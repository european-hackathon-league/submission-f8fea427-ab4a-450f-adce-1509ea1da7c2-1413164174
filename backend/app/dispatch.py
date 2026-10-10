import asyncio
from datetime import timedelta

from opentelemetry.propagate import extract
from sqlalchemy import select
from temporalio.client import Client
from temporalio.common import WorkflowIDReusePolicy
from temporalio.exceptions import WorkflowAlreadyStartedError
from temporalio.service import RPCError

from app.db import Command, Outbox, Run, RunSource, Session
from app.telemetry import tracer
from app.workflows import AnalysisWorkflow


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
        run_id = accepted.result["run_id"]
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
        intent.attempts += 1
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
                AnalysisWorkflow.run,
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
