from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from uuid import uuid4

import pytest
from openpyxl import load_workbook
from sqlalchemy import func, select
from test_ingestion import upload
from test_uploads import workbook

from app.db import (
    EvidenceArtifact,
    LogicalRecord,
    ParseCache,
    Run,
    RunEvidence,
    RunSource,
    Session,
)
from app.ingest_types import FeedbackAnnotation, FeedbackRecord, ParseResult
from app.ingestion import publish_batch
from app.wire import CellLocator, Scope


def test_runtime_pdf_fallback_preserves_successful_parse_cache_identity():
    from app.ingestion import cache_identity

    binding = {"parser_revision": "synthetic", "pdf_batch_pages": 2}
    assert cache_identity("workspace", "sha", binding, "1:2", "") == cache_identity(
        "workspace", "sha", binding | {"pdf_single_page_fallback": True}, "1:2", ""
    )


def frozen_run(client, namespace=None, data=None):
    namespace = namespace or str(uuid4())
    if data is None:
        # Mock parser outputs must not share a content cache between unrelated tests.
        book = load_workbook(BytesIO(workbook()))
        book.properties.identifier = str(uuid4())
        buffer = BytesIO()
        book.save(buffer)
        book.close()
        data = buffer.getvalue()
    source_id = upload(client, namespace, data=data).json()["sources"][0]["source_id"]
    response = client.post(
        "/api/v1/runs",
        json={
            "vehicle_id": "vehicle_demo",
            "baseline_asset_id": "asset_demo_v1",
            "part_catalog_version": "catalog_demo_v1",
            "source_ids": [source_id],
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 202
    with Session() as session:
        run = session.get(Run, response.json()["run_id"])
        member = session.scalar(select(RunSource).where(RunSource.run_id == run.id))
        return run.id, run.generation_id, member.source_version_id, member.binding


def feedback(binding, text="Synthetic seat comfort feedback"):
    annotation = FeedbackAnnotation(
        text=text,
        locator=CellLocator(sheet="Sheet", row=2, cells=["A2", "B2"]),
        classifications={"topic": "Comfort", "engine": None},
        scope=Scope(markets=["DE"], cohort_ids=["DE", "EU"]),
    )
    return ParseResult(
        kind="feedback",
        parser_revision=binding["parser_revision"],
        records=[
            FeedbackRecord(
                dataset_namespace=binding["dataset_namespace"],
                source_namespace="survey_one",
                external_record_id="synthetic_1",
                text=text,
                annotations=[annotation],
                scope=annotation.scope,
            )
        ],
    )


def test_concurrent_materialization_has_one_cache_record_and_event(client):
    run_id, generation, version, binding = frozen_run(client)
    result = feedback(binding)
    with ThreadPoolExecutor(max_workers=2) as pool:
        cache_ids = list(
            pool.map(
                lambda _: publish_batch(run_id, generation, version, result), range(2)
            )
        )
    assert cache_ids[0] == cache_ids[1]
    with Session() as session:
        assert session.get(ParseCache, cache_ids[0]) is not None
        assert (
            session.scalar(
                select(func.count())
                .select_from(RunEvidence)
                .where(RunEvidence.run_id == run_id)
            )
            == 1
        )
        assert session.get(Run, run_id).event_sequence == 2
        evidence = session.scalar(
            select(EvidenceArtifact)
            .join(RunEvidence, RunEvidence.evidence_id == EvidenceArtifact.id)
            .where(RunEvidence.run_id == run_id)
        )
        record = session.get(LogicalRecord, evidence.record_id)
        assert record.dataset_namespace == binding["dataset_namespace"]
        assert evidence.scope["cohort_ids"] == ["DE", "EU"]


def test_superseded_generation_cannot_publish_any_artifacts(client):
    run_id, generation, version, binding = frozen_run(client)
    with Session.begin() as session:
        session.get(Run, run_id).generation_id = str(uuid4())
    with pytest.raises(ValueError, match="Superseded"):
        publish_batch(run_id, generation, version, feedback(binding))
    with Session() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(RunEvidence)
                .where(RunEvidence.run_id == run_id)
            )
            == 0
        )


def test_publication_rejects_namespace_outside_frozen_binding(client):
    run_id, generation, version, binding = frozen_run(client)
    result = feedback(binding)
    result.records[0].dataset_namespace = "another_dataset"
    with pytest.raises(ValueError, match="namespace"):
        publish_batch(run_id, generation, version, result)


def test_publication_rejects_parser_revision_outside_frozen_binding(client):
    run_id, generation, version, binding = frozen_run(client)
    result = feedback(binding)
    result.parser_revision = "superseded-parser"
    with pytest.raises(ValueError, match="revision"):
        publish_batch(run_id, generation, version, result)


def test_publication_rejects_models_outside_frozen_binding(client):
    run_id, generation, version, binding = frozen_run(client)
    with Session.begin() as session:
        member = session.get(RunSource, (run_id, version))
        member.binding = member.binding | {
            "model_versions": {"synthetic/model": "pinned"}
        }
    result = feedback(binding)
    result.parser_versions = {"synthetic/model": "changed"}
    with pytest.raises(ValueError, match="Model revision"):
        publish_batch(run_id, generation, version, result)


def test_repeated_source_versions_reuse_cache_but_preserve_lineage(client):
    namespace = str(uuid4())
    data = workbook()
    first_run, first_generation, first_version, binding = frozen_run(
        client, namespace, data
    )
    second_run, second_generation, second_version, second_binding = frozen_run(
        client, namespace, data
    )
    assert first_version != second_version
    first_cache = publish_batch(
        first_run, first_generation, first_version, feedback(binding)
    )
    second_cache = publish_batch(
        second_run, second_generation, second_version, feedback(second_binding)
    )
    assert first_cache == second_cache
    with Session() as session:
        first = session.scalar(
            select(EvidenceArtifact)
            .join(RunEvidence, RunEvidence.evidence_id == EvidenceArtifact.id)
            .where(RunEvidence.run_id == first_run)
        )
        second = session.scalar(
            select(EvidenceArtifact)
            .join(RunEvidence, RunEvidence.evidence_id == EvidenceArtifact.id)
            .where(RunEvidence.run_id == second_run)
        )
        assert first.id != second.id
        assert first.source_version_id == first_version
        assert second.source_version_id == second_version
        assert first.record_id == second.record_id


def test_content_cache_reuse_does_not_merge_distinct_dataset_identities(client):
    data = workbook()
    first_run, first_generation, first_version, binding = frozen_run(
        client, str(uuid4()), data
    )
    second_run, second_generation, second_version, second_binding = frozen_run(
        client, str(uuid4()), data
    )
    first_cache = publish_batch(
        first_run, first_generation, first_version, feedback(binding)
    )
    second_cache = publish_batch(
        second_run, second_generation, second_version, feedback(second_binding)
    )
    assert first_cache == second_cache
    with Session() as session:
        first = session.scalar(
            select(EvidenceArtifact)
            .join(RunEvidence, RunEvidence.evidence_id == EvidenceArtifact.id)
            .where(RunEvidence.run_id == first_run)
        )
        second = session.scalar(
            select(EvidenceArtifact)
            .join(RunEvidence, RunEvidence.evidence_id == EvidenceArtifact.id)
            .where(RunEvidence.run_id == second_run)
        )
        assert first.record_id != second.record_id
        assert (
            session.get(LogicalRecord, first.record_id).dataset_namespace
            == binding["dataset_namespace"]
        )
        assert (
            session.get(LogicalRecord, second.record_id).dataset_namespace
            == second_binding["dataset_namespace"]
        )
