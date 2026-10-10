import type { ExportCommand, ExportResult } from "../api/wire";
export type ExportJob = {
  key: string;
  body: ExportCommand;
  sourceVersionIds: string[];
  resourceId: string | null;
  researchIds?: string[];
  scoringPolicyVersion?: string;
};
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((id) => typeof id === "string" && id.length > 0) &&
  new Set(value).size === value.length;
const same = (left: unknown, right: string[]) =>
  strings(left) &&
  left.length === right.length &&
  left.every((id) => right.includes(id));
export function exportLink(
  result: ExportResult,
  job: ExportJob,
  runId: string,
  mode: "real" | "mock",
  resolve?: (value: string) => string | null,
): string {
  const manifest = result.manifest;
  if (
    result.export_id !== job.resourceId ||
    result.status !== "ready" ||
    !manifest ||
    manifest.proposal_set_version !== job.body.proposal_set_version ||
    !same(manifest.variant_ids, job.body.variant_ids) ||
    !same(manifest.source_version_ids, job.sourceVersionIds) ||
    (manifest.run_id !== undefined && manifest.run_id !== runId) ||
    (manifest.format !== undefined && manifest.format !== job.body.format) ||
    (manifest.research_ids !== undefined &&
      job.researchIds !== undefined &&
      !same(manifest.research_ids, job.researchIds)) ||
    (manifest.scoring_policy_version !== undefined &&
      job.scoringPolicyVersion !== undefined &&
      manifest.scoring_policy_version !== job.scoringPolicyVersion)
  )
    throw new Error(
      "Export identity or manifest does not match the requested proposal, variants and source versions. Download withheld.",
    );
  if (!result.download_url)
    throw new Error("Ready export has no authorized download link.");
  const resolved = resolve ? resolve(result.download_url) : result.download_url;
  if (!resolved)
    throw new Error("Export download link is unsafe or unavailable.");
  try {
    const url = new URL(resolved, window.location.href);
    if (
      url.username ||
      url.password ||
      (!["http:", "https:"].includes(url.protocol) &&
        !(mode === "mock" && url.protocol === "blob:"))
    )
      throw new Error();
    return resolved;
  } catch {
    throw new Error("Export download link is unsafe or unavailable.");
  }
}
export function readExportJob(key: string | null): ExportJob | null {
  if (!key) return null;
  try {
    const job = JSON.parse(sessionStorage.getItem(key) ?? "null") as ExportJob;
    if (
      !job ||
      Object.keys(job).some(
        (key) =>
          ![
            "key",
            "body",
            "sourceVersionIds",
            "resourceId",
            "researchIds",
            "scoringPolicyVersion",
          ].includes(key),
      ) ||
      typeof job.key !== "string" ||
      !job.key ||
      !(
        job.resourceId === null ||
        (typeof job.resourceId === "string" && job.resourceId.length > 0)
      ) ||
      !strings(job.sourceVersionIds) ||
      (job.researchIds !== undefined && !strings(job.researchIds)) ||
      (job.scoringPolicyVersion !== undefined &&
        (typeof job.scoringPolicyVersion !== "string" ||
          !job.scoringPolicyVersion)) ||
      !job.body ||
      Object.keys(job.body).some(
        (key) =>
          !["proposal_set_version", "variant_ids", "format"].includes(key),
      ) ||
      !Number.isSafeInteger(job.body.proposal_set_version) ||
      job.body.proposal_set_version < 1 ||
      !strings(job.body.variant_ids) ||
      !job.body.variant_ids.length ||
      !["json", "xlsx"].includes(job.body.format)
    )
      return null;
    return job;
  } catch {
    return null;
  }
}
export function saveExportJob(key: string | null, job: ExportJob | null) {
  if (!key) return;
  try {
    if (job) sessionStorage.setItem(key, JSON.stringify(job));
    else sessionStorage.removeItem(key);
  } catch {
    /* Current in-memory job remains available if browser storage is unavailable. */
  }
}
