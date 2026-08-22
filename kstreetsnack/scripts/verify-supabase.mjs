import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { fullMenuGroups, localizedPrice } from "../app/menu-data.ts";
import { inspectSeed } from "./seed-supabase.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(scriptDirectory, "..");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loadLocalEnvironment() {
  const envPath = path.join(appDirectory, ".env.local");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

function requireEnvironment() {
  loadLocalEnvironment();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const adminKey = process.env.SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const ownerUserId = process.env.SUPABASE_OWNER_USER_ID?.trim();

  if (!url || !adminKey || !publicKey || !ownerUserId) {
    throw new Error(
      "Supabase URL, public key, secret/service-role key, and owner user ID are required.",
    );
  }
  if (!uuidPattern.test(ownerUserId)) {
    throw new Error("SUPABASE_OWNER_USER_ID must be a canonical UUID.");
  }
  if (adminKey === publicKey) {
    throw new Error("The Supabase public and privileged keys must be different.");
  }
  return { url, adminKey, publicKey, ownerUserId };
}

function keyHeaders(key, extraHeaders = {}, useLegacyAuthorization = true) {
  return {
    apikey: key,
    ...(useLegacyAuthorization && key.startsWith("eyJ")
      ? { Authorization: `Bearer ${key}` }
      : {}),
    ...extraHeaders,
  };
}

async function request(config, key, route, init = {}, useLegacyAuthorization = true) {
  const response = await fetch(`${config.url}${route}`, {
    ...init,
    redirect: "error",
    headers: keyHeaders(key, init.headers, useLegacyAuthorization),
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} verification request failed (${response.status}).`);
  }

  const text = await response.text();
  return {
    data: text ? JSON.parse(text) : undefined,
    headers: response.headers,
  };
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} did not return a row array.`);
  return value;
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} did not return an object.`);
  }
  return value;
}

function hasGoogleIdentity(user) {
  return Array.isArray(user?.identities)
    && user.identities.some((identity) => identity?.provider === "google");
}

function hasGoogleAppMetadata(user) {
  const metadata = user?.app_metadata;
  return Boolean(
    metadata
    && typeof metadata === "object"
    && !Array.isArray(metadata)
    && (
      metadata.provider === "google"
      || (Array.isArray(metadata.providers) && metadata.providers.includes("google"))
    )
  );
}

async function verifyGoogleOnlyAuthProviders(config) {
  const { data } = await request(
    config,
    config.publicKey,
    "/auth/v1/settings",
    {},
    false,
  );
  const settings = requireRecord(data, "Supabase Auth settings");
  const external = requireRecord(settings.external, "Supabase Auth provider settings");
  const enabledProviders = Object.entries(external)
    .filter(([, enabled]) => enabled === true)
    .map(([provider]) => provider)
    .sort();
  if (enabledProviders.length !== 1 || enabledProviders[0] !== "google") {
    throw new Error("Supabase Auth must enable Google as the only operator sign-in provider.");
  }
  return { enabled: enabledProviders };
}

async function verifyTableCount(
  config,
  table,
  columns,
  expectedCount,
  key = config.adminKey,
  useLegacyAuthorization = true,
) {
  const { data, headers } = await request(
    config,
    key,
    `/rest/v1/${table}?select=${columns}&limit=1`,
    { headers: { Prefer: "count=exact", Range: "0-0" } },
    useLegacyAuthorization,
  );
  requireArray(data, table);
  const contentRange = headers.get("content-range") ?? "";
  const match = contentRange.match(/\/(\d+)$/);
  const count = match ? Number(match[1]) : Number.NaN;
  if (count !== expectedCount) {
    throw new Error(`${table} count mismatch: expected ${expectedCount}, received ${Number.isNaN(count) ? "unknown" : count}.`);
  }
  return count;
}

async function verifyTableMinimumCount(
  config,
  table,
  columns,
  minimumCount,
  key = config.adminKey,
  useLegacyAuthorization = true,
) {
  const { data, headers } = await request(
    config,
    key,
    `/rest/v1/${table}?select=${columns}&limit=1`,
    { headers: { Prefer: "count=exact", Range: "0-0" } },
    useLegacyAuthorization,
  );
  requireArray(data, table);
  const contentRange = headers.get("content-range") ?? "";
  const match = contentRange.match(/\/(\d+)$/);
  const count = match ? Number(match[1]) : Number.NaN;
  if (Number.isNaN(count) || count < minimumCount) {
    throw new Error(
      `${table} count mismatch: expected at least ${minimumCount}, received ${Number.isNaN(count) ? "unknown" : count}.`,
    );
  }
  return count;
}

async function verifyTableReadable(config, table, columns) {
  const { data } = await request(
    config,
    config.adminKey,
    `/rest/v1/${table}?select=${columns}&limit=1`,
  );
  requireArray(data, table);
  return "ready";
}

async function verifyAnonymousColumnDenied(config, table, column) {
  const response = await fetch(
    `${config.url}/rest/v1/${table}?select=${encodeURIComponent(column)}&limit=1`,
    {
      redirect: "error",
      headers: keyHeaders(config.publicKey, {}, false),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (response.ok) {
    throw new Error(`Anonymous access to ${table}.${column} must be denied.`);
  }
  if (![400, 401, 403].includes(response.status)) {
    throw new Error(
      `Anonymous ${table}.${column} denial returned an unexpected status (${response.status}).`,
    );
  }
  return "denied";
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function snapshotsMatch(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function publicSnapshotProjection(snapshot) {
  const record = requireRecord(snapshot, "menu release snapshot");
  return {
    schema_version: record.schema_version,
    published_at: record.published_at,
    groups: record.groups,
  };
}

async function verifySeedTable(config, table, columns, expectedRows, identityColumn) {
  const { data, headers } = await request(
    config,
    config.adminKey,
    `/rest/v1/${table}?select=${columns}&order=${identityColumn}&limit=${expectedRows.length + 1}`,
    { headers: { Prefer: "count=exact" } },
  );
  const actualRows = requireArray(data, table);
  const contentRange = headers.get("content-range") ?? "";
  const match = contentRange.match(/\/(\d+)$/);
  const count = match ? Number(match[1]) : Number.NaN;
  if (count !== expectedRows.length || actualRows.length !== expectedRows.length) {
    throw new Error(`${table} does not contain the complete initial seed set.`);
  }

  const expectedById = new Map(expectedRows.map((row) => [row[identityColumn], row]));
  for (const row of actualRows) {
    const expected = expectedById.get(row?.[identityColumn]);
    if (!expected || !snapshotsMatch(row, expected)) {
      throw new Error(`${table} contains a non-seed or modified row.`);
    }
  }
  return count;
}

function unwrapRpcResult(value) {
  if (Array.isArray(value) && value.length === 1) return unwrapRpcResult(value[0]);
  if (value && typeof value === "object" && "get_published_menu" in value) {
    return value.get_published_menu;
  }
  if (value && typeof value === "object" && "get_deployable_published_menu" in value) {
    return value.get_deployable_published_menu;
  }
  if (value && typeof value === "object" && "get_menu_release" in value) {
    return value.get_menu_release;
  }
  return value;
}

function expectedPublicGroups() {
  return fullMenuGroups.map((group) => group.map((category) => ({
    id: category.id,
    title: [...category.title],
    subtitle: [...category.subtitle],
    ...(category.orderNote ? { orderNote: [...category.orderNote] } : {}),
    image: `seed/${category.image}`,
    ...(category.cover ? { cover: true } : {}),
    items: category.items.map((item) => ({
      id: item.id,
      name: [...item.name],
      price: [
        item.price,
        localizedPrice(item.price, "en"),
        localizedPrice(item.price, "ko"),
      ],
      ...(item.tag ? { tag: item.tag } : {}),
      image: `seed/${category.image}`,
      availability: "available",
    })),
  })));
}

function publishedSnapshotCounts(value, expectedItemIds) {
  const snapshot = requireRecord(unwrapRpcResult(value), "get_published_menu");
  if (!Array.isArray(snapshot.groups)) {
    throw new Error("Published menu snapshot has no groups array.");
  }

  let categoryCount = 0;
  let itemCount = 0;
  const itemIds = new Set();
  for (const group of snapshot.groups) {
    if (!Array.isArray(group)) throw new Error("Published menu contains an invalid group.");
    categoryCount += group.length;
    for (const category of group) {
      const record = requireRecord(category, "published category");
      if (!Array.isArray(record.items)) {
        throw new Error("Published category contains an invalid items list.");
      }
      itemCount += record.items.length;
      for (const item of record.items) {
        const itemRecord = requireRecord(item, "published menu item");
        if (typeof itemRecord.id !== "string" || itemIds.has(itemRecord.id)) {
          throw new Error("Published menu contains a missing or duplicate item ID.");
        }
        itemIds.add(itemRecord.id);
      }
    }
  }

  if (snapshot.groups.length !== 2 || categoryCount !== 13 || itemCount !== 80) {
    throw new Error("Published menu snapshot does not contain the expected 2/13/80 hierarchy.");
  }
  if (
    itemIds.size !== expectedItemIds.size
    || [...itemIds].some((id) => !expectedItemIds.has(id))
  ) {
    throw new Error("Published menu item IDs do not match the initial seed contract.");
  }
  if (!snapshotsMatch(snapshot.groups, expectedPublicGroups())) {
    throw new Error("Published menu content does not match the initial public seed contract.");
  }
  return { snapshot, groupCount: snapshot.groups.length, categoryCount, itemCount };
}

async function storageResponseIsMissing(response) {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  const body = await response.text();
  try {
    const error = JSON.parse(body.slice(0, 2048));
    return String(error?.statusCode) === "404"
      || error?.code === "not_found"
      || error?.error === "not_found";
  } catch {
    return false;
  }
}

async function verifySeedImages(config, relativePaths) {
  await Promise.all(relativePaths.map(async (relativePath) => {
    const encodedPath = `seed/${relativePath}`.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(
      `${config.url}/storage/v1/object/public/menu-images/${encodedPath}`,
      {
        redirect: "error",
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (await storageResponseIsMissing(response)) {
      throw new Error("A checked-in seed image is missing from menu-images.");
    }
    if (!response.ok) {
      throw new Error(`A public seed image verification request failed (${response.status}).`);
    }

    const localPath = path.join(appDirectory, "public", "menu", ...relativePath.split("/"));
    const [localBytes, remoteBytes] = await Promise.all([
      readFile(localPath),
      response.arrayBuffer(),
    ]);
    const localDigest = createHash("sha256").update(localBytes).digest("hex");
    const remoteDigest = createHash("sha256").update(Buffer.from(remoteBytes)).digest("hex");
    if (localDigest !== remoteDigest) {
      throw new Error("A menu-images seed object differs from its checked-in source.");
    }
  }));
  return relativePaths.length;
}

async function main() {
  const config = requireEnvironment();
  const inspected = await inspectSeed();
  if (inspected.missingImages.length) {
    throw new Error("A menu image referenced by the initial seed is missing locally.");
  }

  const counts = {
    sections: await verifySeedTable(
      config,
      "sections",
      "id,slug,name,description,sort_order,archived_at",
      inspected.sections,
      "id",
    ),
    categories: await verifySeedTable(
      config,
      "categories",
      "id,section_id,slug,name,description,order_note,image_path,cover,is_featured,featured_order,sort_order,archived_at",
      inspected.categories,
      "id",
    ),
    menuItems: await verifySeedTable(
      config,
      "menu_items",
      "id,category_id,slug,name,description,price,image_path,tag,sort_order,archived_at",
      inspected.menuItems,
      "id",
    ),
    availability: await verifySeedTable(
      config,
      "menu_availability",
      "menu_item_id,is_available,note",
      inspected.availability,
      "menu_item_id",
    ),
  };

  const authProviders = await verifyGoogleOnlyAuthProviders(config);

  const { data: authResponse } = await request(
    config,
    config.adminKey,
    `/auth/v1/admin/users/${encodeURIComponent(config.ownerUserId)}`,
  );
  const authUser = authResponse?.user ?? authResponse;
  if (
    !authUser
    || authUser.id !== config.ownerUserId
    || authUser.is_anonymous === true
    || typeof authUser.email !== "string"
    || authUser.email.trim().length === 0
    || !hasGoogleIdentity(authUser)
    || !hasGoogleAppMetadata(authUser)
  ) {
    throw new Error("The configured owner is not an existing Google Auth user with Google app metadata.");
  }

  const { data: ownerRowsValue } = await request(
    config,
    config.adminKey,
    `/rest/v1/admin_users?select=user_id,role,is_active&user_id=eq.${encodeURIComponent(config.ownerUserId)}`,
  );
  const ownerRows = requireArray(ownerRowsValue, "admin_users owner lookup");
  if (ownerRows.length !== 1 || ownerRows[0].role !== "owner" || ownerRows[0].is_active !== true) {
    throw new Error("The configured Auth user is not an active menu owner.");
  }
  const adminUserCount = await verifyTableMinimumCount(
    config,
    "admin_users",
    "user_id,role,is_active",
    1,
  );
  const accessManagement = {
    requests: await verifyTableReadable(
      config,
      "menu_admin_access_requests",
      "user_id,requested_at",
    ),
    audit: await verifyTableReadable(
      config,
      "menu_admin_access_audit",
      "id,actor_user_id,target_user_id,operation,changed_at",
    ),
  };

  const { data: bucketValue } = await request(
    config,
    config.adminKey,
    "/storage/v1/bucket/menu-images",
  );
  const bucket = requireRecord(bucketValue, "menu-images bucket");
  if (
    bucket.id !== "menu-images"
    || bucket.public !== true
    || Number(bucket.file_size_limit) !== 5 * 1024 * 1024
    || !Array.isArray(bucket.allowed_mime_types)
    || !bucket.allowed_mime_types.includes("image/webp")
  ) {
    throw new Error("The menu-images bucket configuration is invalid.");
  }
  const storageImageCount = await verifySeedImages(config, inspected.uploadImages);

  const { data: settingsValue } = await request(
    config,
    config.adminKey,
    "/rest/v1/site_settings?select=id,current_release_id,live_release_id&id=eq.1",
  );
  const settingsRows = requireArray(settingsValue, "site_settings");
  const currentReleaseId = settingsRows[0]?.current_release_id;
  const liveReleaseId = settingsRows[0]?.live_release_id;
  if (
    settingsRows.length !== 1
    || !uuidPattern.test(currentReleaseId ?? "")
    || !uuidPattern.test(liveReleaseId ?? "")
  ) {
    throw new Error("Valid current and live menu releases must both be selected.");
  }

  const releaseColumns = "id,version,snapshot,published_at,deployment_status";
  const [{ data: currentReleaseValue }, { data: liveReleaseValue }] = await Promise.all([
    request(
      config,
      config.adminKey,
      `/rest/v1/menu_releases?select=${releaseColumns}&id=eq.${encodeURIComponent(currentReleaseId)}`,
    ),
    request(
      config,
      config.adminKey,
      `/rest/v1/menu_releases?select=${releaseColumns}&id=eq.${encodeURIComponent(liveReleaseId)}`,
    ),
  ]);
  const currentReleaseRows = requireArray(currentReleaseValue, "current menu release");
  const liveReleaseRows = requireArray(liveReleaseValue, "live menu release");
  const currentRelease = currentReleaseRows[0];
  const liveRelease = liveReleaseRows[0];
  if (
    currentReleaseRows.length !== 1
    || currentRelease?.id !== currentReleaseId
    || !Number.isSafeInteger(Number(currentRelease?.version))
    || !requireRecord(currentRelease?.snapshot, "current menu release snapshot")
  ) {
    throw new Error("The current confirmation release row is missing or invalid.");
  }
  if (
    liveReleaseRows.length !== 1
    || liveRelease?.id !== liveReleaseId
    || !Number.isSafeInteger(Number(liveRelease?.version))
    || liveRelease?.deployment_status !== "succeeded"
    || !requireRecord(liveRelease?.snapshot, "live menu release snapshot")
  ) {
    throw new Error("The live menu release row is missing, invalid, or not successfully deployed.");
  }
  const releaseCount = await verifyTableMinimumCount(
    config,
    "menu_releases",
    "id,version,snapshot,published_at,published_by",
    1,
  );

  const { data: restoreBaselineValue } = await request(
    config,
    config.adminKey,
    "/rest/v1/rpc/get_menu_restore_baseline_bootstrap_status",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
  const restoreBaselineRows = requireArray(restoreBaselineValue, "menu restore baseline");
  const restoreBaseline = restoreBaselineRows[0];
  if (
    restoreBaselineRows.length !== 1
    || restoreBaseline?.baseline_key !== "pre_test_2026_08_21"
    || !uuidPattern.test(restoreBaseline?.source_release_id ?? "")
    || !Number.isSafeInteger(Number(restoreBaseline?.source_release_version))
    || Number(restoreBaseline?.item_count) !== 80
    || Number.isNaN(Date.parse(restoreBaseline?.captured_at ?? ""))
  ) {
    throw new Error("The immutable 80-item menu recovery baseline is missing or invalid.");
  }

  const { data: publicSnapshotValue } = await request(
    config,
    config.publicKey,
    "/rest/v1/rpc/get_published_menu",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
    false,
  );
  const published = publishedSnapshotCounts(
    publicSnapshotValue,
    new Set(inspected.menuItems.map((item) => item.id)),
  );
  if (!snapshotsMatch(published.snapshot, publicSnapshotProjection(liveRelease.snapshot))) {
    throw new Error("The public RPC snapshot does not match the live release.");
  }
  if (!snapshotsMatch(Object.keys(published.snapshot).sort(), ["groups", "published_at", "schema_version"])) {
    throw new Error("The public RPC exposed fields outside the public menu projection.");
  }

  const { data: deployableSnapshotValue } = await request(
    config,
    config.publicKey,
    "/rest/v1/rpc/get_deployable_published_menu",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
    false,
  );
  const deployable = publishedSnapshotCounts(
    deployableSnapshotValue,
    new Set(inspected.menuItems.map((item) => item.id)),
  );
  if (!snapshotsMatch(deployable.snapshot, publicSnapshotProjection(liveRelease.snapshot))) {
    throw new Error("The routine deployment RPC does not match the idle live release.");
  }

  const { data: publicLiveReleaseValue } = await request(
    config,
    config.publicKey,
    "/rest/v1/rpc/get_menu_release",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_release_id: liveReleaseId }),
    },
    false,
  );
  const publicLiveRelease = requireRecord(
    unwrapRpcResult(publicLiveReleaseValue),
    "public live menu release",
  );
  if (!snapshotsMatch(publicLiveRelease, publicSnapshotProjection(liveRelease.snapshot))) {
    throw new Error("The public exact-release RPC does not match the approved live release.");
  }

  if (
    currentReleaseId !== liveReleaseId
    && ["not_requested", "failed"].includes(currentRelease.deployment_status)
  ) {
    const { data: unapprovedReleaseValue } = await request(
      config,
      config.publicKey,
      "/rest/v1/rpc/get_menu_release",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p_release_id: currentReleaseId }),
      },
      false,
    );
    if (unwrapRpcResult(unapprovedReleaseValue) !== null) {
      throw new Error("An unapproved or failed confirmation release was exposed publicly.");
    }
  }
  if (
    published.snapshot.schema_version !== 1
    || published.snapshot.published_at !== liveRelease.published_at
    || Number.isNaN(Date.parse(published.snapshot.published_at))
  ) {
    throw new Error("The live release metadata is invalid or inconsistent.");
  }

  const publicAvailabilityCount = await verifyTableCount(
    config,
    "menu_availability",
    "menu_item_id,is_available",
    80,
    config.publicKey,
    false,
  );
  const restrictedAvailability = {
    note: await verifyAnonymousColumnDenied(config, "menu_availability", "note"),
    updatedAt: await verifyAnonymousColumnDenied(config, "menu_availability", "updated_at"),
  };

  console.log(JSON.stringify({
    mode: "verified",
    counts,
    owner: "active",
    authProviders,
    ownerAuth: { googleIdentity: "ready", googleAppMetadata: "ready" },
    adminUsers: adminUserCount,
    accessManagement,
    bucket: { status: "ready", seedImages: storageImageCount },
    releases: releaseCount,
    restoreBaseline: {
      status: "ready",
      sourceReleaseId: restoreBaseline.source_release_id,
      menuItems: Number(restoreBaseline.item_count),
    },
    currentReleaseVersion: Number(currentRelease.version),
    liveReleaseVersion: Number(liveRelease.version),
    publicMenu: {
      groups: published.groupCount,
      categories: published.categoryCount,
      menuItems: published.itemCount,
    },
    publicAvailability: {
      menuItems: publicAvailabilityCount,
      restrictedColumns: restrictedAvailability,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Supabase verification failed.");
  process.exitCode = 1;
});
