import { useEffect, useRef, useState } from "react";
import type {
  Api,
  Change,
  Evidence,
  Finding,
  Workspace,
} from "../api/contracts";
import {
  readDecision,
  saveDecision,
  type DecisionCommand,
} from "./decisionCommands";
import EvidenceList from "./EvidenceList";
import { ApiError, commandKey } from "../api/client";

export const partLabel = (id: string) =>
  ({
    seats: "Seats",
    charging: "Charging",
    dashboard: "Dashboard",
    body: "Body",
    lighting: "Lighting",
    steering: "Steering",
  })[id] ?? id;
export function feedbackColor(share: number | null) {
  return share === null
    ? "#a7adb4"
    : `hsl(0 62% ${Math.max(25, 88 - share * 100)}%)`;
}
export function FeedbackRing({ finding }: { finding: Finding }) {
  const c = finding.counts,
    share = c.negative_share;
  return (
    <div className="review-chart">
      <svg
        viewBox="0 0 160 160"
        role="img"
        aria-label={`${c.negative_records} of ${c.total_records} negative feedback records`}
      >
        <circle
          cx="80"
          cy="80"
          r="62"
          fill="none"
          stroke="#edf0f2"
          strokeWidth="13"
        />
        {share !== null && (
          <circle
            cx="80"
            cy="80"
            r="62"
            fill="none"
            stroke={feedbackColor(share)}
            strokeWidth="13"
            pathLength="100"
            strokeDasharray={`${share * 100} ${100 - share * 100}`}
            transform="rotate(-90 80 80)"
          />
        )}
        <text x="80" y="80" textAnchor="middle" fontSize="29" fontWeight="650">
          {share === null ? "—" : `${Math.round(share * 100)}%`}
        </text>
        <text x="80" y="101" textAnchor="middle" fontSize="12">
          negative
        </text>
      </svg>
      <div className="chart-key">
        <span>
          <i style={{ background: feedbackColor(share) }} />
          <b>{c.negative_records}</b> negative
        </span>
        <span>
          <i />
          <b>{c.total_records - c.negative_records}</b> other feedback
        </span>
        <small>
          {c.total_records} records{finding.provisional ? " · Provisional" : ""}
        </small>
      </div>
    </div>
  );
}
export function FeedbackOverview({
  findings,
  onReview,
  selectedId,
}: {
  findings: Finding[];
  selectedId?: string | null;
  onReview: (f: Finding) => void;
}) {
  return (
    <section aria-label="Customer feedback">
      <h2>Customer feedback</h2>
      <p className="chart-caption">Negative feedback by finding</p>
      <div className="bar-axis">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
      {findings.map((f) => (
        <button
          key={f.finding_id}
          className="feedback-chart-row"
          aria-pressed={selectedId === f.finding_id}
          aria-label={`${f.title}: ${f.counts.negative_records} of ${f.counts.total_records} negative feedback records`}
          onClick={() => onReview(f)}
        >
          <span className="chart-row-title">
            <strong>{f.title}</strong>
            <b>
              {f.counts.negative_share === null
                ? "—"
                : `${Math.round(f.counts.negative_share * 100)}%`}
            </b>
          </span>
          <span className="wide-meter">
            <span
              style={{
                width: `${(f.counts.negative_share ?? 0) * 100}%`,
                background: feedbackColor(f.counts.negative_share),
              }}
            />
          </span>
          <span className="chart-row-meta">
            {f.counts.negative_records} / {f.counts.total_records} records
            {f.provisional ? " · Provisional" : ""}
            <span>↗</span>
          </span>
        </button>
      ))}
      <small className="chart-footnote">
        Records may appear under more than one finding.
      </small>
    </section>
  );
}
export function EvidenceOverview({
  api,
  workspace,
  onOpen,
  selectedId,
}: {
  api: Api;
  workspace: Workspace;
  selectedId?: string | null;
  onOpen: (e: Evidence) => void;
}) {
  const [selection, setSelection] = useState<{
    id: string;
    side: "support" | "opposition";
  } | null>(null);
  useEffect(
    () => setSelection(selectedId ? { id: selectedId, side: "support" } : null),
    [selectedId],
  );
  const requested = selection?.id ?? selectedId;
  const selected = requested
    ? workspace.findings.find((f) => f.finding_id === requested)
    : workspace.findings[0];
  const side = selection?.side ?? "support";
  return (
    <section>
      <h2>Evidence</h2>
      {requested && !selected && (
        <p role="status">
          Selected finding is unavailable in this snapshot. Return to Customer
          feedback or reconnect.
        </p>
      )}
      <p className="chart-caption">Each finding, both sides</p>
      <div className="matrix-head">
        <span />
        <span>Supporting</span>
        <span>Counterpoint</span>
      </div>
      {workspace.findings.map((f) => (
        <div className="matrix-row" key={f.finding_id}>
          <strong>{f.part_ids.map(partLabel).join(", ") || f.title}</strong>
          {(["support", "opposition"] as const).map((s) => {
            const ids =
              s === "support"
                ? f.supporting_evidence_ids
                : f.opposing_evidence_ids;
            return (
              <button
                className={`evidence-node ${s}`}
                key={s}
                disabled={!ids.length}
                aria-label={`${f.title}: ${ids.length} ${s === "support" ? "supporting" : "opposing"} excerpts`}
                aria-pressed={
                  selected?.finding_id === f.finding_id && side === s
                }
                onClick={() => setSelection({ id: f.finding_id, side: s })}
              >
                {new Set(ids).size}
              </button>
            );
          })}
        </div>
      ))}
      {selected && (
        <div className="selected-finding">
          <h3>{selected.title}</h3>
          <FeedbackRing finding={selected} />
          <details>
            <summary>Finding details</summary>
            <p>{selected.customer_need}</p>
            <p>{selected.coverage}</p>
            <p>{selected.part_ids.join(", ")}</p>
          </details>
        </div>
      )}
      {selected && (
        <EvidenceList
          api={api}
          runId={workspace.snapshot.run_id}
          ids={
            side === "support"
              ? selected.supporting_evidence_ids
              : selected.opposing_evidence_ids
          }
          title={
            side === "support"
              ? "Supporting observations"
              : "Opposing observations"
          }
          onOpen={onOpen}
        />
      )}
    </section>
  );
}
export default function WorkshopSummary({
  api,
  workspace,
  variantId,
  onReview,
}: {
  api: Api;
  workspace: Workspace;
  variantId: string;
  onReview: (change: Change) => void;
}) {
  const variant = workspace.proposals.variants.find(
    (v) => v.variant_id === variantId,
  );
  return (
    <section aria-label="Suggestions">
      {!variant?.changes.length && (
        <p className="empty-state">
          {workspace.snapshot.analysis_status === "failed"
            ? "Analysis failed; no suggestions were created."
            : workspace.snapshot.analysis_status === "proposals_ready"
              ? "No suggestions are available for this selection."
              : workspace.snapshot.analysis_status === "waiting_for_pm"
                ? "Analysis is waiting for your input."
                : "Suggestions will appear when analysis completes."}
        </p>
      )}
      {variant?.changes.map((c) => {
        const f = workspace.findings.find((f) =>
          (c.wire?.finding_ids ?? [c.finding_id]).includes(f.finding_id),
        );
        return (
          <article className="suggestion-card" key={c.change_id}>
            <strong className="review-part">
              {c.part_ids.map(partLabel).join(", ") || "Vehicle"}
            </strong>
            <h2>{c.wire?.outcome || f?.title || c.after}</h2>
            {f && (
              <div className="feedback-meter">
                <span className="meter-track">
                  <span
                    style={{
                      width: `${(f.counts.negative_share ?? 0) * 100}%`,
                      background: feedbackColor(f.counts.negative_share),
                    }}
                  />
                </span>
                <span>
                  {f.counts.negative_records}/{f.counts.total_records} negative
                  {f.provisional ? " · Provisional" : ""}
                </span>
              </div>
            )}
            <p>{c.after}</p>
            <div className="card-footer">
              <button onClick={() => onReview(c)}>
                {c.decision_state === "proposed"
                  ? "Review"
                  : `${c.decision_state} · View`}
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
export function SuggestionReview({
  api,
  workspace,
  variantId,
  changeId,
  onClose,
  onRefresh,
  onOpen,
  onEdit,
}: {
  api: Api;
  workspace: Workspace;
  variantId: string;
  changeId: string;
  onClose: () => void;
  onRefresh: () => Promise<Workspace>;
  onOpen: (e: Evidence) => void;
  onEdit: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    lock = useRef(false);
  const version = workspace.proposals.proposal_set_version;
  const storageKey =
    api.mode === "real" && api.sessionNamespace
      ? JSON.stringify([
          "workshop-decision",
          api.sessionNamespace,
          workspace.snapshot.run_id,
          version,
          variantId,
          changeId,
        ])
      : null;
  const command = useRef<DecisionCommand | null>(
    readDecision(storageKey, version, variantId, changeId),
  );
  const [note, setNote] = useState(command.current?.body.rationale ?? ""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [accepted, setAccepted] = useState(false);
  const variant = workspace.proposals.variants.find(
      (v) => v.variant_id === variantId,
    ),
    change = variant?.changes.find((c) => c.change_id === changeId);
  const finding = workspace.findings.find((f) =>
    (change?.wire?.finding_ids ?? [change?.finding_id]).includes(f.finding_id),
  );
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    if (element?.showModal) element.showModal();
    else element?.setAttribute("open", "");
    element?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      if (element?.open && element.close) element.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  async function decide(action: string) {
    if (lock.current || accepted || !change) return;
    if (
      !command.current &&
      (workspace.snapshot.current_proposal_set_version !== version ||
        workspace.snapshot.analysis_status !== "proposals_ready")
    )
      return;
    if (!note.trim() && !command.current) {
      setError("Add a decision note.");
      return;
    }
    if (!command.current)
      command.current = {
        key: commandKey(),
        body: {
          proposal_set_version: version,
          variant_id: variantId,
          change_ids: [changeId],
          action,
          rationale: note.trim(),
        },
      };
    saveDecision(storageKey, command.current);
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const result = await api.request<{ resource_id: string }>(
        `/runs/${encodeURIComponent(workspace.snapshot.run_id)}/decisions`,
        command.current.body,
        command.current.key,
      );
      if (!result.resource_id)
        throw new Error(
          "Decision response unavailable. Retry original decision.",
        );
      setAccepted(true);
      command.current = null;
      saveDecision(storageKey, null);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decision unavailable.");
      if (
        e instanceof ApiError &&
        e.status !== null &&
        e.status < 500 &&
        !e.retryable
      ) {
        command.current = null;
        saveDecision(storageKey, null);
      }
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="suggestion-dialog"
      aria-label="Review suggestion"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending && !command.current) onClose();
      }}
    >
      <button
        className="dialog-close"
        aria-label="Close review"
        disabled={pending || !!command.current}
        onClick={onClose}
      >
        Close
      </button>
      {change ? (
        <>
          <h2>{change.part_ids.map(partLabel).join(", ") || "Vehicle"}</h2>
          {finding && <FeedbackRing finding={finding} />}
          <div className="change-summary">
            <span>Suggested change</span>
            <p>{change.after}</p>
          </div>
          <details>
            <summary>Customer evidence</summary>
            <EvidenceList
              api={api}
              runId={workspace.snapshot.run_id}
              ids={change.wire?.supporting_evidence_ids ?? change.evidence_ids}
              title="Supporting observations"
              onOpen={onOpen}
            />
            <EvidenceList
              api={api}
              runId={workspace.snapshot.run_id}
              ids={change.wire?.opposing_evidence_ids ?? []}
              title="Opposing observations"
              onOpen={onOpen}
            />
            <p>{change.target}</p>
            <p>{change.assumptions.join(" ")}</p>
          </details>
          <button
            className="quiet"
            disabled={pending || !!command.current}
            onClick={onEdit}
          >
            Edit suggestion
          </button>
          <textarea
            aria-label="Decision note"
            placeholder="Decision note"
            value={note}
            disabled={pending || !!command.current || accepted}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p role="alert">{error}</p>}
          {accepted ? (
            <>
              <p role="status">Decision recorded</p>
              {error && (
                <button
                  disabled={pending}
                  onClick={() => {
                    setPending(true);
                    void onRefresh()
                      .then(() => setError(""))
                      .catch((e) =>
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Refresh unavailable.",
                        ),
                      )
                      .finally(() => setPending(false));
                  }}
                >
                  Refresh decision
                </button>
              )}
            </>
          ) : command.current && !pending ? (
            <button onClick={() => void decide(command.current!.body.action)}>
              Retry original decision
            </button>
          ) : (
            <div className="action-row">
              {["approve", "defer", "reject"].map((action) => (
                <button
                  key={action}
                  className={action === "approve" ? "primary" : ""}
                  disabled={
                    pending ||
                    workspace.snapshot.current_proposal_set_version !==
                      version ||
                    workspace.snapshot.analysis_status !== "proposals_ready"
                  }
                  onClick={() => void decide(action)}
                >
                  {action[0].toUpperCase() + action.slice(1)}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <p>Suggestion unavailable in this version.</p>
      )}
    </dialog>
  );
}
