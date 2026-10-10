"""Outbox routing checks use recorded Temporal calls, never a live server."""

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select
from test_ingestion_cache import frozen_run

from app.db import Command, Outbox, Run, Session, StageOutput
from app.dispatch import _start, dispatch_once
from app.workflows import AnalysisWorkflow, DeliveryWorkflow


class RecordingTemporal:
    def __init__(self, signal_failures=0):
        self.starts = []
        self.signals = []
        self.signal_failures = signal_failures

    async def start_workflow(self, workflow, manifest, **options):
        self.starts.append((workflow, manifest, options))

    def get_workflow_handle(self, workflow_id):
        async def signal(name, message, **options):
            self.signals.append((workflow_id, name, message, options))
            if self.signal_failures:
                self.signal_failures -= 1
                raise TimeoutError("Synthetic signal timeout")

        return SimpleNamespace(signal=signal)


def queue_delivery(run_id, generation, operation, resource_id=None):
    command_id = str(uuid4())
    resource_id = resource_id or str(uuid4())
    stage_key = (
        f"{operation}:{command_id if operation == 'continuation' else resource_id}"
    )
    with Session.begin() as session:
        run = session.get(Run, run_id)
        session.add(
            Command(
                id=command_id,
                workspace_id=run.workspace_id,
                actor_id="pm_demo",
                operation=operation,
                idempotency_key=str(uuid4()),
                body_hash="synthetic",
                run_id=run_id,
                body={},
                result={"resource_id": resource_id, "resource_url": "/synthetic"},
                trace_context={},
            )
        )
        session.flush()
        session.add(Outbox(command_id=command_id))
        if session.get(StageOutput, (run_id, generation, stage_key)) is None:
            session.add(
                StageOutput(
                    run_id=run_id,
                    generation_id=generation,
                    stage_key=stage_key,
                    payload={"checkpoint_id": resource_id},
                )
            )
    return command_id, resource_id


@pytest.mark.parametrize("operation", [None, "export", "render", "instruction"])
def test_start_selects_workflow_from_bound_operation_without_a_database(
    monkeypatch, operation
):
    temporal = RecordingTemporal()
    intent = SimpleNamespace(delivered=False)
    manifest = {
        "run_id": "synthetic-run",
        "generation_id": "synthetic-generation",
        "source_version_ids": [],
    }
    if operation is not None:
        manifest["operation"] = operation
        manifest["resource_id"] = "synthetic-resource"
    assert asyncio.run(
        _start(temporal, "synthetic-queue", "synthetic-command", manifest, intent, True)
    )
    assert temporal.starts[0][0] == (
        AnalysisWorkflow.run if operation is None else DeliveryWorkflow.run
    )
    assert temporal.starts[0][2]["id"] == "command-synthetic-command"
    assert intent.delivered


@pytest.mark.parametrize("operation", ["export", "render", "instruction"])
def test_downstream_dispatch_uses_command_run_id_and_original_stage_generation(
    client, operation
):
    run_id, generation, _, _ = frozen_run(client)
    command_id, resource = queue_delivery(run_id, generation, operation)
    newer_generation = str(uuid4())
    with Session.begin() as session:
        session.get(Run, run_id).generation_id = newer_generation
    temporal = RecordingTemporal()
    assert asyncio.run(dispatch_once(temporal, command_id=command_id))
    workflow, manifest, options = temporal.starts[0]
    assert workflow == DeliveryWorkflow.run
    assert manifest["run_id"] == run_id
    assert manifest["generation_id"] == generation
    assert manifest["generation_id"] != newer_generation
    assert manifest["resource_id"] == resource
    assert manifest["operation"] == operation
    assert options["id"] == "command-" + command_id
    with Session() as session:
        assert session.get(Outbox, command_id).delivered
        assert session.get(Outbox, command_id).attempts == 1


def test_render_retry_dispatch_preserves_original_render_resource(client):
    run_id, generation, _, _ = frozen_run(client)
    first_command, original_resource = queue_delivery(run_id, generation, "render")
    retry_command, resource = queue_delivery(
        run_id, generation, "render", original_resource
    )
    temporal = RecordingTemporal()
    assert asyncio.run(dispatch_once(temporal, command_id=first_command))
    assert asyncio.run(dispatch_once(temporal, command_id=retry_command))
    assert resource == original_resource
    assert [call[1]["resource_id"] for call in temporal.starts] == [
        original_resource,
        original_resource,
    ]
    assert [call[2]["id"] for call in temporal.starts] == [
        "command-" + first_command,
        "command-" + retry_command,
    ]


def test_guided_continuation_signals_analysis_and_retains_failed_dispatch_for_retry(
    client,
):
    run_id, generation, _, _ = frozen_run(client)
    with Session() as session:
        original_command = session.scalar(
            select(Command.id).where(
                Command.run_id == run_id, Command.operation == "runs"
            )
        )
    command_id, checkpoint = queue_delivery(run_id, generation, "continuation")
    temporal = RecordingTemporal(signal_failures=1)
    assert not asyncio.run(dispatch_once(temporal, command_id=command_id))
    with Session() as session:
        assert not session.get(Outbox, command_id).delivered
        assert session.get(Outbox, command_id).attempts == 1
    assert asyncio.run(dispatch_once(temporal, command_id=command_id))
    assert temporal.starts == []
    assert len(temporal.signals) == 2
    for workflow_id, name, message, _ in temporal.signals:
        assert workflow_id == "command-" + original_command
        assert name == "continue_analysis"
        assert message == {"command_id": command_id, "checkpoint_id": checkpoint}
    with Session() as session:
        assert session.get(Outbox, command_id).delivered
        assert session.get(Outbox, command_id).attempts == 2
