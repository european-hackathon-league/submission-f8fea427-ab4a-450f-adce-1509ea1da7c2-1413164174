from uuid import uuid4

from sqlalchemy import select
from test_ingestion import upload
from test_ingestion_cache import feedback

from app.db import Run, RunSource, Session
from app.ingest_types import CoverageIssue, ParseResult
from app.ingestion import complete_ingestion, finalize_source, publish_batch


def joined_run(client, count):
    sources = [
        upload(client, str(uuid4())).json()["sources"][0]["source_id"]
        for _ in range(count)
    ]
    response = client.post(
        "/api/v1/runs",
        json={
            "vehicle_id": "vehicle_demo",
            "baseline_asset_id": "asset_demo_v1",
            "part_catalog_version": "catalog_demo_v1",
            "source_ids": sources,
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 202
    with Session() as session:
        run = session.get(Run, response.json()["run_id"])
        members = session.scalars(
            select(RunSource)
            .where(RunSource.run_id == run.id)
            .order_by(RunSource.source_version_id)
        ).all()
        return (
            run.id,
            run.generation_id,
            [(member.source_version_id, member.binding) for member in members],
        )


def unsupported(binding):
    return ParseResult(
        kind="unknown",
        parser_revision=binding["parser_revision"],
        status="unsupported",
        coverage=[
            CoverageIssue(
                code="unsupported_profile",
                message="Synthetic layout has no supported profile",
                severity="error",
            )
        ],
    )


def test_failed_companion_source_preserves_valid_evidence_and_explicit_coverage(client):
    run_id, generation, members = joined_run(client, 2)
    for index, (version, binding) in enumerate(members):
        publish_batch(
            run_id,
            generation,
            version,
            feedback(binding) if index == 0 else unsupported(binding),
        )
        finalize_source(run_id, generation, version)
    complete_ingestion(run_id, generation)
    with Session() as session:
        run = session.get(Run, run_id)
        assert run.analysis_status == "processing"
        assert run.stage == "ingestion_ready"
        assert any("unsupported_profile" in warning for warning in run.warnings)
    complete_ingestion(run_id, generation)
    with Session() as session:
        assert session.get(Run, run_id).event_sequence == 4


def test_all_unsupported_sources_are_explicit_failure_not_successful_empty_analysis(
    client,
):
    run_id, generation, members = joined_run(client, 1)
    version, binding = members[0]
    publish_batch(run_id, generation, version, unsupported(binding))
    finalize_source(run_id, generation, version)
    complete_ingestion(run_id, generation)
    with Session() as session:
        run = session.get(Run, run_id)
        assert run.analysis_status == "failed"
        assert run.stage == "failed"
        assert any("No valid evidence" in warning for warning in run.warnings)
