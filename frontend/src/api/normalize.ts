import type * as Wire from "./wire";
import type * as View from "./contracts";
import type { ComponentId } from "../domain/contracts";

export const scopeLabel = (scope: Wire.Scope): string =>
  [
    ...(scope.vehicle_ids ?? []),
    ...(scope.markets ?? []),
    ...(scope.cohort_ids ?? []),
    scope.year == null ? "" : String(scope.year),
    scope.software ?? "",
    ...(scope.equipment ?? []),
  ]
    .filter(Boolean)
    .join(" · ") || "Scope unspecified";
export function vehicle(wire: Wire.Vehicle): View.Vehicle {
  const labels: Record<string, string> = {
    "g60-i5-m60": "BMW i5 M60 / G60",
    f70: "BMW 1 Series / F70",
    g68: "BMW 5 Series / G68",
    g70: "BMW 7 Series / G70",
  };
  return {
    wire,
    vehicle_id: wire.vehicle_id,
    title: labels[wire.vehicle_id] ?? wire.vehicle_id,
    baseline_asset_id: wire.baseline_asset_ids[0] ?? null,
    part_catalog_version: wire.part_catalog_versions[0] ?? null,
    capabilities: wire.capabilities,
  };
}
export function snapshot(wire: Wire.Snapshot): View.Snapshot {
  return {
    ...wire,
    wire,
    contract_version: wire.contract_version ?? "1",
    config: {
      ...wire.config,
      market_context: wire.config.market_context ?? [],
      participation_mode: wire.config.participation_mode ?? "autonomous",
      deep_dive: { enabled: wire.config.deep_dive?.enabled ?? false },
    },
    part_aggregates: [],
  };
}
export function finding(wire: Wire.Finding): View.Finding {
  return {
    ...wire,
    wire,
    part_ids: wire.part_ids as ComponentId[],
    coverage: wire.coverage.join(" · "),
    baseline: "Baseline not provided for this finding.",
    applicability: "See evidence scope and applicability.",
    counts: {
      ...wire.counts,
      negative_share: wire.counts.negative_share ?? null,
    },
  };
}
export function evidence(wire: Wire.Evidence): View.Evidence {
  const loc = wire.locator;
  const label =
    "sheet" in loc
      ? `${loc.sheet}, row ${loc.row}, cells ${loc.cells.join(", ")}`
      : "page" in loc
        ? `Page ${loc.page}${loc.section ? `, ${loc.section}` : ""}${loc.bbox ? `, bounding box ${loc.bbox.join(", ")}` : ""}`
        : `${loc.url}, passage ${loc.passage_start}–${loc.passage_end}`;
  return {
    ...wire,
    wire,
    source_kind: wire.source_kind === "external" ? "external" : "uploaded",
    locator: {
      type:
        loc.type ?? ("sheet" in loc ? "cell" : "page" in loc ? "pdf" : "web"),
      label,
    },
    scope: scopeLabel(wire.scope),
    limitations: (wire.limitations ?? []).join(" · "),
    source_url: wire.source_url ?? null,
  };
}
export function research(wire: Wire.Research): View.Research {
  return {
    ...wire,
    wire,
    competitor_scope: scopeLabel(wire.competitor_scope),
    recommendation: wire.recommendation ?? "No recommendation available.",
    counterevidence: wire.counterevidence_ids,
    as_of: "Date not supplied by research contract",
  };
}
export function change(wire: Wire.Change): View.Change {
  return {
    ...wire,
    wire,
    finding_id: wire.finding_ids[0] ?? "",
    part_ids: wire.part_ids as ComponentId[],
    before: wire.before ?? "Baseline not supplied",
    rationale: wire.outcome,
    evidence_ids: [
      ...new Set([
        ...wire.supporting_evidence_ids,
        ...wire.opposing_evidence_ids,
      ]),
    ],
    target: wire.target == null ? "" : String(wire.target),
    assumptions: wire.uncertainty,
    decision_state: wire.decision_state ?? "proposed",
  };
}
export function proposals(wire: Wire.Proposals): View.ProposalSet {
  const changes = new Map(wire.changes.map((c) => [c.change_id, change(c)]));
  return {
    ...wire,
    wire,
    unresolved_conflicts: wire.unresolved_conflict_ids,
    variants: wire.variants.map((v) => ({
      ...v,
      wire: v,
      cohort_scope: v.cohort_ids,
      changes: v.change_ids.map((id) => {
        const found = changes.get(id);
        if (!found) throw new Error(`Proposal references missing change ${id}`);
        return found;
      }),
    })),
  };
}
export function graph(wire: Wire.Graph): View.Graph {
  const findingIds = new Set(
    wire.nodes.filter((n) => n.entity_type === "finding").map((n) => n.id),
  );
  const associations = new Map<string, Set<string>>();
  // Only direct documented edges to finding nodes establish a navigation association.
  for (const e of wire.edges) {
    if (findingIds.has(e.from_id)) {
      const ids = associations.get(e.to_id) ?? new Set();
      ids.add(e.from_id);
      associations.set(e.to_id, ids);
    }
    if (findingIds.has(e.to_id)) {
      const ids = associations.get(e.from_id) ?? new Set();
      ids.add(e.to_id);
      associations.set(e.from_id, ids);
    }
  }
  return {
    wire,
    revision: wire.revision,
    next_cursor: wire.next_cursor ?? null,
    nodes: wire.nodes.map((n) => ({
      node_id: n.id,
      entity_type: n.entity_type,
      label: n.id,
      finding_id: findingIds.has(n.id)
        ? n.id
        : associations.get(n.id)?.size === 1
          ? [...associations.get(n.id)!][0]
          : "",
    })),
    edges: wire.edges.map((e) => ({
      ...e,
      provenance: e.evidence_ids.join(", "),
    })),
  };
}
export function checkpoint(wire: Wire.Conflicts): View.Checkpoint | null {
  const cp = wire.checkpoints.find((c) => c.wait_state === "waiting");
  if (!cp) return null;
  const conflicts = wire.conflicts.filter((c) =>
    cp.conflict_ids.includes(c.conflict_id),
  );
  return {
    wire: cp,
    conflicts,
    checkpoint_id: cp.checkpoint_id,
    version: cp.version,
    question:
      conflicts.map((c) => c.rationale).join(" · ") ||
      "Checkpoint requires a resolution.",
    alternatives: cp.allowed_actions.map((id) => ({
      id,
      title: id,
      tradeoff: conflicts.map((c) => c.rationale).join(" · "),
    })),
  };
}
export function audit(wire: Wire.Audit): View.AuditEntry {
  return {
    wire,
    event_id: wire.audit_id,
    occurred_at: wire.occurred_at,
    actor: wire.actor_type,
    description: wire.rationale
      ? `${wire.action}: ${wire.rationale}`
      : wire.action,
    proposal_set_version: wire.proposal_set_version ?? null,
  };
}
export function render(wire: Wire.RenderResult): View.RenderResult {
  return {
    ...wire,
    wire,
    assets: wire.assets.map((a) => ({
      ...a,
      variant_id: wire.variant_ids.length === 1 ? wire.variant_ids[0] : "",
    })),
    outcomes: wire.outcomes.map((o) => ({
      ...o,
      status: o.outcome,
      reason: o.reason ?? "",
    })),
  };
}
export function instruction(
  view: View.Instruction | Wire.Instruction,
): Wire.Instruction {
  if ("changed_fields" in view) return view;
  const { target, cohort_scope, ...fields } = view.fields;
  const changed_fields: Wire.Instruction["changed_fields"] = {
    ...fields,
    ...(cohort_scope ? { cohort_ids: cohort_scope } : {}),
  };
  if (target !== undefined) {
    if (target.trim() === "") changed_fields.target = null;
    else if (!Number.isFinite(Number(target)))
      throw new Error("Target must be a finite number or empty.");
    else changed_fields.target = Number(target);
  }
  return {
    operation: view.operation,
    base_proposal_set_version: view.base_proposal_set_version,
    target_ids: view.change_id
      ? [view.variant_id, view.change_id]
      : [view.variant_id],
    changed_fields,
  };
}
