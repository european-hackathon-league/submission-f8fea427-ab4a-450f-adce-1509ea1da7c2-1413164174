from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class Wire(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Error(Wire):
    code: str
    message: str
    retryable: bool = False
    field_errors: list[dict[str, str]] = Field(default_factory=list)
    current_version: int | None = None


class Page[T](Wire):
    items: list[T]
    next_cursor: str | None = None
    revision: int = 1


class DeepDive(Wire):
    enabled: bool = False


class RunConfig(Wire):
    vehicle_id: str
    baseline_asset_id: str
    part_catalog_version: str
    source_ids: list[str] = Field(min_length=1, max_length=100)
    market_context: list[str] = Field(default_factory=list)
    participation_mode: Literal["autonomous", "guided"] = "autonomous"
    deep_dive: DeepDive = Field(default_factory=DeepDive)


class Accepted(Wire):
    command_id: str
    resource_id: str
    resource_url: str


class RunAccepted(Wire):
    run_id: str
    snapshot_url: str
    events_url: str


class UploadResult(Wire):
    source_id: str
    filename: str
    detected_type: Literal["xlsx", "pdf", "unsupported"]
    status: Literal["ready", "rejected"]
    reason: str | None = None


class Uploads(Wire):
    sources: list[UploadResult]


class Vehicle(Wire):
    vehicle_id: str
    baseline_asset_ids: list[str]
    part_catalog_versions: list[str]
    capabilities: list[str]
    synthetic: bool = True


class Snapshot(Wire):
    run_id: str
    contract_version: Literal["1"] = "1"
    config: RunConfig
    analysis_status: Literal[
        "queued", "processing", "waiting_for_pm", "proposals_ready", "failed"
    ]
    stage: str
    revision: int
    last_event_sequence: int
    current_proposal_set_version: int | None
    available_actions: list[str]
    warnings: list[str]
    resource_links: dict[str, str]


class Resource(Wire):
    type: str
    id: str
    revision: int


class Event(Wire):
    contract_version: Literal["1"] = "1"
    event_id: str
    sequence: int = Field(ge=1)
    run_id: str
    type: Literal[
        "analysis.updated",
        "findings.updated",
        "graph.updated",
        "part_counts.updated",
        "research.updated",
        "conflicts.updated",
        "checkpoint.created",
        "proposals.ready",
        "render.updated",
        "export.updated",
        "audit.appended",
    ]
    occurred_at: datetime
    resource: Resource
    proposal_set_version: int | None = None


class Scope(Wire):
    vehicle_ids: list[str] = Field(default_factory=list)
    markets: list[str] = Field(default_factory=list)
    cohort_ids: list[str] = Field(default_factory=list)
    year: int | None = None
    equipment: list[str] = Field(default_factory=list)
    software: str | None = None


class CellLocator(Wire):
    type: Literal["cell"] = "cell"
    sheet: str
    row: int = Field(ge=1)
    cells: list[str]


class PDFLocator(Wire):
    type: Literal["pdf"] = "pdf"
    page: int = Field(ge=1)
    bbox: tuple[float, float, float, float] | None = None
    section: str | None = None


class WebLocator(Wire):
    type: Literal["web"] = "web"
    url: str
    passage_start: int = Field(ge=0)
    passage_end: int = Field(ge=0)


class Evidence(Wire):
    evidence_id: str
    source_version_id: str
    source_kind: Literal[
        "feedback", "study", "sales", "equipment", "strategy", "external"
    ]
    locator: Annotated[
        CellLocator | PDFLocator | WebLocator, Field(discriminator="type")
    ]
    scope: Scope
    excerpt: str
    applicability: Literal["applicable", "mismatch", "unknown"] = "unknown"
    limitations: list[str] = Field(default_factory=list)
    source_url: str | None = None


class Counts(Wire):
    total_records: int = Field(ge=0)
    negative_records: int = Field(ge=0)
    negative_share: float | None = Field(default=None, ge=0, le=1)
    record_ids: list[str]


class Finding(Wire):
    finding_id: str
    revision: int
    title: str
    customer_need: str
    part_ids: list[str]
    cohort_ids: list[str]
    supporting_evidence_ids: list[str]
    opposing_evidence_ids: list[str]
    counts: Counts
    coverage: list[str]
    provisional: bool


class PartAggregate(Wire):
    part_id: str
    cohort_ids: list[str]
    counts: Counts
    intensity_value: float = Field(ge=0, le=1)
    intensity_scale_id: str
    low_evidence: bool
    provisional: bool


class FindingsPage(Page[Finding]):
    counts: Counts
    part_aggregates: list[PartAggregate]


class GraphNode(Wire):
    id: str
    entity_type: str
    revision: int


class GraphEdge(Wire):
    edge_id: str
    from_id: str
    to_id: str
    relationship: Literal[
        "support",
        "contradiction",
        "applicability",
        "mention",
        "membership",
        "derived_from",
    ]
    evidence_ids: list[str]


class Graph(Wire):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    revision: int
    next_cursor: str | None = None


class Claim(Wire):
    claim_id: str
    type: Literal["fact", "opinion", "inference"]
    text: str
    evidence_ids: list[str]
    limitations: list[str]


class Research(Wire):
    research_id: str
    finding_id: str
    status: Literal[
        "queued", "searching", "checking", "ready", "partial", "unavailable"
    ]
    competitor_scope: Scope
    claims: list[Claim]
    counterevidence_ids: list[str]
    candidate_approaches: list[str]
    recommendation: str | None
    gaps: list[str]


class Conflict(Wire):
    conflict_id: str
    version: int
    finding_ids: list[str]
    alternatives: list[Scope]
    rationale: str
    resolution_status: Literal["unresolved", "resolved"]


class Checkpoint(Wire):
    checkpoint_id: str
    version: int
    conflict_ids: list[str]
    allowed_actions: list[str]
    wait_state: Literal["waiting", "continued"]


class Conflicts(Wire):
    conflicts: list[Conflict]
    checkpoints: list[Checkpoint]


class Factors(Wire):
    impact: float | None = Field(default=None, ge=0, le=5)
    breadth: float | None = Field(default=None, ge=0, le=5)
    gap: float | None = Field(default=None, ge=0, le=5)
    future_relevance: float | None = Field(default=None, ge=0, le=5)
    rationales: dict[str, str]


class Change(Wire):
    change_id: str
    requirement_id: str
    version: int
    origin: Literal["ai", "pm"]
    outcome: str
    part_ids: list[str]
    scope: Scope
    horizon: int
    before: str | None
    after: str
    finding_ids: list[str]
    supporting_evidence_ids: list[str]
    opposing_evidence_ids: list[str]
    metric: str | None
    unit: str | None
    target: float | None
    target_basis: str | None
    conditions: list[str]
    validation_method: str
    preservation_constraints: list[str] = Field(default_factory=list)
    target_maturity: Literal["proposed", "needs_validation", "validated", "pm_accepted"]
    factors: Factors
    score: float | None
    scoring_policy_version: str
    evidence_strength: Literal["low", "medium", "high"]
    uncertainty: list[str]
    decision_state: Literal[
        "proposed", "approved", "rejected", "deferred", "selected"
    ] = "proposed"


class Variant(Wire):
    variant_id: str
    title: str
    cohort_ids: list[str]
    assumptions: list[str]
    requirement_ids: list[str]
    change_ids: list[str]
    related_variant_ids: list[str]


class Proposals(Wire):
    proposal_set_version: int
    run_id: str
    generation_id: str
    source_version_ids: list[str]
    research_ids: list[str]
    config_version: int
    scoring_policy_version: str
    variants: list[Variant]
    changes: list[Change]
    unresolved_conflict_ids: list[str]
    gaps: list[str]


class Instruction(Wire):
    operation: Literal[
        "edit_change",
        "remove_change",
        "add_change",
        "edit_target",
        "regroup_variants",
        "request_more_variants",
    ]
    base_proposal_set_version: int = Field(ge=1)
    target_ids: list[str]
    changed_fields: dict[str, str | float | list[str] | None]
    intent: str | None = None


class Continuation(Wire):
    checkpoint_version: int = Field(ge=1)
    resolution: str
    cohort_assignments: dict[str, list[str]] = Field(default_factory=dict)


class Decision(Wire):
    proposal_set_version: int = Field(ge=1)
    variant_id: str
    change_ids: list[str]
    action: Literal["approve", "reject", "defer", "select"]
    rationale: str


class RenderCommand(Wire):
    proposal_set_version: int = Field(ge=1)
    variant_ids: list[str] = Field(min_length=1)
    baseline_asset_id: str


class GeometryOperation(Wire):
    operation: Literal["resize_local"]
    part_id: str
    dimensions_m: tuple[
        Annotated[float, Field(gt=0, le=10, allow_inf_nan=False)],
        Annotated[float, Field(gt=0, le=10, allow_inf_nan=False)],
        Annotated[float, Field(gt=0, le=10, allow_inf_nan=False)],
    ]


class GeometryPart(Wire):
    part_id: str
    mesh_refs: list[str] = Field(min_length=1)
    anchor_mesh_ref: str
    anchor_local: tuple[float, float, float]
    baseline_anchor_local: tuple[float, float, float] | None = None
    dimensions_m: tuple[float, float, float]
    edit_origin_local: tuple[float, float, float] | None = None
    axis_labels: tuple[str, str, str] | None = None
    operations: list[Literal["resize_local"]] = Field(default_factory=list)


class GeometrySceneCatalog(Wire):
    contract_version: Literal["1"] = "1"
    baseline_asset_id: str
    asset_id: str
    part_catalog_version: str
    units: Literal["m"] = "m"
    parts: list[GeometryPart]
    baseline_url: str | None = None


class ManifestChange(Wire):
    change_id: str
    part_ids: list[str]
    proposed_outcome: str
    visual_instruction: str
    preserve_constraints: list[str]
    evidence_ids: list[str]
    geometry: GeometryOperation | None = None
    assumptions: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    proposal_change_version: int = Field(default=1, ge=1)
    requested_wording: str | None = None


class RenderManifest(RenderCommand):
    contract_version: Literal["1"] = "1"
    render_request_id: str
    run_id: str
    part_catalog_version: str
    changes: list[ManifestChange]


class Asset(Wire):
    asset_id: str
    url: str
    media_type: str


class RenderOutcome(Wire):
    change_id: str
    outcome: Literal["rendered", "annotated", "unsupported", "failed"]
    reason: str | None = None
    asset_ids: list[str]
    number: int | None = Field(default=None, ge=1)
    geometry_produced: bool = False
    visual_review: Literal["not_run", "passed", "needs_review", "failed"] = "not_run"
    engineering_validity: Literal["not_assessed"] = "not_assessed"
    measurements: dict[str, list[float]] | None = None
    assumptions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


RenderStage = Literal[
    "queued", "inspecting", "planning", "editing", "validating", "reviewing", "complete"
]


class RenderResult(Wire):
    render_request_id: str
    proposal_set_version: int
    variant_ids: list[str]
    baseline_asset_id: str
    part_catalog_version: str
    status: Literal["queued", "rendering", "succeeded", "partial", "failed"]
    stage: RenderStage | None = None
    job_id: str | None = None
    assets: list[Asset]
    outcomes: list[RenderOutcome]
    stale: bool = False
    failure_reason: str | None = None
    scene_catalog: GeometrySceneCatalog | None = None


class ExportCommand(Wire):
    proposal_set_version: int = Field(ge=1)
    variant_ids: list[str] = Field(min_length=1)
    format: Literal["json", "xlsx"]


class ExportResult(Wire):
    export_id: str
    status: Literal["queued", "processing", "ready", "failed"]
    manifest: dict[str, str | int | list[str]]
    download_url: str | None = None


class Audit(Wire):
    audit_id: str
    actor_id: str
    actor_type: Literal["pm", "service", "ai"]
    action: str
    occurred_at: datetime
    resource_id: str
    proposal_set_version: int | None = None
    rationale: str | None = None
