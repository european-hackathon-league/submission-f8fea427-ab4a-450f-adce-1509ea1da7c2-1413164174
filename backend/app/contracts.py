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
    payloads = {
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
                },
                {
                    "part_id": "part_interior",
                    "parent_part_id": None,
                    "capabilities": ["annotation"],
                },
                {
                    "part_id": "part_digital",
                    "parent_part_id": None,
                    "capabilities": ["annotation"],
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
