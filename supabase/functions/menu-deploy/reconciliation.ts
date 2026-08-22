type JsonRecord = Record<string, unknown>;

export type ReconciledDeploymentStatus = "succeeded" | "failed";

export function isDeploymentConflict(cause: unknown) {
  if (!(cause instanceof Error)) return false;
  return cause.message.includes("deployment is already in progress")
    || cause.message.includes("menu deployment is already in progress");
}

/**
 * A workflow can be marked failed only because its final Supabase callback
 * failed after Pages was already deployed. The Pages step, not the overall
 * workflow conclusion, is therefore the reconciliation source of truth.
 */
export function deploymentOutcomeFromJobs(value: unknown): ReconciledDeploymentStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "failed";
  const jobsValue = (value as JsonRecord).jobs;
  const jobs = Array.isArray(jobsValue) ? jobsValue : [];
  const deployStep = jobs
    .filter((job) => job && typeof job === "object" && !Array.isArray(job))
    .flatMap((job) => {
      const steps = (job as JsonRecord).steps;
      return Array.isArray(steps) ? steps : [];
    })
    .find((step) => (
      step
      && typeof step === "object"
      && !Array.isArray(step)
      && (step as JsonRecord).name === "Deploy to GitHub Pages"
    )) as JsonRecord | undefined;

  return deployStep?.conclusion === "success" ? "succeeded" : "failed";
}
