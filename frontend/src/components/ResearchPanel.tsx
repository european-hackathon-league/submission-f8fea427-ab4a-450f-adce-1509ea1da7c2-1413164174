import { useEffect, useRef, useState } from "react";
import type { Api, Evidence, Finding, Research } from "../api/contracts";
import EvidenceList from "./EvidenceList";

const statusMessages: Record<Research["status"], string> = {
  queued: "Research queued. Existing customer findings remain available.",
  searching: "Searching competitor capability and public experience sources.",
  checking: "Checking source support, applicability and counterevidence.",
  ready: "Research ready. Review source scope and limitations before using the recommendation.",
  partial: "Partial research. Useful evidence remains available alongside explicit gaps.",
  unavailable: "Research unavailable. Customer findings and proposals remain usable; research gaps are not analysis failures.",
};
const claimLabels = { fact: "Fact claim", opinion: "Public opinion", inference: "System inference" } as const;

export default function ResearchPanel({ api, runId, finding, bundles, error, onRetry, onOpen }: {
  api: Api;
  runId: string;
  finding: Finding;
  bundles: Research[];
  error?: string;
  onRetry: () => Promise<unknown>;
  onOpen: (evidence: Evidence) => void;
}) {
  const identity = JSON.stringify([runId, finding.finding_id]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const retryLock = useRef(false);
  const generation = useRef(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  useEffect(() => {
    generation.current++;
    retryLock.current = false;
    setRetrying(false);
    setRetryError("");
    return () => { generation.current++; };
  }, [identity]);
  async function retry() {
    if (retryLock.current) return;
    retryLock.current = true;
    const token = generation.current;
    const expectedIdentity = identity;
    setRetrying(true);
    setRetryError("");
    try {
      await onRetry();
    } catch (failure) {
      if (currentIdentity.current === expectedIdentity && generation.current === token)
        setRetryError(failure instanceof Error ? failure.message : "Research retrieval failed. Retry when connection returns.");
    } finally {
      if (currentIdentity.current === expectedIdentity && generation.current === token) {
        retryLock.current = false;
        setRetrying(false);
      }
    }
  }
  const relevant = bundles.filter(bundle => bundle.finding_id === finding.finding_id);
  return <section className="research-section" aria-label="Deep Dive research">
    <h3>Deep Dive</h3>
    <h4>Customer need addressed</h4>
    <p>{finding.customer_need}</p>
    <p className="muted">{finding.counts.negative_records} of {finding.counts.total_records} negative feedback records. Research does not change uploaded-feedback counts.</p>
    {(error || retryError) && <div className="notice">
      <p role="alert">{retryError || error}</p>
      <p>Customer findings remain usable. Retry retrieves the research resource; it does not restart research.</p>
      <button disabled={retrying} onClick={() => void retry()}>Retry research retrieval</button>
      {retrying && <p role="status">Retrying research retrieval…</p>}
    </div>}
    {!relevant.length && <p className="muted">No research bundle available for this finding.</p>}
    {relevant.map(bundle => {
      const scope = bundle.wire?.competitor_scope;
      const claims = bundle.wire?.claims ?? bundle.claims.map(claim => ({ ...claim, claim_id: "", limitations: [] as string[] }));
      const recommendation = bundle.wire ? bundle.wire.recommendation : bundle.recommendation;
      const counterevidence = bundle.wire?.counterevidence_ids ?? bundle.counterevidence;
      return <article key={bundle.research_id} aria-label={`Research ${bundle.research_id}`}>
        <span className="status">{bundle.status}</span>
        <p role="status">{statusMessages[bundle.status]}</p>
        <p className="muted">Research identity: {bundle.research_id} / finding {bundle.finding_id}</p>
        <h4>Competitor research scope</h4>
        {scope ? <dl>
          <dt>Vehicles</dt><dd>{scope.vehicle_ids?.join(", ") || "Not supplied"}</dd>
          <dt>Markets</dt><dd>{scope.markets?.join(", ") || "Not supplied"}</dd>
          <dt>Cohorts</dt><dd>{scope.cohort_ids?.join(", ") || "Not supplied"}</dd>
          <dt>Model year</dt><dd>{scope.year ?? "Unknown"}</dd>
          <dt>Software</dt><dd>{scope.software ?? "Unknown"}</dd>
          <dt>Equipment</dt><dd>{scope.equipment?.join(", ") || "Not supplied"}</dd>
        </dl> : <p>{bundle.competitor_scope}</p>}
        <p className="muted">Research applicability depends on each cited source's scope and limitations; no blanket applicability is supplied.</p>
        <p className="muted">Date not supplied by research contract. Publication, access and research dates remain unknown.</p>
        <h4>Claims and source evidence</h4>
        {!claims.length && <p className="muted">No claims supplied.</p>}
        {claims.map(claim => <article className="evidence-card" key={claim.claim_id || JSON.stringify([claim.type, claim.text, claim.evidence_ids])} aria-label={`${claimLabels[claim.type]} ${claim.claim_id || "identity unavailable"}`}>
          <strong>{claimLabels[claim.type]}</strong>
          <p>{claim.text}</p>
          <p className="muted">Claim identity: {claim.claim_id || "Not supplied"}</p>
          {claim.limitations.length ? <ul aria-label="Claim limitations">{claim.limitations.map(text => <li key={text}>{text}</li>)}</ul> : <p className="muted">No claim limitations supplied; this does not establish applicability or validation.</p>}
          <EvidenceList api={api} runId={runId} ids={claim.evidence_ids} title={`Citations for ${claim.claim_id || "claim"}`} onOpen={onOpen}/>
        </article>)}
        <h4>Recommended improvement</h4>
        <p>{recommendation || "No recommendation supplied."}</p>
        <h4>Alternative approaches</h4>
        {bundle.candidate_approaches.length ? <ul>{bundle.candidate_approaches.map(text => <li key={text}>{text}</li>)}</ul> : <p className="muted">No alternative approaches supplied.</p>}
        <EvidenceList api={api} runId={runId} ids={counterevidence} title="Counterevidence" onOpen={onOpen}/>
        <h4>Research gaps and uncertainty</h4>
        {bundle.gaps.length ? bundle.gaps.map(gap => <p className="notice" key={gap}>{gap}</p>) : <p className="muted">No research gaps supplied. Recommendations still require scoped validation.</p>}
      </article>;
    })}
  </section>;
}
