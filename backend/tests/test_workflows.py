import asyncio
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import select
from temporalio import activity
from temporalio.client import Client
from temporalio.worker import Replayer, Worker
from test_runs import create_run

from app.activities import complete_foundation, fail_analysis, source_check
from app.config import Settings
from app.db import Command, Outbox, Run, Session, StageOutput
from app.dispatch import dispatch_once
from app.workflows import AnalysisWorkflow


def test_workflow_patch_replays_history_recorded_before_the_code_change(client):
    from helpers.legacy_workflow import LegacyAnalysisWorkflow

    async def scenario():
        run_id, _ = create_run(client)
        with Session() as session:
            command_id = session.scalar(
                select(Command).where(
                    Command.operation == "runs",
                    Command.result["run_id"].astext == run_id,
                )
            ).id
        temporal = await Client.connect(Settings().temporal_address)
        queue = "legacy-" + str(uuid4())
        with ThreadPoolExecutor(max_workers=4) as executor:
            async with Worker(
                temporal,
                task_queue=queue,
                workflows=[LegacyAnalysisWorkflow],
                activities=[source_check, complete_foundation],
                activity_executor=executor,
            ):
                await dispatch_once(temporal, queue, command_id)
                handle = temporal.get_workflow_handle("command-" + command_id)
                await asyncio.wait_for(handle.result(), 30)
                history = await handle.fetch_history()
        await Replayer(workflows=[AnalysisWorkflow]).replay_workflow(history)

    asyncio.run(scenario())


def test_temporal_dispatch_recovery_effect_deduplication_and_replay(client):
    async def scenario():
        run_id, _ = create_run(client)
        with Session() as session:
            accepted = session.scalar(
                select(Command).where(
                    Command.operation == "runs",
                    Command.result["run_id"].astext == run_id,
                )
            )
            command_id = accepted.id
        temporal = await Client.connect(Settings().temporal_address)
        queue = "test-" + str(uuid4())
        with ThreadPoolExecutor(max_workers=4) as executor:
            async with Worker(
                temporal,
                task_queue=queue,
                workflows=[AnalysisWorkflow],
                activities=[source_check, complete_foundation],
                activity_executor=executor,
            ):
                assert await dispatch_once(
                    temporal, queue, command_id, acknowledge=False
                )
                assert await dispatch_once(temporal, queue, command_id)
                handle = temporal.get_workflow_handle("command-" + command_id)
                await asyncio.wait_for(handle.result(), 30)
                history = await handle.fetch_history()
                await Replayer(workflows=[AnalysisWorkflow]).replay_workflow(history)
                with Session() as session:
                    outputs = session.scalars(
                        select(StageOutput).where(StageOutput.run_id == run_id)
                    ).all()
                    assert len(outputs) == 2
                    assert session.get(Run, run_id).stage == "foundation_ready"
                # Repeating the database Activity after a lost acknowledgement changes nothing.
                with Session() as session:
                    run = session.get(Run, run_id)
                    generation = run.generation_id
                    sequence = run.event_sequence
                complete_foundation([run_id, generation])
                with Session() as session:
                    assert session.get(Run, run_id).event_sequence == sequence

    asyncio.run(scenario())


def test_temporal_outage_keeps_dispatch_intent_and_attempt_record(client):
    async def scenario():
        run_id, _ = create_run(client)
        with Session() as session:
            command_id = session.scalar(
                select(Command).where(
                    Command.operation == "runs",
                    Command.result["run_id"].astext == run_id,
                )
            ).id
        unavailable = await Client.connect("127.0.0.1:1", lazy=True)
        assert await dispatch_once(unavailable, command_id=command_id) is False
        with Session() as session:
            intent = session.get(Outbox, command_id)
            assert intent.delivered is False
            assert intent.attempts == 1
            assert session.get(Run, run_id).analysis_status == "queued"

    asyncio.run(scenario())


def test_worker_process_death_after_commit_recovers_without_duplicate_effect(client):
    async def scenario():
        run_id, _ = create_run(client)
        with Session() as session:
            command_id = session.scalar(
                select(Command).where(
                    Command.operation == "runs",
                    Command.result["run_id"].astext == run_id,
                )
            ).id
        temporal = await Client.connect(Settings().temporal_address)
        queue = "crash-" + str(uuid4())
        await dispatch_once(temporal, queue, command_id)
        process = subprocess.Popen(
            [sys.executable, "tests/helpers/crash_worker.py"],
            env=os.environ | {"TEST_TASK_QUEUE": queue, "PYTHONPATH": os.getcwd()},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            assert await asyncio.to_thread(process.wait, 20) == 23
            with Session() as session:
                assert (
                    len(
                        session.scalars(
                            select(StageOutput).where(StageOutput.run_id == run_id)
                        ).all()
                    )
                    == 1
                )
            with ThreadPoolExecutor(max_workers=4) as executor:
                async with Worker(
                    temporal,
                    task_queue=queue,
                    workflows=[AnalysisWorkflow],
                    activities=[source_check, complete_foundation],
                    activity_executor=executor,
                ):
                    await asyncio.wait_for(
                        temporal.get_workflow_handle("command-" + command_id).result(),
                        35,
                    )
            with Session() as session:
                assert (
                    len(
                        session.scalars(
                            select(StageOutput).where(StageOutput.run_id == run_id)
                        ).all()
                    )
                    == 2
                )
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)

    asyncio.run(scenario())


def test_independent_activities_overlap_and_respect_concurrency_bound(client):
    from test_uploads import workbook

    source_ids = []
    for index in range(3):
        response = client.post(
            "/api/v1/uploads",
            files={"files": (f"synthetic-{index}.xlsx", workbook())},
            headers={"Idempotency-Key": str(uuid4())},
        )
        source_ids.append(response.json()["sources"][0]["source_id"])
    response = client.post(
        "/api/v1/runs",
        json={
            "vehicle_id": "vehicle_demo",
            "baseline_asset_id": "asset_demo_v1",
            "part_catalog_version": "catalog_demo_v1",
            "source_ids": source_ids,
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    run_id = response.json()["run_id"]
    active = 0
    maximum = 0
    lock = threading.Lock()

    @activity.defn(name="source_check")
    def observed(args):
        nonlocal active, maximum
        with lock:
            active += 1
            maximum = max(maximum, active)
        try:
            time.sleep(0.2)
            return source_check(args)
        finally:
            with lock:
                active -= 1

    async def scenario():
        temporal = await Client.connect(Settings().temporal_address)
        queue = "overlap-" + str(uuid4())
        with Session() as session:
            command_id = session.scalar(
                select(Command).where(
                    Command.operation == "runs",
                    Command.result["run_id"].astext == run_id,
                )
            ).id
        with ThreadPoolExecutor(max_workers=4) as executor:
            async with Worker(
                temporal,
                task_queue=queue,
                workflows=[AnalysisWorkflow],
                activities=[observed, complete_foundation],
                activity_executor=executor,
            ):
                await dispatch_once(temporal, queue, command_id)
                assert (
                    len(
                        await asyncio.wait_for(
                            temporal.get_workflow_handle(
                                "command-" + command_id
                            ).result(),
                            30,
                        )
                    )
                    == 3
                )
        assert maximum == 2

    asyncio.run(scenario())


def test_retry_exhaustion_publishes_failure_once_and_retains_sources(client):
    from temporalio.client import WorkflowFailureError

    @activity.defn(name="source_check")
    def failing(args):
        raise ValueError("Synthetic failure")

    async def scenario():
        run_id, _ = create_run(client)
        with Session() as session:
            accepted = session.scalar(select(Command).where(Command.run_id == run_id))
            command_id = accepted.id
            generation = session.get(Run, run_id).generation_id
        temporal = await Client.connect(Settings().temporal_address)
        queue = "failure-" + str(uuid4())
        with ThreadPoolExecutor(max_workers=4) as executor:
            async with Worker(
                temporal,
                task_queue=queue,
                workflows=[AnalysisWorkflow],
                activities=[failing, complete_foundation, fail_analysis],
                activity_executor=executor,
            ):
                await dispatch_once(temporal, queue, command_id)
                with pytest.raises(WorkflowFailureError):
                    await asyncio.wait_for(
                        temporal.get_workflow_handle("command-" + command_id).result(),
                        30,
                    )
        snapshot = client.get(f"/api/v1/runs/{run_id}").json()
        assert snapshot["analysis_status"] == "failed"
        assert snapshot["last_event_sequence"] == 2
        fail_analysis([run_id, generation])
        assert client.get(f"/api/v1/runs/{run_id}").json() == snapshot
        assert snapshot["config"]["source_ids"]

    asyncio.run(scenario())


def test_request_outbox_dispatch_activity_share_one_sanitized_trace(client):
    from opentelemetry import trace
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
        InMemorySpanExporter,
    )
    from temporalio.contrib.opentelemetry import TracingInterceptor

    exporter = InMemorySpanExporter()
    trace.get_tracer_provider().add_span_processor(SimpleSpanProcessor(exporter))

    async def scenario():
        run_id, _ = create_run(client)
        with Session() as session:
            accepted = session.scalar(select(Command).where(Command.run_id == run_id))
            command_id = accepted.id
            assert set(accepted.trace_context) <= {"traceparent", "tracestate"}
            assert accepted.trace_context["traceparent"]
        temporal = await Client.connect(
            Settings().temporal_address, interceptors=[TracingInterceptor()]
        )
        queue = "trace-" + str(uuid4())
        with ThreadPoolExecutor(max_workers=4) as executor:
            async with Worker(
                temporal,
                task_queue=queue,
                workflows=[AnalysisWorkflow],
                activities=[source_check, complete_foundation, fail_analysis],
                activity_executor=executor,
            ):
                await dispatch_once(temporal, queue, command_id)
                await asyncio.wait_for(
                    temporal.get_workflow_handle("command-" + command_id).result(), 30
                )
        spans = exporter.get_finished_spans()
        dispatch = next(span for span in spans if span.name == "command.dispatch")
        command_span = next(
            span
            for span in spans
            if span.attributes.get("command.id") == command_id
            and span.name != "command.dispatch"
        )
        assert command_span.attributes["run.id"] == run_id
        api = next(
            span
            for span in spans
            if span.name == "api.request"
            and span.context.trace_id == dispatch.context.trace_id
        )
        activity_span = next(
            span for span in spans if span.name == "activity.source_check"
        )
        assert (
            api.context.trace_id
            == dispatch.context.trace_id
            == activity_span.context.trace_id
        )
        assert api.attributes["request.id"]
        assert activity_span.attributes["run.id"] == run_id
        assert activity_span.attributes["workflow.id"] == "command-" + command_id
        assert "seat is uncomfortable" not in str(
            [dict(span.attributes) for span in spans]
        )

    asyncio.run(scenario())
