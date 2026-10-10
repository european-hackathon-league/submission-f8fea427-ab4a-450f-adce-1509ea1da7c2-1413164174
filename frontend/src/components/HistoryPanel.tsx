import { useEffect, useRef, useState } from "react";
import { ApiError, commandKey } from "../api/client";
import type { Api, Evidence, ProposalSet, Workspace } from "../api/contracts";
import type { Accepted, ExportCommand, ExportResult } from "../api/wire";
import { exportLink, readExportJob, saveExportJob } from "./exportJob";
import type { ExportJob } from "./exportJob";
import ChangeExplanation from "./ChangeExplanation";
export interface HistoryPanelProps {
  api: Api;
  workspace: Workspace;
  variantId: string;
  busy?: boolean;
  onRefresh: () => Promise<Workspace>;
  onOpen: (evidence: Evidence) => void;
}
const jobsByApi = new WeakMap<Api, Map<string, ExportJob>>();
function savedJob(api: Api, runId: string, key: string | null) {
  return jobsByApi.get(api)?.get(runId) ?? readExportJob(key);
}
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Request failed. Retry when connection returns.";
export default function HistoryPanel({
  api,
  workspace,
  variantId,
  busy,
  onRefresh,
  onOpen,
}: HistoryPanelProps) {
  const runId = workspace.snapshot.run_id;
  const storageKey =
    api.mode === "real" && api.sessionNamespace
      ? JSON.stringify(["frontend-export", api.sessionNamespace, runId])
      : null;
  const [version, setVersion] = useState<number | null>(
    workspace.snapshot.current_proposal_set_version,
  );
  const [inspection, setInspection] = useState<ProposalSet | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const inspectionHeading = useRef<HTMLHeadingElement>(null);
  const focusInspection = useRef(false);
  useEffect(() => {
    if (inspection && focusInspection.current) {
      focusInspection.current = false;
      inspectionHeading.current?.focus();
    }
  }, [inspection]);
  const [format, setFormat] = useState<ExportCommand["format"]>("json");
  const [variants, setVariants] = useState<string[]>(
    variantId ? [variantId] : [],
  );
  const [job, setJob] = useState<ExportJob | null>(() =>
    savedJob(api, runId, storageKey),
  );
  const [result, setResult] = useState<ExportResult | null>(null);
  const [download, setDownload] = useState<string | null>(null);
  const [jobError, setJobError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const submitLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const identity = JSON.stringify([api.sessionNamespace, runId]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const previousIdentity = useRef(identity);
  const previousVariant = useRef(variantId);
  useEffect(() => {
    if (previousIdentity.current === identity) return;
    previousIdentity.current = identity;
    submitLock.current = false;
    setVersion(workspace.snapshot.current_proposal_set_version);
    setInspection(null);
    setJob(savedJob(api, runId, storageKey));
    setResult(null);
    setDownload(null);
    setJobError("");
    setSubmitting(false);
    setVariants(variantId ? [variantId] : []);
  }, [
    identity,
    storageKey,
    workspace.snapshot.current_proposal_set_version,
    variantId,
  ]);
  useEffect(() => {
    if (previousVariant.current !== variantId) {
      previousVariant.current = variantId;
      setVariants(variantId ? [variantId] : []);
    }
  }, [variantId]);
  useEffect(() => {
    if (
      version === null &&
      workspace.snapshot.current_proposal_set_version !== null
    )
      setVersion(workspace.snapshot.current_proposal_set_version);
  }, [version, workspace.snapshot.current_proposal_set_version]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setInspection(null);
    setHistoryError("");
    if (version === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void api
      .request<ProposalSet>(
        `/runs/${encodeURIComponent(runId)}/proposals?proposal_set_version=${version}`,
        undefined,
        undefined,
        controller.signal,
      )
      .then((value) => {
        if (!active) return;
        if (
          value.proposal_set_version !== version ||
          value.wire?.run_id !== runId
        )
          throw new Error(
            "Proposal response does not match the selected run and version. Inspection withheld.",
          );
        setInspection(value);
      })
      .catch((error) => {
        if (active) setHistoryError(message(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, runId, version, attempt]);
  function updateJob(value: ExportJob | null) {
    let jobs = jobsByApi.get(api);
    if (!jobs) {
      jobs = new Map();
      jobsByApi.set(api, jobs);
    }
    if (value) jobs.set(runId, value);
    else jobs.delete(runId);
    setJob(value);
    saveExportJob(storageKey, value);
  }
  async function submit(existing?: ExportJob) {
    if (submitLock.current || busy) return;
    if (
      !existing &&
      (!inspection ||
        !variants.length ||
        variants.some(
          (id) => !inspection.variants.some((v) => v.variant_id === id),
        ) ||
        !workspace.snapshot.available_actions.includes("export"))
    )
      return;
    const command = existing ?? {
      key: commandKey(),
      body: {
        proposal_set_version: inspection!.proposal_set_version,
        variant_ids: [...variants],
        format,
      },
      sourceVersionIds: [...inspection!.wire!.source_version_ids],
      researchIds: [...inspection!.wire!.research_ids],
      scoringPolicyVersion: inspection!.wire!.scoring_policy_version,
      resourceId: null,
    };
    if (command.resourceId) return;
    const expectedIdentity = identity;
    submitLock.current = true;
    setSubmitting(true);
    setJobError("");
    setResult(null);
    setDownload(null);
    updateJob(command);
    try {
      const accepted = await api.request<Accepted>(
        `/runs/${encodeURIComponent(runId)}/exports`,
        command.body,
        command.key,
      );
      if (!mounted.current || identityRef.current !== expectedIdentity) return;
      if (
        !accepted ||
        typeof accepted.resource_id !== "string" ||
        !accepted.resource_id
      )
        throw new Error(
          "Accepted export has no resource identity. Retry original request.",
        );
      updateJob({ ...command, resourceId: accepted.resource_id });
    } catch (error) {
      if (!mounted.current || identityRef.current !== expectedIdentity) return;
      setJobError(message(error));
      if (
        error instanceof ApiError &&
        !error.retryable &&
        error.status !== null
      )
        updateJob(null);
    } finally {
      if (mounted.current && identityRef.current === expectedIdentity) {
        submitLock.current = false;
        setSubmitting(false);
      }
    }
  }
  useEffect(() => {
    if (!job?.resourceId) return;
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setJobError("");
    setDownload(null);
    setResult(null);
    async function poll() {
      try {
        const value = await api.request<ExportResult>(
          `/runs/${encodeURIComponent(runId)}/exports/${encodeURIComponent(job!.resourceId!)}`,
          undefined,
          undefined,
          controller.signal,
        );
        if (!active) return;
        if (
          value.export_id !== job!.resourceId ||
          !["queued", "processing", "ready", "failed"].includes(value.status)
        )
          throw new Error(
            "Export response identity or state is invalid. Download withheld.",
          );
        if (value.status === "ready")
          setDownload(exportLink(value, job!, runId, api.mode, api.linkUrl));
        setResult(value);
        if (value.status === "queued" || value.status === "processing")
          timer = setTimeout(() => void poll(), 1000);
      } catch (error) {
        if (active) setJobError(message(error));
      }
    }
    void api
      .request<ProposalSet>(
        `/runs/${encodeURIComponent(runId)}/proposals?proposal_set_version=${job.body.proposal_set_version}`,
        undefined,
        undefined,
        controller.signal,
      )
      .then((value) => {
        if (!active) return;
        const wire = value.wire;
        const same = (left: string[], right: string[]) =>
          left.length === right.length &&
          left.every((id) => right.includes(id));
        if (
          value.proposal_set_version !== job.body.proposal_set_version ||
          wire?.run_id !== runId ||
          !same(wire.source_version_ids, job.sourceVersionIds) ||
          (job.researchIds && !same(wire.research_ids, job.researchIds)) ||
          (job.scoringPolicyVersion &&
            wire.scoring_policy_version !== job.scoringPolicyVersion) ||
          job.body.variant_ids.some(
            (id) => !value.variants.some((v) => v.variant_id === id),
          )
        )
          throw new Error(
            "Saved export binding does not match the immutable server proposal. Download withheld.",
          );
        void poll();
      })
      .catch((error) => {
        if (active) setJobError(message(error));
      });
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, runId, job?.resourceId, pollAttempt]);
  const versions = [
    ...new Set(
      [
        workspace.snapshot.current_proposal_set_version,
        ...workspace.history.map((entry) => entry.proposal_set_version),
        version,
      ].filter(
        (v): v is number => v !== null && Number.isSafeInteger(v) && v > 0,
      ),
    ),
  ].sort((a, b) => b - a);
  const locked =
    !!job &&
    ((result?.status !== "ready" && result?.status !== "failed") || !!jobError);
  const selectedValid =
    !!inspection &&
    variants.length > 0 &&
    variants.every((id) =>
      inspection.variants.some((v) => v.variant_id === id),
    );
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setHistoryError("");
    try {
      await onRefresh();
      if (mounted.current) setAttempt((v) => v + 1);
    } catch (error) {
      if (mounted.current) setHistoryError(message(error));
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }
  return (
    <section aria-label="Proposal history and export">
      <h2>Proposal history and export</h2>
      <p>
        History is retrieved from the API. AI proposals, PM selections,
        approvals, rendering and validation are separate states.
      </p>
      <label>
        Inspect proposal version
        <select
          value={version ?? ""}
          onChange={(event) => {
            focusInspection.current = true;
            setVersion(Number(event.target.value));
          }}
        >
          {!versions.length && <option value="">No published version</option>}
          {versions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <button disabled={refreshing || !!busy} onClick={() => void refresh()}>
        Refresh proposal history
      </button>
      {loading && <p role="status">Loading immutable proposal…</p>}
      {historyError && (
        <>
          <p role="alert">{historyError}</p>
          <button onClick={() => setAttempt((v) => v + 1)}>
            Retry proposal inspection
          </button>
        </>
      )}
      {inspection && (
        <article
          aria-label={`Immutable proposal version ${inspection.proposal_set_version}`}
        >
          <h3 ref={inspectionHeading} tabIndex={-1}>
            Immutable proposal version {inspection.proposal_set_version}
          </h3>
          <p>
            Read-only server snapshot. Generation{" "}
            {inspection.wire?.generation_id}; source versions{" "}
            {inspection.wire?.source_version_ids.join(", ") || "None supplied"}.
          </p>
          {inspection.variants.map((variant) => (
            <section key={variant.variant_id}>
              <h4>
                {variant.title} / {variant.variant_id}
              </h4>
              <p>
                Cohort scope:{" "}
                {variant.cohort_scope.join(", ") || "No cohorts assigned"}
              </p>
              {variant.changes.map((change, index) => (
                <details
                  key={change.change_id}
                  onToggle={(event) => {
                    const key = JSON.stringify([
                      inspection.proposal_set_version,
                      variant.variant_id,
                      change.change_id,
                    ]);
                    const open = event.currentTarget.open;
                    setExpanded((old) =>
                      open
                        ? [...new Set([...old, key])]
                        : old.filter((id) => id !== key),
                    );
                  }}
                >
                  <summary>
                    {index + 1}. {change.after} / {change.change_id}
                  </summary>
                  {expanded.includes(
                    JSON.stringify([
                      inspection.proposal_set_version,
                      variant.variant_id,
                      change.change_id,
                    ]),
                  ) && (
                    <ChangeExplanation
                      api={api}
                      runId={runId}
                      proposals={inspection}
                      variantId={variant.variant_id}
                      changeId={change.change_id}
                      onOpen={onOpen}
                    />
                  )}
                </details>
              ))}
            </section>
          ))}
        </article>
      )}
      <h3>Authoritative export</h3>
      <p>
        Exports bind the inspected proposal version and selected variant IDs.
        Download appears only after matching server manifest verification.
      </p>
      <fieldset disabled={locked || submitting || !!busy}>
        <legend>Export variants</legend>
        {inspection?.variants.map((variant) => (
          <label key={variant.variant_id}>
            <input
              type="checkbox"
              checked={variants.includes(variant.variant_id)}
              onChange={(event) =>
                setVariants((old) =>
                  event.target.checked
                    ? [...old, variant.variant_id]
                    : old.filter((id) => id !== variant.variant_id),
                )
              }
            />
            {variant.title} / {variant.variant_id}
          </label>
        ))}
      </fieldset>
      {variants.some(
        (id) => !inspection?.variants.some((v) => v.variant_id === id),
      ) && (
        <p>
          Selected variant absent from inspected version. Choose an existing
          variant explicitly before exporting.
        </p>
      )}
      <label>
        Export format
        <select
          value={format}
          disabled={locked || submitting || !!busy}
          onChange={(event) =>
            setFormat(event.target.value as ExportCommand["format"])
          }
        >
          <option value="json">JSON</option>
          <option value="xlsx">XLSX</option>
        </select>
      </label>
      {!job && (
        <button
          disabled={
            !selectedValid ||
            !!busy ||
            submitting ||
            !workspace.snapshot.available_actions.includes("export")
          }
          onClick={() => void submit()}
        >
          Request exact-version export
        </button>
      )}
      {!workspace.snapshot.available_actions.includes("export") && (
        <p>Export unavailable in current backend state.</p>
      )}
      {job && (
        <p>
          Export request version {job.body.proposal_set_version} / variants{" "}
          {job.body.variant_ids.join(", ")} / {job.body.format}.
        </p>
      )}
      {submitting && <p role="status">Submitting export request…</p>}
      {job && !job.resourceId && !submitting && (
        <>
          <p>
            Submission outcome uncertain. Inputs frozen; retry uses the same
            command.
          </p>
          <button disabled={!!busy} onClick={() => void submit(job)}>
            Retry original export request
          </button>
        </>
      )}
      {result && (
        <p role="status">
          Export {result.status} / {result.export_id}
        </p>
      )}
      {jobError && <p role="alert">{jobError}</p>}
      {job?.resourceId && jobError && (
        <button disabled={!!busy} onClick={() => setPollAttempt((v) => v + 1)}>
          Retry export retrieval
        </button>
      )}
      {download && (
        <a href={download} target="_blank" rel="noreferrer">
          Download authorized export
        </a>
      )}
      {result?.status === "failed" && (
        <p>
          Backend export failed. No retry endpoint is published; another request
          creates a new command for this exact selection.
        </p>
      )}
      {job &&
        (result?.status === "ready" || result?.status === "failed") &&
        !jobError && (
          <button
            onClick={() => {
              updateJob(null);
              setResult(null);
              setDownload(null);
            }}
          >
            Prepare another export
          </button>
        )}
      <h3>Readable audit</h3>
      {!workspace.history.length && <p>No audit entries supplied.</p>}
      <ol>
        {workspace.history.map((entry) => (
          <li key={entry.event_id}>
            {entry.occurred_at} / {entry.actor} / {entry.description} / proposal{" "}
            {entry.proposal_set_version ?? "Not supplied"}
            {entry.wire?.rationale && ` / ${entry.wire.rationale}`}
          </li>
        ))}
      </ol>
    </section>
  );
}
