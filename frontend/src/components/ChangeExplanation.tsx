import { useEffect, useState } from "react";
import type {
  Api,
  Evidence,
  Finding,
  ProposalSet,
  Research,
} from "../api/contracts";
import { scopeLabel } from "../api/normalize";
import EvidenceList from "./EvidenceList";
export interface ChangeExplanationProps {
  api: Api;
  runId: string;
  proposals: ProposalSet;
  variantId: string;
  changeId: string;
  onOpen: (e: Evidence) => void;
}
function usePages<T>(
  api: Api,
  path: string,
  identity: string,
  enabled: boolean,
) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    identity: string;
    items: T[];
    loading: boolean;
    error?: string;
  }>({ identity: "", items: [], loading: false });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ identity, items: [], loading: enabled });
    if (enabled)
      void (async () => {
        try {
          const items: T[] = [];
          const seen = new Set<string>();
          let cursor: string | null = null;
          let revision: number | undefined;
          let first = true;
          do {
            const page: {
              items: T[];
              next_cursor?: string | null;
              revision?: number;
            } = await api.request<{
              items: T[];
              next_cursor?: string | null;
              revision?: number;
            }>(
              `${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
              undefined,
              undefined,
              controller.signal,
            );
            if (!active) return;
            if (!first && revision !== page.revision)
              throw new Error("Resource changed during pagination. Retry.");
            revision = page.revision;
            first = false;
            items.push(...page.items);
            cursor = page.next_cursor ?? null;
            if (cursor && seen.has(cursor))
              throw new Error("Repeated resource cursor. Retry.");
            if (cursor) seen.add(cursor);
          } while (cursor);
          if (active) setState({ identity, items, loading: false });
        } catch (error) {
          if (active)
            setState({
              identity,
              items: [],
              loading: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Resource unavailable.",
            });
        }
      })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, path, identity, enabled, attempt]);
  return {
    ...(state.identity === identity
      ? state
      : { identity, items: [], loading: enabled }),
    retry: () => setAttempt((old) => old + 1),
  };
}
export default function ChangeExplanation({
  api,
  runId,
  proposals,
  variantId,
  changeId,
  onOpen,
}: ChangeExplanationProps) {
  const variant = proposals.variants.find((v) => v.variant_id === variantId);
  const change = variant?.changes.find((c) => c.change_id === changeId);
  const valid =
    !!change && (!proposals.wire || proposals.wire.run_id === runId);
  const identity = JSON.stringify([
    runId,
    proposals.proposal_set_version,
    variantId,
    changeId,
  ]);
  const current = usePages<Finding>(
    api,
    `/runs/${encodeURIComponent(runId)}/findings`,
    identity,
    valid,
  );
  const researchIds = proposals.wire?.research_ids ?? [];
  const bundles = usePages<Research>(
    api,
    `/runs/${encodeURIComponent(runId)}/research`,
    identity,
    valid && researchIds.length > 0,
  );
  if (!valid || !change || !variant)
    return (
      <p>
        Exact proposal variant or change unavailable. Identity retained:{" "}
        {proposals.proposal_set_version} / {variantId} / {changeId}.
      </p>
    );
  const wire = change.wire;
  const findingIds = wire?.finding_ids ?? [change.finding_id];
  const matchedFindings = current.items.filter((f) =>
    findingIds.includes(f.finding_id),
  );
  const relatedResearch = bundles.items.filter(
    (r) =>
      researchIds.includes(r.research_id) && findingIds.includes(r.finding_id),
  );
  const supporting = wire?.supporting_evidence_ids ?? change.evidence_ids;
  const opposing = wire?.opposing_evidence_ids ?? [];
  const researchEvidence = [
    ...new Set(
      relatedResearch.flatMap((r) => r.claims.flatMap((c) => c.evidence_ids)),
    ),
  ];
  const counterevidence = [
    ...new Set(
      relatedResearch.flatMap(
        (r) => r.wire?.counterevidence_ids ?? r.counterevidence,
      ),
    ),
  ];
  return (
    <section
      className="evidence-card"
      aria-label={`Change explanation ${change.change_id}`}
    >
      <h3>
        Change {variant.changes.findIndex((c) => c.change_id === changeId) + 1}{" "}
        / {change.change_id}
      </h3>
      <p>
        Proposal version {proposals.proposal_set_version} / variant{" "}
        {variant.variant_id}
      </p>
      <p>
        {change.origin === "pm" ? "PM-originated idea" : "AI proposal"}.
        Decision state: {change.decision_state}. Rendering does not establish
        validation or approval.
      </p>
      <dl>
        <dt>Before</dt>
        <dd>{change.before?.trim() || "Not supplied"}</dd>
        <dt>After</dt>
        <dd>{change.after}</dd>
        <dt>Rationale</dt>
        <dd>{change.rationale}</dd>
        <dt>Part IDs</dt>
        <dd>{change.part_ids.join(", ") || "Vehicle-wide or unmapped"}</dd>
        <dt>Scope</dt>
        <dd>
          {wire
            ? scopeLabel(wire.scope)
            : variant.cohort_scope.join(", ") || "Not supplied"}
        </dd>
        <dt>Requirement ID / change version</dt>
        <dd>
          {wire?.requirement_id ?? "Not supplied"} /{" "}
          {wire?.version ?? "Not supplied"}
        </dd>
        <dt>Metric</dt>
        <dd>{wire?.metric ?? "Not supplied"}</dd>
        <dt>Target / unit</dt>
        <dd>
          {wire?.target ?? (change.target || "Unknown")} /{" "}
          {wire?.unit ?? "Not supplied"}
        </dd>
        <dt>Target basis</dt>
        <dd>{wire?.target_basis ?? "Not supplied"}</dd>
        <dt>Target maturity</dt>
        <dd>{change.target_maturity}</dd>
        <dt>Validation method</dt>
        <dd>{wire?.validation_method ?? "Not supplied"}</dd>
        <dt>Evidence strength</dt>
        <dd>{wire?.evidence_strength ?? "Not supplied"}</dd>
      </dl>
      {!!wire?.preservation_constraints?.length && <>
        <h4>Must preserve</h4>
        <ul>{wire.preservation_constraints.map(text => <li key={text}>{text}</li>)}</ul>
      </>}
      <h4>Conditions and uncertainty</h4>
      <ul>
        {[...new Set([...(wire?.conditions ?? []), ...change.assumptions])].map(
          (text) => (
            <li key={text}>{text}</li>
          ),
        )}
      </ul>
      <p>
        Proposal source versions:{" "}
        {proposals.wire?.source_version_ids.join(", ") || "Not supplied"}
      </p>
      <h4>Current finding counts</h4>
      <p className="muted">
        Counts below come from current finding resources. Historical counts are
        not available through an immutable proposal-version API; they do not
        establish counts at this proposal’s creation.
      </p>
      {current.loading && <p role="status">Loading current finding counts…</p>}
      {current.error && (
        <>
          <p role="alert">{current.error}</p>
          <button onClick={current.retry}>Retry current finding counts</button>
        </>
      )}
      {matchedFindings.map((f) => (
        <p key={f.finding_id}>
          Current finding {f.finding_id}: {f.counts.negative_records} of{" "}
          {f.counts.total_records} negative feedback records /{" "}
          {f.counts.negative_share == null
            ? "Unknown negative share"
            : `${(f.counts.negative_share * 100).toLocaleString()}% negative`}
          {f.provisional ? " / provisional" : ""}. Cohorts:{" "}
          {f.cohort_ids.join(", ") || "Not supplied"}. Coverage:{" "}
          {f.coverage || "Not supplied"}.
        </p>
      ))}
      {!current.loading &&
        !current.error &&
        findingIds
          .filter(
            (id) => id && !matchedFindings.some((f) => f.finding_id === id),
          )
          .map((id) => (
            <p key={id}>
              Current finding {id} unavailable. Proposal explanation remains
              inspectable.
            </p>
          ))}
      <EvidenceList
        api={api}
        runId={runId}
        ids={supporting}
        title="Supporting proposal evidence"
        onOpen={onOpen}
      />
      <EvidenceList
        api={api}
        runId={runId}
        ids={opposing}
        title="Opposing proposal evidence"
        onOpen={onOpen}
      />
      <h4>Current proposal-referenced research</h4>
      <p className="muted">
        Current contents of the research IDs referenced by this proposal.
        Historical research content is not available through an immutable
        proposal-version API; current claims and citations may differ from those
        at proposal creation.
      </p>
      {!researchIds.length && (
        <p>No research bundles referenced by this proposal.</p>
      )}
      {bundles.loading && <p role="status">Loading proposal research…</p>}
      {bundles.error && (
        <>
          <p role="alert">{bundles.error}</p>
          <button onClick={bundles.retry}>Retry proposal research</button>
        </>
      )}
      {relatedResearch.map((r) => (
        <article key={r.research_id}>
          <p>
            {r.research_id} / {r.status} / {r.competitor_scope}
          </p>
          {r.claims.map((claim, index) => (
            <p key={r.wire?.claims[index]?.claim_id ?? index}>
              {claim.type}: {claim.text}
            </p>
          ))}
          {r.gaps.map((gap) => (
            <p key={gap}>{gap}</p>
          ))}
        </article>
      ))}
      <EvidenceList
        api={api}
        runId={runId}
        ids={researchEvidence}
        title="Research citations"
        onOpen={onOpen}
      />
      <EvidenceList
        api={api}
        runId={runId}
        ids={counterevidence}
        title="Research counterevidence"
        onOpen={onOpen}
      />
    </section>
  );
}
