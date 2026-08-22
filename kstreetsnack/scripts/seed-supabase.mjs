import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  fullMenuGroups,
  localizedPrice,
  menuUi,
  seedMenuItemId,
} from "../app/menu-data.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(scriptDirectory, "..");
const menuImageDirectory = path.join(appDirectory, "public", "menu");
const dryRun = process.argv.includes("--dry-run");
const forceOverwrite = process.argv.includes("--force-overwrite");
const resume = process.argv.includes("--resume");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const localized = (value) => ({ pl: value[0], en: value[1], ko: value[2] });
const blankLocalized = () => ({});

/** Stable UUIDs let an explicitly forced overwrite target only seed-owned rows. */
export function stableUuid(value) {
  const bytes = createHash("sha256").update(`ksnack-menu-v1:${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildSeedRows() {
  const sectionDefinitions = [
    { slug: "food", groupIndex: 0 },
    { slug: "cafe-drinks", groupIndex: 1 },
  ];
  const sections = sectionDefinitions.map(({ slug, groupIndex }) => ({
    id: stableUuid(`section:${slug}`),
    slug,
    name: {
      pl: menuUi.pl.groups[groupIndex],
      en: menuUi.en.groups[groupIndex],
      ko: menuUi.ko.groups[groupIndex],
    },
    description: blankLocalized(),
    sort_order: groupIndex,
    archived_at: null,
  }));

  const categories = fullMenuGroups.flatMap((group, groupIndex) =>
    group.map((category, categoryIndex) => ({
      id: stableUuid(`category:${category.id}`),
      section_id: sections[groupIndex].id,
      slug: category.id,
      name: localized(category.title),
      description: localized(category.subtitle),
      order_note: category.orderNote ? localized(category.orderNote) : blankLocalized(),
      image_path: `seed/${category.image}`,
      cover: category.cover ?? false,
      is_featured: false,
      featured_order: null,
      sort_order: categoryIndex,
      archived_at: null,
    })),
  );
  const categoryIdBySlug = new Map(categories.map((category) => [category.slug, category.id]));

  const menuItems = fullMenuGroups.flatMap((group) =>
    group.flatMap((category) =>
      category.items.map((item, itemIndex) => {
        const itemNumber = itemIndex + 1;
        const id = seedMenuItemId(category.id, itemNumber);
        const originalId = stableUuid(`item:${category.id}:${itemNumber}`);
        if (id !== originalId || item.id !== originalId) {
          throw new Error(`Stable menu item ID contract changed for ${category.id}-${itemNumber}.`);
        }
        return {
          id,
          category_id: categoryIdBySlug.get(category.id),
          slug: `${category.id}-${itemNumber}`,
          name: localized(item.name),
          description: blankLocalized(),
          price: {
            pl: item.price,
            en: localizedPrice(item.price, "en"),
            ko: localizedPrice(item.price, "ko"),
          },
          image_path: `seed/${category.image}`,
          tag: item.tag ?? null,
          sort_order: itemIndex,
          archived_at: null,
        };
      }),
    ),
  );
  const availability = menuItems.map((item) => ({
    menu_item_id: item.id,
    is_available: true,
    note: blankLocalized(),
  }));

  return { sections, categories, menuItems, availability };
}

async function walkFiles(directory, relativeDirectory = "") {
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(directory, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

export async function inspectSeed() {
  const rows = buildSeedRows();
  const uploadImages = (await walkFiles(menuImageDirectory))
    .filter((file) => file.endsWith(".webp"));
  const referencedImages = [...new Set(rows.categories.map((category) => category.image_path.slice("seed/".length)))];
  const missingImages = referencedImages.filter((relativePath) =>
    !existsSync(path.join(menuImageDirectory, ...relativePath.split("/"))),
  );
  return { ...rows, referencedImages, uploadImages, missingImages };
}

function loadLocalEnvironment() {
  const envPath = path.join(appDirectory, ".env.local");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

function requireEnvironment() {
  loadLocalEnvironment();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const adminKey = process.env.SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ownerUserId = process.env.SUPABASE_OWNER_USER_ID?.trim();
  if (!url || !adminKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or the legacy "
      + "SUPABASE_SERVICE_ROLE_KEY) are required. "
      + "Copy .env.example to .env.local, or use --dry-run for local validation.",
    );
  }
  if (!ownerUserId) {
    throw new Error("SUPABASE_OWNER_USER_ID is required for the initial seed.");
  }
  if (!uuidPattern.test(ownerUserId)) {
    throw new Error("SUPABASE_OWNER_USER_ID must be a canonical UUID.");
  }
  return { url, adminKey, ownerUserId };
}

async function request(config, route, init = {}) {
  const response = await fetch(`${config.url}${route}`, {
    ...init,
    redirect: "error",
    headers: {
      apikey: config.adminKey,
      // New sb_secret_* keys are opaque API keys and must not be sent as a
      // bearer token. Legacy service_role JWTs still use Authorization.
      ...(config.adminKey.startsWith("eyJ")
        ? { Authorization: `Bearer ${config.adminKey}` }
        : {}),
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${route} failed (${response.status}).`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

export function hasExistingMenuData(menuItems, siteSettings) {
  return menuItems.length > 0
    || siteSettings.some((setting) => Boolean(setting?.current_release_id));
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

function seedRowsMatch(actual, expected) {
  return JSON.stringify(canonicalJson(actual)) === JSON.stringify(canonicalJson(expected));
}

function assertSeedOwnedSubset(label, actualRows, expectedRows, identityColumn) {
  if (!Array.isArray(actualRows)) throw new Error(`Could not inspect ${label} before seeding.`);
  if (actualRows.length > expectedRows.length) {
    throw new Error(`Cannot resume: ${label} contains rows outside the initial seed.`);
  }

  const expectedById = new Map(expectedRows.map((row) => [row[identityColumn], row]));
  for (const row of actualRows) {
    const id = row?.[identityColumn];
    const expected = expectedById.get(id);
    if (!expected || !seedRowsMatch(row, expected)) {
      throw new Error(`Cannot resume: ${label} contains a non-seed or modified row.`);
    }
  }
}

function assertCompleteSeedSet(label, actualRows, expectedRows, identityColumn) {
  assertSeedOwnedSubset(label, actualRows, expectedRows, identityColumn);
  if (actualRows.length !== expectedRows.length) {
    throw new Error(`The ${label} seed set is incomplete after writing.`);
  }
}

function hasGoogleIdentity(user) {
  return Array.isArray(user?.identities)
    && user.identities.some((identity) => identity?.provider === "google");
}

async function assertOwnerUserExists(config) {
  const response = await request(
    config,
    `/auth/v1/admin/users/${encodeURIComponent(config.ownerUserId)}`,
  );
  const user = response?.user ?? response;
  if (
    !user
    || user.id !== config.ownerUserId
    || user.is_anonymous === true
    || typeof user.email !== "string"
    || user.email.trim().length === 0
    || !hasGoogleIdentity(user)
  ) {
    throw new Error("SUPABASE_OWNER_USER_ID must identify an existing Google Auth user.");
  }
}

async function inspectRemoteSeedState(config, inspected) {
  const [sections, categories, menuItems, availability, adminUsers, releases, siteSettings] = await Promise.all([
    request(config, `/rest/v1/sections?select=id,slug,name,description,sort_order,archived_at&order=id&limit=${inspected.sections.length + 1}`),
    request(config, `/rest/v1/categories?select=id,section_id,slug,name,description,order_note,image_path,cover,is_featured,featured_order,sort_order,archived_at&order=id&limit=${inspected.categories.length + 1}`),
    request(config, `/rest/v1/menu_items?select=id,category_id,slug,name,description,price,image_path,tag,sort_order,archived_at&order=id&limit=${inspected.menuItems.length + 1}`),
    request(config, `/rest/v1/menu_availability?select=menu_item_id,is_available,note&order=menu_item_id&limit=${inspected.availability.length + 1}`),
    request(config, "/rest/v1/admin_users?select=user_id,role,is_active&order=user_id&limit=2"),
    request(config, "/rest/v1/menu_releases?select=id&order=version&limit=2"),
    request(config, "/rest/v1/site_settings?select=id,current_release_id&order=id&limit=2"),
  ]);
  return { sections, categories, menuItems, availability, adminUsers, releases, siteSettings };
}

async function inspectRemoteSeedImages(config, relativePaths) {
  const existing = new Set();
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
    if (response.status === 404) return;
    if (response.status === 400) {
      const body = await response.text();
      try {
        const error = JSON.parse(body.slice(0, 2048));
        if (
          String(error?.statusCode) === "404"
          || error?.code === "not_found"
          || error?.error === "not_found"
        ) return;
      } catch {
        // A non-JSON 400 is not a safe missing-object signal.
      }
    }
    if (!response.ok) {
      throw new Error(`Could not inspect an existing seed image (${response.status}).`);
    }

    const localPath = path.join(menuImageDirectory, ...relativePath.split("/"));
    const [localBytes, remoteBytes] = await Promise.all([
      readFile(localPath),
      response.arrayBuffer(),
    ]);
    const localDigest = createHash("sha256").update(localBytes).digest("hex");
    const remoteDigest = createHash("sha256").update(Buffer.from(remoteBytes)).digest("hex");
    if (localDigest !== remoteDigest) {
      throw new Error("Cannot resume: an existing seed image differs from the checked-in file.");
    }
    existing.add(relativePath);
  }));
  return existing;
}

async function assertSafeSeedStart(config, inspected) {
  const state = await inspectRemoteSeedState(config, inspected);
  const singleton = state.siteSettings.find((setting) => setting?.id === 1);
  if (!singleton || state.siteSettings.length !== 1) {
    throw new Error("The site_settings singleton is missing or invalid; reapply the migration first.");
  }

  if (forceOverwrite) {
    console.warn("Protected seed-row overwrite mode is enabled.");
    return { existingImages: new Set(), publishedReleaseId: null };
  }

  const existingImages = await inspectRemoteSeedImages(config, inspected.uploadImages);

  if (!resume) {
    const containsRows = state.sections.length > 0
      || state.categories.length > 0
      || state.menuItems.length > 0
      || state.availability.length > 0
      || state.adminUsers.length > 0
      || state.releases.length > 0
      || Boolean(singleton.current_release_id)
      || existingImages.size > 0;
    if (!containsRows) return { existingImages, publishedReleaseId: null };
    throw new Error(
      "Existing menu administration data detected. The initial seed stopped to protect it. "
      + "Use --resume only for a verified partial failure before publication.",
    );
  }

  if (singleton.current_release_id || state.releases.length > 0) {
    const publishedReleaseId = singleton.current_release_id;
    if (
      !uuidPattern.test(publishedReleaseId ?? "")
      || state.releases.length !== 1
      || state.releases[0]?.id !== publishedReleaseId
    ) {
      throw new Error("Cannot resume: the initial release state is not singular and exact.");
    }

    // publish_initial_menu may have committed before the client lost its
    // response or before baseline capture completed. Resume only that exact,
    // untouched seed and continue with the idempotent capture RPC.
    assertCompleteSeedSet("sections", state.sections, inspected.sections, "id");
    assertCompleteSeedSet("categories", state.categories, inspected.categories, "id");
    assertCompleteSeedSet("menu_items", state.menuItems, inspected.menuItems, "id");
    assertCompleteSeedSet(
      "menu_availability",
      state.availability,
      inspected.availability,
      "menu_item_id",
    );
    assertCompleteSeedSet("admin_users", state.adminUsers, [{
      user_id: config.ownerUserId,
      role: "owner",
      is_active: true,
    }], "user_id");
    if (existingImages.size !== inspected.uploadImages.length) {
      throw new Error("Cannot resume: the published initial seed image set is incomplete.");
    }
    return { existingImages, publishedReleaseId };
  }

  assertSeedOwnedSubset("sections", state.sections, inspected.sections, "id");
  assertSeedOwnedSubset("categories", state.categories, inspected.categories, "id");
  assertSeedOwnedSubset("menu_items", state.menuItems, inspected.menuItems, "id");
  assertSeedOwnedSubset(
    "menu_availability",
    state.availability,
    inspected.availability,
    "menu_item_id",
  );
  assertSeedOwnedSubset("admin_users", state.adminUsers, [{
    user_id: config.ownerUserId,
    role: "owner",
    is_active: true,
  }], "user_id");
  return { existingImages, publishedReleaseId: null };
}

function parseRestoreBaselineRow(value, expectedReleaseId, label, allowMissing = false) {
  if (!Array.isArray(value)) throw new Error(`${label} did not return a row array.`);
  if (allowMissing && value.length === 0) return null;
  if (value.length !== 1) throw new Error(`${label} did not return exactly one row.`);
  const row = value[0];
  if (
    !row
    || row.baseline_key !== "pre_test_2026_08_21"
    || row.source_release_id !== expectedReleaseId
    || !Number.isSafeInteger(Number(row.source_release_version))
    || Number(row.item_count) !== 80
    || typeof row.captured_at !== "string"
    || Number.isNaN(Date.parse(row.captured_at))
  ) {
    throw new Error(`${label} did not match the immutable initial 80-item release.`);
  }
  return row;
}

async function loadRestoreBaselineStatus(config, expectedReleaseId) {
  const value = await request(
    config,
    "/rest/v1/rpc/get_menu_restore_baseline_bootstrap_status",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
  return parseRestoreBaselineRow(value, expectedReleaseId, "Restore baseline status", true);
}

async function captureInitialRestoreBaseline(config, expectedReleaseId) {
  try {
    const value = await request(
      config,
      "/rest/v1/rpc/capture_pretest_menu_restore_baseline",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p_expected_release_id: expectedReleaseId }),
      },
    );
    const row = parseRestoreBaselineRow(
      value,
      expectedReleaseId,
      "Restore baseline capture",
    );
    if (typeof row.created !== "boolean") {
      throw new Error("Restore baseline capture did not return its creation state.");
    }
    return { ...row, response_reconciled: false };
  } catch (captureError) {
    // A committed RPC can lose its HTTP response. Re-read through a separate
    // read-only RPC before declaring failure; a later --resume performs the
    // same safe reconciliation if the network is still unavailable now.
    try {
      const row = await loadRestoreBaselineStatus(config, expectedReleaseId);
      if (row) return { ...row, created: false, response_reconciled: true };
    } catch {
      // Preserve the original capture error, which is the actionable failure.
    }
    throw captureError;
  }
}

async function writeSeedRows(config, table, rows, conflictColumns) {
  await request(
    config,
    `/rest/v1/${table}?on_conflict=${encodeURIComponent(conflictColumns)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: `${forceOverwrite ? "resolution=merge-duplicates" : "resolution=ignore-duplicates"},return=minimal`,
      },
      body: JSON.stringify(rows),
    },
  );
}

async function uploadMenuImages(config, relativePaths, existingImages) {
  let uploaded = 0;
  for (const relativePath of relativePaths) {
    if (!forceOverwrite && existingImages.has(relativePath)) continue;
    const absolutePath = path.join(menuImageDirectory, ...relativePath.split("/"));
    const fileStats = await stat(absolutePath);
    if (fileStats.size > 5 * 1024 * 1024) {
      throw new Error(`Image exceeds the 5 MB bucket limit: ${relativePath}`);
    }
    const objectPath = `seed/${relativePath}`;
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    await request(config, `/storage/v1/object/menu-images/${encodedPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "image/webp",
        "x-upsert": forceOverwrite ? "true" : "false",
      },
      body: await readFile(absolutePath),
    });
    uploaded += 1;
  }
  return uploaded;
}

async function assertSeedCompletedBeforePublish(config, inspected) {
  if (forceOverwrite) return;
  const state = await inspectRemoteSeedState(config, inspected);
  const singleton = state.siteSettings.find((setting) => setting?.id === 1);
  if (
    !singleton
    || state.siteSettings.length !== 1
    || singleton.current_release_id
    || state.releases.length > 0
  ) {
    throw new Error("Seed state changed before publication; publication was stopped.");
  }

  assertCompleteSeedSet("sections", state.sections, inspected.sections, "id");
  assertCompleteSeedSet("categories", state.categories, inspected.categories, "id");
  assertCompleteSeedSet("menu_items", state.menuItems, inspected.menuItems, "id");
  assertCompleteSeedSet(
    "menu_availability",
    state.availability,
    inspected.availability,
    "menu_item_id",
  );
  assertCompleteSeedSet("admin_users", state.adminUsers, [{
    user_id: config.ownerUserId,
    role: "owner",
    is_active: true,
  }], "user_id");
}

async function main() {
  if (resume && forceOverwrite) {
    throw new Error("Resume and protected overwrite modes cannot be combined.");
  }

  const inspected = await inspectSeed();
  if (inspected.missingImages.length) {
    throw new Error(`Missing referenced menu images: ${inspected.missingImages.join(", ")}`);
  }

  const summary = {
    sections: inspected.sections.length,
    categories: inspected.categories.length,
    menuItems: inspected.menuItems.length,
    referencedImages: inspected.referencedImages.length,
  };
  if (dryRun) {
    console.log(JSON.stringify({ mode: "dry-run", ...summary }, null, 2));
    return;
  }

  const config = requireEnvironment();
  await assertOwnerUserExists(config);
  const { existingImages, publishedReleaseId } = await assertSafeSeedStart(config, inspected);
  if (publishedReleaseId) {
    const restoreBaseline = await captureInitialRestoreBaseline(config, publishedReleaseId);
    console.log(JSON.stringify({
      mode: "supabase-resume",
      ...summary,
      uploadedImages: 0,
      ownerCreated: true,
      releaseId: publishedReleaseId,
      restoreBaseline: {
        sourceReleaseId: restoreBaseline.source_release_id,
        itemCount: Number(restoreBaseline.item_count),
        created: restoreBaseline.created,
        responseReconciled: restoreBaseline.response_reconciled,
      },
      deploymentTriggered: false,
    }, null, 2));
    return;
  }
  const uploadedImages = await uploadMenuImages(config, inspected.uploadImages, existingImages);
  await writeSeedRows(config, "sections", inspected.sections, "id");
  await writeSeedRows(config, "categories", inspected.categories, "id");
  await writeSeedRows(config, "menu_items", inspected.menuItems, "id");
  await writeSeedRows(config, "menu_availability", inspected.availability, "menu_item_id");

  await writeSeedRows(config, "admin_users", [{
    user_id: config.ownerUserId,
    role: "owner",
    is_active: true,
  }], "user_id");
  await request(
    config,
    `/rest/v1/menu_admin_access_requests?user_id=eq.${encodeURIComponent(config.ownerUserId)}`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
  );

  await assertSeedCompletedBeforePublish(config, inspected);
  if (!forceOverwrite) {
    const completedImages = await inspectRemoteSeedImages(config, inspected.uploadImages);
    if (completedImages.size !== inspected.uploadImages.length) {
      throw new Error("The seed image set is incomplete after writing.");
    }
  }

  const publishRpc = forceOverwrite ? "publish_menu" : "publish_initial_menu";
  const releaseId = await request(config, `/rest/v1/rpc/${publishRpc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (typeof releaseId !== "string" || !uuidPattern.test(releaseId)) {
    throw new Error("The initial publish RPC did not return a release UUID.");
  }
  const restoreBaseline = forceOverwrite
    ? null
    : await captureInitialRestoreBaseline(config, releaseId);
  console.log(JSON.stringify({
    mode: resume ? "supabase-resume" : "supabase",
    ...summary,
    uploadedImages,
    ownerCreated: true,
    releaseId,
    restoreBaseline: restoreBaseline ? {
      sourceReleaseId: restoreBaseline.source_release_id,
      itemCount: Number(restoreBaseline.item_count),
      created: restoreBaseline.created,
      responseReconciled: restoreBaseline.response_reconciled,
    } : null,
    deploymentTriggered: false,
  }, null, 2));
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
