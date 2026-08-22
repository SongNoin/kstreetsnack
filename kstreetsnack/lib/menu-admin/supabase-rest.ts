import type {
  AdminCategory,
  AdminMenuItem,
  AdminRelease,
  AdminRole,
  AdminSection,
  AuthSession,
  DeploymentRequestResult,
  DeploymentStatus,
  LocalizedText,
  MenuAdminState,
  MenuRestoreResult,
  MenuRestoreStatus,
  MenuTag,
  PublishResult,
} from "./types";
import { normalizeReleasePayload, summarizeReleasePayload } from "./release-details";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? "";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const LEGACY_SESSION_KEY = "ksnack.menu-admin.supabase-session.v1";
const SESSION_KEY = "ksnack.menu-admin.supabase-session.v2";
const PKCE_VERIFIER_KEY = "ksnack.menu-admin.google-pkce-verifier.v1";
const PKCE_MAX_AGE_MS = 10 * 60 * 1000;
const STORAGE_BUCKET = "menu-images";
const SESSION_EXPIRED_MESSAGE = "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.";
const OAUTH_CALLBACK_KEYS = [
  "code",
  "error",
  "error_code",
  "error_description",
] as const;
const LEGACY_OAUTH_HASH_KEYS = ["access_token", "refresh_token", "provider_token"] as const;

export const SESSION_EXPIRED_EVENT = "ksnack:menu-admin-session-expired";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

type JsonRecord = Record<string, unknown>;
type RefreshFlight = { refreshToken: string; promise: Promise<AuthSession> };

let refreshFlight: RefreshFlight | null = null;
let oauthRedirectStarting = false;
let oauthCallbackFlight: Promise<AuthSession> | null = null;

function localized(value: unknown): LocalizedText {
  if (typeof value === "string") return { pl: value, en: value, ko: value };
  if (Array.isArray(value)) {
    return { pl: String(value[0] ?? ""), en: String(value[1] ?? ""), ko: String(value[2] ?? "") };
  }
  const record = value && typeof value === "object" ? value as JsonRecord : {};
  return {
    pl: String(record.pl ?? ""),
    en: String(record.en ?? ""),
    ko: String(record.ko ?? ""),
  };
}

async function readError(response: Response) {
  try {
    const body = await response.json() as JsonRecord;
    return String(body.msg ?? body.message ?? body.error_description ?? body.error ?? response.statusText);
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

async function supabaseFetch<T>(
  path: string,
  session: AuthSession | null,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("apikey", SUPABASE_ANON_KEY);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const request = { ...init, headers };
  const url = `${SUPABASE_URL}${path}`;
  const response = session
    ? await fetchWithSessionRefresh(url, session, request)
    : await fetch(url, request);
  if (!response.ok) throw new Error(await readError(response));
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function isGoogleUser(user: JsonRecord) {
  const appMetadata = user.app_metadata && typeof user.app_metadata === "object"
    ? user.app_metadata as JsonRecord
    : {};
  const providers = Array.isArray(appMetadata.providers)
    ? appMetadata.providers.map(String)
    : [];
  const identities = Array.isArray(user.identities) ? user.identities : [];
  return appMetadata.provider === "google"
    || providers.includes("google")
    || identities.some((identity) => (
      identity && typeof identity === "object" && (identity as JsonRecord).provider === "google"
    ));
}

function responseString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function sessionFromResponse(value: JsonRecord, requireGoogle = false): AuthSession {
  const user = value.user && typeof value.user === "object" ? value.user as JsonRecord : {};
  const expiresAt = Number(value.expires_at ?? 0)
    || Math.floor(Date.now() / 1000) + Number(value.expires_in ?? 0);
  const session = {
    accessToken: responseString(value.access_token),
    refreshToken: responseString(value.refresh_token),
    expiresAt,
    email: responseString(user.email),
    userId: responseString(user.id),
  };
  if (
    !session.accessToken
    || !session.refreshToken
    || !session.userId
    || !session.email
    || !Number.isFinite(session.expiresAt)
    || session.expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    throw new Error("로그인 세션을 확인하지 못했습니다.");
  }
  if (requireGoogle && !isGoogleUser(user)) throw new Error("Google 계정 로그인 정보를 확인하지 못했습니다.");
  return session;
}

function storedSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<AuthSession>;
  if (
    typeof session.accessToken !== "string"
    || !session.accessToken
    || typeof session.refreshToken !== "string"
    || !session.refreshToken
    || typeof session.email !== "string"
    || !session.email
    || typeof session.userId !== "string"
    || !session.userId
    || typeof session.expiresAt !== "number"
    || !Number.isFinite(session.expiresAt)
    || session.expiresAt <= 0
  ) return null;
  return session as AuthSession;
}

function cleanOAuthCallbackUrl() {
  const url = new URL(window.location.href);
  for (const key of OAUTH_CALLBACK_KEYS) url.searchParams.delete(key);
  url.hash = "";
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

function base64Url(bytes: Uint8Array) {
  return window.btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createPkcePair() {
  const random = new Uint8Array(32);
  window.crypto.getRandomValues(random);
  const verifier = base64Url(random);
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function readPkceVerifier() {
  try {
    const raw = window.sessionStorage.getItem(PKCE_VERIFIER_KEY);
    if (!raw) return "";
    const value = JSON.parse(raw) as { verifier?: unknown; createdAt?: unknown };
    const createdAt = Number(value.createdAt);
    if (
      typeof value.verifier !== "string"
      || !/^[A-Za-z0-9_-]{43,128}$/.test(value.verifier)
      || !Number.isFinite(createdAt)
      || createdAt > Date.now() + 30_000
      || Date.now() - createdAt > PKCE_MAX_AGE_MS
    ) return "";
    return value.verifier;
  } catch {
    return "";
  }
}

function oauthErrorMessage(params: URLSearchParams) {
  const code = params.get("error_code") ?? params.get("error") ?? "";
  if (code === "access_denied") return "Google 로그인이 취소되었습니다.";
  return "Google 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

async function consumeGoogleOAuthCallback(): Promise<AuthSession> {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const hasLegacyTokenResult = LEGACY_OAUTH_HASH_KEYS.some((key) => hash.has(key));
  const hasOAuthResult = OAUTH_CALLBACK_KEYS.some((key) => query.has(key)) || hasLegacyTokenResult;
  if (!hasOAuthResult) throw new Error("Google 로그인 결과를 찾지 못했습니다. 다시 로그인해 주세요.");

  try {
    if (hasLegacyTokenResult) {
      throw new Error("안전한 Google 로그인을 다시 시작해 주세요.");
    }
    if (query.has("error") || query.has("error_code") || query.has("error_description")) {
      throw new Error(oauthErrorMessage(query));
    }

    const authCode = query.get("code") ?? "";
    const verifier = readPkceVerifier();
    if (!authCode || !verifier) throw new Error("Google 로그인 확인 시간이 지났습니다. 다시 로그인해 주세요.");
    const value = await supabaseFetch<JsonRecord>("/auth/v1/token?grant_type=pkce", null, {
      method: "POST",
      body: JSON.stringify({ auth_code: authCode, code_verifier: verifier }),
    });
    return sessionFromResponse(value, true);
  } finally {
    window.sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    cleanOAuthCallbackUrl();
  }
}

function storeSession(session: AuthSession | null) {
  window.localStorage.removeItem(LEGACY_SESSION_KEY);
  if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else window.localStorage.removeItem(SESSION_KEY);
}

function expireSession() {
  storeSession(null);
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

async function requestRefreshedSession(refreshToken: string) {
  const value = await supabaseFetch<JsonRecord>("/auth/v1/token?grant_type=refresh_token", null, {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const refreshed = sessionFromResponse(value);
  if (!refreshed.accessToken || !refreshed.refreshToken) throw new Error(SESSION_EXPIRED_MESSAGE);
  return refreshed;
}

async function refreshAuthenticatedSession(session: AuthSession) {
  if (!session.refreshToken) {
    expireSession();
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }

  const flight = refreshFlight?.refreshToken === session.refreshToken
    ? refreshFlight
    : {
        refreshToken: session.refreshToken,
        promise: requestRefreshedSession(session.refreshToken),
      };
  refreshFlight = flight;

  try {
    const refreshed = await flight.promise;
    Object.assign(session, {
      ...refreshed,
      email: refreshed.email || session.email,
      userId: refreshed.userId || session.userId,
    });
    storeSession(session);
    return session;
  } catch {
    expireSession();
    throw new Error(SESSION_EXPIRED_MESSAGE);
  } finally {
    if (refreshFlight === flight) refreshFlight = null;
  }
}

function withAuthorization(init: RequestInit, accessToken: string) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return { ...init, headers };
}

async function fetchWithSessionRefresh(url: string, session: AuthSession, init: RequestInit) {
  const requestAccessToken = session.accessToken;
  let response = await fetch(url, withAuthorization(init, requestAccessToken));
  if (response.status !== 401) return response;

  // A concurrent request may already have refreshed this shared session object.
  if (session.accessToken === requestAccessToken) await refreshAuthenticatedSession(session);
  response = await fetch(url, withAuthorization(init, session.accessToken));
  if (response.status === 401) {
    expireSession();
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }
  return response;
}

export async function signInWithGoogle() {
  if (!isSupabaseConfigured) throw new Error("Google 로그인을 시작할 수 없습니다. 온라인 저장소 설정을 확인해 주세요.");
  if (oauthRedirectStarting) return;
  oauthRedirectStarting = true;
  try {
    const { verifier, challenge } = await createPkcePair();
    window.sessionStorage.setItem(PKCE_VERIFIER_KEY, JSON.stringify({ verifier, createdAt: Date.now() }));
    const redirectUrl = new URL(`${BASE_PATH}/admin/auth/callback/`, window.location.origin);
    const authorizeUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
    authorizeUrl.searchParams.set("provider", "google");
    authorizeUrl.searchParams.set("redirect_to", redirectUrl.toString());
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "s256");
    window.location.assign(authorizeUrl.toString());
  } catch (error) {
    oauthRedirectStarting = false;
    window.sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    throw error;
  }
}

export function completeGoogleOAuthSignIn() {
  if (!oauthCallbackFlight) {
    oauthCallbackFlight = (async () => {
      const session = await consumeGoogleOAuthCallback();
      await loadRemoteRole(session);
      return session;
    })();
  }
  return oauthCallbackFlight;
}

export async function restoreSession(): Promise<AuthSession | null> {
  window.localStorage.removeItem(LEGACY_SESSION_KEY);
  let saved: AuthSession | null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    saved = storedSession(JSON.parse(raw));
  } catch {
    storeSession(null);
    return null;
  }
  if (!saved) {
    storeSession(null);
    return null;
  }

  if (saved.userId && saved.expiresAt > Math.floor(Date.now() / 1000) + 60) return saved;
  if (!saved.refreshToken) {
    storeSession(null);
    return null;
  }

  try {
    return await refreshAuthenticatedSession(saved);
  } catch {
    return null;
  }
}

export async function signOut(session: AuthSession) {
  try {
    await supabaseFetch<void>("/auth/v1/logout", session, { method: "POST" });
  } finally {
    storeSession(null);
  }
}

export async function requestRemoteAdminAccess(session: AuthSession) {
  await supabaseFetch<unknown>(
    "/rest/v1/rpc/request_menu_admin_access",
    session,
    { method: "POST", body: "{}" },
  );
}

/** Read-only session check for long-running admin displays. It never creates an access request. */
export async function checkRemoteMenuAccess(session: AuthSession): Promise<boolean> {
  const role = await supabaseFetch<unknown>(
    "/rest/v1/rpc/current_admin_role",
    session,
    { method: "POST", body: "{}" },
  );
  return role === "owner" || role === "manager" || role === "staff";
}

export async function loadRemoteRole(session: AuthSession): Promise<AdminRole> {
  if (!session.userId) throw new Error("로그인 사용자 정보를 확인하지 못했습니다.");
  const role = await supabaseFetch<unknown>(
    "/rest/v1/rpc/current_admin_role",
    session,
    { method: "POST", body: "{}" },
  );
  if (role === null) {
    try {
      await requestRemoteAdminAccess(session);
    } catch {
      storeSession(null);
      throw new Error("운영자 권한 요청을 보내지 못했습니다. 잠시 후 다시 로그인해 주세요.");
    }
    storeSession(null);
    throw new Error("운영자 권한 요청을 보냈습니다. 최고 관리자 승인 후 다시 로그인해 주세요.");
  }
  if (role !== "owner" && role !== "manager" && role !== "staff") {
    storeSession(null);
    throw new Error("이 계정은 사용 가능한 운영자 목록에 없습니다.");
  }
  storeSession(session);
  return role;
}

export type AdminAccessCandidate = {
  userId: string;
  email: string;
  role: AdminRole | null;
  isActive: boolean;
  hasGoogleIdentity: boolean;
  requestedAt: string | null;
};

export function remoteAdminAccessMatches(
  candidates: AdminAccessCandidate[],
  userId: string,
  role: AdminRole,
  isActive: boolean,
) {
  const candidate = candidates.find((entry) => entry.userId === userId);
  return Boolean(
    candidate
    && candidate.role === role
    && candidate.isActive === isActive
    && (!isActive || candidate.requestedAt === null),
  );
}

export function remoteAdminAccessRequestIsRejected(
  candidates: AdminAccessCandidate[],
  userId: string,
) {
  const candidate = candidates.find((entry) => entry.userId === userId);
  return !candidate || (!candidate.isActive && candidate.requestedAt === null);
}

export function remoteAdminAccessIsDeleted(
  candidates: AdminAccessCandidate[],
  userId: string,
) {
  return !candidates.some((entry) => entry.userId === userId);
}

type AdminAccessCandidateRow = {
  user_id: unknown;
  email: unknown;
  role: unknown;
  is_active: unknown;
  has_google_identity: unknown;
  requested_at: unknown;
};

function adminAccessCandidate(value: unknown): AdminAccessCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("운영자 권한 목록 응답을 확인하지 못했습니다.");
  }
  const row = value as AdminAccessCandidateRow;
  const role = row.role === null
    ? null
    : row.role === "owner" || row.role === "manager" || row.role === "staff"
      ? row.role
      : undefined;
  if (
    typeof row.user_id !== "string"
    || !row.user_id
    || typeof row.email !== "string"
    || role === undefined
    || typeof row.is_active !== "boolean"
    || typeof row.has_google_identity !== "boolean"
    || (row.requested_at !== null && typeof row.requested_at !== "string")
  ) {
    throw new Error("운영자 권한 목록 응답을 확인하지 못했습니다.");
  }
  return {
    userId: row.user_id,
    email: row.email,
    role,
    isActive: row.is_active,
    hasGoogleIdentity: row.has_google_identity,
    requestedAt: row.requested_at,
  };
}

export async function loadRemoteAdminCandidates(session: AuthSession) {
  const rows = await supabaseFetch<AdminAccessCandidateRow[]>(
    "/rest/v1/rpc/list_menu_admin_candidates",
    session,
    { method: "POST", body: "{}" },
  );
  if (!Array.isArray(rows)) throw new Error("운영자 권한 목록 응답을 확인하지 못했습니다.");
  return rows.map(adminAccessCandidate);
}

export async function setRemoteAdminAccess(
  candidate: AdminAccessCandidate,
  role: AdminRole,
  isActive: boolean,
  session: AuthSession,
) {
  const rows = await supabaseFetch<AdminAccessCandidateRow[]>(
    "/rest/v1/rpc/set_menu_admin_access",
    session,
    {
      method: "POST",
      body: JSON.stringify({
        p_user_id: candidate.userId,
        p_role: role,
        p_is_active: isActive,
        p_expected_role: candidate.role,
        p_expected_is_active: candidate.isActive,
        p_expected_requested_at: candidate.requestedAt,
      }),
    },
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("운영자 권한 변경 결과를 확인하지 못했습니다.");
  }
  return adminAccessCandidate(rows[0]);
}

export async function rejectRemoteAdminAccessRequest(
  candidate: AdminAccessCandidate,
  session: AuthSession,
) {
  const rejected = await supabaseFetch<unknown>(
    "/rest/v1/rpc/reject_menu_admin_access_request",
    session,
    {
      method: "POST",
      body: JSON.stringify({
        p_user_id: candidate.userId,
        p_expected_requested_at: candidate.requestedAt,
      }),
    },
  );
  if (rejected !== true) throw new Error("이미 처리되었거나 찾을 수 없는 운영자 요청입니다.");
}

export async function deleteRemoteAdminAccess(
  candidate: AdminAccessCandidate,
  session: AuthSession,
) {
  const deleted = await supabaseFetch<unknown>(
    "/rest/v1/rpc/delete_menu_admin_access",
    session,
    {
      method: "POST",
      body: JSON.stringify({
        p_user_id: candidate.userId,
        p_expected_role: candidate.role,
        p_expected_is_active: candidate.isActive,
        p_expected_requested_at: candidate.requestedAt,
      }),
    },
  );
  if (deleted !== true) throw new Error("이미 삭제되었거나 찾을 수 없는 운영자입니다.");
}

type SectionRow = {
  id: string;
  slug: string;
  name: unknown;
  description: unknown;
  sort_order: number;
  archived_at: string | null;
};

type CategoryRow = {
  id: string;
  section_id: string;
  slug: string;
  name: unknown;
  description: unknown;
  order_note: unknown;
  image_path: string | null;
  cover: boolean | null;
  sort_order: number;
  archived_at: string | null;
};

type MenuItemRow = {
  id: string;
  category_id: string;
  slug: string;
  name: unknown;
  description: unknown;
  price: unknown;
  image_path: string | null;
  tag: MenuTag | null;
  sort_order: number;
  archived_at: string | null;
};

type AvailabilityRow = {
  menu_item_id: string;
  is_available: boolean;
  updated_at: string | null;
};

type ReleaseRow = {
  id: string;
  version: unknown;
  snapshot: unknown;
  published_at: string;
  deployment_status?: unknown;
  deployment_requested_at?: string | null;
  deployment_started_at?: string | null;
  deployment_finished_at?: string | null;
  deployment_error?: string | null;
  deployment_run_url?: string | null;
};

type MenuRestoreStatusRow = {
  baseline_key: unknown;
  captured_at: unknown;
  baseline_source_release_id: unknown;
  baseline_source_release_version: unknown;
  baseline_item_count: unknown;
  current_release_id: unknown;
  current_release_version: unknown;
  draft_revision: unknown;
  is_draft_at_baseline: unknown;
  is_published_at_baseline: unknown;
};

type MenuRestoreResultRow = {
  request_id: unknown;
  restored_release_id: unknown;
  restored_at: unknown;
  draft_revision: unknown;
  baseline_source_release_id: unknown;
  restored_item_count: unknown;
};

function positiveSafeInteger(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function menuRestoreStatus(value: unknown): MenuRestoreStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("메뉴 복구 기준점 응답을 확인하지 못했습니다.");
  }
  const row = value as MenuRestoreStatusRow;
  const sourceVersion = positiveSafeInteger(row.baseline_source_release_version);
  const itemCount = positiveSafeInteger(row.baseline_item_count);
  const currentVersion = positiveSafeInteger(row.current_release_version);
  const draftRevision = positiveSafeInteger(row.draft_revision);
  if (
    typeof row.baseline_key !== "string"
    || !row.baseline_key
    || typeof row.captured_at !== "string"
    || !row.captured_at
    || typeof row.baseline_source_release_id !== "string"
    || !row.baseline_source_release_id
    || sourceVersion === undefined
    || itemCount === undefined
    || typeof row.current_release_id !== "string"
    || !row.current_release_id
    || currentVersion === undefined
    || draftRevision === undefined
    || typeof row.is_draft_at_baseline !== "boolean"
    || typeof row.is_published_at_baseline !== "boolean"
  ) {
    throw new Error("메뉴 복구 기준점 응답을 확인하지 못했습니다.");
  }
  return {
    baselineKey: row.baseline_key,
    capturedAt: row.captured_at,
    baselineSourceReleaseId: row.baseline_source_release_id,
    baselineSourceReleaseVersion: sourceVersion,
    baselineItemCount: itemCount,
    currentReleaseId: row.current_release_id,
    currentReleaseVersion: currentVersion,
    draftRevision,
    isDraftAtBaseline: row.is_draft_at_baseline,
    isPublishedAtBaseline: row.is_published_at_baseline,
  };
}

function menuRestoreResult(value: unknown): MenuRestoreResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("메뉴 복구 결과를 확인하지 못했습니다.");
  }
  const row = value as MenuRestoreResultRow;
  const draftRevision = positiveSafeInteger(row.draft_revision);
  const itemCount = positiveSafeInteger(row.restored_item_count);
  if (
    typeof row.request_id !== "string"
    || !row.request_id
    || typeof row.restored_release_id !== "string"
    || !row.restored_release_id
    || typeof row.restored_at !== "string"
    || !row.restored_at
    || draftRevision === undefined
    || typeof row.baseline_source_release_id !== "string"
    || !row.baseline_source_release_id
    || itemCount === undefined
  ) {
    throw new Error("메뉴 복구 결과를 확인하지 못했습니다.");
  }
  return {
    requestId: row.request_id,
    restoredReleaseId: row.restored_release_id,
    restoredAt: row.restored_at,
    draftRevision,
    baselineSourceReleaseId: row.baseline_source_release_id,
    restoredItemCount: itemCount,
  };
}

const DEPLOYMENT_STATUSES = new Set<DeploymentStatus>([
  "not_requested",
  "queued",
  "running",
  "succeeded",
  "failed",
]);

function deploymentStatus(value: unknown): DeploymentStatus {
  return typeof value === "string" && DEPLOYMENT_STATUSES.has(value as DeploymentStatus)
    ? value as DeploymentStatus
    : "not_requested";
}

async function loadReleaseRows(session: AuthSession) {
  const baseSelect = "id,version,snapshot,published_at";
  const deploymentSelect = [
    baseSelect,
    "deployment_status",
    "deployment_requested_at",
    "deployment_started_at",
    "deployment_finished_at",
    "deployment_error",
    "deployment_run_url",
  ].join(",");
  try {
    return await supabaseFetch<ReleaseRow[]>(
      `/rest/v1/menu_releases?select=${deploymentSelect}&order=version.desc&limit=5`,
      session,
    );
  } catch {
    // Keeps local development usable while the deployment migration is being
    // applied; the Edge Function itself remains unavailable until migration.
    return await supabaseFetch<ReleaseRow[]>(
      `/rest/v1/menu_releases?select=${baseSelect}&order=version.desc&limit=5`,
      session,
    );
  }
}

function releaseVersion(value: unknown) {
  const version = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(version) && version > 0 ? version : undefined;
}

export async function loadRemoteState(session: AuthSession): Promise<MenuAdminState> {
  const [sectionRows, categoryRows, itemRows, availabilityRows, releaseRows] = await Promise.all([
    supabaseFetch<SectionRow[]>("/rest/v1/sections?select=id,slug,name,description,sort_order,archived_at&order=sort_order.asc,created_at.asc,id.asc", session),
    supabaseFetch<CategoryRow[]>("/rest/v1/categories?select=id,section_id,slug,name,description,order_note,image_path,cover,sort_order,archived_at&order=sort_order.asc,created_at.asc,id.asc", session),
    supabaseFetch<MenuItemRow[]>("/rest/v1/menu_items?select=id,category_id,slug,name,description,price,image_path,tag,sort_order,archived_at&order=sort_order.asc,created_at.asc,id.asc", session),
    supabaseFetch<AvailabilityRow[]>("/rest/v1/menu_availability?select=menu_item_id,is_available,updated_at", session),
    loadReleaseRows(session),
  ]);
  const availability = new Map(availabilityRows.map((row) => [row.menu_item_id, row]));

  const sections: AdminSection[] = sectionRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: localized(row.name),
    description: localized(row.description),
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
  }));
  const categories: AdminCategory[] = categoryRows.map((row) => ({
    id: row.id,
    sectionId: row.section_id,
    slug: row.slug,
    name: localized(row.name),
    description: localized(row.description),
    orderNote: localized(row.order_note),
    imagePath: row.image_path ?? "",
    cover: Boolean(row.cover),
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
  }));
  const items: AdminMenuItem[] = itemRows.map((row) => {
    const itemAvailability = availability.get(row.id);
    return {
      id: row.id,
      categoryId: row.category_id,
      slug: row.slug,
      name: localized(row.name),
      description: localized(row.description),
      price: localized(row.price),
      imagePath: row.image_path ?? "",
      tag: row.tag ?? "",
      sortOrder: row.sort_order,
      isAvailable: itemAvailability?.is_available ?? true,
      archivedAt: row.archived_at,
      updatedAt: itemAvailability?.updated_at ?? "",
    };
  });

  const releases: AdminRelease[] = releaseRows.map((row) => {
    const payload = normalizeReleasePayload(row.snapshot, row.published_at);
    const version = releaseVersion(row.version);
    const status = deploymentStatus(row.deployment_status);
    return {
      id: row.id,
      ...(version ? { version } : {}),
      createdAt: row.published_at,
      itemCount: payload ? summarizeReleasePayload(payload).itemCount : 0,
      deploymentTriggered: status !== "not_requested",
      deploymentStatus: status,
      ...(row.deployment_requested_at ? { deploymentRequestedAt: row.deployment_requested_at } : {}),
      ...(row.deployment_started_at ? { deploymentStartedAt: row.deployment_started_at } : {}),
      ...(row.deployment_finished_at ? { deploymentFinishedAt: row.deployment_finished_at } : {}),
      ...(row.deployment_error ? { deploymentError: row.deployment_error } : {}),
      ...(row.deployment_run_url ? { deploymentRunUrl: row.deployment_run_url } : {}),
      ...(payload ? { payload } : {}),
    };
  });

  return { schemaVersion: 1, sections, categories, items, releases };
}

export async function loadRemoteMenuRestoreStatus(
  session: AuthSession,
): Promise<MenuRestoreStatus> {
  const rows = await supabaseFetch<MenuRestoreStatusRow[]>(
    "/rest/v1/rpc/get_menu_restore_status",
    session,
    { method: "POST", body: "{}" },
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("메뉴 복구 기준점을 찾지 못했습니다.");
  }
  return menuRestoreStatus(rows[0]);
}

export async function loadRemoteMenuRestoreResult(
  requestId: string,
  session: AuthSession,
): Promise<MenuRestoreResult | null> {
  const rows = await supabaseFetch<MenuRestoreResultRow[]>(
    "/rest/v1/rpc/get_menu_restore_result",
    session,
    {
      method: "POST",
      body: JSON.stringify({ p_request_id: requestId }),
    },
  );
  if (!Array.isArray(rows) || rows.length > 1) {
    throw new Error("메뉴 복구 결과를 확인하지 못했습니다.");
  }
  return rows.length ? menuRestoreResult(rows[0]) : null;
}

export async function restoreRemotePretestMenu(
  status: MenuRestoreStatus,
  requestId: string,
  session: AuthSession,
): Promise<MenuRestoreResult> {
  try {
    const rows = await supabaseFetch<MenuRestoreResultRow[]>(
      "/rest/v1/rpc/restore_pretest_menu",
      session,
      {
        method: "POST",
        body: JSON.stringify({
          p_request_id: requestId,
          p_expected_current_release_id: status.currentReleaseId,
          p_expected_draft_revision: status.draftRevision,
        }),
      },
    );
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error("메뉴 복구 결과를 확인하지 못했습니다.");
    }
    return menuRestoreResult(rows[0]);
  } catch (restoreError) {
    // A committed request may lose its HTTP response. The append-only audit row
    // lets the client reconcile that exact request without restoring twice.
    try {
      const reconciled = await loadRemoteMenuRestoreResult(requestId, session);
      if (reconciled) return reconciled;
    } catch {
      // Preserve the original failure. Retrying later with the same request id
      // remains idempotent at the database boundary.
    }
    throw restoreError;
  }
}

export type CategoryWrite = Omit<AdminCategory, "id" | "slug" | "archivedAt">;

function categoryWriteBody(category: CategoryWrite | AdminCategory) {
  return {
    p_section_id: category.sectionId,
    p_name: category.name,
    p_description: category.description,
    p_order_note: category.orderNote,
    p_image_path: category.imagePath,
    p_cover: category.cover,
    p_sort_order: category.sortOrder,
  };
}

export async function createRemoteCategory(
  input: CategoryWrite,
  session: AuthSession,
  requestId: string,
) {
  const createdId = await supabaseFetch<string>(
    "/rest/v1/rpc/create_menu_category_idempotent",
    session,
    {
      method: "POST",
      body: JSON.stringify({
        p_request_id: requestId,
        ...categoryWriteBody(input),
      }),
    },
  );
  if (!createdId) throw new Error("카테고리를 생성하지 못했습니다.");
  return createdId;
}

export async function updateRemoteCategory(category: AdminCategory, session: AuthSession) {
  await supabaseFetch<void>("/rest/v1/rpc/update_menu_category", session, {
    method: "POST",
    body: JSON.stringify({
      p_category_id: category.id,
      ...categoryWriteBody(category),
    }),
  });
}

export async function setRemoteCategoryArchived(
  categoryId: string,
  archived: boolean,
  session: AuthSession,
) {
  await supabaseFetch<void>("/rest/v1/rpc/set_menu_category_archived", session, {
    method: "POST",
    body: JSON.stringify({
      p_category_id: categoryId,
      p_archived: archived,
    }),
  });
}

export async function deleteRemoteCategory(categoryId: string, session: AuthSession) {
  await supabaseFetch<void>("/rest/v1/rpc/delete_menu_category", session, {
    method: "POST",
    body: JSON.stringify({ p_category_id: categoryId }),
  });
}

export async function reorderRemoteCategories(
  sectionId: string,
  expectedIds: readonly string[],
  orderedIds: readonly string[],
  session: AuthSession,
) {
  await supabaseFetch<void>("/rest/v1/rpc/reorder_menu_categories", session, {
    method: "POST",
    body: JSON.stringify({
      p_section_id: sectionId,
      p_expected_ids: expectedIds,
      p_ordered_ids: orderedIds,
    }),
  });
}

export type MenuItemWrite = Omit<AdminMenuItem, "id" | "slug" | "updatedAt">;

function itemWriteBody(item: MenuItemWrite | AdminMenuItem) {
  return {
    category_id: item.categoryId,
    name: item.name,
    description: item.description,
    price: item.price,
    image_path: item.imagePath || null,
    tag: item.tag || null,
    sort_order: item.sortOrder,
  };
}

export async function createRemoteItem(
  input: MenuItemWrite,
  session: AuthSession,
  requestId: string,
) {
  const body = itemWriteBody(input);
  const createdId = await supabaseFetch<string>("/rest/v1/rpc/create_menu_item_idempotent", session, {
    method: "POST",
    body: JSON.stringify({
      p_request_id: requestId,
      p_category_id: body.category_id,
      p_name: body.name,
      p_description: body.description,
      p_price: body.price,
      p_image_path: body.image_path,
      p_tag: body.tag,
      p_sort_order: body.sort_order,
      p_is_available: input.isAvailable,
    }),
  });
  if (!createdId) throw new Error("메뉴를 생성하지 못했습니다.");
  return createdId;
}

export async function updateRemoteItem(item: AdminMenuItem, session: AuthSession) {
  const body = itemWriteBody(item);
  await supabaseFetch<void>("/rest/v1/rpc/update_menu_item", session, {
    method: "POST",
    body: JSON.stringify({
      p_item_id: item.id,
      p_category_id: body.category_id,
      p_name: body.name,
      p_description: body.description,
      p_price: body.price,
      p_image_path: body.image_path,
      p_tag: body.tag,
      p_sort_order: body.sort_order,
      p_is_available: item.isAvailable,
    }),
  });
}

export async function setRemoteArchived(itemId: string, archived: boolean, session: AuthSession) {
  await supabaseFetch<void>("/rest/v1/rpc/set_menu_item_archived", session, {
    method: "POST",
    body: JSON.stringify({
      p_item_id: itemId,
      p_archived: archived,
    }),
  });
}

export async function setRemoteAvailability(itemId: string, isAvailable: boolean, session: AuthSession) {
  await supabaseFetch<void>("/rest/v1/menu_availability?on_conflict=menu_item_id", session, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ menu_item_id: itemId, is_available: isAvailable }),
  });
}

export async function reorderRemoteItems(
  categoryId: string,
  expectedIds: readonly string[],
  orderedIds: readonly string[],
  session: AuthSession,
) {
  await supabaseFetch<void>("/rest/v1/rpc/reorder_menu_items", session, {
    method: "POST",
    body: JSON.stringify({
      p_category_id: categoryId,
      p_expected_ids: expectedIds,
      p_ordered_ids: orderedIds,
    }),
  });
}

export async function publishRemoteMenu(session: AuthSession): Promise<PublishResult> {
  const response = await supabaseFetch<unknown>("/rest/v1/rpc/publish_menu", session, {
    method: "POST",
    body: JSON.stringify({}),
  });
  let releaseId = "";
  if (typeof response === "string") releaseId = response;
  else if (Array.isArray(response) && response.length) {
    const first = response[0];
    releaseId = typeof first === "string" ? first : String((first as JsonRecord)?.id ?? "");
  } else if (response && typeof response === "object") {
    const record = response as JsonRecord;
    releaseId = String(record.id ?? record.release_id ?? "");
  }
  if (!releaseId) throw new Error("저장한 메뉴의 고유 번호를 확인하지 못했습니다.");
  return {
    releaseId,
    publishedAt: new Date().toISOString(),
    deploymentTriggered: false,
  };
}

export async function requestRemoteDeployment(
  releaseId: string,
  session: AuthSession,
): Promise<DeploymentRequestResult> {
  const result = await supabaseFetch<DeploymentRequestResult>("/functions/v1/menu-deploy", session, {
    method: "POST",
    body: JSON.stringify({ releaseId }),
  });
  if (
    !result
    || result.releaseId !== releaseId
    || typeof result.requestId !== "string"
    || result.status !== "queued"
  ) {
    throw new Error("사이트 공개 요청 결과를 확인하지 못했습니다.");
  }
  return result;
}

async function storageFetch(path: string, session: AuthSession, init: RequestInit) {
  const headers = new Headers(init.headers);
  headers.set("apikey", SUPABASE_ANON_KEY);
  const response = await fetchWithSessionRefresh(
    `${SUPABASE_URL}/storage/v1${path}`,
    session,
    { ...init, headers },
  );
  if (!response.ok) throw new Error(await readError(response));
  return response;
}

async function uploadRemoteImageToFolder(blob: Blob, session: AuthSession, folder: string) {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.webp`;
  const objectPath = `${folder}/${filename}`;
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  await storageFetch(`/object/${STORAGE_BUCKET}/${encodedPath}`, session, {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "image/webp",
      "x-upsert": "false",
    },
    body: blob,
  });
  return objectPath;
}

export async function uploadRemoteImage(blob: Blob, session: AuthSession, itemId?: string) {
  return uploadRemoteImageToFolder(blob, session, itemId ? `items/${itemId}` : "items/new");
}

export async function uploadRemoteCategoryImage(
  blob: Blob,
  session: AuthSession,
  categoryId: string,
) {
  return uploadRemoteImageToFolder(blob, session, `categories/${categoryId || "new"}`);
}

export function resolveAdminImage(path: string) {
  if (!path) return "";
  if (path.startsWith("static:")) return `${BASE_PATH}/menu/${path.slice("static:".length)}`;
  if (/^(https?:|data:|blob:)/.test(path) || path.startsWith("/")) return path;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${encodedPath}`;
}

export function releaseFromPublish(result: PublishResult, itemCount: number): AdminRelease {
  return {
    id: result.releaseId,
    createdAt: result.publishedAt,
    itemCount,
    deploymentTriggered: false,
  };
}
