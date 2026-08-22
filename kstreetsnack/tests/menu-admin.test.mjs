import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { fullMenuGroups } from "../app/menu-data.ts";
import {
  balanceSlideColumns,
  paginateCategories,
  partitionSlideColumns,
  splitPrice,
} from "../app/admin/displays/board-utils.ts";
import { safeJsonLdStringify } from "../lib/json-ld.ts";
import {
  diffReleasePayloads,
  normalizeReleasePayload,
  summarizeReleasePayload,
} from "../lib/menu-admin/release-details.ts";
import { reorderAdminState, reorderAdminStateByOffset, withReorderBaseline } from "../lib/menu-admin/reorder.ts";
import {
  buildSeedRows,
  hasExistingMenuData,
  inspectSeed,
  stableUuid,
} from "../scripts/seed-supabase.mjs";
import {
  deploymentOutcomeFromJobs,
  isDeploymentConflict,
} from "../../supabase/functions/menu-deploy/reconciliation.ts";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function reorderFixture() {
  const text = (value) => ({ pl: value, en: value, ko: value });
  const category = (id, sectionId, sortOrder, archivedAt = null) => ({
    id, sectionId, slug: id, name: text(id), description: text(""), orderNote: text(""),
    imagePath: "static:test.webp", cover: false, sortOrder, archivedAt,
  });
  const item = (id, categoryId, sortOrder, archivedAt = null) => ({
    id, categoryId, slug: id, name: text(id), description: text(""), price: text("1 zł"),
    imagePath: "", tag: "", sortOrder, isAvailable: true, archivedAt, updatedAt: "",
  });
  return {
    schemaVersion: 1,
    sections: [
      { id: "section-a", slug: "a", name: text("A"), description: text(""), sortOrder: 0, archivedAt: null },
      { id: "section-b", slug: "b", name: text("B"), description: text(""), sortOrder: 1, archivedAt: null },
    ],
    categories: [
      category("category-a", "section-a", 0),
      category("category-b", "section-a", 1),
      category("category-archived", "section-a", 2, "2026-01-01T00:00:00.000Z"),
      category("category-c", "section-b", 0),
    ],
    items: [
      item("item-a", "category-a", 0),
      item("item-b", "category-a", 1),
      item("item-archived", "category-a", 2, "2026-01-01T00:00:00.000Z"),
      item("item-c", "category-c", 0),
    ],
    releases: [],
  };
}

function publicItem(id, nameKo, availability = "available", overrides = {}) {
  return {
    id,
    name: [`${id} PL`, `${id} EN`, nameKo],
    price: ["10 zł", "10 PLN", "10즈워티"],
    availability,
    ...overrides,
  };
}

function publicCategory(id, nameKo, items, overrides = {}) {
  return {
    id,
    title: [`${id} PL`, `${id} EN`, nameKo],
    subtitle: ["", "", ""],
    image: `static:${id}.webp`,
    items,
    ...overrides,
  };
}

function releaseSnapshot(groups, keyStyle = "snake") {
  return keyStyle === "camel"
    ? { schemaVersion: 1, publishedAt: "2026-08-19T00:00:00.000Z", groups }
    : { schema_version: 1, published_at: "2026-08-19T00:00:00.000Z", groups };
}

async function loadIsolatedSupabaseClient() {
  const typescriptModule = await import("typescript");
  const typescript = typescriptModule.default ?? typescriptModule;
  const source = readFileSync(path.resolve(appDirectory, "lib", "menu-admin", "supabase-rest.ts"), "utf8")
    .replace(
      'import { normalizeReleasePayload, summarizeReleasePayload } from "./release-details";',
      "const normalizeReleasePayload = () => undefined; const summarizeReleasePayload = () => ({ itemCount: 0 });",
    );
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
  }).outputText;
  const encoded = Buffer.from(compiled).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

async function loadIsolatedPublishedMenu() {
  const typescriptModule = await import("typescript");
  const typescript = typescriptModule.default ?? typescriptModule;
  const source = readFileSync(path.resolve(appDirectory, "lib", "menu", "published-menu.ts"), "utf8")
    .replace(
      'import { fullMenuGroups } from "@/app/menu-data";',
      'const fullMenuGroups = [[{ id: "fallback", title: ["Fallback", "Fallback", "Fallback"], subtitle: ["", "", ""], image: "fallback.webp", items: [] }]];',
    );
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
  }).outputText;
  const encoded = Buffer.from(compiled).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

test("TV menu pagination caps category cards and preserves oversized categories", () => {
  const smallCategories = Array.from({ length: 9 }, (_, categoryIndex) => publicCategory(
    `category-${categoryIndex}`,
    `카테고리 ${categoryIndex}`,
    [publicItem(`item-${categoryIndex}`, `메뉴 ${categoryIndex}`)],
  ));
  const slides = paginateCategories(smallCategories, 14, 4);

  assert.deepEqual(slides.map((slide) => slide.length), [4, 4, 1]);
  assert.equal(slides.flatMap((slide) => slide).flatMap((slice) => slice.items).length, 9);
  assert.equal(balanceSlideColumns(slides[0]).flat().length, 4);

  const oversized = publicCategory(
    "ramen",
    "셀프 라면",
    Array.from({ length: 17 }, (_, index) => publicItem(`ramen-${index}`, `라면 ${index}`)),
  );
  const oversizedSlides = paginateCategories([oversized], 14);
  assert.deepEqual(oversizedSlides.map((slide) => slide[0].items.length), [14, 3]);
  assert.deepEqual(oversizedSlides.map((slide) => slide[0].continuation), [false, true]);
});

test("current food and cafe menus each fit one ordered three-column TV board", () => {
  const boardPlans = [
    { categories: fullMenuGroups[0], itemCapacity: 44, expectedItems: 37 },
    { categories: fullMenuGroups[1], itemCapacity: 50, expectedItems: 43 },
  ];

  for (const { categories, itemCapacity, expectedItems } of boardPlans) {
    const slides = paginateCategories(categories, itemCapacity, 10);
    assert.equal(slides.length, 1);

    const columns = partitionSlideColumns(slides[0], 3);
    assert.equal(columns.length, 3);
    assert.deepEqual(
      columns.flat().map((slice) => slice.category.id),
      categories.map((category) => category.id),
    );
    assert.equal(
      columns.flatMap((column) => column).flatMap((slice) => slice.items).length,
      expectedItems,
    );
    assert.ok(columns.every((column) => column.length > 0));
  }
});

test("TV menu prices split Polish quantity options into scannable pairs", () => {
  assert.deepEqual(
    splitPrice(["1 szt. 5 zł · 3 szt. 13 zł · 5 szt. 21 zł", "", ""]),
    [
      { label: "1 szt.", value: "5 zł" },
      { label: "3 szt.", value: "13 zł" },
      { label: "5 szt.", value: "21 zł" },
    ],
  );
});

test("TV menu motion is subtle, stable across availability refreshes, and reduced-motion safe", () => {
  const boardSource = readFileSync(path.resolve(appDirectory, "app", "admin", "displays", "display-board.tsx"), "utf8");
  const boardCss = readFileSync(path.resolve(appDirectory, "app", "admin", "displays", "display-board.module.css"), "utf8");

  assert.match(boardSource, /key=\{`\$\{kind\}-\$\{slideIndex\}`\}/);
  assert.match(boardSource, /key=\{item\.id \?\?/);
  assert.match(boardCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(boardCss, /\.soldOutLabel[\s\S]*animation: soldOutStamp/);
  assert.match(boardCss, /\.categoryImage[\s\S]*animation: categoryImageAmbient 24s[^;]*infinite/);
  assert.match(boardCss, /@keyframes brandLogoYSpin[\s\S]*rotateY\(360deg\)/);
  assert.match(boardCss, /\.brandLockup img[\s\S]*animation: brandLogoYSpin 20s[^;]*infinite/);
  assert.match(boardCss, /\.cafeBoard \.column:nth-child\(3\)[\s\S]*background: var\(--board-cream\)/);
  assert.doesNotMatch(boardCss, /\.menuRow\s*\{[^}]*animation:[^;]*infinite/is);
  assert.match(boardCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.brandLockup img,[\s\S]*\.categoryImage,[\s\S]*animation: none !important/);
});

test("current menu seed contains every existing category and item", () => {
  const rows = buildSeedRows();
  const sourceCategories = fullMenuGroups.flat();
  const sourceItems = sourceCategories.flatMap((category) => category.items);

  assert.equal(rows.sections.length, 2);
  assert.equal(rows.categories.length, sourceCategories.length);
  assert.equal(rows.menuItems.length, sourceItems.length);
  assert.equal(rows.availability.length, sourceItems.length);
  assert.equal(rows.categories.length, 13);
  assert.equal(rows.menuItems.length, 80);
  assert.ok(rows.menuItems.every((item) => item.name.pl && item.name.en && item.name.ko));
  assert.ok(rows.menuItems.every((item) => item.price.pl && item.price.en && item.price.ko));
  assert.ok(rows.availability.every((entry) => entry.is_available));
});

test("seed identifiers are stable UUIDs", () => {
  assert.equal(stableUuid("category:kimbap"), stableUuid("category:kimbap"));
  assert.match(stableUuid("category:kimbap"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("checked-in fallback menu IDs match seeded Supabase availability IDs", () => {
  const fallbackIds = fullMenuGroups.flatMap((group) =>
    group.flatMap((category) => category.items.map((menuItem) => menuItem.id)),
  );
  const seededIds = buildSeedRows().menuItems.map((menuItem) => menuItem.id);

  assert.equal(fallbackIds.length, 80);
  assert.equal(new Set(fallbackIds).size, 80);
  assert.ok(fallbackIds.every((id) => typeof id === "string" && id.length > 0));
  assert.deepEqual(fallbackIds, seededIds);
});

test("every referenced initial photo exists", async () => {
  const inspected = await inspectSeed();
  assert.deepEqual(inspected.missingImages, []);
  for (const image of inspected.referencedImages) {
    assert.ok(existsSync(path.join(appDirectory, "public", "menu", image)), image);
  }
});

test("manager-authored JSON-LD cannot terminate its script element", () => {
  const serialized = safeJsonLdStringify({ name: "</script><script>alert(1)</script>" });
  assert.equal(serialized.includes("<"), false);
  assert.equal(serialized.includes("</script>"), false);
  assert.match(serialized, /\\u003c\/script\\u003e/);
  assert.deepEqual(JSON.parse(serialized), { name: "</script><script>alert(1)</script>" });
});

test("initial seed detects data that must not be overwritten", () => {
  assert.equal(hasExistingMenuData([], [{ current_release_id: null }]), false);
  assert.equal(hasExistingMenuData([{ id: "existing" }], [{ current_release_id: null }]), true);
  assert.equal(hasExistingMenuData([], [{ current_release_id: "release" }]), true);
});

test("Supabase bootstrap is transactional, owner-gated, resumable, and read-only verifiable", () => {
  const migration = readFileSync(
    path.resolve(appDirectory, "..", "supabase", "migrations", "20260819000000_create_menu_admin_schema.sql"),
    "utf8",
  );
  const seedScript = readFileSync(path.resolve(appDirectory, "scripts", "seed-supabase.mjs"), "utf8");
  const verifyScript = readFileSync(path.resolve(appDirectory, "scripts", "verify-supabase.mjs"), "utf8");
  const envExample = readFileSync(path.resolve(appDirectory, ".env.example"), "utf8");
  const packageJson = JSON.parse(readFileSync(path.resolve(appDirectory, "package.json"), "utf8"));

  assert.ok(migration.indexOf("begin;") < migration.indexOf("create table"));
  assert.match(migration, /commit;\s*$/);
  assert.match(seedScript, /SUPABASE_OWNER_USER_ID is required for the initial seed/);
  assert.match(seedScript, /identity\?\.provider === "google"/);
  assert.ok(seedScript.indexOf("await assertOwnerUserExists(config)") < seedScript.indexOf("await assertSafeSeedStart(config, inspected)"));
  assert.ok(seedScript.indexOf("await assertSafeSeedStart(config, inspected)") < seedScript.indexOf("await uploadMenuImages("));
  assert.match(seedScript, /Cannot resume: the initial release state is not singular and exact/);
  assert.match(seedScript, /state\.releases\.length !== 1[\s\S]*state\.releases\[0\]\?\.id !== publishedReleaseId/);
  assert.match(seedScript, /capture_pretest_menu_restore_baseline/);
  assert.match(seedScript, /get_menu_restore_baseline_bootstrap_status/);
  assert.match(seedScript, /response_reconciled: true/);
  assert.match(seedScript, /const restoreBaseline = forceOverwrite[\s\S]*captureInitialRestoreBaseline\(config, releaseId\)/);
  assert.match(seedScript, /resolution=ignore-duplicates/);
  assert.match(seedScript, /await assertSeedCompletedBeforePublish\(config, inspected\)/);
  assert.match(seedScript, /menu_admin_access_requests\?user_id=eq/);
  assert.match(verifyScript, /verifyTableCount\([\s\S]*"sections"[\s\S]*2/);
  assert.match(verifyScript, /verifyTableCount\([\s\S]*"menu_items"[\s\S]*80/);
  assert.match(verifyScript, /\/rest\/v1\/rpc\/get_published_menu/);
  assert.match(verifyScript, /\/rest\/v1\/rpc\/get_deployable_published_menu/);
  assert.match(verifyScript, /select=id,current_release_id,live_release_id/);
  assert.match(verifyScript, /published\.snapshot, publicSnapshotProjection\(liveRelease\.snapshot\)/);
  assert.match(verifyScript, /Object\.keys\(published\.snapshot\)[\s\S]*groups[\s\S]*published_at[\s\S]*schema_version/);
  assert.match(verifyScript, /\/rest\/v1\/rpc\/get_menu_release/);
  assert.match(verifyScript, /An unapproved or failed confirmation release was exposed publicly/);
  assert.match(verifyScript, /"menu_item_id,is_available"/);
  assert.match(verifyScript, /verifyAnonymousColumnDenied\(config, "menu_availability", "note"\)/);
  assert.match(verifyScript, /verifyAnonymousColumnDenied\(config, "menu_availability", "updated_at"\)/);
  assert.match(verifyScript, /adminKey === publicKey/);
  assert.match(verifyScript, /identity\?\.provider === "google"/);
  assert.match(verifyScript, /menu_admin_access_requests/);
  assert.match(verifyScript, /menu_admin_access_audit/);
  assert.match(verifyScript, /get_menu_restore_baseline_bootstrap_status/);
  assert.match(verifyScript, /restoreBaseline\?\.baseline_key !== "pre_test_2026_08_21"/);
  assert.match(verifyScript, /Number\(restoreBaseline\?\.item_count\) !== 80/);
  assert.match(envExample, /\[최초 설정 필수\][\s\S]*SUPABASE_OWNER_USER_ID=/);
  assert.equal(packageJson.scripts["verify:supabase"], "node --experimental-strip-types scripts/verify-supabase.mjs");
});

test("menu deployment pipeline is owner-gated, server-triggered, immutable, and observable", () => {
  const migration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260822000000_add_menu_deployment_pipeline.sql",
    ),
    "utf8",
  );
  const liveReleaseMigration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260822010000_add_live_menu_release.sql",
    ),
    "utf8",
  );
  const queuedFailureMigration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260822040000_add_queued_deployment_failure_cas.sql",
    ),
    "utf8",
  );
  const edgeFunction = readFileSync(
    path.resolve(appDirectory, "..", "supabase", "functions", "menu-deploy", "index.ts"),
    "utf8",
  );
  const deploymentReconciliation = readFileSync(
    path.resolve(appDirectory, "..", "supabase", "functions", "menu-deploy", "reconciliation.ts"),
    "utf8",
  );
  const workflow = readFileSync(
    path.resolve(appDirectory, "..", ".github", "workflows", "deploy-pages.yml"),
    "utf8",
  );
  const publishedMenu = readFileSync(
    path.resolve(appDirectory, "lib", "menu", "published-menu.ts"),
    "utf8",
  );
  const remoteClient = readFileSync(
    path.resolve(appDirectory, "lib", "menu-admin", "supabase-rest.ts"),
    "utf8",
  );
  const availabilitySync = readFileSync(
    path.resolve(appDirectory, "app", "menu-availability-sync.tsx"),
    "utf8",
  );
  const menuView = readFileSync(
    path.resolve(appDirectory, "app", "menu-view.tsx"),
    "utf8",
  );
  const deploymentGuide = readFileSync(
    path.resolve(appDirectory, "docs", "menu-admin-deployment.md"),
    "utf8",
  );
  const adminDashboard = readFileSync(
    path.resolve(appDirectory, "app", "admin", "admin-dashboard.tsx"),
    "utf8",
  );
  const baseMigration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260819000000_create_menu_admin_schema.sql",
    ),
    "utf8",
  );

  assert.ok(migration.indexOf("begin;") < migration.indexOf("alter table public.menu_releases"));
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /deployment_status in \('not_requested', 'queued', 'running', 'succeeded', 'failed'\)/);
  assert.match(migration, /create or replace function public\.get_menu_release\(p_release_id uuid\)[\s\S]*jsonb_build_object\([\s\S]*'schema_version'[\s\S]*'published_at'[\s\S]*'groups'[\s\S]*where mr\.id = p_release_id[\s\S]*deployment_status in \('queued', 'running', 'succeeded'\)/);
  assert.match(migration, /create or replace function public\.request_menu_deployment[\s\S]*has_admin_role\(array\['owner'\]\)/);
  assert.match(migration, /current_release_id is distinct from p_release_id/);
  assert.match(migration, /deployment_request_id is distinct from p_request_id/);
  assert.match(migration, /interval '45 minutes'/);
  assert.match(migration, /deployment_status = 'queued'[\s\S]*deployment_requested_at[\s\S]*interval '45 minutes'/);
  assert.match(migration, /Another menu deployment is already in progress/);
  assert.match(migration, /create or replace function public\.update_menu_deployment[\s\S]*auth\.role\(\)[\s\S]*service_role/);
  assert.match(migration, /deployment_status in \('succeeded', 'failed'\)[\s\S]*A completed deployment cannot change state/);
  assert.match(migration, /grant execute on function public\.update_menu_deployment[\s\S]*to service_role/);

  assert.ok(liveReleaseMigration.indexOf("begin;") < liveReleaseMigration.indexOf("alter table public.site_settings"));
  assert.match(liveReleaseMigration, /commit;\s*$/);
  assert.match(liveReleaseMigration, /add column if not exists live_release_id uuid references public\.menu_releases/);
  assert.match(liveReleaseMigration, /set live_release_id = current_release_id/);
  assert.match(liveReleaseMigration, /mr\.id = ss\.live_release_id[\s\S]*mr\.deployment_status = 'not_requested'/);
  assert.match(liveReleaseMigration, /set deployment_status = 'succeeded',[\s\S]*where id = v_release_id/);
  assert.match(liveReleaseMigration, /drop policy if exists menu_images_manager_update on storage\.objects/);
  assert.match(liveReleaseMigration, /drop policy if exists menu_images_manager_delete on storage\.objects/);
  assert.match(liveReleaseMigration, /create or replace function public\.get_published_menu\(\)[\s\S]*jsonb_build_object\([\s\S]*'groups'[\s\S]*mr\.id = ss\.live_release_id/);
  assert.match(liveReleaseMigration, /create or replace function public\.get_deployable_published_menu\(\)[\s\S]*mr\.id = ss\.live_release_id[\s\S]*not exists \([\s\S]*deployment_status in \('queued', 'running'\)/);
  assert.match(liveReleaseMigration, /grant execute on function public\.get_deployable_published_menu\(\) to anon, authenticated, service_role/);
  assert.match(liveReleaseMigration, /create or replace function public\.get_menu_release\(p_release_id uuid\)[\s\S]*jsonb_build_object\([\s\S]*'groups'[\s\S]*where mr\.id = p_release_id[\s\S]*deployment_status in \('queued', 'running', 'succeeded'\)/);
  assert.match(liveReleaseMigration, /create or replace function public\.publish_initial_menu\(\)[\s\S]*set live_release_id = v_release_id/);
  assert.match(liveReleaseMigration, /new\.deployment_status = 'succeeded'[\s\S]*old\.deployment_status is distinct from 'succeeded'/);
  assert.match(liveReleaseMigration, /create trigger promote_succeeded_menu_deployment[\s\S]*after update of deployment_status/);
  assert.match(liveReleaseMigration, /set live_release_id = new\.id/);

  assert.match(edgeFunction, /GITHUB_ACTIONS_TOKEN/);
  assert.match(edgeFunction, /request_menu_deployment/);
  assert.match(edgeFunction, /update_menu_deployment/);
  assert.match(edgeFunction, /X-GitHub-Api-Version/);
  assert.match(edgeFunction, /MENU_DEPLOY_CALLBACK_SECRET/);
  assert.match(edgeFunction, /safeEqual\(suppliedSecret/);
  assert.match(edgeFunction, /loadStaleRunningDeployments/);
  assert.match(edgeFunction, /actions\/runs\/\$\{runId\}\/jobs\?per_page=100/);
  assert.match(edgeFunction, /deploymentOutcomeFromJobs\(jobsValue\)/);
  assert.match(edgeFunction, /reconcileStaleRunningDeployments/);
  assert.match(edgeFunction, /class RpcResponseError extends Error/);
  assert.match(edgeFunction, /function rpcResponseIsAmbiguous[\s\S]*status === 408[\s\S]*status === 429[\s\S]*status >= 500/);
  assert.match(edgeFunction, /queueDeploymentWithResponseLossRetry/);
  const queueRetryBody = edgeFunction.slice(
    edgeFunction.indexOf("const queueDeploymentWithResponseLossRetry"),
    edgeFunction.indexOf("let repository: string;"),
  );
  assert.equal((queueRetryBody.match(/return await queueDeployment\(\)/g) ?? []).length, 2);
  assert.match(queueRetryBody, /cause instanceof RpcResponseError && !rpcResponseIsAmbiguous\(cause\)/);
  assert.match(queueRetryBody, /retryCause instanceof RpcResponseError && !rpcResponseIsAmbiguous\(retryCause\)[\s\S]*failQueuedBestEffort[\s\S]*safe deployment request retry was rejected/);
  assert.match(queueRetryBody, /failQueuedBestEffort[\s\S]*safe retry/);
  assert.match(queueRetryBody, /DeploymentQueueTransportError/);
  const dispatchTransportCatch = edgeFunction.slice(
    edgeFunction.indexOf("let dispatch: Response;"),
    edgeFunction.indexOf("if (!dispatch.ok)"),
  );
  assert.match(dispatchTransportCatch, /dispatch outcome could not be confirmed/);
  assert.match(dispatchTransportCatch, /failQueuedBestEffort/);
  assert.doesNotMatch(dispatchTransportCatch, /updateDeployment\([^)]*"failed"/);
  assert.match(edgeFunction, /fail_queued_menu_deployment/);
  assert.match(queuedFailureMigration, /create or replace function public\.fail_queued_menu_deployment/);
  assert.match(queuedFailureMigration, /pg_advisory_xact_lock\(662061563457110138\)[\s\S]*update public\.menu_releases/);
  assert.match(queuedFailureMigration, /deployment_request_id = p_request_id[\s\S]*deployment_status = 'queued'/);
  assert.match(queuedFailureMigration, /get diagnostics v_updated = row_count;[\s\S]*return v_updated = 1/);
  assert.match(queuedFailureMigration, /revoke all on function public\.fail_queued_menu_deployment[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(queuedFailureMigration, /grant execute on function public\.fail_queued_menu_deployment[\s\S]*to service_role/);
  assert.match(adminDashboard, /deploymentRetryAfterMs = 45 \* 60 \* 1000/);
  assert.match(adminDashboard, /function deploymentRetryIsDue[\s\S]*status !== "queued"[\s\S]*status !== "running"[\s\S]*deploymentRequestedAt/);
  assert.match(adminDashboard, /deploymentWasAccepted\(currentStatus\)[\s\S]*!retryIsDue/);
  assert.match(adminDashboard, /deploymentRetryDue[\s\S]*"상태 확인 \/ 다시 요청"/);
  const deploymentPollingEffect = adminDashboard.slice(
    adminDashboard.indexOf("const deploymentPollingActive"),
    adminDashboard.indexOf("if (!pendingRestoreResult"),
  );
  assert.match(deploymentPollingEffect, /const scheduleDeploymentPoll/);
  assert.match(deploymentPollingEffect, /\.catch\(\(\) => \{[\s\S]*if \(active\) scheduleDeploymentPoll\(\)/);
  assert.match(deploymentPollingEffect, /stillInProgress[\s\S]*scheduleDeploymentPoll\(\)/);
  assert.match(deploymentPollingEffect, /clearTimeout\(timeout\)/);
  assert.match(deploymentReconciliation, /Deploy to GitHub Pages/);
  assert.match(deploymentReconciliation, /deployStep\?\.conclusion === "success" \? "succeeded" : "failed"/);
  assert.doesNotMatch(remoteClient, /GITHUB_ACTIONS_TOKEN|MENU_DEPLOY_CALLBACK_SECRET/);
  assert.match(remoteClient, /\/functions\/v1\/menu-deploy/);

  assert.match(workflow, /release_id:[\s\S]*required: true/);
  assert.match(workflow, /deployment_request_id:[\s\S]*required: true/);
  assert.match(workflow, /NEXT_PUBLIC_SUPABASE_URL: \$\{\{ vars\.NEXT_PUBLIC_SUPABASE_URL \}\}/);
  assert.match(workflow, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: \$\{\{ vars\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \}\}/);
  assert.match(workflow, /MENU_RELEASE_ID: \$\{\{ inputs\.release_id \}\}/);
  assert.match(workflow, /REQUIRE_REMOTE_MENU: "1"/);
  assert.match(workflow, /^permissions: \{\}$/m);
  const buildJob = workflow.slice(workflow.indexOf("  build:"), workflow.indexOf("  deploy:"));
  const deployJob = workflow.slice(workflow.indexOf("  deploy:"));
  assert.match(buildJob, /permissions:\s*\n\s+contents: read\s*\n\s+pages: read/);
  assert.doesNotMatch(buildJob, /pages: write|id-token: write/);
  assert.match(deployJob, /permissions:\s*\n\s+pages: write\s*\n\s+id-token: write/);
  assert.doesNotMatch(deployJob, /contents: write/);
  const pinnedOfficialActions = [...workflow.matchAll(/uses: actions\/[a-z-]+@([0-9a-f]{40}) # v\d+\.\d+\.\d+/g)];
  assert.equal(pinnedOfficialActions.length, 5);
  assert.doesNotMatch(workflow, /uses: actions\/[a-z-]+@v\d/);
  assert.match(workflow, /MENU_DEPLOY_CALLBACK_SECRET/);
  assert.match(workflow, /concurrency:\s*\n\s+group: pages\s*\n[\s\S]*queue: max\s*\n\s+cancel-in-progress: false/);
  assert.equal((workflow.match(/--retry 5 --retry-all-errors --retry-delay 2/g) ?? []).length, 2);
  assert.match(workflow, /status:\"running\"/);
  assert.match(workflow, /deployment_status=\"succeeded\"/);
  assert.match(workflow, /deployment_status=\"failed\"/);

  assert.match(publishedMenu, /process\.env\.MENU_RELEASE_ID/);
  assert.match(publishedMenu, /process\.env\.REQUIRE_REMOTE_MENU === "1"/);
  assert.match(publishedMenu, /requestedReleaseId[\s\S]*\? "get_menu_release"[\s\S]*\? "get_deployable_published_menu"[\s\S]*: "get_published_menu"/);
  assert.match(publishedMenu, /p_release_id: requestedReleaseId/);
  assert.match(publishedMenu, /if \(failClosed\) throw error/);

  // Availability is the deliberately narrow real-time exception to immutable
  // catalog releases: anonymous clients may read it, never mutate it.
  assert.match(baseMigration, /create policy menu_availability_public_read[\s\S]*for select[\s\S]*to anon, authenticated/);
  assert.match(liveReleaseMigration, /create policy menu_availability_public_read[\s\S]*for select[\s\S]*to anon[\s\S]*using \(true\)/);
  assert.match(liveReleaseMigration, /create policy menu_availability_admin_read[\s\S]*to authenticated[\s\S]*has_admin_role\(array\['owner', 'manager', 'staff'\]\)/);
  assert.match(liveReleaseMigration, /revoke select \(menu_item_id, is_available, note, updated_at\)[\s\S]*from anon/);
  assert.match(liveReleaseMigration, /grant select \(menu_item_id, is_available\)[\s\S]*to anon/);
  assert.match(availabilitySync, /\/rest\/v1\/menu_availability/);
  assert.match(availabilitySync, /select", "menu_item_id,is_available"/);
  assert.doesNotMatch(availabilitySync, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
  assert.ok(
    availabilitySync.indexOf('menuItem.dataset.availability = "sold_out"')
      < availabilitySync.indexOf("rows.forEach((row)"),
    "성공한 availability 응답에 없는 이전 공개 메뉴는 먼저 품절 처리합니다.",
  );
  assert.match(menuView, /<MenuAvailabilitySync \/>/);
  assert.match(deploymentGuide, /하나의 원자적 트랜잭션이 아닌 두 외부 시스템의 작업/);
  assert.match(deploymentGuide, /Pages 배포는 성공했지만 최종 callback/);
  assert.match(deploymentGuide, /Verify JWT가 꺼져 있는지/);
  assert.match(deploymentGuide, /기존 공개본으로 한 번 배포 요청/);
});

test("cancelled and stale GitHub runs reconcile from the actual Pages step", () => {
  assert.equal(deploymentOutcomeFromJobs({
    jobs: [{
      name: "deploy",
      conclusion: "failure",
      steps: [
        { name: "Deploy to GitHub Pages", conclusion: "success" },
        { name: "Report requested menu deployment result", conclusion: "failure" },
      ],
    }],
  }), "succeeded");
  assert.equal(deploymentOutcomeFromJobs({
    jobs: [{
      name: "deploy",
      conclusion: "cancelled",
      steps: [{ name: "Deploy to GitHub Pages", conclusion: "cancelled" }],
    }],
  }), "failed");
  assert.equal(deploymentOutcomeFromJobs({ jobs: [] }), "failed");
  assert.equal(isDeploymentConflict(new Error("Another menu deployment is already in progress.")), true);
  assert.equal(isDeploymentConflict(new Error("Only an owner may deploy the public site.")), false);
});

test("admin-triggered static builds fetch the exact release and fail closed", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const previousReleaseId = process.env.MENU_RELEASE_ID;
  const previousRequireRemote = process.env.REQUIRE_REMOTE_MENU;
  const previousFetch = globalThis.fetch;
  const releaseId = "11111111-1111-4111-8111-111111111111";
  const groups = [[publicCategory("kimbap", "김밥", [publicItem("item-1", "기본")])]];
  const requests = [];

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://menu-admin-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.MENU_RELEASE_ID = releaseId;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: init?.body, headers: init?.headers });
    return new Response(JSON.stringify({ schema_version: 1, groups }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const publishedMenu = await loadIsolatedPublishedMenu();
    assert.deepEqual(await publishedMenu.getPublishedMenuGroups(), groups);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://menu-admin-test.supabase.co/rest/v1/rpc/get_menu_release");
    assert.deepEqual(JSON.parse(requests[0].body), { p_release_id: releaseId });

    globalThis.fetch = async () => new Response("missing", { status: 404 });
    await assert.rejects(
      publishedMenu.getPublishedMenuGroups(),
      /Required remote menu fetch failed \(HTTP 404\)/,
    );

    delete process.env.MENU_RELEASE_ID;
    process.env.REQUIRE_REMOTE_MENU = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    await assert.rejects(
      publishedMenu.getPublishedMenuGroups(),
      /Supabase public build settings are required for a production menu build/,
    );

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://menu-admin-test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    requests.length = 0;
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), body: init?.body, headers: init?.headers });
      return new Response(JSON.stringify({ schema_version: 1, groups }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    assert.deepEqual(await publishedMenu.getPublishedMenuGroups(), groups);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://menu-admin-test.supabase.co/rest/v1/rpc/get_deployable_published_menu",
    );
    assert.equal(requests[0].body, "{}");

    globalThis.fetch = async () => new Response("null", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    await assert.rejects(
      publishedMenu.getPublishedMenuGroups(),
      /required remote menu release is missing or invalid/i,
    );

    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(
      publishedMenu.getPublishedMenuGroups(),
      /Required remote menu fetch failed \(HTTP 503\)/,
    );

    delete process.env.REQUIRE_REMOTE_MENU;
    const fallback = await publishedMenu.getPublishedMenuGroups();
    assert.equal(fallback[0][0].id, "fallback");
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
    if (previousReleaseId === undefined) delete process.env.MENU_RELEASE_ID;
    else process.env.MENU_RELEASE_ID = previousReleaseId;
    if (previousRequireRemote === undefined) delete process.env.REQUIRE_REMOTE_MENU;
    else process.env.REQUIRE_REMOTE_MENU = previousRequireRemote;
    globalThis.fetch = previousFetch;
  }
});

test("menu admin access management is request-scoped, owner-only, and lockout-safe", () => {
  const migration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260820000000_add_menu_admin_access_management.sql",
    ),
    "utf8",
  );

  assert.ok(migration.indexOf("begin;") < migration.indexOf("create table"));
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /create table if not exists public\.menu_admin_access_requests/);
  assert.match(migration, /create table if not exists public\.menu_admin_access_audit/);
  assert.match(migration, /alter table public\.menu_admin_access_requests enable row level security/);
  assert.match(migration, /alter table public\.menu_admin_access_audit enable row level security/);
  assert.match(migration, /revoke all on table public\.menu_admin_access_requests from public, anon, authenticated/);
  assert.match(migration, /revoke all on table public\.menu_admin_access_audit from public, anon, authenticated/);
  assert.match(migration, /create trigger admin_users_audit_access_change[\s\S]*after insert or update or delete/);
  assert.match(migration, /create or replace function public\.request_menu_admin_access\(\)[\s\S]*security definer/);
  assert.match(migration, /create or replace function public\.list_menu_admin_candidates\(\)[\s\S]*security definer/);
  assert.match(migration, /create or replace function public\.set_menu_admin_access\([\s\S]*security definer/);
  assert.match(migration, /create or replace function public\.reject_menu_admin_access_request\([\s\S]*p_expected_requested_at timestamptz[\s\S]*security definer/);

  const functionDefinition = (name) => {
    const start = migration.indexOf(`create or replace function public.${name}`);
    assert.notEqual(start, -1, `${name} 함수가 migration에 있어야 합니다.`);
    const end = migration.indexOf("\n$$;", start);
    assert.notEqual(end, -1, `${name} 함수 본문이 닫혀 있어야 합니다.`);
    return migration.slice(start, end + 4);
  };
  const requestFunction = functionDefinition("request_menu_admin_access()");
  const rejectFunction = functionDefinition("reject_menu_admin_access_request(");
  const setFunction = functionDefinition("set_menu_admin_access(");

  assert.match(migration, /i\.provider = 'google'/);
  assert.match(migration, /select au\.user_id[\s\S]*union[\s\S]*select access_request\.user_id/);
  assert.match(migration, /The target user has not requested menu administration access/);
  assert.match(migration, /An owner cannot demote or deactivate their own account/);
  assert.match(migration, /The last active owner cannot be demoted or deactivated/);
  assert.equal(
    migration.match(/lock table public\.admin_users in exclusive mode/g)?.length,
    3,
    "request/set/reject RPC는 같은 admin_users 직렬화 경계를 공유합니다.",
  );
  assert.ok(
    requestFunction.indexOf("Authentication is required")
      < requestFunction.indexOf("lock table public.admin_users in exclusive mode"),
    "비인증 요청은 heavyweight lock 전에 거부합니다.",
  );
  assert.ok(
    requestFunction.indexOf("i.provider = 'google'")
      < requestFunction.indexOf("lock table public.admin_users in exclusive mode"),
    "비-Google 요청은 heavyweight lock 전에 거부합니다.",
  );
  assert.match(
    requestFunction,
    /lock table public\.admin_users in exclusive mode;[\s\S]*if exists \([\s\S]*au\.is_active[\s\S]*delete from public\.menu_admin_access_requests[\s\S]*return null;/,
  );
  assert.ok(
    setFunction.indexOf("Only an active owner may manage menu administration access.")
      < setFunction.indexOf("lock table public.admin_users in exclusive mode"),
    "비-owner는 heavyweight lock을 잡기 전에 거부합니다.",
  );
  assert.match(
    setFunction,
    /lock table public\.admin_users in exclusive mode;[\s\S]*Owner access changed concurrently; reload and retry\./,
  );
  assert.match(setFunction, /p_expected_role text,[\s\S]*p_expected_is_active boolean,[\s\S]*p_expected_requested_at timestamptz/);
  assert.match(
    setFunction,
    /v_existing_role is not distinct from p_expected_role[\s\S]*v_existing_active is not distinct from p_expected_is_active[\s\S]*v_existing_requested_at is not distinct from p_expected_requested_at[\s\S]*errcode = '40001'/,
  );
  assert.ok(
    rejectFunction.indexOf("Only an active owner may reject menu administration requests.")
      < rejectFunction.indexOf("lock table public.admin_users in exclusive mode"),
    "비-owner의 거절 요청은 heavyweight lock 전에 거부합니다.",
  );
  assert.match(
    rejectFunction,
    /lock table public\.admin_users in exclusive mode;[\s\S]*Owner access changed concurrently; reload and retry\.[\s\S]*requested_at is not distinct from p_expected_requested_at[\s\S]*if not found then[\s\S]*errcode = '40001'/,
  );
  assert.match(migration, /to_regprocedure\('public\.set_menu_admin_access\(uuid,text,boolean\)'\)[\s\S]*revoke all on function public\.set_menu_admin_access\(uuid, text, boolean\)[\s\S]*drop function public\.set_menu_admin_access\(uuid, text, boolean\)/);
  assert.match(migration, /to_regprocedure\('public\.reject_menu_admin_access_request\(uuid\)'\)[\s\S]*revoke all on function public\.reject_menu_admin_access_request\(uuid\)[\s\S]*drop function public\.reject_menu_admin_access_request\(uuid\)/);
  assert.match(migration, /create or replace function public\.prevent_menu_admin_owner_lockout\(\)[\s\S]*pg_advisory_xact_lock/);
  assert.match(migration, /create trigger admin_users_prevent_owner_lockout[\s\S]*before update or delete/);
  assert.match(migration, /The last active owner cannot be demoted, deactivated, or deleted/);
  assert.match(migration, /not v_existing_active and p_is_active/);
  assert.match(migration, /end > case v_existing_role/);
  assert.match(migration, /on conflict on constraint admin_users_pkey do update/);
  assert.match(migration, /if p_is_active then[\s\S]*delete from public\.menu_admin_access_requests/);
  for (const mutation of ["insert", "update", "delete"]) {
    assert.match(migration, new RegExp(`drop policy if exists admin_users_owner_${mutation}`));
  }
  assert.match(migration, /revoke insert, update, delete on table public\.admin_users from authenticated/);
  assert.match(migration, /grant execute on function public\.request_menu_admin_access\(\) to authenticated/);
  assert.match(migration, /grant execute on function public\.set_menu_admin_access\(uuid, text, boolean, text, boolean, timestamptz\) to authenticated/);
  assert.match(migration, /grant execute on function public\.reject_menu_admin_access_request\(uuid, timestamptz\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.set_menu_admin_access\(uuid, text, boolean\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.reject_menu_admin_access_request\(uuid\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.set_menu_admin_access\([^\n]+\) to (anon|service_role)/);
  assert.equal(migration.includes("as5427072@gmail.com"), false, "기존 owner를 migration에서 직접 변경하지 않습니다.");
});

test("inactive operator removal is owner-only, atomic, and preserves the Auth user", () => {
  const migration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260821000000_add_menu_admin_access_deletion.sql",
    ),
    "utf8",
  );

  assert.ok(migration.indexOf("begin;") < migration.indexOf("create or replace function"));
  assert.match(migration, /commit;\s*$/);
  assert.match(
    migration,
    /create or replace function public\.delete_menu_admin_access\([\s\S]*security definer[\s\S]*set search_path = ''/,
  );

  const functionStart = migration.indexOf("create or replace function public.delete_menu_admin_access");
  const functionEnd = migration.indexOf("\n$$;", functionStart);
  const deletionFunction = migration.slice(functionStart, functionEnd + 4);
  assert.ok(
    deletionFunction.indexOf("Only an active owner may permanently remove menu administration access.")
      < deletionFunction.indexOf("lock table public.admin_users in exclusive mode"),
    "비-owner는 직렬화 lock 전에 거부합니다.",
  );
  assert.match(deletionFunction, /p_user_id = v_caller_id[\s\S]*cannot permanently remove their own account/);
  assert.match(
    deletionFunction,
    /lock table public\.admin_users in exclusive mode;[\s\S]*Owner access changed concurrently; reload and retry\./,
  );
  assert.equal(
    deletionFunction.match(/lock table public\.admin_users in exclusive mode/g)?.length,
    1,
    "삭제 RPC도 기존 접근 관리 RPC와 같은 admin_users 직렬화 경계를 사용합니다.",
  );
  assert.match(deletionFunction, /An active operator must be deactivated before permanent removal\./);
  assert.match(
    deletionFunction,
    /v_existing_role is distinct from p_expected_role[\s\S]*v_existing_is_active is distinct from p_expected_is_active[\s\S]*v_existing_requested_at is distinct from p_expected_requested_at[\s\S]*errcode = '40001'/,
  );
  assert.ok(
    deletionFunction.indexOf("delete from public.menu_admin_access_requests")
      < deletionFunction.indexOf("delete from public.admin_users"),
    "남은 승인 요청과 운영자 권한 행을 같은 트랜잭션에서 정리합니다.",
  );
  assert.doesNotMatch(deletionFunction, /delete\s+from\s+auth\.(users|identities)/i);
  assert.match(
    migration,
    /revoke all on function public\.delete_menu_admin_access\(uuid, text, boolean, timestamptz\)[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(
    migration,
    /grant execute on function public\.delete_menu_admin_access\(uuid, text, boolean, timestamptz\)[\s\S]*to authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.delete_menu_admin_access\([^\n]+\)[\s\S]*to (anon|service_role)/,
  );
});

test("every admin boundary requires a live Google OAuth session", () => {
  const migration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260822020000_enforce_google_admin_sessions.sql",
    ),
    "utf8",
  );
  const coreMigration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260819000000_create_menu_admin_schema.sql",
    ),
    "utf8",
  );
  const deploymentMigration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260822000000_add_menu_deployment_pipeline.sql",
    ),
    "utf8",
  );
  const verifier = readFileSync(
    path.resolve(appDirectory, "scripts", "verify-supabase.mjs"),
    "utf8",
  );
  const securityGuide = readFileSync(
    path.resolve(appDirectory, "docs", "admin-auth-security.md"),
    "utf8",
  );

  assert.ok(migration.indexOf("begin;") < migration.indexOf("create or replace function"));
  assert.match(migration, /commit;\s*$/);

  const sessionStart = migration.indexOf("create or replace function public.is_google_admin_session");
  const sessionEnd = migration.indexOf("\n$$;", sessionStart);
  const sessionFunction = migration.slice(sessionStart, sessionEnd + 4);
  assert.match(sessionFunction, /coalesce\(auth\.role\(\), ''\) <> 'authenticated'/);
  assert.match(sessionFunction, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(sessionFunction, /v_session_id !~\* '\^\[0-9a-f\]\{8\}/);
  assert.match(sessionFunction, /from auth\.sessions as auth_session[\s\S]*auth_session\.id = v_session_id::uuid[\s\S]*auth_session\.user_id = v_user_id/);
  assert.match(sessionFunction, /auth_session\.not_after is null[\s\S]*auth_session\.not_after > clock_timestamp\(\)/);
  assert.match(sessionFunction, /jsonb_typeof\(v_claims -> 'amr'\) is distinct from 'array'/);
  assert.match(sessionFunction, /jsonb_array_elements\(v_claims -> 'amr'\)[\s\S]*amr_claim ->> 'method' = 'oauth'/);
  assert.doesNotMatch(sessionFunction, /amr_claim ->> 'method' = '(password|otp)'/);
  assert.match(sessionFunction, /app_metadata,provider[\s\S]*= 'google'/);
  assert.match(sessionFunction, /app_metadata,providers[\s\S]*@> '\["google"\]'/);
  assert.match(sessionFunction, /from auth\.identities as identity[\s\S]*identity\.provider = 'google'/);

  const roleStart = migration.indexOf("create or replace function public.current_admin_role");
  const roleEnd = migration.indexOf("\n$$;", roleStart);
  const roleFunction = migration.slice(roleStart, roleEnd + 4);
  assert.ok(
    roleFunction.indexOf("if not public.is_google_admin_session()")
      < roleFunction.indexOf("from public.admin_users as admin_user"),
    "admin_users 역할을 읽기 전에 현재 Google 세션을 검증합니다.",
  );
  assert.match(migration, /create or replace function public\.has_admin_role[\s\S]*public\.current_admin_role\(\)/);
  assert.match(
    migration,
    /create policy admin_users_self_or_owner_read[\s\S]*public\.is_google_admin_session\(\)[\s\S]*user_id = auth\.uid\(\)/,
  );

  const accessFunctions = [
    ["request_menu_admin_access", ""],
    ["list_menu_admin_candidates", ""],
    ["set_menu_admin_access", "uuid, text, boolean, text, boolean, timestamptz"],
    ["reject_menu_admin_access_request", "uuid, timestamptz"],
    ["delete_menu_admin_access", "uuid, text, boolean, timestamptz"],
  ];
  for (const [name, signature] of accessFunctions) {
    const escapedSignature = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const compactSignature = signature.replaceAll(" ", "");
    assert.match(
      migration,
      new RegExp(`to_regprocedure\\(\\s*'public\\.${name}_internal\\(${compactSignature}\\)'\\s*\\) is null`),
    );
    assert.match(
      migration,
      new RegExp(`alter function public\\.${name}\\(${escapedSignature}\\)\\s+rename to ${name}_internal`),
    );
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${name}_internal\\(${escapedSignature}\\)[\\s\\S]*?from public, anon, authenticated, service_role`),
    );
    assert.doesNotMatch(
      migration,
      new RegExp(`grant execute on function public\\.${name}_internal`),
    );

    const wrapperStart = migration.indexOf(`create or replace function public.${name}`);
    const wrapperEnd = migration.indexOf("\n$$;", wrapperStart);
    const wrapper = migration.slice(wrapperStart, wrapperEnd + 4);
    assert.match(wrapper, /perform public\.require_google_admin_session\(\)/);
    assert.match(wrapper, new RegExp(`public\\.${name}_internal\\(`));
  }

  assert.match(migration, /grant execute on function public\.current_admin_role\(\) to authenticated/);
  assert.match(migration, /grant execute on function public\.request_menu_admin_access\(\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.[a-z_]+_internal/);

  // Trusted bootstrap/deployment callbacks retain their explicit service-role
  // branches; browser authorization still flows through has_admin_role().
  assert.match(coreMigration, /auth\.role\(\), ''\) <> 'service_role'[\s\S]*public\.has_admin_role/);
  assert.match(coreMigration, /create or replace function public\.publish_initial_menu[\s\S]*auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(deploymentMigration, /create or replace function public\.request_menu_deployment[\s\S]*auth\.role\(\), ''\) <> 'service_role'[\s\S]*has_admin_role\(array\['owner'\]\)/);
  assert.match(verifier, /\/auth\/v1\/settings/);
  assert.match(verifier, /Object\.entries\(external\)[\s\S]*enabledProviders\.length !== 1 \|\| enabledProviders\[0\] !== "google"/);
  assert.match(verifier, /hasGoogleIdentity\(authUser\)[\s\S]*hasGoogleAppMetadata\(authUser\)/);
  assert.match(securityGuide, /session_id \+ oauth AMR \+ Google app_metadata \+ Google identity/);
  assert.match(securityGuide, /internal\/tokens\/service\.go/);
  assert.match(securityGuide, /internal\/models\/sessions\.go/);
});

test("category CRUD and reorder RPCs preserve references and reject stale ordering", () => {
  const migration = readFileSync(
    path.resolve(appDirectory, "..", "supabase", "migrations", "20260819000000_create_menu_admin_schema.sql"),
    "utf8",
  );
  const remoteClient = readFileSync(
    path.resolve(appDirectory, "lib", "menu-admin", "supabase-rest.ts"),
    "utf8",
  );

  for (const functionName of [
    "create_menu_category",
    "update_menu_category",
    "set_menu_category_archived",
    "delete_menu_category",
    "set_menu_item_archived",
    "reorder_menu_categories",
    "reorder_menu_items",
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${functionName}\\(`));
  }
  assert.match(migration, /Category cannot be archived while it contains active menu items\./);
  assert.match(migration, /Category cannot be deleted while it is referenced by menu items\./);
  assert.match(migration, /where mi\.category_id = p_category_id/);
  assert.doesNotMatch(migration, /create policy categories_manager_(insert|update|delete)/);
  assert.match(migration, /grant select on table public\.categories to authenticated;/);
  assert.match(migration, /revoke all on function public\.reorder_menu_categories\(uuid, jsonb, jsonb\)/);
  assert.match(migration, /grant execute on function public\.reorder_menu_items\(uuid, jsonb, jsonb\) to authenticated, service_role;/);
  assert.match(migration, /if v_current_ids = v_ordered_ids then\s+return;/);
  assert.match(migration, /if v_current_ids <> v_expected_ids then/);
  assert.match(migration, /sort_order is distinct from desired\.sort_order/);
  assert.doesNotMatch(migration, /v_effective_sort_order\s*:=\s*p_sort_order/);
  assert.match(remoteClient, /p_expected_ids: expectedIds/);
  assert.match(remoteClient, /p_ordered_ids: orderedIds/);
  assert.doesNotMatch(remoteClient, /p_pairs:/);
  assert.match(remoteClient, /order=sort_order\.asc,created_at\.asc,id\.asc/);
});

test("category reorder is scoped to its section and keeps archived records last", () => {
  const state = reorderFixture();
  const sectionId = state.categories[0].sectionId;
  const scoped = state.categories.filter((category) => category.sectionId === sectionId);
  const first = scoped[0];
  const second = scoped[1];
  const archived = scoped.find((category) => category.archivedAt !== null);

  const reordered = reorderAdminState(state, "category", second.id, first.id, "before");
  const orderedIds = reordered.state.categories
    .filter((category) => category.sectionId === sectionId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => category.id);

  assert.equal(reordered.parentId, sectionId);
  assert.deepEqual(orderedIds.slice(0, 2), [second.id, first.id]);
  assert.equal(orderedIds.at(-1), archived.id);
  assert.deepEqual(reordered.expectedIds, [first.id, second.id, archived.id]);
  assert.deepEqual(orderedIds, reordered.orderedIds);
  assert.equal(state.categories.find((category) => category.id === first.id).sortOrder, 0);
  assert.throws(
    () => reorderAdminState(state, "category", first.id, "category-c", "before"),
    /같은 메뉴 그룹/,
  );
});

test("menu reorder supports keyboard offsets and rejects category crossing", () => {
  const state = reorderFixture();
  const firstCategoryId = state.items[0].categoryId;
  const categoryItems = state.items.filter((item) => item.categoryId === firstCategoryId);
  const moved = reorderAdminStateByOffset(state, "item", categoryItems[1].id, -1);
  assert.ok(moved);
  assert.equal(moved.state.items.find((item) => item.id === categoryItems[1].id).sortOrder, 0);

  const otherCategoryItem = state.items.find((item) => item.categoryId !== firstCategoryId);
  assert.throws(
    () => reorderAdminState(state, "item", categoryItems[0].id, otherCategoryItem.id, "before"),
    /같은 카테고리/,
  );
});

test("reorder preserves the canonical incoming order for legacy sort-order ties", () => {
  const state = reorderFixture();
  const categoryA = state.categories.find((category) => category.id === "category-a");
  const categoryB = state.categories.find((category) => category.id === "category-b");
  categoryA.sortOrder = 0;
  categoryB.sortOrder = 0;
  state.categories = [categoryB, categoryA, ...state.categories.filter((category) => (
    category.id !== categoryA.id && category.id !== categoryB.id
  ))];

  const reordered = reorderAdminState(state, "category", categoryA.id, categoryB.id, "before");
  assert.deepEqual(reordered.expectedIds.slice(0, 2), [categoryB.id, categoryA.id]);
  assert.deepEqual(reordered.orderedIds.slice(0, 2), [categoryA.id, categoryB.id]);
});

test("multi-step keyboard reorder keeps the original server baseline", () => {
  const state = reorderFixture();
  const archivedIndex = state.items.findIndex((item) => item.id === "item-archived");
  const third = { ...state.items[1], id: "item-third", slug: "item-third", sortOrder: 2 };
  state.items[archivedIndex].sortOrder = 3;
  state.items.splice(archivedIndex, 0, third);

  const firstMove = reorderAdminStateByOffset(state, "item", "item-a", 1);
  assert.ok(firstMove);
  const firstSessionResult = withReorderBaseline(firstMove, firstMove.expectedIds);
  const secondMove = reorderAdminStateByOffset(firstSessionResult.state, "item", "item-a", 1);
  assert.ok(secondMove);
  const finalSessionResult = withReorderBaseline(secondMove, firstSessionResult.expectedIds);

  assert.deepEqual(finalSessionResult.expectedIds, ["item-a", "item-b", "item-third", "item-archived"]);
  assert.deepEqual(finalSessionResult.orderedIds, ["item-b", "item-third", "item-a", "item-archived"]);
  assert.equal(finalSessionResult.changed, true);
});

test("release payload normalization keeps local and remote snapshots in parity", () => {
  const groups = [[publicCategory("meals", "식사", [
    publicItem("available", "판매 메뉴", "available", { image: "static:meal.webp" }),
    publicItem("sold-out", "품절 메뉴", "sold_out"),
    { ...publicItem("legacy", "기본 판매 메뉴"), availability: undefined },
  ])]];
  const publishedAt = "2026-08-19T12:34:56.000Z";
  const remote = normalizeReleasePayload(releaseSnapshot(groups), publishedAt);
  const local = normalizeReleasePayload(releaseSnapshot(groups, "camel"), publishedAt);

  assert.ok(remote);
  assert.deepEqual(local, remote);
  assert.equal(remote.publishedAt, publishedAt);
  assert.equal(remote.groups[0][0].items[2].availability, "available");

  const summary = summarizeReleasePayload(remote);
  assert.deepEqual(summary, {
    itemCount: 3,
    categoryCount: 1,
    availableCount: 2,
    soldOutCount: 1,
    categories: [{
      id: "meals",
      nameKo: "식사",
      soldOutCount: 1,
      items: [
        { id: "available", nameKo: "판매 메뉴", pricePl: "10 zł", availability: "available", hasImage: true },
        { id: "sold-out", nameKo: "품절 메뉴", pricePl: "10 zł", availability: "sold_out", hasImage: false },
        { id: "legacy", nameKo: "기본 판매 메뉴", pricePl: "10 zł", availability: "available", hasImage: false },
      ],
    }],
  });
});

test("release payload normalization distinguishes invalid snapshots from an empty release", () => {
  const publishedAt = "2026-08-19T12:34:56.000Z";
  const empty = normalizeReleasePayload(releaseSnapshot([]), publishedAt);
  assert.ok(empty);
  assert.equal(summarizeReleasePayload(empty).itemCount, 0);

  const duplicateItemGroups = [[
    publicCategory("one", "하나", [publicItem("same", "첫 메뉴")]),
    publicCategory("two", "둘", [publicItem("same", "둘째 메뉴")]),
  ]];
  const duplicateCategoryGroups = [[
    publicCategory("same", "하나", []),
    publicCategory("same", "둘", []),
  ]];
  const invalidAvailability = [[publicCategory("one", "하나", [
    publicItem("bad", "잘못된 메뉴", "hidden"),
  ])]];

  assert.equal(normalizeReleasePayload(releaseSnapshot(duplicateItemGroups), publishedAt), undefined);
  assert.equal(normalizeReleasePayload(releaseSnapshot(duplicateCategoryGroups), publishedAt), undefined);
  assert.equal(normalizeReleasePayload(releaseSnapshot(invalidAvailability), publishedAt), undefined);
  assert.equal(normalizeReleasePayload({ schema_version: 1, groups: {} }, publishedAt), undefined);
  assert.equal(normalizeReleasePayload(releaseSnapshot([]), ""), undefined);
});

test("release diff reports item public-field changes without image alias noise", () => {
  const previous = normalizeReleasePayload(releaseSnapshot([[
    publicCategory("one", "첫 카테고리", [
      publicItem("same-image", "같은 사진", "available", { image: "static:same.webp" }),
      publicItem("bare-image", "같은 기본 사진", "available", { image: "/menu/bare.webp" }),
      publicItem("storage-change", "사진 교체", "available", { image: "items/photo.webp" }),
      publicItem("edited", "수정 전", "available"),
      publicItem("locale-edit", "다국어 수정", "available"),
      publicItem("status", "상태 변경", "available"),
      publicItem("removed", "삭제 메뉴", "available"),
      publicItem("moved", "이동 메뉴", "available"),
    ]),
    publicCategory("two", "둘째 카테고리", []),
  ]]), "2026-08-19T00:00:00.000Z");
  const current = normalizeReleasePayload(releaseSnapshot([[
    publicCategory("one", "첫 카테고리", [
      publicItem("same-image", "같은 사진", "available", { image: "/menu/same.webp" }),
      publicItem("bare-image", "같은 기본 사진", "available", { image: "bare.webp" }),
      publicItem("storage-change", "사진 교체", "available", { image: "/menu/items/photo.webp" }),
      publicItem("edited", "수정 후", "available", { price: ["12 zł", "12 PLN", "12즈워티"] }),
      publicItem("locale-edit", "다국어 수정", "available", { name: ["locale-edit PL", "Changed EN", "다국어 수정"] }),
      publicItem("status", "상태 변경", "sold_out"),
      publicItem("added", "추가 메뉴", "sold_out"),
    ]),
    publicCategory("two", "둘째 카테고리", [publicItem("moved", "이동 메뉴", "available")]),
  ]]), "2026-08-20T00:00:00.000Z");

  assert.ok(previous);
  assert.ok(current);
  assert.deepEqual(diffReleasePayloads(current, previous), {
    added: ["추가 메뉴"],
    removed: ["삭제 메뉴"],
    edited: ["사진 교체", "수정 후", "다국어 수정", "이동 메뉴"],
    statusChanged: ["상태 변경"],
  });
});

test("remote and local release mappings retain validated payload details", () => {
  const remoteClient = readFileSync(path.resolve(appDirectory, "lib", "menu-admin", "supabase-rest.ts"), "utf8");
  const localStore = readFileSync(path.resolve(appDirectory, "lib", "menu-admin", "local-store.ts"), "utf8");

  assert.match(remoteClient, /normalizeReleasePayload\(row\.snapshot, row\.published_at\)/);
  assert.match(remoteClient, /payload \? summarizeReleasePayload\(payload\)\.itemCount : 0/);
  assert.match(remoteClient, /payload \? \{ payload \} : \{\}/);
  assert.match(remoteClient, /\.\.\.\(version \? \{ version \} : \{\}\)/);
  assert.match(localStore, /normalizeReleasePayload\(release\.payload, release\.createdAt\)/);
  assert.match(localStore, /itemCount: summary\.itemCount/);
});

test("REST and Storage share one refresh flight and expire the UI session on refresh failure", { concurrency: false }, async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousPublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const stored = new Map();
  const dispatchedEvents = [];

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://menu-admin-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
    dispatchEvent: (event) => {
      dispatchedEvents.push(event.type);
      return true;
    },
  };

  try {
    const client = await loadIsolatedSupabaseClient();
    let refreshCalls = 0;
    let roleCalls = 0;
    let storageCalls = 0;
    let releaseRefresh;
    const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });

    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const authorization = new Headers(init.headers).get("Authorization");
      if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
        refreshCalls += 1;
        await refreshGate;
        return Response.json({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
          user: { id: "owner-id", email: "owner@example.com" },
        });
      }
      if (url.includes("/rest/v1/rpc/current_admin_role")) {
        roleCalls += 1;
        if (authorization === "Bearer old-access-token") return Response.json({ message: "expired" }, { status: 401 });
        assert.equal(authorization, "Bearer new-access-token");
        return Response.json("owner");
      }
      if (url.includes("/storage/v1/object/menu-images/")) {
        storageCalls += 1;
        if (authorization === "Bearer old-access-token") return Response.json({ message: "expired" }, { status: 401 });
        assert.equal(authorization, "Bearer new-access-token");
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected test request: ${url}`);
    };

    const session = {
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      expiresAt: 1,
      email: "owner@example.com",
      userId: "owner-id",
    };
    const pending = Promise.all([
      client.loadRemoteRole(session),
      client.uploadRemoteImage(new Blob(["image"], { type: "image/webp" }), session, "item-id"),
    ]);
    for (let attempt = 0; attempt < 10 && (roleCalls < 1 || storageCalls < 1 || refreshCalls < 1); attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(refreshCalls, 1);
    releaseRefresh();
    const [role, objectPath] = await pending;

    assert.equal(role, "owner");
    assert.match(objectPath, /^items\/item-id\/.+\.webp$/);
    assert.equal(refreshCalls, 1);
    assert.equal(roleCalls, 2);
    assert.equal(storageCalls, 2);
    assert.equal(session.accessToken, "new-access-token");
    assert.equal(session.refreshToken, "new-refresh-token");
    assert.equal(JSON.parse(stored.values().next().value).accessToken, "new-access-token");

    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
        return Response.json({ message: "invalid refresh token" }, { status: 400 });
      }
      const authorization = new Headers(init.headers).get("Authorization");
      assert.equal(authorization, "Bearer expired-again");
      return Response.json({ message: "expired" }, { status: 401 });
    };
    const expiredSession = {
      accessToken: "expired-again",
      refreshToken: "invalid-refresh-token",
      expiresAt: 1,
      email: "owner@example.com",
      userId: "owner-id",
    };
    await assert.rejects(client.loadRemoteRole(expiredSession), /로그인 세션이 만료되었습니다/);
    assert.ok(dispatchedEvents.includes(client.SESSION_EXPIRED_EVENT));
    assert.equal(stored.size, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousPublicKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousPublicKey;
  }
});

test("Google is the only admin sign-in method and uses a one-time PKCE code", { concurrency: false }, async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousPublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const previousBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const stored = new Map();
  const sessionStored = new Map();
  let assignedUrl = "";
  let replacedUrl = "";
  let tokenRequestBody;
  let tokenCalls = 0;
  let roleCalls = 0;
  let accessRequestCalls = 0;
  let roleResponse = "owner";
  let accessRequestFails = false;
  let tokenResponseMode = "valid";
  const location = {
    origin: "http://127.0.0.1:3000",
    href: "http://127.0.0.1:3000/kstreetsnack/admin/",
    pathname: "/kstreetsnack/admin/",
    search: "",
    hash: "",
    assign: (url) => { assignedUrl = url; },
  };

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://menu-admin-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.NEXT_PUBLIC_BASE_PATH = "/kstreetsnack";
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
    sessionStorage: {
      getItem: (key) => sessionStored.get(key) ?? null,
      setItem: (key, value) => sessionStored.set(key, value),
      removeItem: (key) => sessionStored.delete(key),
    },
    crypto: globalThis.crypto,
    btoa: globalThis.btoa,
    location,
    history: {
      state: null,
      replaceState: (_state, _title, url) => { replacedUrl = String(url); },
    },
    dispatchEvent: () => true,
  };

  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      assert.equal(new Headers(init.headers).get("apikey"), "sb_publishable_test");
      if (url.endsWith("/auth/v1/token?grant_type=pkce")) {
        tokenCalls += 1;
        tokenRequestBody = JSON.parse(String(init.body));
        if (tokenResponseMode === "malformed") {
          return Response.json({
            access_token: "password-access",
            refresh_token: "password-refresh",
            expires_in: 3600,
            user: { id: "owner-id", email: "owner@example.com", app_metadata: { providers: ["email"] } },
          });
        }
        return Response.json({
          access_token: "oauth-access",
          refresh_token: "oauth-refresh",
          expires_in: 3600,
          user: {
            id: "owner-id",
            email: "owner@example.com",
            app_metadata: { providers: ["email", "google"] },
          },
        });
      }
      if (url.endsWith("/rest/v1/rpc/current_admin_role")) {
        roleCalls += 1;
        return Response.json(roleResponse);
      }
      if (url.endsWith("/rest/v1/rpc/request_menu_admin_access")) {
        accessRequestCalls += 1;
        assert.deepEqual(JSON.parse(String(init.body)), {});
        if (accessRequestFails) return Response.json({ message: "request failed" }, { status: 500 });
        return Response.json("2026-08-20T00:00:00.000Z");
      }
      throw new Error(`Unexpected test request: ${url}`);
    };

    const client = await loadIsolatedSupabaseClient();
    await client.signInWithGoogle();
    const authorizeUrl = new URL(assignedUrl);
    assert.equal(authorizeUrl.origin, "https://menu-admin-test.supabase.co");
    assert.equal(authorizeUrl.pathname, "/auth/v1/authorize");
    assert.equal(authorizeUrl.searchParams.get("provider"), "google");
    assert.equal(authorizeUrl.searchParams.get("redirect_to"), "http://127.0.0.1:3000/kstreetsnack/admin/auth/callback/");
    assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "s256");
    assert.match(authorizeUrl.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
    const pkceRecord = JSON.parse(sessionStored.values().next().value);
    const verifier = pkceRecord.verifier;
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(Date.now() - pkceRecord.createdAt < 1000);
    assert.equal(client.signInWithPassword, undefined);

    location.search = "?code=oauth-code";
    location.pathname = "/kstreetsnack/admin/auth/callback/";
    location.href = `http://127.0.0.1:3000${location.pathname}${location.search}`;
    const [session, duplicateSession] = await Promise.all([
      client.completeGoogleOAuthSignIn(),
      client.completeGoogleOAuthSignIn(),
    ]);
    assert.deepEqual(session, {
      accessToken: "oauth-access",
      refreshToken: "oauth-refresh",
      expiresAt: session.expiresAt,
      email: "owner@example.com",
      userId: "owner-id",
    });
    assert.deepEqual(duplicateSession, session);
    assert.ok(session.expiresAt > Math.floor(Date.now() / 1000));
    assert.equal(tokenCalls, 1);
    assert.equal(roleCalls, 1, "Strict Mode에서도 권한 확인까지 한 번만 실행합니다.");
    assert.deepEqual(tokenRequestBody, { auth_code: "oauth-code", code_verifier: verifier });
    assert.equal(replacedUrl, "/kstreetsnack/admin/auth/callback/");
    assert.equal(sessionStored.size, 0);
    const savedSession = stored.get("ksnack.menu-admin.supabase-session.v2");
    assert.equal(JSON.parse(savedSession).userId, "owner-id");

    stored.set("ksnack.menu-admin.supabase-session.v1", JSON.stringify(session));
    stored.delete("ksnack.menu-admin.supabase-session.v2");
    assert.equal(await client.restoreSession(), null);
    assert.equal(stored.has("ksnack.menu-admin.supabase-session.v1"), false);

    roleResponse = null;
    stored.set("ksnack.menu-admin.supabase-session.v2", JSON.stringify(session));
    await assert.rejects(client.loadRemoteRole(session), /운영자 권한 요청을 보냈습니다/);
    assert.equal(accessRequestCalls, 1);
    assert.equal(stored.size, 0);

    accessRequestFails = true;
    stored.set("ksnack.menu-admin.supabase-session.v2", JSON.stringify(session));
    await assert.rejects(client.loadRemoteRole(session), /운영자 권한 요청을 보내지 못했습니다/);
    assert.equal(accessRequestCalls, 2);
    assert.equal(stored.size, 0);

    location.search = "?error=access_denied&error_description=cancelled";
    location.href = `http://127.0.0.1:3000${location.pathname}${location.search}`;
    sessionStored.set("ksnack.menu-admin.google-pkce-verifier.v1", JSON.stringify({ verifier, createdAt: Date.now() }));
    const cancelledClient = await loadIsolatedSupabaseClient();
    await assert.rejects(cancelledClient.completeGoogleOAuthSignIn(), /Google 로그인이 취소되었습니다/);
    assert.equal(tokenCalls, 1);
    assert.equal(sessionStored.size, 0);

    location.search = "?code=non-google-code";
    location.href = `http://127.0.0.1:3000${location.pathname}${location.search}`;
    sessionStored.set("ksnack.menu-admin.google-pkce-verifier.v1", JSON.stringify({ verifier, createdAt: Date.now() }));
    tokenResponseMode = "malformed";
    const malformedClient = await loadIsolatedSupabaseClient();
    await assert.rejects(malformedClient.completeGoogleOAuthSignIn(), /Google 계정 로그인 정보를/);
    assert.equal(tokenCalls, 2);
    assert.equal(stored.size, 0);
    assert.equal(sessionStored.size, 0);

    const dashboard = readFileSync(path.resolve(appDirectory, "app", "admin", "admin-dashboard.tsx"), "utf8");
    const callbackPage = readFileSync(path.resolve(appDirectory, "app", "admin", "auth", "callback", "page.tsx"), "utf8");
    assert.match(dashboard, /Google로 로그인/);
    assert.match(dashboard, /signInWithGoogle/);
    assert.equal(dashboard.includes('type="password"'), false);
    assert.equal(dashboard.includes("signInWithPassword"), false);
    assert.match(callbackPage, /referrer: "no-referrer"/);
    assert.match(callbackPage, /robots: \{ index: false, follow: false \}/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousPublicKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousPublicKey;
    if (previousBasePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = previousBasePath;
  }
});

test("owner access helpers list only RPC candidates and persist exact role state", { concurrency: false }, async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousPublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const previousFetch = globalThis.fetch;
  const requests = [];

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://menu-admin-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  const session = {
    accessToken: "owner-access",
    refreshToken: "owner-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    email: "owner@example.com",
    userId: "owner-id",
  };
  const pendingRow = {
    user_id: "pending-id",
    email: "pending@example.com",
    role: null,
    is_active: false,
    has_google_identity: true,
    requested_at: "2026-08-20T00:00:00.000Z",
  };
  const legacyOwnerRow = {
    user_id: "owner-id",
    email: "owner@example.com",
    role: "owner",
    is_active: true,
    has_google_identity: false,
    requested_at: null,
  };

  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      assert.equal(new Headers(init.headers).get("apikey"), "sb_publishable_test");
      assert.equal(new Headers(init.headers).get("Authorization"), "Bearer owner-access");
      if (url.endsWith("/rest/v1/rpc/list_menu_admin_candidates")) {
        requests.push({ path: "list", body: JSON.parse(String(init.body)) });
        return Response.json([pendingRow, legacyOwnerRow]);
      }
      if (url.endsWith("/rest/v1/rpc/set_menu_admin_access")) {
        const body = JSON.parse(String(init.body));
        requests.push({ path: "set", body });
        return Response.json([{
          ...pendingRow,
          role: body.p_role,
          is_active: body.p_is_active,
          requested_at: body.p_is_active ? null : pendingRow.requested_at,
        }]);
      }
      if (url.endsWith("/rest/v1/rpc/reject_menu_admin_access_request")) {
        const body = JSON.parse(String(init.body));
        requests.push({ path: "reject", body });
        return Response.json(true);
      }
      throw new Error(`Unexpected test request: ${url}`);
    };

    const client = await loadIsolatedSupabaseClient();
    const candidates = await client.loadRemoteAdminCandidates(session);
    assert.deepEqual(candidates, [
      {
        userId: "pending-id",
        email: "pending@example.com",
        role: null,
        isActive: false,
        hasGoogleIdentity: true,
        requestedAt: "2026-08-20T00:00:00.000Z",
      },
      {
        userId: "owner-id",
        email: "owner@example.com",
        role: "owner",
        isActive: true,
        hasGoogleIdentity: false,
        requestedAt: null,
      },
    ]);
    assert.equal(
      client.remoteAdminAccessMatches(candidates, "pending-id", "manager", true),
      false,
      "승인 전 요청은 성공한 권한 변경으로 판정하지 않습니다.",
    );
    assert.equal(
      client.remoteAdminAccessRequestIsRejected(candidates, "pending-id"),
      false,
      "요청 시각이 남은 계정은 거절 완료로 판정하지 않습니다.",
    );

    const approved = await client.setRemoteAdminAccess(candidates[0], "manager", true, session);
    assert.equal(approved.role, "manager");
    assert.equal(approved.isActive, true);
    assert.equal(approved.requestedAt, null);
    assert.equal(client.remoteAdminAccessMatches([approved], "pending-id", "manager", true), true);
    assert.equal(client.remoteAdminAccessMatches([approved], "pending-id", "staff", true), false);
    assert.equal(
      client.remoteAdminAccessMatches([{ ...approved, requestedAt: "2026-08-20T01:00:00.000Z" }], "pending-id", "manager", true),
      false,
      "승인·재활성화 뒤 요청 행이 남아 있으면 완료로 판정하지 않습니다.",
    );

    const reactivationRequest = {
      ...approved,
      isActive: false,
      requestedAt: "2026-08-20T01:00:00.000Z",
    };
    assert.equal(
      client.remoteAdminAccessMatches([reactivationRequest], "pending-id", "manager", true),
      false,
      "비활성 재요청은 재활성화 성공으로 판정하지 않습니다.",
    );
    assert.equal(
      client.remoteAdminAccessMatches(
        [{ ...reactivationRequest, isActive: true, requestedAt: null }],
        "pending-id",
        "manager",
        true,
      ),
      true,
      "역할·활성 상태가 맞고 요청 행이 정리된 경우만 재활성화 성공입니다.",
    );
    assert.equal(client.remoteAdminAccessRequestIsRejected([reactivationRequest], "pending-id"), false);
    assert.equal(
      client.remoteAdminAccessRequestIsRejected([{ ...reactivationRequest, requestedAt: null }], "pending-id"),
      true,
    );
    assert.equal(
      client.remoteAdminAccessRequestIsRejected([approved], "pending-id"),
      false,
      "활성 계정은 요청 행이 없어도 거절 완료로 오인하지 않습니다.",
    );
    assert.equal(client.remoteAdminAccessRequestIsRejected([], "pending-id"), true);
    await client.rejectRemoteAdminAccessRequest(candidates[0], session);
    assert.deepEqual(requests, [
      { path: "list", body: {} },
      {
        path: "set",
        body: {
          p_user_id: "pending-id",
          p_role: "manager",
          p_is_active: true,
          p_expected_role: null,
          p_expected_is_active: false,
          p_expected_requested_at: "2026-08-20T00:00:00.000Z",
        },
      },
      {
        path: "reject",
        body: {
          p_user_id: "pending-id",
          p_expected_requested_at: "2026-08-20T00:00:00.000Z",
        },
      },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousPublicKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousPublicKey;
  }
});

test("inactive operator deletion sends the reviewed state only to the owner RPC", { concurrency: false }, async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousPublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const previousFetch = globalThis.fetch;
  const requests = [];

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://menu-admin-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  const session = {
    accessToken: "owner-access",
    refreshToken: "owner-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    email: "owner@example.com",
    userId: "owner-id",
  };
  const inactiveCandidate = {
    userId: "inactive-id",
    email: "inactive@example.com",
    role: "staff",
    isActive: false,
    hasGoogleIdentity: true,
    requestedAt: "2026-08-21T00:00:00.000Z",
  };

  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      assert.equal(url, "https://menu-admin-test.supabase.co/rest/v1/rpc/delete_menu_admin_access");
      assert.equal(new Headers(init.headers).get("apikey"), "sb_publishable_test");
      assert.equal(new Headers(init.headers).get("Authorization"), "Bearer owner-access");
      requests.push({ method: init.method, body: JSON.parse(String(init.body)) });
      return Response.json(true);
    };

    const client = await loadIsolatedSupabaseClient();
    assert.equal(client.remoteAdminAccessIsDeleted([inactiveCandidate], "inactive-id"), false);
    assert.equal(client.remoteAdminAccessIsDeleted([], "inactive-id"), true);
    await client.deleteRemoteAdminAccess(inactiveCandidate, session);
    assert.deepEqual(requests, [{
      method: "POST",
      body: {
        p_user_id: "inactive-id",
        p_expected_role: "staff",
        p_expected_is_active: false,
        p_expected_requested_at: "2026-08-21T00:00:00.000Z",
      },
    }]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousPublicKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousPublicKey;
  }
});

test("pre-test menu recovery is immutable, owner-only, atomic, and concurrency-safe", () => {
  const migration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260821010000_add_pretest_menu_restore.sql",
    ),
    "utf8",
  );
  const bootstrapMigration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260822030000_add_menu_restore_baseline_bootstrap.sql",
    ),
    "utf8",
  );

  assert.ok(migration.indexOf("begin;") < migration.indexOf("create table"));
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /create table if not exists public\.menu_restore_baselines/);
  assert.match(migration, /check \(baseline_key = 'pre_test_2026_08_21'\)/);
  assert.match(migration, /check \(item_count = 80\)/);
  assert.match(migration, /create trigger menu_restore_baselines_immutable[\s\S]*before update or delete/);
  assert.match(migration, /pg_trigger_depth\(\) > 1[\s\S]*TG_TABLE_NAME = 'menu_restore_baselines'[\s\S]*to_jsonb\(new\) - 'captured_by'[\s\S]*to_jsonb\(old\) - 'captured_by'/);
  assert.match(migration, /create table if not exists public\.menu_restore_audit/);
  assert.match(migration, /before_draft_snapshot jsonb not null/);
  assert.match(migration, /create trigger menu_restore_audit_immutable[\s\S]*before update or delete/);
  assert.match(migration, /pg_trigger_depth\(\) > 1[\s\S]*TG_TABLE_NAME = 'menu_restore_audit'[\s\S]*to_jsonb\(new\) - 'restored_by'[\s\S]*to_jsonb\(old\) - 'restored_by'/);
  assert.match(migration, /Pre-test baseline capture requires the matching current 80-item menu/);
  assert.match(migration, /Pre-test baseline capture deferred until the initial menu seed is published\.[\s\S]*return;/);
  assert.doesNotMatch(migration, /raise exception 'Cannot capture the pre-test baseline without a current published release\.'/);
  assert.match(migration, /v_missing_published_items/);
  assert.match(migration, /v_published_snapshot := public\.build_menu_snapshot\(v_captured_at\)/);
  assert.match(migration, /create table if not exists public\.menu_draft_state/);
  for (const table of ["sections", "categories", "menu_items", "menu_availability"]) {
    assert.match(migration, new RegExp(`create trigger ${table}_bump_draft_revision`));
  }

  const restoreStart = migration.indexOf("create or replace function public.restore_pretest_menu");
  const restoreEnd = migration.indexOf("\n$$;", restoreStart);
  const restoreFunction = migration.slice(restoreStart, restoreEnd + 4);
  assert.ok(
    restoreFunction.indexOf("Only an active owner may restore the pre-test menu")
      < restoreFunction.indexOf("pg_advisory_xact_lock"),
    "비-owner는 잠금 전에 거부합니다.",
  );
  assert.ok(
    restoreFunction.indexOf("lock table public.sections")
      < restoreFunction.indexOf("from public.menu_draft_state as draft_state"),
    "기존 writer와의 교착을 피하도록 draft revision보다 콘텐츠 테이블을 먼저 잠급니다.",
  );
  assert.match(
    restoreFunction,
    /v_current_release_id is distinct from p_expected_current_release_id[\s\S]*v_current_draft_revision is distinct from p_expected_draft_revision[\s\S]*errcode = '40001'/,
  );
  assert.match(
    restoreFunction,
    /A repeated request id is an idempotent response-loss reconciliation[\s\S]*where audit\.request_id = p_request_id[\s\S]*if found then/,
  );
  assert.equal(
    restoreFunction.match(/where audit\.request_id = p_request_id/g)?.length,
    2,
    "동일 request id의 동시 요청도 직렬화 뒤 감사행을 다시 확인합니다.",
  );
  assert.match(restoreFunction, /update public\.menu_items[\s\S]*update public\.categories[\s\S]*update public\.sections/);
  assert.match(restoreFunction, /delete from public\.menu_items[\s\S]*insert into public\.sections[\s\S]*insert into public\.categories[\s\S]*insert into public\.menu_items/);
  assert.match(restoreFunction, /insert into public\.menu_availability[\s\S]*is_available = excluded\.is_available/);
  assert.match(restoreFunction, /public\.build_menu_draft_snapshot\(\) <> v_baseline\.draft_snapshot/);
  assert.match(restoreFunction, /v_restored_snapshot -> 'groups'[\s\S]*v_baseline\.published_snapshot -> 'groups'/);
  assert.match(restoreFunction, /insert into public\.menu_releases/);
  assert.match(restoreFunction, /update public\.site_settings[\s\S]*current_release_id = v_restored_release_id/);
  assert.match(restoreFunction, /insert into public\.menu_restore_audit/);
  assert.doesNotMatch(restoreFunction, /update\s+public\.menu_releases/i);
  assert.match(migration, /revoke all on table public\.menu_restore_baselines from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.restore_pretest_menu\(uuid, uuid, bigint\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.restore_pretest_menu\([^\n]+\) to (anon|service_role)/);

  assert.ok(
    bootstrapMigration.indexOf("begin;")
      < bootstrapMigration.indexOf("create or replace function public.get_menu_restore_baseline_bootstrap_status"),
  );
  assert.match(bootstrapMigration, /commit;\s*$/);
  assert.match(
    bootstrapMigration,
    /create or replace function public\.capture_pretest_menu_restore_baseline[\s\S]*coalesce\(auth\.role\(\), ''\) <> 'service_role'/,
  );
  assert.match(bootstrapMigration, /p_expected_release_id uuid/);
  assert.equal(
    bootstrapMigration.match(/where baseline\.baseline_key = 'pre_test_2026_08_21'/g)?.length,
    3,
    "상태 조회와 capture의 잠금 전·후 재조회가 고정 기준점만 사용합니다.",
  );
  assert.match(bootstrapMigration, /pg_advisory_xact_lock\(662061563457110137\)/);
  assert.match(bootstrapMigration, /lock table public\.sections, public\.categories, public\.menu_items, public\.menu_availability[\s\S]*share row exclusive mode/);
  assert.match(bootstrapMigration, /lock table public\.menu_restore_baselines in share row exclusive mode/);
  assert.match(bootstrapMigration, /v_current_release_id is distinct from p_expected_release_id[\s\S]*v_live_release_id is distinct from p_expected_release_id/);
  assert.match(bootstrapMigration, /v_release_count <> 1/);
  assert.match(bootstrapMigration, /v_section_count <> 2[\s\S]*v_category_count <> 13[\s\S]*v_draft_item_count <> 80[\s\S]*v_availability_count <> 80[\s\S]*v_published_item_count <> 80/);
  assert.match(bootstrapMigration, /v_missing_published_items <> 0/);
  assert.match(bootstrapMigration, /v_published_snapshot -> 'sections'[\s\S]*v_release\.snapshot -> 'sections'/);
  assert.match(bootstrapMigration, /v_published_snapshot -> 'groups'[\s\S]*v_release\.snapshot -> 'groups'/);
  assert.match(bootstrapMigration, /insert into public\.menu_restore_baselines/);
  const captureStart = bootstrapMigration.indexOf("create or replace function public.capture_pretest_menu_restore_baseline");
  const captureEnd = bootstrapMigration.indexOf("\n$$;", captureStart);
  const captureFunction = bootstrapMigration.slice(captureStart, captureEnd + 4);
  assert.doesNotMatch(captureFunction, /(update|delete from)\s+public\.menu_restore_baselines/i);
  assert.match(bootstrapMigration, /revoke all on function public\.capture_pretest_menu_restore_baseline\(uuid\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(bootstrapMigration, /grant execute on function public\.capture_pretest_menu_restore_baseline\(uuid\)[\s\S]*to service_role/);
  assert.doesNotMatch(bootstrapMigration, /grant execute on function public\.capture_pretest_menu_restore_baseline\(uuid\)[\s\S]*to (anon|authenticated)/);
});

test("menu recovery client uses reviewed CAS state and reconciles a lost response", { concurrency: false }, async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousPublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const previousFetch = globalThis.fetch;
  const requests = [];

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://menu-admin-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  const session = {
    accessToken: "owner-access",
    refreshToken: "owner-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    email: "owner@example.com",
    userId: "owner-id",
  };
  const statusRow = {
    baseline_key: "pre_test_2026_08_21",
    captured_at: "2026-08-21T00:00:00.000Z",
    baseline_source_release_id: "baseline-release-id",
    baseline_source_release_version: "1",
    baseline_item_count: 80,
    current_release_id: "reviewed-release-id",
    current_release_version: "7",
    draft_revision: "42",
    is_draft_at_baseline: false,
    is_published_at_baseline: false,
  };
  const resultRow = {
    request_id: "11111111-1111-4111-8111-111111111111",
    restored_release_id: "restored-release-id",
    restored_at: "2026-08-21T01:00:00.000Z",
    draft_revision: "311",
    baseline_source_release_id: "baseline-release-id",
    restored_item_count: 80,
  };

  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      assert.equal(new Headers(init.headers).get("apikey"), "sb_publishable_test");
      assert.equal(new Headers(init.headers).get("Authorization"), "Bearer owner-access");
      const body = JSON.parse(String(init.body));
      if (url.endsWith("/rest/v1/rpc/get_menu_restore_status")) {
        requests.push({ path: "status", body });
        return Response.json([statusRow]);
      }
      if (url.endsWith("/rest/v1/rpc/restore_pretest_menu")) {
        requests.push({ path: "restore", body });
        throw new TypeError("response lost after commit");
      }
      if (url.endsWith("/rest/v1/rpc/get_menu_restore_result")) {
        requests.push({ path: "result", body });
        return Response.json([resultRow]);
      }
      throw new Error(`Unexpected test request: ${url}`);
    };

    const client = await loadIsolatedSupabaseClient();
    const status = await client.loadRemoteMenuRestoreStatus(session);
    assert.deepEqual(status, {
      baselineKey: "pre_test_2026_08_21",
      capturedAt: "2026-08-21T00:00:00.000Z",
      baselineSourceReleaseId: "baseline-release-id",
      baselineSourceReleaseVersion: 1,
      baselineItemCount: 80,
      currentReleaseId: "reviewed-release-id",
      currentReleaseVersion: 7,
      draftRevision: 42,
      isDraftAtBaseline: false,
      isPublishedAtBaseline: false,
    });
    const result = await client.restoreRemotePretestMenu(
      status,
      resultRow.request_id,
      session,
    );
    assert.deepEqual(result, {
      requestId: resultRow.request_id,
      restoredReleaseId: "restored-release-id",
      restoredAt: "2026-08-21T01:00:00.000Z",
      draftRevision: 311,
      baselineSourceReleaseId: "baseline-release-id",
      restoredItemCount: 80,
    });
    assert.deepEqual(requests, [
      { path: "status", body: {} },
      {
        path: "restore",
        body: {
          p_request_id: resultRow.request_id,
          p_expected_current_release_id: "reviewed-release-id",
          p_expected_draft_revision: 42,
        },
      },
      { path: "result", body: { p_request_id: resultRow.request_id } },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousPublicKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousPublicKey;
  }
});

test("owner-only operator UI exposes request review without weakening self protection", () => {
  const dashboard = readFileSync(path.resolve(appDirectory, "app", "admin", "admin-dashboard.tsx"), "utf8");
  const dashboardPage = readFileSync(path.resolve(appDirectory, "app", "admin", "page.tsx"), "utf8");
  const menuPage = readFileSync(path.resolve(appDirectory, "app", "admin", "menu", "page.tsx"), "utf8");
  const operatorPage = readFileSync(path.resolve(appDirectory, "app", "admin", "operators", "page.tsx"), "utf8");
  const callback = readFileSync(path.resolve(appDirectory, "app", "admin", "auth", "callback", "callback-client.tsx"), "utf8");
  const headerMarkup = dashboard.slice(
    dashboard.indexOf("<header"),
    dashboard.indexOf("</header>") + "</header>".length,
  );
  const accessChangeBody = dashboard.slice(
    dashboard.indexOf("async function changeOperatorAccess"),
    dashboard.indexOf("async function rejectOperatorRequest"),
  );
  const requestRejectionBody = dashboard.slice(
    dashboard.indexOf("async function rejectOperatorRequest"),
    dashboard.indexOf("async function deleteOperatorAccess"),
  );
  const accessDeletionBody = dashboard.slice(
    dashboard.indexOf("async function deleteOperatorAccess"),
    dashboard.indexOf("function openAdd"),
  );

  assert.match(dashboardPage, /view="dashboard"/);
  assert.match(menuPage, /view="menu"/);
  assert.match(operatorPage, /view="operators"/);
  assert.match(dashboard, /aria-label="운영툴 주요 메뉴"/);
  assert.doesNotMatch(headerMarkup, /styles\.adminNav/);
  assert.match(dashboard, /<\/header>[\s\S]*styles\.appNavBar[\s\S]*styles\.adminNav/);
  assert.match(dashboard, /aria-current=\{view === "operators" \? "page" : undefined\}/);
  assert.match(dashboard, /view === "operators"/);
  assert.match(dashboard, /role !== "owner"[\s\S]*최고 관리자만 운영자 권한을 변경할 수 있습니다/);
  assert.match(dashboard, /role === "owner" && requestedOperators\.length > 0/);
  assert.match(dashboard, /loadRemoteAdminCandidates/);
  assert.match(dashboard, /setRemoteAdminAccess/);
  assert.match(dashboard, /rejectRemoteAdminAccessRequest/);
  assert.match(dashboard, /deleteRemoteAdminAccess/);
  assert.match(dashboard, /승인 대기/);
  assert.match(dashboard, /사용 중인 운영자/);
  assert.match(dashboard, /이용 중지된 운영자/);
  assert.match(dashboard, /요청 거절/);
  assert.match(dashboard, /운영자 목록에서 삭제/);
  assert.match(dashboard, /candidate\.userId === session\?\.userId/);
  assert.doesNotMatch(dashboard, /operatorPanelOpen/);
  assert.doesNotMatch(dashboard, /role="dialog"[\s\S]*operator-manager-title/);
  assert.match(dashboard, /navigationLocked = busy \|\| Boolean\(keyboardReorder\) \|\| Boolean\(operatorBusyId\)/);
  assert.match(dashboard, /onClick=\{blockLockedNavigation\}/);
  assert.match(dashboard, /remoteAdminAccessMatches/);
  assert.match(dashboard, /remoteAdminAccessRequestIsRejected/);
  assert.match(dashboard, /remoteAdminAccessIsDeleted/);
  assert.match(dashboard, /변경 결과를 확인할 수 없어 목록을 새로 불러왔습니다/);
  assert.equal((accessChangeBody.match(/setRemoteAdminAccess/g) ?? []).length, 1);
  assert.equal((requestRejectionBody.match(/rejectRemoteAdminAccessRequest/g) ?? []).length, 1);
  assert.equal((accessDeletionBody.match(/deleteRemoteAdminAccess/g) ?? []).length, 1);
  assert.match(accessChangeBody, /setRemoteAdminAccess\(candidate, nextRole, nextActive, session\)/);
  assert.match(requestRejectionBody, /rejectRemoteAdminAccessRequest\(candidate, session\)/);
  assert.match(accessDeletionBody, /candidate\.userId === session\.userId/);
  assert.match(accessDeletionBody, /candidate\.role === null/);
  assert.match(accessDeletionBody, /candidate\.isActive/);
  assert.match(accessDeletionBody, /Google 계정은 삭제되지 않습니다/);
  assert.match(accessDeletionBody, /deleteRemoteAdminAccess\(candidate, session\)/);
  assert.match(accessDeletionBody, /catch \{[\s\S]*loadRemoteAdminCandidates\(session\)[\s\S]*remoteAdminAccessIsDeleted/);
  assert.match(accessChangeBody, /catch \{[\s\S]*loadRemoteAdminCandidates\(session\)/);
  assert.match(requestRejectionBody, /catch \{[\s\S]*loadRemoteAdminCandidates\(session\)/);
  assert.match(dashboard, /처음 로그인하면 최고 관리자에게 운영자 승인 요청이 전송됩니다/);
  assert.match(callback, /운영자 승인을 기다리고 있어요/);
});

test("audit actor foreign keys can be cleared without permitting ordinary audit rewrites", () => {
  const baseMigration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260819000000_create_menu_admin_schema.sql",
    ),
    "utf8",
  );
  const cleanupMigration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260822060000_allow_auth_actor_fk_cleanup.sql",
    ),
    "utf8",
  );
  const hardeningMigration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260822070000_reapply_security_function_hardening.sql",
    ),
    "utf8",
  );

  for (const migration of [baseMigration, cleanupMigration]) {
    const functionStart = migration.indexOf(
      "create or replace function public.set_content_audit_fields()",
    );
    const functionEnd = migration.indexOf("\n$$;", functionStart);
    const auditFunction = migration.slice(functionStart, functionEnd + 4);
    assert.ok(functionStart >= 0);
    assert.match(
      auditFunction,
      /pg_trigger_depth\(\) > 1[\s\S]*to_jsonb\(new\) - array\['created_by', 'updated_by'\]::text\[\][\s\S]*to_jsonb\(old\) - array\['created_by', 'updated_by'\]::text\[\]/,
    );
    assert.match(auditFunction, /old\.created_by is not null and new\.created_by is null/);
    assert.match(auditFunction, /old\.updated_by is not null and new\.updated_by is null/);
    assert.match(auditFunction, /new\.created_by := old\.created_by/);
  }

  assert.ok(cleanupMigration.indexOf("begin;") < cleanupMigration.indexOf("create or replace function"));
  assert.match(cleanupMigration, /commit;\s*$/);
  assert.doesNotMatch(cleanupMigration, /^\+/m);
  assert.ok(hardeningMigration.indexOf("begin;") < hardeningMigration.indexOf("create or replace function"));
  assert.match(hardeningMigration, /create or replace function public\.prevent_menu_restore_record_change\(\)[\s\S]*pg_trigger_depth\(\) > 1[\s\S]*menu_restore_baselines[\s\S]*menu_restore_audit/);
  assert.match(hardeningMigration, /create or replace function public\.is_google_admin_session\(\)[\s\S]*auth_session\.not_after is null[\s\S]*auth_session\.not_after > clock_timestamp\(\)/);
  assert.match(hardeningMigration, /revoke all on function public\.prevent_menu_restore_record_change\(\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(hardeningMigration, /grant execute on function public\.is_google_admin_session\(\) to authenticated/);
  assert.match(hardeningMigration, /commit;\s*$/);
});

test("operator management RPC wrappers restore authenticated-only execute grants", () => {
  const migration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260822080000_restore_menu_admin_rpc_execute_grants.sql",
    ),
    "utf8",
  );
  const signatures = [
    "request_menu_admin_access\\(\\)",
    "list_menu_admin_candidates\\(\\)",
    "set_menu_admin_access\\(uuid, text, boolean, text, boolean, timestamptz\\)",
    "reject_menu_admin_access_request\\(uuid, timestamptz\\)",
    "delete_menu_admin_access\\(uuid, text, boolean, timestamptz\\)",
  ];

  assert.ok(migration.indexOf("begin;") < migration.indexOf("do $verify_menu_admin_wrappers$"));
  assert.match(migration, /procedure\.prosecdef/);
  for (const signature of signatures) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*?from public, anon, authenticated, service_role`),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${signature}[\\s\\S]*?to authenticated`),
    );
  }
  assert.match(migration, /has_function_privilege\('authenticated', v_signature, 'EXECUTE'\)/);
  assert.match(migration, /has_function_privilege\('anon', v_signature, 'EXECUTE'\)/);
  assert.match(migration, /has_function_privilege\('service_role', v_signature, 'EXECUTE'\)/);
  assert.match(migration, /commit;\s*$/);
});

test("remote menu writes keep indeterminate uploads intact and preserve successful mutations on reload failure", () => {
  const dashboard = readFileSync(path.resolve(appDirectory, "app", "admin", "admin-dashboard.tsx"), "utf8");
  const remoteClient = readFileSync(path.resolve(appDirectory, "lib", "menu-admin", "supabase-rest.ts"), "utf8");
  const createMigration = readFileSync(
    path.resolve(
      appDirectory,
      "..",
      "supabase",
      "migrations",
      "20260822050000_add_idempotent_menu_create.sql",
    ),
    "utf8",
  );
  const saveDraftBody = dashboard.slice(
    dashboard.indexOf("async function saveDraft"),
    dashboard.indexOf("async function toggleAvailability"),
  );
  const archiveBody = dashboard.slice(
    dashboard.indexOf("async function archiveItem"),
    dashboard.indexOf("async function publishMenu"),
  );
  const publishBody = dashboard.slice(
    dashboard.indexOf("async function publishMenu"),
    dashboard.indexOf("function handleReset"),
  );

  assert.ok(saveDraftBody.indexOf("await uploadRemoteImage") < saveDraftBody.indexOf("await createRemoteItem"));
  assert.equal((saveDraftBody.match(/await createRemoteItem/g) ?? []).length, 1);
  assert.match(remoteClient, /createRemoteItem\([\s\S]*requestId: string[\s\S]*create_menu_item_idempotent[\s\S]*p_request_id: requestId/);
  assert.match(remoteClient, /createRemoteCategory\([\s\S]*requestId: string[\s\S]*create_menu_category_idempotent[\s\S]*p_request_id: requestId/);
  assert.match(dashboard, /pendingItemCreateRequestIdRef\.current = crypto\.randomUUID\(\)/);
  assert.match(dashboard, /pendingCategoryCreateRequestIdRef\.current = crypto\.randomUUID\(\)/);
  assert.match(saveDraftBody, /pendingItemUploadedPathRef\.current[\s\S]*createRemoteItem\([\s\S]*createRequestId/);
  assert.match(dashboard, /pendingCategoryUploadedPathRef\.current[\s\S]*createRemoteCategory\([\s\S]*createRequestId/);
  assert.match(createMigration, /create table if not exists public\.menu_create_requests/);
  assert.match(createMigration, /pg_advisory_xact_lock[\s\S]*menu-item-create:[\s\S]*request_payload is distinct from v_payload/);
  assert.match(createMigration, /pg_advisory_xact_lock[\s\S]*menu-category-create:[\s\S]*request_payload is distinct from v_payload/);
  assert.match(createMigration, /revoke all on function public\.create_menu_item\([\s\S]*from public, anon, authenticated, service_role/);
  assert.match(createMigration, /revoke all on function public\.create_menu_category\([\s\S]*from public, anon, authenticated, service_role/);
  assert.match(createMigration, /grant execute on function public\.create_menu_item_idempotent[\s\S]*to authenticated, service_role/);
  assert.match(createMigration, /grant execute on function public\.create_menu_category_idempotent[\s\S]*to authenticated, service_role/);
  assert.equal(dashboard.includes("discardRemoteUpload"), false);
  assert.equal(dashboard.includes("deleteRemoteImage"), false);
  assert.equal(remoteClient.includes("deleteRemoteImage"), false);
  assert.match(dashboard, /window\.addEventListener\(SESSION_EXPIRED_EVENT, handleSessionExpired\)/);
  assert.match(archiveBody, /reloadRemoteWithFallback\(optimisticState, session\)/);
  assert.ok(
    publishBody.indexOf("await publishRemoteMenu(session)")
      < publishBody.indexOf("setState(await loadRemoteState(session))"),
    "확인용 저장 뒤 서버의 실제 immutable release를 다시 읽습니다.",
  );
  assert.doesNotMatch(publishBody, /buildPublishedPayload|optimisticRelease|reloadRemoteWithFallback/);
  assert.match(publishBody, /setPublicationReloadRequired\(true\)[\s\S]*setLastPublish\(null\)[\s\S]*사이트 공개를 잠시 막았습니다[\s\S]*return/);
  assert.match(dashboard, /publicationReloadRequired[\s\S]*페이지를 새로고침한 뒤 사이트에 공개해 주세요/);
  assert.match(dashboard, /disabled=\{mutationLocked[\s\S]*publicationReloadRequired/);
  assert.match(dashboard, /async function handleLogout\(\)[\s\S]*?try \{[\s\S]*?await signOut\(session\);[\s\S]*?finally \{[\s\S]*?setSession\(null\)/);
});

test("admin interface keeps publishing language plain and consistent", () => {
  const dashboard = readFileSync(path.resolve(appDirectory, "app", "admin", "admin-dashboard.tsx"), "utf8");
  const preview = readFileSync(path.resolve(appDirectory, "app", "admin", "preview", "preview-client.tsx"), "utf8");

  assert.match(dashboard, /K STREET SNACK 의 메뉴를/);
  assert.match(dashboard, /확인용으로 저장/);
  assert.match(dashboard, /사이트에 공개/);
  assert.match(dashboard, /판매 중·품절 변경은 손님 화면에 바로 반영됩니다/);
  assert.match(dashboard, /이름·가격·사진·순서·보관 변경은 확인용으로 저장한 뒤 최고 관리자가 사이트에 공개해야 반영됩니다/);
  assert.match(dashboard, /판매 상태는 즉시 반영됩니다\. 카탈로그 변경은 확인용 저장 후 최고 관리자가 사이트에 공개합니다/);
  assert.equal(dashboard.includes("변경한 내용은 사이트에 공개하기 전까지 손님 화면에 나타나지 않습니다."), false);
  assert.match(dashboard, /이 브라우저에만 저장/);
  assert.match(dashboard, /styles\.headerActions[\s\S]*styles\.headerResetButton/);
  assert.equal(dashboard.includes("styles.sidebarFooter"), false);
  assert.match(dashboard, /저장한 메뉴 확인/);
  assert.match(dashboard, /summarizeReleasePayload/);
  assert.ok(
    dashboard.indexOf('id="saved-menu-records"') < dashboard.indexOf('className={styles.stats}'),
    "저장한 메뉴 확인은 현황과 긴 메뉴 목록보다 앞에 있어야 합니다.",
  );
  assert.equal(dashboard.includes("확인용 저장 기록"), false);
  assert.match(preview, /사이트 공개 전 미리보기/);
  for (const jargon of [
    "MENU CONTROL CENTER",
    "MENU LIBRARY",
    "RELEASE HISTORY",
    "CATEGORY LIBRARY",
    "검수용 스냅샷",
    "실제 사이트 배포",
    "Supabase 초안 데이터",
  ]) {
    assert.equal(dashboard.includes(jargon) || preview.includes(jargon), false, jargon);
  }
});

test("TV menu boards remain clearly labelled as a trial feature", () => {
  const dashboardSource = readFileSync(path.resolve(appDirectory, "app", "admin", "admin-dashboard.tsx"), "utf8");

  assert.match(dashboardSource, /매장 메뉴판 · 시험 기능/);
  assert.match(dashboardSource, />시험 기능<\/span>/);
  assert.match(dashboardSource, /현재 시험 운영 중인 기능입니다\./);
  assert.doesNotMatch(dashboardSource, /매장 메뉴판 · 실험 기능|로컬 테스트|아직 실제 사이트에는 공개하지 않는 테스트 기능/);
});
