import asyncio
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fixtures.excel import FEEDBACK_HEADERS, feedback_row, workbook
from sqlalchemy import select
from temporalio.client import Client
from temporalio.worker import Replayer, Worker

from app.activities import complete_foundation, fail_analysis, source_check
from app.config import Settings
from app.db import Audit, Command, Run, RunEvidence, RunSource, Session
from app.dispatch import dispatch_once
from app.workflows import AnalysisWorkflow


@pytest.mark.parametrize("pair_exhausted", [False, True])
def test_pdf_checkpoints_bound_cpu_work_and_preserve_every_page(
    client, monkeypatch, pair_exhausted
):
    from test_storage import text_pdf

    from app.ingest_types import CoverageIssue, ParsedPassage, ParseResult
    from app.ingestion import ingest_source
    from app.wire import PDFLocator

    uploaded = client.post(
        "/api/v1/uploads",
        files={
            "files": (
                "synthetic-report.pdf",
                text_pdf(7) + f"\n% fixture {uuid4()}\n".encode(),
            )
        },
        headers={"Idempotency-Key": str(uuid4())},
    ).json()
    run_id = client.post(
        "/api/v1/runs",
        json={
            "vehicle_id": "vehicle_demo",
            "baseline_asset_id": "asset_demo_v1",
            "part_catalog_version": "catalog_demo_v1",
            "source_ids": [uploaded["sources"][0]["source_id"]],
        },
        headers={"Idempotency-Key": str(uuid4())},
    ).json()["run_id"]
    with Session() as session:
        generation = session.get(Run, run_id).generation_id
        member = session.scalar(select(RunSource).where(RunSource.run_id == run_id))
        version, revision = member.source_version_id, member.binding["parser_revision"]
        model_versions = member.binding["model_versions"]
    calls = []

    def parse(data, filename, **options):
        first, last = options["page_range"]
        assert last - first + 1 <= 2
        if pair_exhausted and last > first:
            return ParseResult(
                kind="unknown",
                parser_revision=revision,
                status="failed",
                coverage=[
                    CoverageIssue(
                        code="pdf_parser_limit", message="Synthetic CPU limit"
                    )
                ],
            )
        calls.append((first, last))
        return ParseResult(
            kind="strategy",
            parser_revision=revision,
            parser_versions=model_versions,
            passages=[
                ParsedPassage(
                    source_kind="strategy",
                    text=f"Synthetic page {page}",
                    locator=PDFLocator(page=page),
                )
                for page in range(first, last + 1)
            ],
        )

    monkeypatch.setattr("app.ingestion.parse_pdf", parse)
    ingest_source([run_id, generation, version])
    ingest_source([run_id, generation, version])
    assert [page for first, last in calls for page in range(first, last + 1)] == list(
        range(1, 8)
    )
    assert len(client.get(f"/api/v1/runs/{run_id}/evidence").json()["items"]) == 7


def test_ingestion_reuses_committed_parsing_for_identical_sources(client, monkeypatch):
    from test_ingestion_cache import feedback, frozen_run
    from test_uploads import workbook as source_workbook

    from app.ingestion import ingest_source

    data = source_workbook()
    first = frozen_run(client, data=data)
    second = frozen_run(client, data=data)
    calls = []

    def parse(data, binding):
        calls.append(binding["dataset_namespace"])
        return feedback(binding)

    monkeypatch.setattr("app.ingestion.parse_excel_bounded", parse)
    for run_id, generation, version, _ in (first, second):
        ingest_source([run_id, generation, version])
    assert len(calls) == 1
    with Session() as session:
        first_evidence = session.scalar(
            select(RunEvidence).where(RunEvidence.run_id == first[0])
        )
        second_evidence = session.scalar(
            select(RunEvidence).where(RunEvidence.run_id == second[0])
        )
        assert first_evidence.evidence_id != second_evidence.evidence_id
        reads = session.scalars(
            select(Audit).where(
                Audit.run_id.in_([first[0], second[0]]), Audit.action == "source.read"
            )
        ).all()
        assert len(reads) == 2
        assert all(read.actor_type == "service" for read in reads)


def test_transient_parser_failure_does_not_poison_next_run(client, monkeypatch):
    from test_ingestion_cache import feedback, frozen_run
    from test_uploads import workbook as source_workbook

    from app.ingest_types import CoverageIssue, ParseResult
    from app.ingestion import ingest_source

    data = source_workbook()
    first, second = frozen_run(client, data=data), frozen_run(client, data=data)
    calls = []

    def parse(data, binding):
        calls.append(binding["dataset_namespace"])
        if len(calls) == 1:
            return ParseResult(
                kind="unknown",
                parser_revision=binding["parser_revision"],
                status="failed",
                coverage=[
                    CoverageIssue(
                        code="transient_limit", message="Synthetic parser limit"
                    )
                ],
            )
        return feedback(binding)

    monkeypatch.setattr("app.ingestion.parse_excel_bounded", parse)
    for run_id, generation, version, _ in (first, second):
        ingest_source([run_id, generation, version])
    assert len(calls) == 2
    with Session() as session:
        assert (
            session.scalar(select(RunEvidence).where(RunEvidence.run_id == first[0]))
            is None
        )
        assert (
            session.scalar(select(RunEvidence).where(RunEvidence.run_id == second[0]))
            is not None
        )


def test_uploaded_feedback_runs_through_durable_ingestion_and_replays(client):
    from app.ingestion import ingest_source, join_ingestion

    data = workbook({"Feedback_Explorer": [FEEDBACK_HEADERS, feedback_row()]})
    uploaded = client.post(
        "/api/v1/uploads",
        files={"files": ("synthetic.xlsx", data)},
        headers={"Idempotency-Key": str(uuid4())},
    )
    response = client.post(
        "/api/v1/runs",
        json={
            "vehicle_id": "vehicle_demo",
            "baseline_asset_id": "asset_demo_v1",
            "part_catalog_version": "catalog_demo_v1",
            "source_ids": [uploaded.json()["sources"][0]["source_id"]],
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 202
    run_id = response.json()["run_id"]
    with Session.begin() as session:
        for member in session.scalars(
            select(RunSource).where(RunSource.run_id == run_id)
        ):
            member.binding = member.binding | {"workflow_revision": "ingestion-v1"}
    with Session() as session:
        command_id = session.scalar(select(Command.id).where(Command.run_id == run_id))

    async def scenario():
        temporal = await Client.connect(Settings().temporal_address)
        with ThreadPoolExecutor(max_workers=4) as executor:
            async with Worker(
                temporal,
                task_queue="ingestion-" + run_id,
                workflows=[AnalysisWorkflow],
                activities=[
                    source_check,
                    complete_foundation,
                    fail_analysis,
                    ingest_source,
                    join_ingestion,
                ],
                activity_executor=executor,
            ):
                await dispatch_once(temporal, "ingestion-" + run_id, command_id)
                handle = temporal.get_workflow_handle("command-" + command_id)
                await asyncio.wait_for(handle.result(), 60)
                history = await handle.fetch_history()
            await Replayer(workflows=[AnalysisWorkflow]).replay_workflow(history)

    asyncio.run(scenario())
    with Session() as session:
        run = session.get(Run, run_id)
        assert run.stage == "ingestion_ready"
        assert (
            len(
                session.scalars(
                    select(RunEvidence).where(RunEvidence.run_id == run_id)
                ).all()
            )
            == 1
        )
        generation, sequence = run.generation_id, run.event_sequence
    with Session() as session:
        version = session.scalar(
            select(RunEvidence).where(RunEvidence.run_id == run_id)
        ).evidence_id
    from app.db import EvidenceArtifact

    with Session() as session:
        source_version = session.get(EvidenceArtifact, version).source_version_id
    ingest_source([run_id, generation, source_version])
    join_ingestion([run_id, generation])
    assert (
        client.get(f"/api/v1/runs/{run_id}").json()["last_event_sequence"] == sequence
    )
