import type { Change, Finding, Snapshot } from "../api/contracts";

export default function FindingDetails({ finding: f, aggregates = [], changes = [] }: {
  finding: Finding;
  aggregates?: Snapshot["part_aggregates"];
  changes?: Change[];
}) {
  const parts = aggregates.filter(a => f.part_ids.includes(a.part_id));
  const linkedChanges = [...new Map(changes.filter(c => (c.wire?.finding_ids ?? [c.finding_id]).includes(f.finding_id)).map(c => [c.change_id, c])).values()];
  const uncertainty = [...new Set(linkedChanges.flatMap(c => c.wire?.uncertainty ?? c.assumptions))];
  return <section className="finding-detail">
    <h2>{f.title}</h2>
    <p>{f.customer_need}</p>
    <p><strong>{f.counts.negative_records} of {f.counts.total_records} negative feedback records</strong> / {f.counts.negative_share == null ? "Unknown share" : `${(f.counts.negative_share * 100).toLocaleString()}% negative`}</p>
    {f.counts.total_records === 0 && <p className="muted">No feedback records in supplied denominator.</p>}
    <div className="tag-row">
      {f.provisional && <span className="status">Provisional</span>}
      {f.counts.low_evidence && <span className="status">Low evidence</span>}
      <span>Cohorts: {f.cohort_ids.join(", ") || "Not supplied"}</span>
    </div>
    <dl>
      <dt>Finding identity</dt><dd>{f.finding_id} / revision {f.revision}</dd>
      <dt>Parts</dt><dd>{f.part_ids.join(", ") || "Vehicle-wide or unmapped"}</dd>
      <dt>Coverage</dt><dd>{f.coverage || "Coverage not supplied"}</dd>
      <dt>Baseline</dt><dd>{f.baseline}</dd>
      <dt>Applicability</dt><dd>{f.applicability}</dd>
    </dl>
    {parts.map(a => <p className="muted" key={JSON.stringify([a.part_id, a.wire?.cohort_ids ?? [], a.counts.intensity_scale_id])}>
      Part {a.part_id} / Cohorts: {a.wire?.cohort_ids.join(", ") || "Not supplied"}: {a.counts.negative_records} of {a.counts.total_records} negative feedback records; {a.counts.provisional ? "provisional" : "finalized"}{a.counts.low_evidence ? " / Low evidence" : ""}. Intensity {a.counts.intensity_value} on server scale {a.counts.intensity_scale_id}.
    </p>)}
    {linkedChanges.map(c => <p key={c.change_id}>Proposed requirement: {c.after}. Target maturity: {c.target_maturity}.</p>)}
    <h3>Uncertainty</h3>
    {uncertainty.length ? <ul>{uncertainty.map(text => <li key={text}>{text}</li>)}</ul> : <p className="muted">No additional uncertainty supplied. Absence of a gap does not establish validation.</p>}
  </section>;
}
