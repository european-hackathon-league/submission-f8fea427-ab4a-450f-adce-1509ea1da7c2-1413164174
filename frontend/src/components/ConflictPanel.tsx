import { useEffect, useRef, useState } from "react";
import { ApiError, commandKey } from "../api/client";
import { scopeLabel } from "../api/normalize";
import type { Api, Workspace } from "../api/contracts";
import type { Checkpoint } from "../api/wire";
import { readCheckpointDraft, saveCheckpointDraft } from "./checkpointDraft";
import type { CheckpointDraft, CheckpointCommand } from "./checkpointDraft";

export interface ConflictPanelProps {
  compact?: boolean;
  api: Api;
  workspace: Workspace;
  busy?: boolean;
  onRefresh: () => Promise<Workspace>;
  onChanged?: () => void;
}
function errorText(error: unknown) {
  if (!(error instanceof Error)) return "Checkpoint request failed. Retry.";
  if (!(error instanceof ApiError)) return error.message;
  return [
    error.message,
    ...error.field_errors.map((field) =>
      Object.entries(field)
        .map(([key, value]) => `${key}: ${value}`)
        .join(" / "),
    ),
  ].join(" · ");
}

function CheckpointForm({
  checkpoint: cp,
  api,
  workspace,
  busy,
  onRefresh,
  onChanged,
  unavailable = false,
}: ConflictPanelProps & { checkpoint: Checkpoint; unavailable?: boolean }) {
  const variants = workspace.proposals.variants;
  const cohorts = [
    ...new Set([
      ...variants.flatMap((v) => v.cohort_scope),
      ...workspace.findings.flatMap((f) => f.cohort_ids),
      ...(workspace.conflicts?.conflicts.flatMap((c) =>
        c.alternatives.flatMap((scope) => scope.cohort_ids ?? []),
      ) ?? []),
    ]),
  ];
  const storageKey =
    api.mode === "real"
      ? `vehicle-checkpoint:${JSON.stringify([api.sessionNamespace ?? `real:${import.meta.env.VITE_API_BASE_URL || "/api/v1"}`, workspace.snapshot.run_id, cp.checkpoint_id])}`
      : null;
  const [restored] = useState(() => readCheckpointDraft(storageKey));
  const [draft, setDraft] = useState<CheckpointDraft>(
    () =>
      restored?.draft ?? {
        version: cp.version,
        resolution: "",
        assignments: Object.fromEntries(
          variants.map((v) => [v.variant_id, [...v.cohort_scope]]),
        ),
      },
  );
  const [pending, setPending] = useState(false);
  const [acceptedVersion, setAcceptedVersion] = useState<number | null>(
    restored?.acceptedVersion ?? null,
  );
  const accepted = acceptedVersion === cp.version;
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (accepted && (cp.wait_state === "continued" || unavailable))
      heading.current?.focus();
  }, [accepted, cp.wait_state, unavailable]);
  const command = useRef<CheckpointCommand | null>(restored?.command ?? null);
  useEffect(() => {
    saveCheckpointDraft(
      storageKey,
      cp.wait_state === "continued"
        ? null
        : { draft, command: command.current, acceptedVersion },
    );
  }, [storageKey, draft, pending, acceptedVersion, cp.wait_state]);
  const obsolete = cp.version !== draft.version || stale;
  const knownAssignments =
    draft.resolution !== "regroup_variants" ||
    Object.entries(draft.assignments).every(
      ([id, assigned]) =>
        variants.some((v) => v.variant_id === id) &&
        assigned.every((cohort) => cohorts.includes(cohort)),
    );
  const canContinue = workspace.snapshot.available_actions.includes(
    "continue_checkpoint",
  );
  const locked =
    !!busy ||
    pending ||
    accepted ||
    obsolete ||
    unavailable ||
    cp.wait_state !== "waiting";
  const inputLocked = locked || command.current !== null;
  const conflicts =
    workspace.conflicts?.conflicts.filter((c) =>
      cp.conflict_ids.includes(c.conflict_id),
    ) ?? [];

  async function refresh() {
    setRefreshFailed(false);
    try {
      await onRefresh();
    } catch (cause) {
      if (mounted.current) {
        setError(errorText(cause));
        setRefreshFailed(true);
      }
    }
  }
  async function submit() {
    if (
      inFlight.current ||
      locked ||
      !canContinue ||
      !cp.allowed_actions.includes(draft.resolution) ||
      !knownAssignments
    )
      return;
    if (draft.resolution === "regroup_variants" && !variants.length) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    const request = command.current ?? {
      key: commandKey(),
      body: {
        checkpoint_version: draft.version,
        resolution: draft.resolution,
        ...(draft.resolution === "regroup_variants"
          ? { cohort_assignments: structuredClone(draft.assignments) }
          : {}),
      },
    };
    command.current = request;
    saveCheckpointDraft(storageKey, {
      draft,
      command: request,
      acceptedVersion: null,
    });
    try {
      await api.request(
        `/runs/${encodeURIComponent(workspace.snapshot.run_id)}/checkpoints/${encodeURIComponent(cp.checkpoint_id)}/continue`,
        request.body,
        request.key,
      );
      if (!mounted.current) return;
      setAcceptedVersion(request.body.checkpoint_version);
      command.current = null;
      saveCheckpointDraft(storageKey, {
        draft,
        command: null,
        acceptedVersion: request.body.checkpoint_version,
      });
      onChanged?.();
      await refresh();
    } catch (cause) {
      if (!mounted.current) return;
      setError(errorText(cause));
      if (
        cause instanceof ApiError &&
        ["stale_checkpoint", "stale_version"].includes(cause.code)
      ) {
        command.current = null;
        setStale(true);
        await refresh();
      } else if (
        cause instanceof ApiError &&
        !cause.retryable &&
        cause.status !== null
      ) {
        command.current = null;
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }
  function reconcile() {
    if (
      unavailable ||
      cp.wait_state !== "waiting" ||
      (cp.version === draft.version && stale)
    )
      return;
    command.current = null;
    setDraft((old) => ({
      version: cp.version,
      resolution: cp.allowed_actions.includes(old.resolution)
        ? old.resolution
        : "",
      assignments: Object.fromEntries(
        variants.map((v) => [
          v.variant_id,
          (old.assignments[v.variant_id] ?? v.cohort_scope).filter((id) =>
            cohorts.includes(id),
          ),
        ]),
      ),
    }));
    setStale(false);
    setAcceptedVersion(null);
    setError("");
  }
  const regroupValid =
    draft.resolution !== "regroup_variants" || variants.length > 0;
  return (
    <section
      className="checkpoint"
      aria-label={`Checkpoint ${cp.checkpoint_id}`}
    >
      <h3 ref={heading} tabIndex={-1}>
        Checkpoint {cp.checkpoint_id}
      </h3>
      <p>
        {unavailable ? "Last observed server version" : "Server version"}{" "}
        {cp.version} / {cp.wait_state}. Draft version {draft.version}.
      </p>
      {unavailable && (
        <p className="notice">
          Checkpoint absent from current backend snapshot. Retained draft cannot
          continue a different question.
        </p>
      )}
      <p>Draft resolution: {draft.resolution || "Not selected"}</p>
      {draft.resolution === "regroup_variants" && (
        <p>
          Draft cohort assignments:{" "}
          {Object.entries(draft.assignments)
            .map(
              ([id, assigned]) =>
                `${id}: ${assigned.join(", ") || "No cohorts assigned"}`,
            )
            .join(" / ")}
        </p>
      )}
      {conflicts.map((conflict) => (
        <p key={conflict.conflict_id}>
          {conflict.rationale} / {conflict.conflict_id}
        </p>
      ))}
      {cp.conflict_ids
        .filter((id) => !conflicts.some((c) => c.conflict_id === id))
        .map((id) => (
          <p key={id}>Conflict {id}: details unavailable.</p>
        ))}
      {cp.wait_state === "continued" ? (
        <p>Backend continued this checkpoint.</p>
      ) : (
        <>
          <label className="stacked-label">
            Resolution for {cp.checkpoint_id}
            <select
              value={draft.resolution}
              disabled={inputLocked}
              onChange={(event) =>
                setDraft((old) => ({ ...old, resolution: event.target.value }))
              }
            >
              <option value="">Choose supported resolution</option>
              {cp.allowed_actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>
          {!cp.allowed_actions.length && (
            <p>No supported resolutions supplied.</p>
          )}
          {draft.resolution === "regroup_variants" && (
            <div>
              <p>
                Assign existing cohorts to existing variants. An empty selection
                clears that variant’s cohort scope; it does not mean all
                cohorts. Overlapping assignments are explicit; counts remain
                unchanged until backend recomputes.
              </p>
              {variants.map((variant) => (
                <fieldset key={variant.variant_id} disabled={inputLocked}>
                  <legend>Cohorts for {variant.variant_id}</legend>
                  {cohorts.map((cohort) => (
                    <label key={cohort}>
                      <input
                        type="checkbox"
                        checked={
                          draft.assignments[variant.variant_id]?.includes(
                            cohort,
                          ) ?? false
                        }
                        onChange={(event) =>
                          setDraft((old) => ({
                            ...old,
                            assignments: {
                              ...old.assignments,
                              [variant.variant_id]: event.target.checked
                                ? [
                                    ...(old.assignments[variant.variant_id] ??
                                      []),
                                    cohort,
                                  ]
                                : (
                                    old.assignments[variant.variant_id] ?? []
                                  ).filter((id) => id !== cohort),
                            },
                          }))
                        }
                      />
                      {cohort}
                    </label>
                  ))}
                </fieldset>
              ))}
              {!variants.length && (
                <p>
                  Variant identities unavailable; regrouping cannot be
                  submitted.
                </p>
              )}
              {!cohorts.length && <p>No cohort identities supplied.</p>}
            </div>
          )}
          {!knownAssignments && (
            <p role="alert">
              Draft references variants or cohorts absent from current results.
              Review and reconcile before continuing.
            </p>
          )}
          {obsolete && (
            <div className="notice">
              <p>
                Checkpoint changed. Draft retained against version{" "}
                {draft.version}; review current question before applying it.
              </p>
              <button
                disabled={
                  unavailable ||
                  pending ||
                  !!busy ||
                  cp.version === draft.version
                }
                onClick={reconcile}
              >
                Reconcile with checkpoint version {cp.version}
              </button>
            </div>
          )}
          {!knownAssignments && !obsolete && (
            <button
              disabled={unavailable || pending || !!busy}
              onClick={reconcile}
            >
              Reconcile current cohort assignments
            </button>
          )}
          {!canContinue && (
            <p>Continuation unavailable in current backend state.</p>
          )}
          <button
            disabled={
              locked ||
              !canContinue ||
              !cp.allowed_actions.includes(draft.resolution) ||
              !knownAssignments ||
              !regroupValid
            }
            onClick={() => void submit()}
          >
            Continue checkpoint {cp.checkpoint_id}
          </button>
        </>
      )}
      {pending && <p role="status">Submitting checkpoint continuation…</p>}
      {accepted && cp.wait_state === "waiting" && (
        <p role="status">
          Continuation accepted. Waiting for backend checkpoint update.
        </p>
      )}
      {command.current && !pending && (
        <p>
          Request outcome uncertain. Draft frozen; retry continues the same
          command.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {(refreshFailed || stale) && (
        <button disabled={pending || !!busy} onClick={() => void refresh()}>
          Refresh checkpoint {cp.checkpoint_id}
        </button>
      )}
    </section>
  );
}

export default function ConflictPanel(props: ConflictPanelProps) {
  const { workspace } = props;
  const conflicts = workspace.conflicts?.conflicts ?? [];
  const checkpoints = workspace.conflicts?.checkpoints ?? [];
  const [observedCheckpoints, setObservedCheckpoints] =
    useState<Checkpoint[]>(checkpoints);
  useEffect(() => {
    setObservedCheckpoints((previous) => [
      ...new Map(
        [...previous, ...checkpoints].map((cp) => [cp.checkpoint_id, cp]),
      ).values(),
    ]);
  }, [workspace.conflicts]);
  const retainedCheckpoints = observedCheckpoints.filter(
    (cp) =>
      !checkpoints.some(
        (current) => current.checkpoint_id === cp.checkpoint_id,
      ),
  );
  const autonomous =
    workspace.snapshot.config.participation_mode === "autonomous";
  const unresolved = [
    ...new Set([
      ...conflicts
        .filter((c) => c.resolution_status === "unresolved")
        .map((c) => c.conflict_id),
      ...workspace.proposals.unresolved_conflicts,
    ]),
  ];
  if (props.compact)
    return (
      <section
        className="conflicts-visual"
        aria-label="Conflicts and alternatives"
      >
        <h2>Conflicts</h2>
        {!conflicts.length && (
          <p className="empty-state">
            {workspace.conflicts
              ? "No conflicts supplied."
              : "Conflict details unavailable."}
          </p>
        )}
        {conflicts.map((c) => (
          <article key={c.conflict_id}>
            <div className="visual-heading">
              <strong>
                {c.finding_ids
                  .map(
                    (id) =>
                      workspace.findings.find((f) => f.finding_id === id)
                        ?.title ?? id,
                  )
                  .join(", ")}
              </strong>
              <span className="status">{c.resolution_status}</span>
            </div>
            <div className="opposing-cards">
              {c.alternatives.map((scope, index) => (
                <div className="viewpoint" key={index}>
                  <span className="viewpoint-label">
                    Alternative {index + 1}
                  </span>
                  <strong>
                    {scope.cohort_ids?.join(", ") || "Cohort not specified"}
                  </strong>
                  <span>
                    {scope.markets?.join(", ") || "Market not specified"}
                  </span>
                  <details>
                    <summary>Scope</summary>
                    <p>{scopeLabel(scope)}</p>
                  </details>
                </div>
              ))}
            </div>
            <p className="conflict-rationale">{c.rationale}</p>
          </article>
        ))}
        <details>
          <summary>
            Proposal alternatives · {workspace.proposals.variants.length}
          </summary>
          {workspace.proposals.variants.map((v) => (
            <article key={v.variant_id}>
              <h3>{v.title}</h3>
              <p>{v.cohort_scope.join(", ")}</p>
              {v.assumptions.map((a) => (
                <p key={a}>{a}</p>
              ))}
            </article>
          ))}
        </details>
        {!autonomous &&
          [...checkpoints, ...retainedCheckpoints].map((cp) => (
            <details key={cp.checkpoint_id} open={cp.wait_state === "waiting"}>
              <summary>Resolve conflict</summary>
              <CheckpointForm
                {...props}
                checkpoint={cp}
                unavailable={
                  !checkpoints.some(
                    (current) => current.checkpoint_id === cp.checkpoint_id,
                  )
                }
              />
            </details>
          ))}
      </section>
    );
  return (
    <section aria-label="Conflicts and alternatives">
      <h2>Conflicts and alternatives</h2>
      <p>
        {autonomous
          ? "Autonomous alternatives require no PM checkpoint decisions."
          : "Guided participation uses backend checkpoints."}
      </p>
      <p className="muted">
        Variant limit not supplied by current API contract. Cohort and market
        scopes may overlap; scopes are not distinct people or additive counts.
      </p>
      {!workspace.conflicts && (
        <p>Conflict details unavailable in this snapshot.</p>
      )}
      {!conflicts.length && <p>No conflict details supplied.</p>}
      {conflicts.map((conflict) => (
        <article className="evidence-card" key={conflict.conflict_id}>
          <h3>
            {conflict.conflict_id} / version {conflict.version} /{" "}
            {conflict.resolution_status}
          </h3>
          <p>{conflict.rationale}</p>
          <p>
            Finding IDs: {conflict.finding_ids.join(", ") || "Not supplied"}
          </p>
          <ul>
            {conflict.alternatives.map((scope, index) => (
              <li key={index}>{scopeLabel(scope)}</li>
            ))}
          </ul>
          {!conflict.alternatives.length && (
            <p>No alternative scopes supplied.</p>
          )}
        </article>
      ))}
      <p>Unresolved conflict IDs: {unresolved.join(", ") || "None supplied"}</p>
      <h3>
        Backend proposal alternatives / version{" "}
        {workspace.proposals.proposal_set_version}
      </h3>
      {!workspace.proposals.variants.length && (
        <p>No proposal alternatives available yet.</p>
      )}
      {workspace.proposals.variants.map((variant) => (
        <article className="evidence-card" key={variant.variant_id}>
          <h4>{variant.title}</h4>
          <p>
            Variant {variant.variant_id}. Cohorts:{" "}
            {variant.cohort_scope.join(", ") || "Not supplied"}
          </p>
          <p>
            Related variants:{" "}
            {variant.wire?.related_variant_ids.join(", ") || "Not supplied"}
          </p>
          <ul>
            {variant.assumptions.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          {variant.changes.map((change) => (
            <p key={change.change_id}>
              {change.after} / {change.rationale}
            </p>
          ))}
        </article>
      ))}
      {!autonomous &&
        [...checkpoints, ...retainedCheckpoints].map((checkpoint) => (
          <CheckpointForm
            key={checkpoint.checkpoint_id}
            {...props}
            checkpoint={checkpoint}
            unavailable={
              !checkpoints.some(
                (cp) => cp.checkpoint_id === checkpoint.checkpoint_id,
              )
            }
          />
        ))}
      {!autonomous && !checkpoints.length && (
        <p>No backend checkpoints supplied.</p>
      )}
    </section>
  );
}
