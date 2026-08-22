// Supabase Edge Function: authenticated owner -> immutable release -> GitHub
// Pages workflow. GitHub credentials never cross the browser boundary.

import {
  deploymentOutcomeFromJobs,
  isDeploymentConflict,
  type ReconciledDeploymentStatus,
} from "./reconciliation.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALLBACK_STATUSES = new Set(["running", "succeeded", "failed"]);
const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
];

type JsonRecord = Record<string, unknown>;

class RpcResponseError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "RpcResponseError";
  }
}

class DeploymentQueueTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentQueueTransportError";
  }
}

function rpcResponseIsAmbiguous(cause: unknown) {
  return cause instanceof RpcResponseError
    && (cause.status === 408 || cause.status === 429 || cause.status >= 500);
}

type StaleRunningDeployment = {
  releaseId: string;
  requestId: string;
  runId: number;
  runUrl: string | null;
};

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing Edge Function secret: ${name}`);
  return value;
}

function allowedOrigins() {
  const configured = Deno.env.get("ADMIN_ALLOWED_ORIGINS")
    ?.split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set(configured?.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin")?.replace(/\/$/, "") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-deploy-callback-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allowedOrigins().has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(request: Request, status: number, body: JsonRecord) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  });
}

async function safeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= leftBytes[index] ^ rightBytes[index];
  }
  return mismatch === 0;
}

async function responseError(response: Response) {
  try {
    const value = await response.json() as JsonRecord;
    return String(value.message ?? value.error_description ?? value.error ?? `HTTP ${response.status}`);
  } catch {
    return `HTTP ${response.status}`;
  }
}

function serviceHeaders(serviceKey: string) {
  return {
    apikey: serviceKey,
    ...(serviceKey.startsWith("eyJ") ? { Authorization: `Bearer ${serviceKey}` } : {}),
    "Content-Type": "application/json",
  };
}

function githubRepository() {
  const repository = env("GITHUB_REPOSITORY");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("Invalid GitHub repository configuration.");
  }
  return repository;
}

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env("GITHUB_ACTIONS_TOKEN")}`,
    "User-Agent": "kstreetsnack-menu-deploy",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function rpc(
  name: string,
  body: JsonRecord,
  headers: Record<string, string>,
) {
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new RpcResponseError(response.status, await responseError(response));
  }
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : undefined;
}

async function updateDeployment(
  releaseId: string,
  requestId: string,
  status: string,
  runId: number | null,
  runUrl: string | null,
  error: string | null,
) {
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  return await rpc("update_menu_deployment", {
    p_release_id: releaseId,
    p_request_id: requestId,
    p_status: status,
    p_run_id: runId,
    p_run_url: runUrl,
    p_error: error,
  }, serviceHeaders(serviceKey));
}

async function failQueuedBestEffort(releaseId: string, requestId: string, error: string) {
  try {
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    await rpc("fail_queued_menu_deployment", {
      p_release_id: releaseId,
      p_request_id: requestId,
      p_error: error,
    }, serviceHeaders(serviceKey));
  } catch {
    // A concurrent running callback may have won the row lock. In that case
    // the queued-only compare-and-set intentionally refuses to fail the run.
  }
}

async function loadStaleRunningDeployments(): Promise<StaleRunningDeployment[]> {
  const cutoff = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const endpoint = new URL("/rest/v1/menu_releases", env("SUPABASE_URL"));
  endpoint.searchParams.set(
    "select",
    "id,deployment_request_id,deployment_run_id,deployment_run_url",
  );
  endpoint.searchParams.set("deployment_status", "eq.running");
  endpoint.searchParams.set("deployment_requested_at", `lt.${cutoff}`);

  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(endpoint, {
    headers: serviceHeaders(serviceKey),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const value = await response.json() as unknown;
  if (!Array.isArray(value)) throw new Error("Invalid stale deployment response.");

  return value.flatMap((entry): StaleRunningDeployment[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as JsonRecord;
    const releaseId = String(row.id ?? "");
    const requestId = String(row.deployment_request_id ?? "");
    const runId = Number(row.deployment_run_id);
    if (
      !UUID_PATTERN.test(releaseId)
      || !UUID_PATTERN.test(requestId)
      || !Number.isSafeInteger(runId)
      || runId <= 0
    ) return [];
    return [{
      releaseId,
      requestId,
      runId,
      runUrl: validGithubRunUrl(row.deployment_run_url),
    }];
  });
}

async function githubDeploymentOutcome(runId: number): Promise<{
  status: ReconciledDeploymentStatus;
  runUrl: string | null;
} | null> {
  const repository = githubRepository();
  const headers = githubHeaders();
  const runResponse = await fetch(
    `https://api.github.com/repos/${repository}/actions/runs/${runId}`,
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  if (!runResponse.ok) throw new Error(await responseError(runResponse));
  const run = await runResponse.json() as JsonRecord;
  if (run.status !== "completed") return null;

  const jobsResponse = await fetch(
    `https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`,
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  if (!jobsResponse.ok) throw new Error(await responseError(jobsResponse));
  const jobsValue = await jobsResponse.json() as JsonRecord;

  return {
    status: deploymentOutcomeFromJobs(jobsValue),
    runUrl: validGithubRunUrl(run.html_url),
  };
}

async function reconcileStaleRunningDeployments() {
  const attempts = await loadStaleRunningDeployments();
  let reconciled = 0;
  for (const attempt of attempts) {
    const outcome = await githubDeploymentOutcome(attempt.runId);
    if (!outcome) continue;
    await updateDeployment(
      attempt.releaseId,
      attempt.requestId,
      outcome.status,
      attempt.runId,
      outcome.runUrl ?? attempt.runUrl,
      outcome.status === "failed"
        ? "The completed GitHub workflow did not deploy its Pages artifact."
        : null,
    );
    reconciled += 1;
  }
  return reconciled;
}

function validGithubRunUrl(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const repository = env("GITHUB_REPOSITORY");
  const prefix = `https://github.com/${repository}/actions/runs/`;
  return value.startsWith(prefix) ? value : null;
}

async function handleCallback(request: Request, body: JsonRecord) {
  const suppliedSecret = request.headers.get("x-deploy-callback-secret") ?? "";
  if (!suppliedSecret || !await safeEqual(suppliedSecret, env("MENU_DEPLOY_CALLBACK_SECRET"))) {
    return json(request, 401, { error: "Invalid deployment callback." });
  }

  const releaseId = String(body.releaseId ?? "");
  const requestId = String(body.requestId ?? "");
  const status = String(body.status ?? "");
  if (!UUID_PATTERN.test(releaseId) || !UUID_PATTERN.test(requestId) || !CALLBACK_STATUSES.has(status)) {
    return json(request, 400, { error: "Invalid deployment callback payload." });
  }

  const runIdValue = body.runId === undefined || body.runId === null ? null : Number(body.runId);
  const runId = runIdValue !== null && Number.isSafeInteger(runIdValue) && runIdValue > 0
    ? runIdValue
    : null;
  const runUrl = validGithubRunUrl(body.runUrl);
  const error = status === "failed" && typeof body.error === "string"
    ? body.error.slice(0, 1000)
    : null;

  try {
    const deployment = await updateDeployment(releaseId, requestId, status, runId, runUrl, error);
    return json(request, 200, { deployment });
  } catch (cause) {
    return json(request, 409, {
      error: cause instanceof Error ? cause.message : "Deployment status could not be updated.",
    });
  }
}

async function handleDeploymentRequest(request: Request, body: JsonRecord) {
  const origin = request.headers.get("origin")?.replace(/\/$/, "") ?? "";
  if (origin && !allowedOrigins().has(origin)) {
    return json(request, 403, { error: "This admin origin is not allowed." });
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return json(request, 401, { error: "Google login is required." });
  }

  const releaseId = String(body.releaseId ?? "");
  if (!UUID_PATTERN.test(releaseId)) return json(request, 400, { error: "Invalid menu release ID." });

  const requestId = crypto.randomUUID();
  const publicKey = env("SUPABASE_ANON_KEY");

  const queueDeployment = async () => await rpc("request_menu_deployment", {
    p_release_id: releaseId,
    p_request_id: requestId,
  }, {
    apikey: publicKey,
    Authorization: authorization,
    "Content-Type": "application/json",
  });

  const queueDeploymentWithResponseLossRetry = async () => {
    try {
      return await queueDeployment();
    } catch (cause) {
      if (cause instanceof RpcResponseError && !rpcResponseIsAmbiguous(cause)) throw cause;

      // A timeout, connection reset, or invalid response after the database
      // commit has an ambiguous outcome. The request UUID makes one immediate
      // replay safe: the RPC returns the already queued attempt when the first
      // call committed, or creates it when the first call never arrived.
      try {
        return await queueDeployment();
      } catch (retryCause) {
        if (retryCause instanceof RpcResponseError && !rpcResponseIsAmbiguous(retryCause)) {
          // The first call may still have committed even when the replay is a
          // definite rejection (for example, the owner session expired between
          // attempts). Clear that exact queued UUID before returning the error.
          await failQueuedBestEffort(
            releaseId,
            requestId,
            "The safe deployment request retry was rejected.",
          );
          throw retryCause;
        }

        // If both responses are unknowable, clear only this still-queued UUID.
        // This prevents an undelivered request from blocking all deployment for
        // 45 minutes without racing a workflow that already reached running.
        await failQueuedBestEffort(
          releaseId,
          requestId,
          "The deployment request could not be confirmed after a safe retry.",
        );
        throw new DeploymentQueueTransportError(
          retryCause instanceof Error
            ? retryCause.message
            : "The deployment request could not be confirmed.",
        );
      }
    }
  };

  try {
    await queueDeploymentWithResponseLossRetry();
  } catch (cause) {
    if (isDeploymentConflict(cause)) {
      try {
        const reconciled = await reconcileStaleRunningDeployments();
        if (reconciled > 0) await queueDeploymentWithResponseLossRetry();
        else throw cause;
      } catch (reconcileCause) {
        return json(request, 409, {
          error: reconcileCause instanceof Error
            ? reconcileCause.message
            : "The earlier deployment is still in progress.",
        });
      }
    } else {
      return json(request, cause instanceof DeploymentQueueTransportError ? 502 : 403, {
        error: cause instanceof Error ? cause.message : "The deployment request was rejected.",
      });
    }
  }

  let repository: string;
  let dispatchHeaders: Record<string, string>;
  try {
    repository = githubRepository();
    dispatchHeaders = {
      ...githubHeaders(),
      "Content-Type": "application/json",
    };
  } catch {
    await failQueuedBestEffort(releaseId, requestId, "Invalid GitHub deployment configuration.");
    return json(request, 500, { error: "Invalid GitHub deployment configuration." });
  }

  const workflow = Deno.env.get("GITHUB_WORKFLOW_FILE")?.trim() || "deploy-pages.yml";
  const ref = Deno.env.get("GITHUB_WORKFLOW_REF")?.trim() || "master";
  let dispatch: Response;
  try {
    dispatch = await fetch(
      `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
      {
        method: "POST",
        headers: dispatchHeaders,
        body: JSON.stringify({
          ref,
          inputs: {
            release_id: releaseId,
            deployment_request_id: requestId,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (cause) {
    // A transport error does not prove that GitHub rejected the dispatch. The
    // queued-only compare-and-set fails the attempt only if GitHub's running
    // callback has not won the same row lock. A workflow whose callback wins
    // continues; a workflow whose failure wins stops before the build.
    const dispatchError = `GitHub workflow dispatch outcome could not be confirmed: ${cause instanceof Error ? cause.message : "network error"}`;
    await failQueuedBestEffort(releaseId, requestId, dispatchError);
    return json(request, 502, { error: dispatchError });
  }

  if (!dispatch.ok) {
    const dispatchError = `GitHub workflow dispatch failed: ${await responseError(dispatch)}`;
    await failQueuedBestEffort(releaseId, requestId, dispatchError);
    return json(request, 502, { error: dispatchError });
  }

  return json(request, 202, {
    releaseId,
    requestId,
    status: "queued",
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin")?.replace(/\/$/, "") ?? "";
    return new Response(null, {
      status: origin && allowedOrigins().has(origin) ? 204 : 403,
      headers: corsHeaders(request),
    });
  }
  if (request.method !== "POST") return json(request, 405, { error: "Method not allowed." });

  let body: JsonRecord;
  try {
    body = await request.json() as JsonRecord;
  } catch {
    return json(request, 400, { error: "A JSON body is required." });
  }

  try {
    return body.action === "status"
      ? await handleCallback(request, body)
      : await handleDeploymentRequest(request, body);
  } catch (cause) {
    return json(request, 500, {
      error: cause instanceof Error ? cause.message : "Deployment service configuration is incomplete.",
    });
  }
});
