import type { Api, RenderResult } from "../api/contracts";
import type { RenderCommand } from "../api/wire";
export type RenderBinding = {
  runId: string;
  proposalVersion: number;
  variantIds: string[];
  baselineAssetId: string;
  partCatalogVersion: string;
};
export type RenderSubmission = {
  key: string;
  kind: "create" | "retry";
  retryOf?: string;
  body: RenderCommand | Record<string, never>;
};
export type RenderJob = {
  localId: string;
  binding: RenderBinding;
  submission: RenderSubmission | null;
  requestId: string | null;
  autoSubmit?: boolean;
  result?: RenderResult;
  error?: string;
};
export const bindingKey = (binding: RenderBinding) =>
  JSON.stringify([
    binding.runId,
    binding.proposalVersion,
    [...binding.variantIds].sort(),
    binding.baselineAssetId,
    binding.partCatalogVersion,
  ]);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const memory = new WeakMap<Api, Map<string, RenderJob[]>>();
export function readRenderJobs(
  key: string | null,
  runId: string,
  api?: Api,
): RenderJob[] {
  const cached = api ? memory.get(api)?.get(runId) : undefined;
  if (cached) return cached.map((job) => ({ ...job, autoSubmit: false }));
  if (!key) return [];
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const { localId, binding, submission, requestId } = item;
      if (
        !text(localId) ||
        ids.has(localId) ||
        !binding ||
        binding.runId !== runId ||
        !Number.isSafeInteger(binding.proposalVersion) ||
        binding.proposalVersion < 1 ||
        ![
          binding.runId,
          binding.baselineAssetId,
          binding.partCatalogVersion,
        ].every(text) ||
        !Array.isArray(binding.variantIds) ||
        !binding.variantIds.length ||
        !binding.variantIds.every(text) ||
        new Set(binding.variantIds).size !== binding.variantIds.length ||
        (requestId !== null && !text(requestId))
      )
        return [];
      const saved: RenderJob = {
        localId,
        binding: {
          runId: binding.runId,
          proposalVersion: binding.proposalVersion,
          variantIds: binding.variantIds,
          baselineAssetId: binding.baselineAssetId,
          partCatalogVersion: binding.partCatalogVersion,
        },
        requestId,
        submission: null,
      };
      if (submission !== null) {
        if (
          requestId !== null ||
          !submission ||
          !text(submission.key) ||
          !["create", "retry"].includes(submission.kind) ||
          !submission.body ||
          typeof submission.body !== "object" ||
          Array.isArray(submission.body)
        )
          return [];
        if (submission.kind === "create") {
          const expected: RenderCommand = {
            proposal_set_version: binding.proposalVersion,
            variant_ids: binding.variantIds,
            baseline_asset_id: binding.baselineAssetId,
          };
          if (
            Object.keys(submission.body).length !== 3 ||
            submission.body.proposal_set_version !==
              expected.proposal_set_version ||
            submission.body.baseline_asset_id !== expected.baseline_asset_id ||
            JSON.stringify(submission.body.variant_ids) !==
              JSON.stringify(expected.variant_ids)
          )
            return [];
          saved.submission = {
            kind: "create",
            key: submission.key,
            body: expected,
          };
        } else {
          if (!text(submission.retryOf) || Object.keys(submission.body).length)
            return [];
          saved.submission = {
            kind: "retry",
            key: submission.key,
            retryOf: submission.retryOf,
            body: {},
          };
        }
      }
      if (!saved.submission && !saved.requestId) return [];
      ids.add(localId);
      return [saved];
    });
  } catch {
    return [];
  }
}
export function saveRenderJobs(
  key: string | null,
  jobs: RenderJob[],
  api?: Api,
  runId?: string,
) {
  if (api && runId) {
    let runs = memory.get(api);
    if (!runs) {
      runs = new Map();
      memory.set(api, runs);
    }
    runs.set(
      runId,
      jobs.map((job) => ({ ...job, autoSubmit: false })),
    );
  }
  if (!key) return;
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify(
        jobs.map(({ localId, binding, submission, requestId }) => ({
          localId,
          binding,
          submission,
          requestId,
        })),
      ),
    );
  } catch {
    /* Keep job recovery usable in memory when storage is unavailable. */
  }
}
export function validateRenderResult(result: RenderResult, job: RenderJob) {
  const wire = result.wire;
  if (
    !wire ||
    wire.render_request_id !== job.requestId ||
    wire.proposal_set_version !== job.binding.proposalVersion ||
    wire.baseline_asset_id !== job.binding.baselineAssetId ||
    wire.part_catalog_version !== job.binding.partCatalogVersion ||
    JSON.stringify([...wire.variant_ids].sort()) !==
      JSON.stringify([...job.binding.variantIds].sort())
  )
    throw new Error(
      "Render result identity does not match the accepted run, proposal, variant, baseline and catalog.",
    );
  const assets = new Set(wire.assets.map((asset) => asset.asset_id));
  if (
    assets.size !== wire.assets.length ||
    new Set(wire.outcomes.map((outcome) => outcome.change_id)).size !==
      wire.outcomes.length ||
    wire.outcomes.some((outcome) =>
      outcome.asset_ids.some((id) => !assets.has(id)),
    )
  )
    throw new Error(
      "Render result contains conflicting or missing asset identities.",
    );
}
export function renderAssetUrl(value: string) {
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
