"""Generate public contract artifacts from the API's wire models."""

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app import wire as w
from app.main import app

SCENARIOS = (
    "standard_autonomous",
    "deep_dive_success",
    "deep_dive_partial",
    "guided_conflict",
    "duplicate_uploads",
    "pm_edit_stale",
    "render_partial",
    "render_late",
    "reconnect",
    "versioned_export",
)
MODELS: dict[str, type[w.Wire]] = {
    "Snapshot": w.Snapshot,
    "Event": w.Event,
    "Proposals": w.Proposals,
    "FindingsPage": w.FindingsPage,
    "EvidenceList": w.Page[w.Evidence],
    "RenderResult": w.RenderResult,
    "RenderManifest": w.RenderManifest,
    "Error": w.Error,
    "ResearchPage": w.Page[w.Research],
    "Conflicts": w.Conflicts,
    "Instruction": w.Instruction,
    "Continuation": w.Continuation,
    "Uploads": w.Uploads,
    "ExportResult": w.ExportResult,
    "EventPage": w.Page[w.Event],
}


def scenario(name: str) -> dict[str, Any]:
    run_id = "run_demo"
    scope = w.Scope(
        vehicle_ids=["vehicle_demo"], markets=["US"], cohort_ids=["cohort_us"]
    )
    config = w.RunConfig(
        vehicle_id="vehicle_demo",
        baseline_asset_id="asset_demo_v1",
        part_catalog_version="catalog_demo_v1",
        source_ids=["source_demo"],
        market_context=["US"],
        participation_mode="guided" if name == "guided_conflict" else "autonomous",
        deep_dive=w.DeepDive(enabled=name.startswith("deep_dive")),
    )
    evidence = w.Evidence(
        evidence_id="evidence_demo",
        source_version_id="source_version_demo",
        source_kind="feedback",
        locator=w.CellLocator(sheet="Feedback_Explorer", row=2, cells=["A2", "G2"]),
        scope=scope,
        excerpt="Synthetic: the seat is uncomfortable on long journeys.",
        applicability="applicable",
    )
    counts = w.Counts(
        total_records=1,
        negative_records=1,
        negative_share=1,
        record_ids=["record_demo"],
    )
    finding = w.Finding(
        finding_id="finding_demo",
        revision=1,
        title="Synthetic seat comfort",
        customer_need="Remain comfortable on long journeys",
        part_ids=["part_seat"],
        cohort_ids=["cohort_us"],
        supporting_evidence_ids=[evidence.evidence_id],
        opposing_evidence_ids=[],
        counts=counts,
        coverage=["Synthetic fixture; no population inference"],
        provisional=False,
    )
    change = w.Change(
        change_id="change_demo",
        requirement_id="requirement_demo",
        version=1,
        origin="ai",
        outcome="Improve long-journey seat comfort",
        part_ids=["part_seat"],
        scope=scope,
        horizon=2030,
        before=None,
        after="Evaluate seat comfort improvements",
        finding_ids=[finding.finding_id],
        supporting_evidence_ids=[evidence.evidence_id],
        opposing_evidence_ids=[],
        metric="discomfort rating",
        unit="rating",
        target=None,
        target_basis=None,
        conditions=["long journeys"],
        validation_method="Scoped customer study",
        target_maturity="needs_validation",
        factors=w.Factors(
            impact=3,
            breadth=None,
            gap=None,
            future_relevance=None,
            rationales={"impact": "Synthetic assessment; other factors unknown"},
        ),
        score=None,
        scoring_policy_version="default_35_25_20_20_v1",
        evidence_strength="low",
        uncertainty=["Baseline and target require validation"],
    )
    proposal = w.Proposals(
        proposal_set_version=1,
        run_id=run_id,
        generation_id="generation_demo",
        source_version_ids=[evidence.source_version_id],
        research_ids=[],
        config_version=1,
        scoring_policy_version=change.scoring_policy_version,
        variants=[
            w.Variant(
                variant_id="variant_demo",
                title="Synthetic alternative",
                cohort_ids=["cohort_us"],
                assumptions=[],
                requirement_ids=[change.requirement_id],
                change_ids=[change.change_id],
                related_variant_ids=[],
            )
        ],
        changes=[change],
        unresolved_conflict_ids=[],
        gaps=["Synthetic example"],
    )
    snapshot = w.Snapshot(
        run_id=run_id,
        config=config,
        analysis_status="waiting_for_pm"
        if name == "guided_conflict"
        else "proposals_ready",
        stage="proposal",
        revision=1,
        last_event_sequence=1,
        current_proposal_set_version=1,
        available_actions=["continue_checkpoint"]
        if name == "guided_conflict"
        else ["edit", "reimagine", "export"],
        warnings=["Synthetic data"],
        resource_links={"proposals": f"/api/v1/runs/{run_id}/proposals"},
    )
    event = w.Event(
        event_id="event_demo_1",
        sequence=1,
        run_id=run_id,
        type="proposals.ready",
        occurred_at=datetime(2026, 10, 10, tzinfo=UTC),
        resource=w.Resource(type="proposals", id=run_id, revision=1),
        proposal_set_version=1,
    )
    manifest = w.RenderManifest(
        render_request_id="render_demo",
        run_id=run_id,
        proposal_set_version=1,
        variant_ids=["variant_demo"],
        baseline_asset_id=config.baseline_asset_id,
        part_catalog_version=config.part_catalog_version,
        changes=[
            w.ManifestChange(
                change_id=change.change_id,
                part_ids=change.part_ids,
                proposed_outcome=change.outcome,
                visual_instruction="Annotate synthetic concept",
                preserve_constraints=["Preserve all other parts"],
                evidence_ids=[evidence.evidence_id],
            )
        ],
    )
    render = w.RenderResult(
        render_request_id=manifest.render_request_id,
        proposal_set_version=1,
        variant_ids=manifest.variant_ids,
        baseline_asset_id=manifest.baseline_asset_id,
        part_catalog_version=manifest.part_catalog_version,
        status="partial" if name == "render_partial" else "succeeded",
        assets=[],
        outcomes=[
            w.RenderOutcome(
                change_id=change.change_id,
                outcome="unsupported" if name == "render_partial" else "annotated",
                asset_ids=[],
                reason="Synthetic geometry unsupported"
                if name == "render_partial"
                else None,
            )
        ],
        stale=name == "render_late",
    )
    payloads: dict[str, w.Wire] = {
        "Snapshot": snapshot,
        "Event": event,
        "Proposals": proposal,
        "FindingsPage": w.FindingsPage(
            items=[finding], counts=counts, part_aggregates=[]
        ),
        "EvidenceList": w.Page[w.Evidence](items=[evidence]),
        "RenderManifest": manifest,
        "RenderResult": render,
        "Error": w.Error(
            code="stale_version" if name == "pm_edit_stale" else "example_error",
            message="Synthetic error example",
            current_version=2 if name == "pm_edit_stale" else None,
        ),
    }

    if name.startswith("deep_dive"):
        external = evidence.model_copy(
            update={
                "evidence_id": "evidence_external",
                "source_version_id": "web_version_demo",
                "source_kind": "external",
                "locator": w.WebLocator(
                    url="https://research.example/synthetic",
                    passage_start=0,
                    passage_end=49,
                ),
                "excerpt": "Synthetic competitor offers adjustable seat bolsters.",
                "limitations": ["Synthetic fixture; no real competitor claim"],
            }
        )
        payloads["EvidenceList"] = w.Page[w.Evidence](items=[evidence, external])
        gaps = (
            ["Synthetic retrieval budget exhausted before counterevidence"]
            if name.endswith("partial")
            else []
        )
        research = w.Research(
            research_id="research_demo",
            finding_id=finding.finding_id,
            status="partial" if gaps else "ready",
            competitor_scope=scope,
            claims=[
                w.Claim(
                    claim_id="claim_demo",
                    type="fact",
                    text=external.excerpt,
                    evidence_ids=[external.evidence_id],
                    limitations=external.limitations,
                )
            ],
            counterevidence_ids=[],
            candidate_approaches=["Evaluate adjustable bolsters"],
            recommendation=None if gaps else "Evaluate in a scoped customer study",
            gaps=gaps,
        )
        payloads["ResearchPage"] = w.Page[w.Research](items=[research])
        proposal.research_ids = [research.research_id]
        proposal.gaps.extend(gaps)
    if name == "guided_conflict":
        opposing_scope = w.Scope(
            vehicle_ids=["vehicle_demo"], markets=["DE"], cohort_ids=["cohort_de"]
        )
        opposing = evidence.model_copy(
            update={
                "evidence_id": "evidence_opposing",
                "locator": w.CellLocator(
                    sheet="Feedback_Explorer", row=3, cells=["A3", "G3"]
                ),
                "scope": opposing_scope,
                "excerpt": "Synthetic: preserve the firm supportive seat.",
            }
        )
        counts = w.Counts(
            total_records=2,
            negative_records=1,
            negative_share=0.5,
            record_ids=["record_demo", "record_opposing"],
        )
        finding.counts = counts
        finding.opposing_evidence_ids = [opposing.evidence_id]
        finding.cohort_ids.append("cohort_de")
        payloads["FindingsPage"] = w.FindingsPage(
            items=[finding], counts=counts, part_aggregates=[]
        )
        payloads["EvidenceList"] = w.Page[w.Evidence](items=[evidence, opposing])
        change.opposing_evidence_ids = [opposing.evidence_id]
        proposal.unresolved_conflict_ids = ["conflict_demo"]
        payloads["Conflicts"] = w.Conflicts(
            conflicts=[
                w.Conflict(
                    conflict_id="conflict_demo",
                    version=1,
                    finding_ids=[finding.finding_id],
                    alternatives=[scope, opposing_scope],
                    rationale="Preserve opposing customer cohort needs",
                    resolution_status="unresolved",
                )
            ],
            checkpoints=[
                w.Checkpoint(
                    checkpoint_id="checkpoint_demo",
                    version=1,
                    conflict_ids=["conflict_demo"],
                    allowed_actions=["regroup_variants"],
                    wait_state="waiting",
                )
            ],
        )
        payloads["Continuation"] = w.Continuation(
            checkpoint_version=1,
            resolution="regroup_variants",
            cohort_assignments={
                "variant_us": ["cohort_us"],
                "variant_de": ["cohort_de"],
            },
        )
        snapshot.current_proposal_set_version = None
        snapshot.stage = "conflict"
        event.type = "checkpoint.created"
        event.resource = w.Resource(type="checkpoint", id="checkpoint_demo", revision=1)
        event.proposal_set_version = None
    if name in {"standard_autonomous", "duplicate_uploads"}:
        uploads = w.Uploads(
            sources=[
                w.UploadResult(
                    source_id="source_demo",
                    filename="feedback.xlsx",
                    detected_type="xlsx",
                    status="ready",
                )
            ]
        )
        if name == "standard_autonomous":
            uploads.sources.append(
                w.UploadResult(
                    source_id="source_bad",
                    filename="damaged.pdf",
                    detected_type="pdf",
                    status="rejected",
                    reason="corrupt_file",
                )
            )
        else:
            proposal.source_version_ids.append("source_version_duplicate")
            config.source_ids.append("source_duplicate")
            uploads.sources.append(
                w.UploadResult(
                    source_id="source_duplicate",
                    filename="feedback-copy.xlsx",
                    detected_type="xlsx",
                    status="ready",
                )
            )
        payloads["Uploads"] = uploads
    if name == "render_partial":
        unsupported = change.model_copy(
            update={
                "change_id": "change_unsupported",
                "requirement_id": "requirement_unsupported",
                "origin": "pm",
                "outcome": "Explore a PM concept without a scene mapping",
                "part_ids": ["part_unmapped"],
                "finding_ids": [],
                "supporting_evidence_ids": [],
                "opposing_evidence_ids": [],
                "evidence_strength": "low",
                "uncertainty": ["PM idea; no customer evidence or scene mapping"],
            }
        )
        proposal.changes.append(unsupported)
        proposal.variants[0].change_ids.append(unsupported.change_id)
        proposal.variants[0].requirement_ids.append(unsupported.requirement_id)
        manifest.changes.append(
            w.ManifestChange(
                change_id=unsupported.change_id,
                part_ids=unsupported.part_ids,
                proposed_outcome=unsupported.outcome,
                visual_instruction="Unsupported concept",
                preserve_constraints=[],
                evidence_ids=[],
            )
        )
        render.assets = [
            w.Asset(
                asset_id="asset_concept",
                url="/api/v1/runs/run_demo/renders/render_demo/assets/asset_concept",
                media_type="image/png",
            )
        ]
        render.outcomes = [
            w.RenderOutcome(
                change_id=change.change_id,
                outcome="rendered",
                asset_ids=["asset_concept"],
            ),
            w.RenderOutcome(
                change_id=unsupported.change_id,
                outcome="unsupported",
                asset_ids=[],
                reason="No semantic scene mapping",
            ),
        ]
    if name in {"render_late", "pm_edit_stale"}:
        proposal.proposal_set_version = 2
        snapshot.current_proposal_set_version = 2
        snapshot.revision = 2
        event.proposal_set_version = 2
        event.resource.revision = 2
    if name == "pm_edit_stale":
        payloads["Instruction"] = w.Instruction(
            operation="edit_change",
            base_proposal_set_version=1,
            target_ids=[change.change_id],
            changed_fields={"after": "Synthetic PM revision"},
        )
    if name == "reconnect":
        snapshot.last_event_sequence = 17
        event.sequence = 17
        event.event_id = "event_demo_17"
        payloads["EventPage"] = w.Page[w.Event](
            items=[event], revision=snapshot.revision
        )
        payloads["Error"] = w.Error(
            code="replay_expired",
            message="Replay cursor expired; fetch snapshot",
            retryable=False,
        )
    if name == "versioned_export":
        payloads["ExportResult"] = w.ExportResult(
            export_id="export_demo",
            status="ready",
            manifest={
                "proposal_set_version": proposal.proposal_set_version,
                "variant_ids": ["variant_demo"],
                "source_version_ids": proposal.source_version_ids,
                "research_ids": [],
                "scoring_policy_version": proposal.scoring_policy_version,
                "audit_cutoff": 1,
                "format": "json",
            },
            download_url="/api/v1/runs/run_demo/exports/export_demo/download",
        )
    return {
        "synthetic": True,
        "description": name,
        "payloads": {
            key: value.model_dump(mode="json") for key, value in payloads.items()
        },
    }


def artifacts() -> dict[str, Any]:
    return {
        "openapi.json": app.openapi(),
        "schemas.json": {
            name: model.model_json_schema() for name, model in MODELS.items()
        },
        "renderer.schema.json": {
            "request": w.RenderManifest.model_json_schema(),
            "result": w.RenderResult.model_json_schema(),
        },
        "catalog.example.json": {
            "contract_version": "1",
            "synthetic": True,
            "part_catalog_version": "catalog_demo_v1",
            "vehicle_id": "vehicle_demo",
            "baseline_asset_id": "asset_demo_v1",
            "parts": [
                {
                    "part_id": "part_seat",
                    "parent_part_id": "part_interior",
                    "capabilities": ["annotation"],
                    "anchor_ref": "synthetic_anchor",
                    "mesh_refs": [],
                },
                {
                    "part_id": "part_interior",
                    "parent_part_id": None,
                    "capabilities": ["annotation"],
                    "anchor_ref": "synthetic_anchor",
                    "mesh_refs": [],
                },
                {
                    "part_id": "part_digital",
                    "parent_part_id": None,
                    "capabilities": ["annotation"],
                    "anchor_ref": "synthetic_anchor",
                    "mesh_refs": [],
                },
                {
                    "part_id": "part_unmapped",
                    "parent_part_id": None,
                    "capabilities": [],
                },
            ],
        },
        "scenarios.json": {name: scenario(name) for name in SCENARIOS},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument(
        "--output", type=Path, default=Path(__file__).resolve().parents[2] / "contracts"
    )
    args = parser.parse_args()
    drift = []
    for name, value in artifacts().items():
        path = args.output / name
        rendered = json.dumps(value, indent=2, sort_keys=True) + "\n"
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != rendered:
                drift.append(name)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(rendered, encoding="utf-8")
    if drift:
        raise SystemExit("Contract drift: " + ", ".join(drift))


if __name__ == "__main__":
    main()
