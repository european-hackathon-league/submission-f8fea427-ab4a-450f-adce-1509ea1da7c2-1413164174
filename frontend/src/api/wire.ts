// Generated from frontend/fixtures/openapi.json; source commit recorded in provenance.json.
// Wire types only. UI projections live in contracts.ts and normalize.ts.
export type Accepted = {
  command_id: string;
  resource_id: string;
  resource_url: string;
};
export type Asset = { asset_id: string; media_type: string; url: string };
export type Audit = {
  action: string;
  actor_id: string;
  actor_type: "pm" | "service" | "ai";
  audit_id: string;
  occurred_at: string;
  proposal_set_version?: number | null;
  rationale?: string | null;
  resource_id: string;
};
export type Body_uploads_api_v1_uploads_post = { files: string[] };
export type CellLocator = {
  cells: string[];
  row: number;
  sheet: string;
  type?: "cell";
};
export type Change = {
  after: string;
  before: string | null;
  change_id: string;
  conditions: string[];
  decision_state?:
    | "proposed"
    | "approved"
    | "rejected"
    | "deferred"
    | "selected";
  evidence_strength: "low" | "medium" | "high";
  factors: Factors;
  finding_ids: string[];
  horizon: number;
  metric: string | null;
  opposing_evidence_ids: string[];
  origin: "ai" | "pm";
  outcome: string;
  part_ids: string[];
  preservation_constraints?: string[];
  requirement_id: string;
  scope: Scope;
  score: number | null;
  scoring_policy_version: string;
  supporting_evidence_ids: string[];
  target: number | null;
  target_basis: string | null;
  target_maturity:
    | "proposed"
    | "needs_validation"
    | "validated"
    | "pm_accepted";
  uncertainty: string[];
  unit: string | null;
  validation_method: string;
  version: number;
};
export type Checkpoint = {
  allowed_actions: string[];
  checkpoint_id: string;
  conflict_ids: string[];
  version: number;
  wait_state: "waiting" | "continued";
};
export type Claim = {
  claim_id: string;
  evidence_ids: string[];
  limitations: string[];
  text: string;
  type: "fact" | "opinion" | "inference";
};
export type Conflict = {
  alternatives: Scope[];
  conflict_id: string;
  finding_ids: string[];
  rationale: string;
  resolution_status: "unresolved" | "resolved";
  version: number;
};
export type Conflicts = { checkpoints: Checkpoint[]; conflicts: Conflict[] };
export type Continuation = {
  checkpoint_version: number;
  cohort_assignments?: Record<string, string[]>;
  resolution: string;
};
export type Counts = {
  negative_records: number;
  negative_share?: number | null;
  record_ids: string[];
  total_records: number;
};
export type Decision = {
  action: "approve" | "reject" | "defer" | "select";
  change_ids: string[];
  proposal_set_version: number;
  rationale: string;
  variant_id: string;
};
export type DeepDive = { enabled?: boolean };
export type Error = {
  code: string;
  current_version?: number | null;
  field_errors?: Record<string, string>[];
  message: string;
  retryable?: boolean;
};
export type Evidence = {
  applicability?: "applicable" | "mismatch" | "unknown";
  evidence_id: string;
  excerpt: string;
  limitations?: string[];
  locator: CellLocator | PDFLocator | WebLocator;
  scope: Scope;
  source_kind:
    | "feedback"
    | "study"
    | "sales"
    | "equipment"
    | "strategy"
    | "external";
  source_url?: string | null;
  source_version_id: string;
};
export type ExportCommand = {
  format: "json" | "xlsx";
  proposal_set_version: number;
  variant_ids: string[];
};
export type ExportResult = {
  download_url?: string | null;
  export_id: string;
  manifest: Record<string, string | number | string[]>;
  status: "queued" | "processing" | "ready" | "failed";
};
export type Factors = {
  breadth?: number | null;
  future_relevance?: number | null;
  gap?: number | null;
  impact?: number | null;
  rationales: Record<string, string>;
};
export type Finding = {
  cohort_ids: string[];
  counts: Counts;
  coverage: string[];
  customer_need: string;
  finding_id: string;
  opposing_evidence_ids: string[];
  part_ids: string[];
  provisional: boolean;
  revision: number;
  supporting_evidence_ids: string[];
  title: string;
};
export type FindingsPage = {
  counts: Counts;
  items: Finding[];
  next_cursor?: string | null;
  part_aggregates: PartAggregate[];
  revision?: number;
};
export type Graph = {
  edges: GraphEdge[];
  next_cursor?: string | null;
  nodes: GraphNode[];
  revision: number;
};
export type GraphEdge = {
  edge_id: string;
  evidence_ids: string[];
  from_id: string;
  relationship:
    | "support"
    | "contradiction"
    | "applicability"
    | "mention"
    | "membership"
    | "derived_from";
  to_id: string;
};
export type GraphNode = { entity_type: string; id: string; revision: number };
export type Instruction = {
  base_proposal_set_version: number;
  changed_fields: Record<string, string | number | string[] | null>;
  intent?: string | null;
  operation:
    | "edit_change"
    | "remove_change"
    | "add_change"
    | "edit_target"
    | "regroup_variants"
    | "request_more_variants";
  target_ids: string[];
};
export type PDFLocator = {
  bbox?: unknown[] | null;
  page: number;
  section?: string | null;
  type?: "pdf";
};
export type Page_Audit_ = {
  items: Audit[];
  next_cursor?: string | null;
  revision?: number;
};
export type Page_Research_ = {
  items: Research[];
  next_cursor?: string | null;
  revision?: number;
};
export type Page_Vehicle_ = {
  items: Vehicle[];
  next_cursor?: string | null;
  revision?: number;
};
export type PartAggregate = {
  cohort_ids: string[];
  counts: Counts;
  intensity_scale_id: string;
  intensity_value: number;
  low_evidence: boolean;
  part_id: string;
  provisional: boolean;
};
export type Proposals = {
  changes: Change[];
  config_version: number;
  gaps: string[];
  generation_id: string;
  proposal_set_version: number;
  research_ids: string[];
  run_id: string;
  scoring_policy_version: string;
  source_version_ids: string[];
  unresolved_conflict_ids: string[];
  variants: Variant[];
};
export type RenderCommand = {
  baseline_asset_id: string;
  proposal_set_version: number;
  variant_ids: string[];
};
export type RenderOutcome = {
  asset_ids: string[];
  assumptions?: string[];
  change_id: string;
  engineering_validity?: "not_assessed";
  geometry_produced?: boolean;
  measurements?: Record<string, number[]> | null;
  number?: number | null;
  outcome: "rendered" | "annotated" | "unsupported" | "failed";
  reason?: string | null;
  visual_review?: "not_run" | "passed" | "needs_review" | "failed";
  warnings?: string[];
};
export type GeometryPart = {
  baseline_anchor_local?: [number, number, number] | null;
  axis_labels?: [string, string, string] | null;
  anchor_local: [number, number, number];
  anchor_mesh_ref: string;
  dimensions_m: [number, number, number];
  edit_origin_local?: [number, number, number] | null;
  mesh_refs: string[];
  operations?: "resize_local"[];
  part_id: string;
};
export type GeometrySceneCatalog = {
  asset_id: string;
  baseline_asset_id: string;
  baseline_url?: string | null;
  contract_version?: "1";
  part_catalog_version: string;
  parts: GeometryPart[];
  units?: "m";
};
export type RenderResult = {
  stage?: "queued" | "inspecting" | "planning" | "editing" | "validating" | "reviewing" | "complete" | null;
  assets: Asset[];
  baseline_asset_id: string;
  failure_reason?: string | null;
  job_id?: string | null;
  outcomes: RenderOutcome[];
  part_catalog_version: string;
  proposal_set_version: number;
  render_request_id: string;
  scene_catalog?: GeometrySceneCatalog | null;
  stale?: boolean;
  status: "queued" | "rendering" | "succeeded" | "partial" | "failed";
  variant_ids: string[];
};
export type Research = {
  candidate_approaches: string[];
  claims: Claim[];
  competitor_scope: Scope;
  counterevidence_ids: string[];
  finding_id: string;
  gaps: string[];
  recommendation: string | null;
  research_id: string;
  status:
    | "queued"
    | "searching"
    | "checking"
    | "ready"
    | "partial"
    | "unavailable";
};
export type RunAccepted = {
  events_url: string;
  run_id: string;
  snapshot_url: string;
};
export type RunConfig = {
  baseline_asset_id: string;
  deep_dive?: DeepDive;
  market_context?: string[];
  part_catalog_version: string;
  participation_mode?: "autonomous" | "guided";
  source_ids: string[];
  vehicle_id: string;
};
export type Scope = {
  cohort_ids?: string[];
  equipment?: string[];
  markets?: string[];
  software?: string | null;
  vehicle_ids?: string[];
  year?: number | null;
};
export type Snapshot = {
  analysis_status:
    | "queued"
    | "processing"
    | "waiting_for_pm"
    | "proposals_ready"
    | "failed";
  available_actions: string[];
  config: RunConfig;
  contract_version?: "1";
  current_proposal_set_version: number | null;
  last_event_sequence: number;
  resource_links: Record<string, string>;
  revision: number;
  run_id: string;
  stage: string;
  warnings: string[];
};
export type UploadResult = {
  detected_type: "xlsx" | "pdf" | "unsupported";
  filename: string;
  reason?: string | null;
  source_id: string;
  status: "ready" | "rejected";
};
export type Uploads = { sources: UploadResult[] };
export type Variant = {
  assumptions: string[];
  change_ids: string[];
  cohort_ids: string[];
  related_variant_ids: string[];
  requirement_ids: string[];
  title: string;
  variant_id: string;
};
export type Vehicle = {
  baseline_asset_ids: string[];
  capabilities: string[];
  part_catalog_versions: string[];
  synthetic?: boolean;
  vehicle_id: string;
};
export type WebLocator = {
  passage_end: number;
  passage_start: number;
  type?: "web";
  url: string;
};
