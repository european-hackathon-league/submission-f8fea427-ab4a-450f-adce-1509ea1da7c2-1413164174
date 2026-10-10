import asyncio
from datetime import timedelta

from opentelemetry.propagate import extract
from sqlalchemy import select
from temporalio.client import Client
from temporalio.common import WorkflowIDReusePolicy
from temporalio.exceptions import WorkflowAlreadyStartedError
from temporalio.service import RPCError

from app.db import Command, Outbox, Run, RunSource, Session, StageOutput
from app.telemetry import tracer
from app.workflows import AnalysisWorkflow, DeliveryWorkflow


async def dispatch_once(
    client: Client,
    task_queue: str = "vehicle-backend",
    command_id: str | None = None,
    acknowledge: bool = True,
) -> bool:
    with Session.begin() as session:
        query = (
            select(Outbox)
            .where(Outbox.delivered.is_(False))
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if command_id:
            query = query.where(Outbox.command_id == command_id)
        intent = session.scalar(query)
        if intent is None:
            return False
        accepted = session.get(Command, intent.command_id)
        if accepted is None:
            raise ValueError("Outbox command missing")
        run_id = accepted.run_id or accepted.result.get("run_id")
        run = session.get(Run, run_id)
        if run is None:
            raise ValueError("Outbox run missing")
        manifest: dict[str, str | list[str]] = {
            "run_id": run.id,
            "generation_id": run.generation_id,
            "source_version_ids": list(
                session.scalars(
                    select(RunSource.source_version_id).where(
                        RunSource.run_id == run.id
                    )
                )
            ),
        }
        bindings = session.scalars(
            select(RunSource).where(RunSource.run_id == run.id)
        ).all()
        if bindings:
            revision = bindings[0].binding.get("workflow_revision")
            if revision in {"ingestion-v1", "analysis-v1"} and all(
                member.binding.get("workflow_revision") == revision
                for member in bindings
            ):
                manifest["pipeline_version"] = revision
        if accepted.operation != "runs":
            resource_id = accepted.result.get("resource_id", accepted.id)
            artifact_id = (
                accepted.id if accepted.operation == "continuation" else resource_id
            )
            stage = session.scalar(
                select(StageOutput).where(
                    StageOutput.run_id == run.id,
                    StageOutput.stage_key == f"{accepted.operation}:{artifact_id}",
                )
            )
            if stage is None:
                raise ValueError("Accepted command artifact missing")
            manifest.update(
                generation_id=stage.generation_id,
                operation=accepted.operation,
                resource_id=resource_id,
                command_id=accepted.id,
            )
        intent.attempts += 1
        if accepted.operation == "continuation":
            if stage is None:
                raise ValueError("Continuation artifact missing")
            initial = session.scalar(
                select(Command).where(
                    Command.run_id == run.id, Command.operation == "runs"
                )
            )
            if initial is None:
                raise ValueError("Analysis command missing")
            try:
                await client.get_workflow_handle("command-" + initial.id).signal(
                    "continue_analysis",
                    {
                        "command_id": accepted.id,
                        "checkpoint_id": str(stage.payload["checkpoint_id"]),
                    },
                    rpc_timeout=timedelta(seconds=5),
                )
            except RPCError, RuntimeError, TimeoutError:
                return False
            intent.delivered = acknowledge
            return True
        with tracer.start_as_current_span(
            "command.dispatch",
            context=extract(accepted.trace_context),
            attributes={
                "run.id": run.id,
                "command.id": accepted.id,
                "workflow.id": "command-" + accepted.id,
            },
            record_exception=False,
            set_status_on_exception=False,
        ):
            return await _start(
                client, task_queue, accepted.id, manifest, intent, acknowledge
            )


async def _start(
    client: Client,
    task_queue: str,
    command_id: str,
    manifest: dict[str, str | list[str]],
    intent: Outbox,
    acknowledge: bool,
) -> bool:
    try:
        await asyncio.wait_for(
            client.start_workflow(
                DeliveryWorkflow.run
                if "operation" in manifest
                else AnalysisWorkflow.run,
                manifest,
                id="command-" + command_id,
                task_queue=task_queue,
                id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
                rpc_timeout=timedelta(seconds=5),
            ),
            timeout=10,
        )
    except WorkflowAlreadyStartedError:
        pass
    except RPCError, RuntimeError, TimeoutError:
        return False
    intent.delivered = acknowledge
    return True
