import type * as Wire from "./wire";
import type { ComponentId, FeedbackCount } from "../domain/contracts";

// UI view models. Exact server payloads are defined in wire.ts.
// Normalizers retain full wire payloads; semantic IDs and numeric counts are never rewritten.
export interface Vehicle {
  wire?: Wire.Vehicle;
  vehicle_id: string;
  title: string;
  baseline_asset_id: string | null;
  part_catalog_version: string | null;
  capabilities: string[];
}
export interface Upload {
  source_id: string;
  filename: string;
  status: "ready" | "rejected";
  reason: string | null;
}
export interface RunConfig {
  vehicle_id: string;
  baseline_asset_id: string;
  part_catalog_version: string;
  source_ids: string[];
  market_context: string[];
  participation_mode: "autonomous" | "guided";
  deep_dive: { enabled: boolean };
}
export interface Snapshot {
  run_id: string;
  contract_version: "1";
  config: RunConfig;
  analysis_status:
    "queued" | "processing" | "waiting_for_pm" | "proposals_ready" | "failed";
  stage: string;
  revision: number;
  last_event_sequence: number;
  current_proposal_set_version: number | null;
  resource_links?: Record<string, string>;
  wire?: Wire.Snapshot;
  available_actions: string[];
  warnings: string[];
  part_aggregates: Array<{
    part_id: ComponentId;
    counts: FeedbackCount;
    wire?: Wire.PartAggregate;
  }>;
}
export interface Finding {
  finding_id: string;
  revision: number;
  title: string;
  customer_need: string;
  part_ids: ComponentId[];
  cohort_ids: string[];
  supporting_evidence_ids: string[];
  opposing_evidence_ids: string[];
  counts: Pick<
    FeedbackCount,
    "negative_records" | "total_records" | "negative_share"
  > &
    Partial<FeedbackCount>;
  wire?: Wire.Finding;
  coverage: string;
  provisional: boolean;
  baseline: string;
  applicability: string;
}
export interface Evidence {
  evidence_id: string;
  source_version_id: string;
  source_kind: "uploaded" | "external";
  wire?: Wire.Evidence;
  locator: { type: string; label: string };
  scope: string;
  excerpt: string;
  limitations: string;
  source_url: string | null;
}
export interface Research {
  research_id: string;
  wire?: Wire.Research;
  finding_id: string;
  status:
    "queued" | "searching" | "checking" | "ready" | "partial" | "unavailable";
  competitor_scope: string;
  claims: Array<{
    type: "fact" | "opinion" | "inference";
    text: string;
    evidence_ids: string[];
  }>;
  recommendation: string;
  candidate_approaches: string[];
  counterevidence: string[];
  gaps: string[];
  as_of: string;
}
export interface Change {
  change_id: string;
  wire?: Wire.Change;
  finding_id: string;
  origin: "ai" | "pm";
  part_ids: ComponentId[];
  before: string;
  after: string;
  rationale: string;
  evidence_ids: string[];
  target: string;
  target_maturity: string;
  assumptions: string[];
  decision_state: string;
}
export interface Variant {
  variant_id: string;
  wire?: Wire.Variant;
  title: string;
  cohort_scope: string[];
  assumptions: string[];
  changes: Change[];
}
export interface ProposalSet {
  proposal_set_version: number;
  wire?: Wire.Proposals;
  variants: Variant[];
  unresolved_conflicts: string[];
}
export interface Graph {
  revision?: number;
  next_cursor?: string | null;
  wire?: Wire.Graph;
  nodes: Array<{
    node_id: string;
    entity_type: string;
    label: string;
    finding_id: string;
  }>;
  edges: Array<{
    edge_id: string;
    from_id: string;
    to_id: string;
    relationship: string;
    provenance: string;
  }>;
}
export interface Checkpoint {
  checkpoint_id: string;
  wire?: Wire.Checkpoint;
  conflicts?: Wire.Conflict[];
  version: number;
  question: string;
  alternatives: Array<{ id: string; title: string; tradeoff: string }>;
}
export interface AuditEntry {
  wire?: Wire.Audit;
  event_id: string;
  occurred_at: string;
  actor: string;
  description: string;
  proposal_set_version: number | null;
}
export interface RenderResult {
  wire?: Wire.RenderResult;
  render_request_id: string;
  proposal_set_version: number;
  variant_ids: string[];
  status: "queued" | "rendering" | "succeeded" | "partial" | "failed";
  assets: Array<{ asset_id: string; url: string; variant_id: string }>;
  outcomes: Array<{
    change_id: string;
    status: "rendered" | "annotated" | "unsupported" | "failed";
    reason: string;
  }>;
}
export interface Instruction {
  operation:
    | "edit_change"
    | "remove_change"
    | "add_change"
    | "edit_target"
    | "regroup_variants";
  base_proposal_set_version: number;
  variant_id: string;
  change_id?: string;
  fields: {
    after?: string;
    target?: string;
    cohort_scope?: string[];
    part_ids?: ComponentId[];
  };
}
export interface Workspace {
  resourceErrors?: { research?: string };
  counts?: Wire.Counts;
  conflicts?: Wire.Conflicts;
  snapshot: Snapshot;
  findings: Finding[];
  graph: Graph;
  research: Research[];
  checkpoint: Checkpoint | null;
  proposals: ProposalSet;
  history: AuditEntry[];
}
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}
export interface Api {
  mode: "mock" | "real";
  sessionNamespace?: string;
  events?(
    runId: string,
    sequence: number,
    lastEventId: string | null,
    signal: AbortSignal,
  ): Promise<Response>;
  sourceUrl?(sourceId: string): string;
  linkUrl?(value: string): string | null;
  vehicles?(): Promise<Vehicle[]>;
  canReadSource?(url: string): boolean;
  readSource?(url: string, signal: AbortSignal): Promise<Blob>;
  /** Protected application render assets and authoritative export bytes only. */
  canReadAsset?(url: string): boolean;
  readAsset?(url: string, signal: AbortSignal): Promise<Blob>;
  dispose?(): void;
  request<T>(
    path: string,
    body?: unknown,
    key?: string,
    signal?: AbortSignal,
  ): Promise<T>;
  upload(file: File): Promise<Upload>;
  workspace(runId: string): Promise<Workspace>;
}
