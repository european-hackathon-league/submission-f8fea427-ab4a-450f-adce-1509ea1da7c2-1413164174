import { useEffect, useRef, useState } from "react";
import { BookOpen, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { ApiError, commandKey } from "../api/client";
import type { Api, Change, Evidence, Workspace } from "../api/contracts";
import EvidenceList from "./EvidenceList";
import type { Accepted, Instruction } from "../api/wire";
import {
  emptyProposalDrafts,
  readProposalDrafts,
  saveProposalDrafts,
} from "./proposalDraft";
import type {
  EditDraft,
  PendingInstruction,
  ProposalDrafts,
  VariantDraft,
} from "./proposalDraft";
export type ProposalWorkspaceProps = {
  api: Api;
  workspace: Workspace;
  variantId: string;
  onVariantChange: (id: string) => void;
  busy?: boolean;
  onRefresh: () => Promise<Workspace>;
  onEvidence: (change: Change) => void;
  onOpen?: (evidence: Evidence) => void;
  onDirtyChange?: (dirty: boolean) => void;
  sessionNamespace: string;
  legacyDrafts?: Array<[string, EditDraft]>;
  legacyIdea?: string;
};
const memoryDrafts = new WeakMap<Api, Map<string, ProposalDrafts>>();
const changeKey = (variant: string, change: string) =>
  JSON.stringify([variant, change]);
const own = <T,>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;
function message(cause: unknown) {
  if (!(cause instanceof Error))
    return "Instruction failed. Your draft remains available.";
  if (!(cause instanceof ApiError)) return cause.message;
  return [
    cause.message,
    ...cause.field_errors.map((field) =>
      Object.entries(field)
        .map(([key, value]) => `${key}: ${value}`)
        .join(" / "),
    ),
  ].join(" · ");
}
function initialize(
  props: ProposalWorkspaceProps,
  storageKey: string | null,
): ProposalDrafts {
  const identity = JSON.stringify([
    props.sessionNamespace,
    props.workspace.snapshot.run_id,
  ]);
  const memory = memoryDrafts.get(props.api)?.get(identity);
  if (memory) return memory;
  const stored = readProposalDrafts(storageKey);
  if (stored) return stored;
  const state = emptyProposalDrafts();
  const version = props.workspace.proposals.proposal_set_version;
  for (const variant of props.workspace.proposals.variants) {
    state.variants[variant.variant_id] = {
      baseVersion: version,
      groupBaseVersion: version,
      idea:
        variant.variant_id === props.variantId ? (props.legacyIdea ?? "") : "",
      cohorts: [...variant.cohort_scope],
      ...(variant.variant_id === props.variantId && props.legacyIdea
        ? { needsReview: true }
        : {}),
    };
    for (const change of variant.changes) {
      const legacy = props.legacyDrafts?.find(
        ([key]) => key === `${variant.variant_id}:${change.change_id}`,
      )?.[1];
      state.changes[changeKey(variant.variant_id, change.change_id)] =
        legacy ?? {
          baseVersion: version,
          text: change.after,
          target: change.target,
        };
    }
  }
  return state;
}
export default function ProposalWorkspace(props: ProposalWorkspaceProps) {
  const identity = JSON.stringify([
    props.sessionNamespace,
    props.workspace.snapshot.run_id,
  ]);
  return (
    <ProposalWorkspaceSession key={identity} {...props} identity={identity} />
  );
}
function ProposalWorkspaceSession(
  props: ProposalWorkspaceProps & { identity: string },
) {
  const {
    api,
    workspace,
    variantId,
    onVariantChange,
    busy,
    onRefresh,
    onEvidence,
  } = props;
  const version = workspace.proposals.proposal_set_version;
  const storageKey =
    api.mode === "real" ? `vehicle-proposals:${props.identity}` : null;
  const [state, setState] = useState(() => initialize(props, storageKey));
  const current = useRef(state);
  current.current = state;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [hiddenEvidence, setHiddenEvidence] = useState(new Set<string>());
  const [removal, setRemoval] = useState<{
    changeId: string;
    variantId: string;
    baseVersion: number;
  } | null>(null);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusedChange = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    remember(current.current);
    return () => {
      mounted.current = false;
    };
  }, [storageKey]);
  const variant = workspace.proposals.variants.find(
    (v) => v.variant_id === variantId,
  );
  const variantDraft: VariantDraft = own(state.variants, variantId) ?? {
    baseVersion: version,
    groupBaseVersion: version,
    idea: "",
    cohorts: [...(variant?.cohort_scope ?? [])],
  };
  const cohorts = [
    ...new Set([
      ...workspace.proposals.variants.flatMap((v) => v.cohort_scope),
      ...workspace.findings.flatMap((f) => f.cohort_ids),
      ...(workspace.conflicts?.conflicts.flatMap((c) =>
        c.alternatives.flatMap((scope) => scope.cohort_ids ?? []),
      ) ?? []),
    ]),
  ];
  const accepted = state.accepted;
  const recomputed =
    !!accepted &&
    version > accepted.request.body.base_proposal_set_version &&
    ["proposals_ready", "waiting_for_pm"].includes(
      workspace.snapshot.analysis_status,
    );
  const waiting = !!accepted && !recomputed;
  const canEdit = workspace.snapshot.available_actions.includes("edit");
  const inputsLocked = !!busy || pending || state.command !== null || waiting;
  const staleRejected =
    state.staleBaseVersion !== null && version <= state.staleBaseVersion;
  const knownOriginals = useRef({
    changes: new Map<string, { text: string; target: string }>(),
    scopes: new Map<string, string[]>(),
  });
  for (const item of workspace.proposals.variants) {
    knownOriginals.current.scopes.set(item.variant_id, item.cohort_scope);
    for (const change of item.changes)
      knownOriginals.current.changes.set(
        changeKey(item.variant_id, change.change_id),
        { text: change.after, target: change.target },
      );
  }
  const dirty =
    Object.entries(state.changes).some(([key, draft]) => {
      const original = knownOriginals.current.changes.get(key);
      return !original
        ? !!(draft.text.trim() || draft.target.trim())
        : draft.text !== original.text || draft.target !== original.target;
    }) ||
    Object.entries(state.variants).some(([id, draft]) => {
      if (draft.idea.trim()) return true;
      const original = knownOriginals.current.scopes.get(id);
      return original
        ? draft.cohorts.length !== original.length ||
            draft.cohorts.some((cohort) => !original.includes(cohort))
        : draft.cohorts.length > 0;
    });
  useEffect(() => {
    props.onDirtyChange?.(dirty);
  }, [dirty, props.onDirtyChange]);
  useEffect(
    () => () => {
      props.onDirtyChange?.(false);
    },
    [props.onDirtyChange],
  );
  function remember(value: ProposalDrafts) {
    let scoped = memoryDrafts.get(api);
    if (!scoped) {
      scoped = new Map();
      memoryDrafts.set(api, scoped);
    }
    scoped.set(props.identity, value);
    saveProposalDrafts(storageKey, value);
  }
  function update(transform: (value: ProposalDrafts) => ProposalDrafts) {
    const next = transform(current.current);
    current.current = next;
    setState(next);
    remember(next);
  }
  function editDraft(change: Change) {
    return (
      own(state.changes, changeKey(variantId, change.change_id)) ?? {
        baseVersion: version,
        text: change.after,
        target: change.target,
      }
    );
  }
  function setEdit(change: Change, patch: Partial<EditDraft>) {
    const key = changeKey(variantId, change.change_id);
    const previous = editDraft(change);
    update((old) => ({
      ...old,
      changes: { ...old.changes, [key]: { ...previous, ...patch } },
    }));
  }
  function setVariant(patch: Partial<VariantDraft>) {
    update((old) => ({
      ...old,
      variants: { ...old.variants, [variantId]: { ...variantDraft, ...patch } },
    }));
  }
  async function refresh() {
    if (lock.current) return;
    lock.current = true;
    setRefreshFailed(false);
    setPending(true);
    try {
      await onRefresh();
      if (mounted.current) setError("");
    } catch (cause) {
      if (mounted.current) {
        setError(message(cause));
        setRefreshFailed(true);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function submit(body: Instruction, retry = false) {
    if (
      lock.current ||
      !!busy ||
      waiting ||
      (!retry &&
        (!canEdit ||
          state.command !== null ||
          body.base_proposal_set_version !== version ||
          staleRejected))
    )
      return false;
    const request: PendingInstruction =
      retry && current.current.command
        ? current.current.command
        : { key: commandKey(), body };
    lock.current = true;
    setPending(true);
    setError("");
    setRefreshFailed(false);
    update((old) => ({ ...old, command: request, accepted: null }));
    try {
      const result = await api.request<Accepted>(
        `/runs/${encodeURIComponent(workspace.snapshot.run_id)}/instructions`,
        request.body,
        request.key,
      );
      if (!mounted.current) return false;
      if (
        !result ||
        !["command_id", "resource_id", "resource_url"].every(
          (key) =>
            typeof result[key as keyof Accepted] === "string" &&
            result[key as keyof Accepted],
        )
      )
        throw new ApiError(
          "invalid_response",
          "Instruction acknowledgement is invalid; outcome uncertain.",
          null,
          null,
          true,
        );
      update((old) => {
        const changes = { ...old.changes };
        if (request.body.operation === "remove_change")
          for (const item of workspace.proposals.variants)
            for (const change of item.changes)
              if (request.body.target_ids.includes(change.change_id))
                delete changes[changeKey(item.variant_id, change.change_id)];
        const variants = { ...old.variants };
        if (request.body.operation === "add_change")
          for (const id of request.body.target_ids) {
            const draft = own(variants, id);
            if (draft && draft.idea === request.body.changed_fields.after)
              variants[id] = { ...draft, idea: "" };
          }
        return {
          ...old,
          changes,
          variants,
          command: null,
          accepted: { result, request },
          staleBaseVersion: null,
        };
      });
      try {
        await onRefresh();
      } catch (cause) {
        if (mounted.current) {
          setError(message(cause));
          setRefreshFailed(true);
        }
      }
      return true;
    } catch (cause) {
      if (!mounted.current) return false;
      setError(message(cause));
      if (
        cause instanceof ApiError &&
        ["stale_version", "stale_proposal"].includes(cause.code)
      ) {
        setError(
          `${message(cause)} Your draft is retained; refresh current proposals before reconciling.`,
        );
        update((old) => ({
          ...old,
          command: null,
          staleBaseVersion: request.body.base_proposal_set_version,
        }));
        try {
          await onRefresh();
        } catch (failure) {
          if (mounted.current) {
            setError(`${message(cause)} · ${message(failure)}`);
            setRefreshFailed(true);
          }
        }
      } else if (
        cause instanceof ApiError &&
        cause.status !== null &&
        cause.status < 500 &&
        !cause.retryable
      ) {
        update((old) => ({ ...old, command: null }));
      }
      return false;
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  const variantStale =
    variantDraft.baseVersion !== version ||
    !!variantDraft.needsReview ||
    staleRejected;
  const groupingStale =
    variantDraft.groupBaseVersion !== version || staleRejected;
  const presentChanges = new Set(
    workspace.proposals.variants.flatMap((v) =>
      v.changes.map((c) => changeKey(v.variant_id, c.change_id)),
    ),
  );
  const removedChanges = Object.entries(state.changes).filter(
    ([key]) => !presentChanges.has(key),
  );
  const removedVariants = Object.entries(state.variants).filter(
    ([id]) => !workspace.proposals.variants.some((v) => v.variant_id === id),
  );
  const unknownCohorts = variantDraft.cohorts.filter(
    (id) => !cohorts.includes(id),
  );
  useEffect(() => {
    if (
      focusedChange.current &&
      !variant?.changes.some(
        (change) =>
          changeKey(variantId, change.change_id) === focusedChange.current,
      )
    ) {
      heading.current?.focus();
      focusedChange.current = null;
    }
  }, [workspace.proposals, variantId, variant]);
  return (
    <section aria-label="Proposal editing">
      <div className="section-title">
        <h2 ref={heading} tabIndex={-1}>
          Proposals / version {version}
        </h2>
      </div>
      <p className="muted">
        PM selection is an alternative to inspect. Proposal decision state,
        approval, rendering and target validation are separate backend states.
      </p>
      <label className="stacked-label">
        Variant
        <select
          value={variant?.variant_id ?? ""}
          onChange={(event) => onVariantChange(event.target.value)}
        >
          {!variant && <option value="">Select an available variant</option>}
          {workspace.proposals.variants.map((v) => (
            <option key={v.variant_id} value={v.variant_id}>
              {v.title}
            </option>
          ))}
        </select>
      </label>
      {workspace.proposals.unresolved_conflicts.map((id) => (
        <p className="notice" key={id}>
          Unresolved conflict: {id}
        </p>
      ))}
      {pending && (
        <p role="status">
          {state.command
            ? "Submitting version-bound instruction…"
            : "Refreshing proposals…"}
        </p>
      )}
      {accepted && (
        <div className="notice">
          <p role="status">
            Instruction accepted: {accepted.result.command_id}. Resource:{" "}
            {accepted.result.resource_id}.
          </p>
          <p className="muted">
            Backend resource reference: {accepted.result.resource_url}
          </p>
          {recomputed ? (
            <p role="status">
              Backend returned proposal version {version}. Review recomputed
              results; retained drafts still require exact-version
              reconciliation.
            </p>
          ) : (
            <p role="status">
              Waiting for backend recomputation after proposal version{" "}
              {accepted.request.body.base_proposal_set_version}. Current version{" "}
              {version} / {workspace.snapshot.analysis_status}.
            </p>
          )}
          {waiting && workspace.snapshot.analysis_status === "failed" && (
            <p role="alert">
              Backend recomputation failed. Draft retained; refresh retrieves
              authoritative status.
            </p>
          )}
          <button disabled={pending || !!busy} onClick={() => void refresh()}>
            Refresh proposals
          </button>
        </div>
      )}
      {state.command && !pending && (
        <div className="notice">
          <p>
            Instruction outcome uncertain. Drafts frozen; retry uses the same
            request and idempotency key.
          </p>
          <button
            disabled={!!busy}
            onClick={() => void submit(state.command!.body, true)}
          >
            Retry same instruction
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!accepted && (refreshFailed || staleRejected) && (
        <button disabled={pending || !!busy} onClick={() => void refresh()}>
          Refresh proposals
        </button>
      )}
      {!!removedChanges.length && (
        <section aria-label="Retained unavailable change drafts">
          {removedChanges.map(([key, draft]) => (
            <article className="notice" key={key}>
              <h3>Retained draft for unavailable change {key}</h3>
              <p>
                Draft version {draft.baseVersion}. Original identity cannot be
                edited in current proposal set.
              </p>
              <p>{draft.text}</p>
              <p>Draft target: {draft.target || "Empty"}</p>
            </article>
          ))}
        </section>
      )}
      {!!removedVariants.length && (
        <section aria-label="Retained unavailable variant drafts">
          {removedVariants.map(([id, draft]) => (
            <article className="notice" key={id}>
              <h3>Retained draft for unavailable variant {id}</h3>
              <p>
                PM idea version {draft.baseVersion}: {draft.idea || "Empty"}
              </p>
              <p>
                Grouping version {draft.groupBaseVersion}:{" "}
                {draft.cohorts.join(", ") || "No cohorts assigned"}
              </p>
            </article>
          ))}
        </section>
      )}
      {!canEdit && (
        <p>
          Editing unavailable in current backend state. Drafts remain available.
        </p>
      )}
      {!variant ? (
        <p>
          Selected variant unavailable in current proposal version. Choose a
          current variant; drafts retain their original identities.
        </p>
      ) : (
        <>
          <p>
            <strong>Scope:</strong>{" "}
            {variant.cohort_scope.join(", ") || "No cohorts supplied"}
          </p>
          {variant.assumptions.map((text) => (
            <p className="muted" key={text}>
              {text}
            </p>
          ))}
          <details>
            <summary>Regroup variant scope</summary>
            <div className="scope-editor">
              <fieldset disabled={inputsLocked}>
                <legend>Cohort scope</legend>
                {cohorts.map((id) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={variantDraft.cohorts.includes(id)}
                      onChange={(event) =>
                        setVariant({
                          cohorts: event.target.checked
                            ? [...variantDraft.cohorts, id]
                            : variantDraft.cohorts.filter(
                                (cohort) => cohort !== id,
                              ),
                        })
                      }
                    />
                    {id}
                  </label>
                ))}
              </fieldset>
              <p className="muted">
                Only backend cohort identities can be assigned. Empty selection
                clears scope; overlapping cohorts are not additive counts.
              </p>
              {!!unknownCohorts.length && (
                <p role="alert">
                  Draft cohorts unavailable in current results:{" "}
                  {unknownCohorts.join(", ")}. Explicit reconciliation removes
                  unavailable assignments.
                </p>
              )}
              {groupingStale && (
                <div className="notice">
                  <p>
                    Grouping draft based on version{" "}
                    {variantDraft.groupBaseVersion}; current version {version}.
                  </p>
                  <button
                    disabled={inputsLocked || staleRejected}
                    onClick={() =>
                      setVariant({
                        groupBaseVersion: version,
                        cohorts: variantDraft.cohorts.filter((id) =>
                          cohorts.includes(id),
                        ),
                        needsReview: false,
                      })
                    }
                  >
                    Use current version with my grouping
                  </button>
                </div>
              )}
              <button
                disabled={
                  inputsLocked ||
                  !canEdit ||
                  groupingStale ||
                  !!unknownCohorts.length
                }
                onClick={() =>
                  void submit({
                    operation: "regroup_variants",
                    base_proposal_set_version: variantDraft.groupBaseVersion,
                    target_ids: [variantId],
                    changed_fields: { cohort_ids: variantDraft.cohorts },
                  })
                }
              >
                <Save size={15} />
                Save grouping
              </button>
            </div>
          </details>
          {!variant.changes.length && (
            <p>No changes supplied for this variant.</p>
          )}
          {variant.changes.map((change, index) => {
            const draft = editDraft(change);
            const stale = draft.baseVersion !== version || staleRejected;
            const validTarget =
              draft.target.trim() === "" ||
              Number.isFinite(Number(draft.target));
            const evidenceKey = changeKey(variantId, change.change_id);
            const showEvidence = !hiddenEvidence.has(evidenceKey);
            return (
              <article
                className="proposal-item"
                key={change.change_id}
                aria-label={`Change ${change.change_id}`}
                onFocusCapture={() => {
                  focusedChange.current = changeKey(
                    variantId,
                    change.change_id,
                  );
                }}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    focusedChange.current = null;
                }}
              >
                <h3>
                  <span className="change-number">{index + 1}</span>
                  {change.origin === "pm" ? "PM idea" : "AI proposal"}
                </h3>
                <p className="muted">
                  Change {change.change_id} / proposal version {version}.
                  Decision state: {change.decision_state}. Target maturity:{" "}
                  {change.target_maturity}.
                </p>
                <div
                  className={`proposal-review${showEvidence ? "" : " is-evidence-hidden"}`}
                >
                  <div className="proposal-editor">
                    <p>
                      <strong>Before:</strong> {change.before || "Not supplied"}
                    </p>
                    <p>{change.rationale}</p>
                    <label className="stacked-label">
                      Proposal text
                      <textarea
                        value={draft.text}
                        disabled={inputsLocked}
                        onChange={(event) =>
                          setEdit(change, { text: event.target.value })
                        }
                      />
                    </label>
                    <label className="stacked-label">
                      Target
                      <input
                        inputMode="decimal"
                        value={draft.target}
                        aria-invalid={!validTarget}
                        disabled={inputsLocked}
                        onChange={(event) =>
                          setEdit(change, { target: event.target.value })
                        }
                      />
                    </label>
                    {!validTarget && (
                      <p role="alert">
                        Target must be a finite number or empty to clear.
                      </p>
                    )}
                    {change.wire && (
                      <p className="muted">
                        Metric: {change.wire.metric ?? "Unknown"} / unit:{" "}
                        {change.wire.unit ?? "Unknown"} / target basis:{" "}
                        {change.wire.target_basis ?? "Unknown"}. Validation:{" "}
                        {change.wire.validation_method}
                      </p>
                    )}
                    {change.assumptions.map((text) => (
                      <p className="muted" key={text}>
                        {text}
                      </p>
                    ))}
                    {stale && (
                      <div className="notice">
                        <strong>
                          Draft based on version {draft.baseVersion}; current
                          version {version}.
                        </strong>
                        <p>Current proposal: {change.after}</p>
                        <p>Current target: {change.target || "Not supplied"}</p>
                        <button
                          disabled={inputsLocked || staleRejected}
                          onClick={() =>
                            setEdit(change, { baseVersion: version })
                          }
                        >
                          <RefreshCw size={15} />
                          Use current version with my draft
                        </button>
                      </div>
                    )}
                    <div className="action-row">
                      <button
                        disabled={
                          inputsLocked ||
                          !canEdit ||
                          stale ||
                          !draft.text.trim()
                        }
                        onClick={() =>
                          void submit({
                            operation: "edit_change",
                            base_proposal_set_version: draft.baseVersion,
                            target_ids: [change.change_id],
                            changed_fields: { after: draft.text },
                          })
                        }
                      >
                        <Save size={15} />
                        Save edit
                      </button>
                      <button
                        disabled={
                          inputsLocked || !canEdit || stale || !validTarget
                        }
                        onClick={() =>
                          void submit({
                            operation: "edit_target",
                            base_proposal_set_version: draft.baseVersion,
                            target_ids: [change.change_id],
                            changed_fields: {
                              target:
                                draft.target.trim() === ""
                                  ? null
                                  : Number(draft.target),
                            },
                          })
                        }
                      >
                        <Save size={15} />
                        Save target
                      </button>
                      <button
                        aria-expanded={showEvidence}
                        aria-controls={`proposal-evidence-${encodeURIComponent(evidenceKey)}`}
                        onClick={() =>
                          setHiddenEvidence((old) => {
                            const next = new Set(old);
                            if (next.has(evidenceKey)) next.delete(evidenceKey);
                            else next.add(evidenceKey);
                            return next;
                          })
                        }
                      >
                        <BookOpen size={15} />
                        {showEvidence ? "Hide evidence" : "View evidence"}
                      </button>
                      <button onClick={() => onEvidence(change)}>
                        Inspect finding evidence
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Remove change ${index + 1}`}
                        title="Remove change"
                        disabled={inputsLocked || !canEdit || stale}
                        onClick={() =>
                          setRemoval({
                            changeId: change.change_id,
                            variantId,
                            baseVersion: draft.baseVersion,
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <section
                    id={`proposal-evidence-${encodeURIComponent(evidenceKey)}`}
                    className="proposal-evidence"
                    aria-label={`Evidence for proposal ${index + 1}`}
                    hidden={!showEvidence}
                  >
                    <h3>Evidence</h3>
                    <ProposalEvidence
                      api={api}
                      workspace={workspace}
                      change={change}
                      onOpen={props.onOpen ?? (() => onEvidence(change))}
                    />
                  </section>
                </div>
              </article>
            );
          })}
          <section className="add-proposal">
            <h3>Add PM idea</h3>
            <label className="stacked-label">
              PM instruction
              <textarea
                value={variantDraft.idea}
                disabled={inputsLocked}
                onChange={(event) => setVariant({ idea: event.target.value })}
              />
            </label>
            {variantDraft.needsReview && (
              <p className="notice">
                Legacy PM draft needs explicit review of current variant and
                version before submission.
              </p>
            )}
            {variantStale && (
              <div className="notice">
                <p>
                  PM idea draft based on version {variantDraft.baseVersion};
                  current version {version}.
                </p>
                <button
                  disabled={inputsLocked || staleRejected}
                  onClick={() =>
                    setVariant({ baseVersion: version, needsReview: false })
                  }
                >
                  Use current version with my PM idea
                </button>
              </div>
            )}
            <button
              disabled={
                inputsLocked ||
                !canEdit ||
                variantStale ||
                !variantDraft.idea.trim()
              }
              onClick={() =>
                void submit({
                  operation: "add_change",
                  base_proposal_set_version: variantDraft.baseVersion,
                  target_ids: [variantId],
                  changed_fields: { after: variantDraft.idea },
                })
              }
            >
              <Plus size={16} />
              Add proposal
            </button>
          </section>
        </>
      )}
      {removal && (
        <RemovalConfirmation
          disabled={
            inputsLocked ||
            !canEdit ||
            removal.baseVersion !== version ||
            staleRejected ||
            !workspace.proposals.variants
              .find((item) => item.variant_id === removal.variantId)
              ?.changes.some((change) => change.change_id === removal.changeId)
          }
          fallbackFocus={() => heading.current?.focus()}
          onCancel={() => setRemoval(null)}
          onConfirm={async () => {
            const saved = await submit({
              operation: "remove_change",
              base_proposal_set_version: removal.baseVersion,
              target_ids: [removal.changeId],
              changed_fields: {},
            });
            if (saved && mounted.current) setRemoval(null);
            return saved;
          }}
        />
      )}
    </section>
  );
}
function ProposalEvidence({
  api,
  workspace,
  change,
  onOpen,
}: {
  api: Api;
  workspace: Workspace;
  change: Change;
  onOpen: (evidence: Evidence) => void;
}) {
  const ids = change.wire?.finding_ids ?? [change.finding_id];
  const findings = workspace.findings.filter((finding) =>
    ids.includes(finding.finding_id),
  );
  const supporting =
    change.wire?.supporting_evidence_ids ?? change.evidence_ids;
  const opposing = change.wire?.opposing_evidence_ids ?? [];
  if (change.origin === "pm" && !supporting.length && !opposing.length)
    return <p className="muted">No evidence linked to this PM idea.</p>;
  return (
    <>
      {!findings.length && (
        <p className="muted">No customer finding linked to this proposal.</p>
      )}
      {findings.map((finding) => (
        <div key={finding.finding_id}>
          <h4>{finding.title}</h4>
          <p>{finding.customer_need}</p>
          <p>
            <strong>
              {finding.counts.negative_records} of{" "}
              {finding.counts.total_records} negative feedback records
            </strong>
            {finding.provisional ? " / provisional" : ""}
            {finding.counts.low_evidence ? " / low evidence" : ""}
          </p>
          <p className="muted">
            {finding.cohort_ids.join(", ")} · {finding.coverage}
          </p>
          <p className="muted">{finding.applicability}</p>
        </div>
      ))}
      <EvidenceList
        api={api}
        runId={workspace.snapshot.run_id}
        ids={supporting}
        title="Supporting observations"
        onOpen={onOpen}
      />
      <EvidenceList
        api={api}
        runId={workspace.snapshot.run_id}
        ids={opposing}
        title="Opposing observations"
        onOpen={onOpen}
      />
    </>
  );
}
function RemovalConfirmation({
  disabled,
  onCancel,
  onConfirm,
  fallbackFocus,
}: {
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<boolean>;
  fallbackFocus: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    mounted.current = true;
    if (dialog?.showModal) dialog.showModal();
    else dialog?.setAttribute("open", "");
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      mounted.current = false;
      if (dialog?.open && typeof dialog.close === "function") dialog.close();
      if (opener?.isConnected && !opener.matches(":disabled")) opener.focus();
      else queueMicrotask(fallbackFocus);
    };
  }, []);
  const cancel = () => {
    if (!lock.current) onCancel();
  };
  return (
    <dialog
      ref={ref}
      aria-label="Remove proposal?"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <h2>Remove proposal?</h2>
      <p>
        This removes this proposal from every variant that references it, including its
        unsaved edits. Removal cannot be undone here. Customer evidence stays
        unchanged.
      </p>
      {failed && (
        <p role="alert">
          Removal failed. Proposal and draft kept. Close this dialog to review
          the error, then retry.
        </p>
      )}
      <div className="action-row">
        <button disabled={pending} onClick={cancel}>
          Keep working
        </button>
        <button
          className="primary"
          disabled={disabled || pending}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setPending(true);
            setFailed(false);
            try {
              const saved = await onConfirm();
              if (mounted.current && !saved) setFailed(true);
            } finally {
              lock.current = false;
              if (mounted.current) setPending(false);
            }
          }}
        >
          {pending ? "Working…" : "Remove proposal"}
        </button>
      </div>
    </dialog>
  );
}
