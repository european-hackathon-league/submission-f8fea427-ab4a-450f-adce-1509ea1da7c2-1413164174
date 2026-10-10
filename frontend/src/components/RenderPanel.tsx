import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, commandKey } from "../api/client";
import type {
  Api,
  Evidence,
  ProposalSet,
  RenderResult,
  Workspace,
} from "../api/contracts";
import type { Accepted } from "../api/wire";
import ChangeExplanation from "./ChangeExplanation";
import RenderAssets from "./RenderAssets";
import {
  bindingKey,
  readRenderJobs,
  saveRenderJobs,
  validateRenderResult,
} from "./renderJobs";
import type { RenderBinding, RenderJob } from "./renderJobs";
export interface RenderPanelProps {
  api: Api;
  workspace: Workspace;
  variantId: string;
  busy?: boolean;
  onRefresh: () => Promise<Workspace>;
  onOpen: (e: Evidence) => void;
}
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Render request unavailable. Retry.";
function Job({
  job,
  current,
  retryableAttempt,
  update,
  onRetry,
  ...props
}: RenderPanelProps & {
  job: RenderJob;
  current: boolean;
  retryableAttempt: boolean;
  update: (id: string, patch: Partial<RenderJob>) => void;
  onRetry: (job: RenderJob) => void;
}) {
  const { api, workspace, variantId, busy, onRefresh, onOpen } = props;
  const mounted = useRef(true);
  const locked = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState("");
  const [proposal, setProposal] = useState<ProposalSet | null>(null);
  const [proposalError, setProposalError] = useState("");
  const [proposalAttempt, setProposalAttempt] = useState(0);
  const [explained, setExplained] = useState<string | null>(null);
  const [showEarlierAssets, setShowEarlierAssets] = useState(false);
  const explanation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = useCallback(async () => {
    if (locked.current || !job.submission) return;
    locked.current = true;
    setSubmitting(true);
    update(job.localId, { error: undefined });
    const command = job.submission;
    const root = `/runs/${encodeURIComponent(job.binding.runId)}/renders`;
    try {
      const accepted = await api.request<Accepted>(
        command.kind === "retry"
          ? `${root}/${encodeURIComponent(command.retryOf!)}/retry`
          : root,
        command.body,
        command.key,
      );
      if (!mounted.current) return;
      if (typeof accepted.resource_id !== "string" || !accepted.resource_id)
        throw new Error(
          "Accepted render resource identity unavailable. Retry the same submission.",
        );
      update(job.localId, {
        requestId: accepted.resource_id,
        submission: null,
        autoSubmit: false,
      });
      try {
        await onRefresh();
      } catch (error) {
        if (mounted.current) setSnapshotError(errorText(error));
      }
    } catch (error) {
      if (!mounted.current) return;
      update(job.localId, { error: errorText(error), autoSubmit: false });
      if (
        error instanceof ApiError &&
        !error.retryable &&
        error.status !== null
      ) {
        // A definitive rejection leaves the exact command visible; a replay cannot create a different version.
        if (error.code === "stale_version")
          try {
            await onRefresh();
          } catch (cause) {
            if (mounted.current) setSnapshotError(errorText(cause));
          }
      }
    } finally {
      locked.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }, [api, job.localId, job.submission, job.binding, onRefresh, update]);
  useEffect(() => {
    if (job.autoSubmit && job.submission) void submit();
  }, [job.autoSubmit, job.submission, submit]);
  useEffect(() => {
    if (!job.requestId) return;
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      setLoading(true);
      update(job.localId, { error: undefined });
      try {
        const result = await api.request<RenderResult>(
          `/runs/${encodeURIComponent(job.binding.runId)}/renders/${encodeURIComponent(job.requestId!)}`,
          undefined,
          undefined,
          controller.signal,
        );
        if (!active) return;
        validateRenderResult(result, job);
        update(job.localId, { result });
        setLoading(false);
        if (["queued", "rendering"].includes(result.status))
          timer = setTimeout(() => void poll(), 2000);
      } catch (error) {
        if (active) {
          update(job.localId, { error: errorText(error) });
          setLoading(false);
        }
      }
    }
    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [api, job.requestId, job.localId, job.binding, pollAttempt, update]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setProposalError("");
    const currentProposal = workspace.proposals;
    if (
      currentProposal.proposal_set_version === job.binding.proposalVersion &&
      currentProposal.wire?.run_id === job.binding.runId
    ) {
      setProposal(currentProposal);
      return () => {
        active = false;
        controller.abort();
      };
    }
    setProposal(null);
    void api
      .request<ProposalSet>(
        `/runs/${encodeURIComponent(job.binding.runId)}/proposals?proposal_set_version=${job.binding.proposalVersion}`,
        undefined,
        undefined,
        controller.signal,
      )
      .then((value) => {
        if (
          value.proposal_set_version !== job.binding.proposalVersion ||
          value.wire?.run_id !== job.binding.runId
        )
          throw new Error("Immutable proposal identity mismatch.");
        if (active) setProposal(value);
      })
      .catch((error) => {
        if (active) setProposalError(errorText(error));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, workspace.proposals, job.binding, proposalAttempt]);
  useEffect(() => {
    if (explained) explanation.current?.focus();
  }, [explained]);
  const result = job.result;
  const stale = !!result?.wire?.stale;
  const selectedVariant = proposal?.variants.find(
    (v) =>
      v.variant_id === variantId &&
      job.binding.variantIds.includes(v.variant_id),
  );
  const renderedVariant =
    selectedVariant ??
    proposal?.variants.find((v) =>
      job.binding.variantIds.includes(v.variant_id),
    );
  const changeIds = new Set(
    renderedVariant?.changes.map((c) => c.change_id) ?? [],
  );
  const outcomes =
    result?.wire?.outcomes.filter((outcome) =>
      changeIds.has(outcome.change_id),
    ) ?? [];
  const assetIds = new Set(outcomes.flatMap((outcome) => outcome.asset_ids));
  const assets =
    result?.wire?.assets.filter((asset) => assetIds.has(asset.asset_id)) ?? [];
  const assetList = (
    <div className="render-assets">
      <RenderAssets api={api} assets={assets} identity={JSON.stringify([bindingKey(job.binding), job.requestId, renderedVariant?.variant_id])} onRefreshLinks={() => setPollAttempt(old => old + 1)} />
    </div>
  );
  return (
    <section
      className="render-section"
      aria-label={`Render job ${job.requestId ?? job.localId}`}
    >
      <h3>Render proposal version {job.binding.proposalVersion}</h3>
      <p>
        Run {job.binding.runId} / variants {job.binding.variantIds.join(", ")} /
        baseline {job.binding.baselineAssetId} / catalog{" "}
        {job.binding.partCatalogVersion}
      </p>
      {!current && (
        <p className="notice">
          Older render or earlier attempt: proposal version{" "}
          {job.binding.proposalVersion}. Current selected proposal version{" "}
          {workspace.proposals.proposal_set_version}; baseline remains selected.
        </p>
      )}
      {stale && (
        <p className="notice">
          Backend marks this render stale. It cannot supply current-version
          assets.
        </p>
      )}
      <p>Rendering does not mean validated or approved.</p>
      {job.submission && (
        <>
          <p role="status">
            {submitting
              ? "Submitting render request…"
              : "Render submission outcome unresolved. Retry keeps its exact version and command key."}
          </p>
          <button disabled={submitting || busy} onClick={() => void submit()}>
            Retry render submission {job.localId}
          </button>
        </>
      )}
      {loading && <p role="status">Loading render job {job.requestId}…</p>}
      {result && (
        <>
          <span className="status">{result.status}</span>
          {result.wire?.failure_reason && <p>{result.wire.failure_reason}</p>}
          {result.wire?.outcomes.map((outcome) => (
            <p key={outcome.change_id}>
              {outcome.change_id}: {outcome.outcome} /{" "}
              {outcome.reason || "No additional limitation supplied."}
            </p>
          ))}
          {current && !stale ? (
            <section aria-label="Current render assets">{assetList}</section>
          ) : (
            <details onToggle={event => setShowEarlierAssets(event.currentTarget.open)}>
              <summary>Inspect earlier render assets {job.requestId}</summary>
              {showEarlierAssets && assetList}
            </details>
          )}
          {["failed", "partial"].includes(result.status) && (
            <button
              disabled={
                busy ||
                !workspace.snapshot.available_actions.includes("reimagine") ||
                !retryableAttempt
              }
              onClick={() => onRetry(job)}
            >
              Retry render {job.requestId}
            </button>
          )}
        </>
      )}
      {job.error && (
        <>
          <p role="alert">{job.error}</p>
          {job.requestId && (
            <button
              disabled={loading}
              onClick={() => setPollAttempt((old) => old + 1)}
            >
              Retry render status {job.requestId}
            </button>
          )}
        </>
      )}
      {snapshotError && (
        <>
          <p role="alert">{snapshotError}</p>
          <button
            onClick={() =>
              void onRefresh()
                .then(() => {
                  if (mounted.current) setSnapshotError("");
                })
                .catch((error) => {
                  if (mounted.current) setSnapshotError(errorText(error));
                })
            }
          >
            Refresh render workspace
          </button>
        </>
      )}
      {proposalError && (
        <>
          <p role="alert">{proposalError}</p>
          <button onClick={() => setProposalAttempt((old) => old + 1)}>
            Retry render proposal version {job.binding.proposalVersion}
          </button>
        </>
      )}
      {!proposal && !proposalError && (
        <p role="status">
          Loading immutable proposal version {job.binding.proposalVersion}…
        </p>
      )}
      {renderedVariant?.changes.map((change, index) => (
        <button
          key={change.change_id}
          onClick={() => {
            setExplained(change.change_id);
            explanation.current?.focus();
          }}
        >
          Explain change {index + 1} {change.change_id}
        </button>
      ))}
      {explained && proposal && renderedVariant && (
        <div ref={explanation} tabIndex={-1}>
          <ChangeExplanation
            api={api}
            runId={job.binding.runId}
            proposals={proposal}
            variantId={renderedVariant.variant_id}
            changeId={explained}
            onOpen={onOpen}
          />
        </div>
      )}
    </section>
  );
}
export default function RenderPanel(props: RenderPanelProps) {
  return (
    <RunRenderPanel
      key={JSON.stringify([
        props.api.sessionNamespace ?? props.api.mode,
        props.workspace.snapshot.run_id,
      ])}
      {...props}
    />
  );
}
function RunRenderPanel(props: RenderPanelProps) {
  const { api, workspace, variantId, busy } = props;
  const runId = workspace.snapshot.run_id;
  const [explained, setExplained] = useState<string | null>(null);
  const explanation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (explained) explanation.current?.focus();
  }, [explained]);
  const storageKey =
    api.mode === "real"
      ? `vehicle-renders:${JSON.stringify([api.sessionNamespace ?? `real:${import.meta.env.VITE_API_BASE_URL || "/api/v1"}`, runId])}`
      : null;
  const [jobs, setJobs] = useState<RenderJob[]>(() =>
    readRenderJobs(storageKey, runId, api),
  );
  const jobsRef = useRef(jobs);
  const binding: RenderBinding = {
    runId,
    proposalVersion: workspace.proposals.proposal_set_version,
    variantIds: [variantId],
    baselineAssetId: workspace.snapshot.config.baseline_asset_id,
    partCatalogVersion: workspace.snapshot.config.part_catalog_version,
  };
  const currentKey = bindingKey(binding);
  const latest = jobs
    .filter((job) => bindingKey(job.binding) === currentKey)
    .at(-1);
  const variant = workspace.proposals.variants.find(
    (v) => v.variant_id === variantId,
  );
  const update = useCallback(
    (id: string, patch: Partial<RenderJob>) => {
      const next = jobsRef.current.map((job) =>
        job.localId === id ? { ...job, ...patch } : job,
      );
      jobsRef.current = next;
      saveRenderJobs(storageKey, next, api, runId);
      setJobs(next);
    },
    [storageKey, api, runId],
  );
  function create(retry?: RenderJob) {
    if (
      busy ||
      !workspace.snapshot.available_actions.includes("reimagine") ||
      (!retry &&
        (!variant ||
          workspace.snapshot.current_proposal_set_version !==
            workspace.proposals.proposal_set_version))
    )
      return;
    const exact = retry?.binding ?? binding;
    if (
      !retry &&
      jobsRef.current.some(
        (job) => bindingKey(job.binding) === bindingKey(exact),
      )
    )
      return;
    if (
      retry &&
      jobsRef.current
        .filter((job) => bindingKey(job.binding) === bindingKey(exact))
        .at(-1)?.localId !== retry.localId
    )
      return;
    const id = commandKey();
    const job: RenderJob = {
      localId: id,
      binding: exact,
      requestId: null,
      autoSubmit: true,
      submission: retry
        ? { kind: "retry", retryOf: retry.requestId!, key: id, body: {} }
        : {
            kind: "create",
            key: id,
            body: {
              proposal_set_version: exact.proposalVersion,
              variant_ids: exact.variantIds,
              baseline_asset_id: exact.baselineAssetId,
            },
          },
    };
    const next = [...jobsRef.current, job];
    jobsRef.current = next;
    saveRenderJobs(storageKey, next, api, runId);
    setJobs(next);
  }
  return (
    <section aria-label="Visualization">
      <div className="section-title">
        <h2>Visualization</h2>
        <button
          className="primary"
          disabled={
            busy ||
            !workspace.snapshot.available_actions.includes("reimagine") ||
            !variant ||
            !!latest ||
            workspace.snapshot.current_proposal_set_version !==
              workspace.proposals.proposal_set_version
          }
          onClick={() => create()}
        >
          Reimagine
        </button>
      </div>
      {!variant && (
        <p>
          Selected variant unavailable. Choose an existing variant before
          rendering.
        </p>
      )}
      {!jobs.length && <p>No render requested for this proposal set.</p>}
      {!latest && variant && (
        <section aria-label="Current proposal explanations">
          {variant.changes.map((change, index) => (
            <button
              key={change.change_id}
              onClick={() => {
                setExplained(change.change_id);
                explanation.current?.focus();
              }}
            >
              Explain change {index + 1} {change.change_id}
            </button>
          ))}
          {explained && (
            <div ref={explanation} tabIndex={-1}>
              <ChangeExplanation
                api={api}
                runId={runId}
                proposals={workspace.proposals}
                variantId={variantId}
                changeId={explained}
                onOpen={props.onOpen}
              />
            </div>
          )}
        </section>
      )}
      {jobs.map((job) => (
        <Job
          key={job.localId}
          {...props}
          job={job}
          current={latest?.localId === job.localId}
          retryableAttempt={
            jobs
              .filter(
                (candidate) =>
                  bindingKey(candidate.binding) === bindingKey(job.binding),
              )
              .at(-1)?.localId === job.localId
          }
          update={update}
          onRetry={create}
        />
      ))}
    </section>
  );
}
