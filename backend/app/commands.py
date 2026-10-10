import hashlib
import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from opentelemetry import propagate, trace
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from app import wire as w
from app.auth import Actor, reject
from app.db import Audit, Command, Event, Membership, Run, Session, Workspace


def new_id() -> str:
    return str(uuid4())


def audit(
    session: DBSession,
    actor: Actor,
    action: str,
    resource_id: str,
    run_id: str | None = None,
) -> None:
    session.add(
        Audit(
            id=new_id(),
            workspace_id=actor.workspace_id,
            run_id=run_id,
            actor_id=actor.actor_id,
            actor_type=actor.actor_type,
            action=action,
            resource_id=resource_id,
        )
    )


def command(
    actor: Actor,
    operation: str,
    key: str,
    body: dict[str, Any],
    effect: Callable[[DBSession, str], dict[str, Any]],
    *,
    run_id: str | None = None,
) -> dict[str, Any]:
    fingerprint = hashlib.sha256(
        json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    with Session.begin() as session:
        # shortcut: serialize workspace commands; use per-resource locks if contention is measured.
        session.scalar(
            select(Workspace)
            .where(Workspace.id == actor.workspace_id)
            .with_for_update()
        )
        previous = session.scalar(
            select(Command).where(
                Command.workspace_id == actor.workspace_id,
                Command.actor_id == actor.actor_id,
                Command.operation == operation,
                Command.idempotency_key == key,
            )
        )
        if previous:
            trace.get_current_span().set_attribute("command.id", previous.id)
            if previous.body_hash != fingerprint:
                reject(
                    "idempotency_conflict",
                    "Idempotency key was used with a different body",
                    409,
                )
            return previous.result
        command_id = new_id()
        trace.get_current_span().set_attribute("command.id", command_id)
        result = effect(session, command_id)
        context: dict[str, str] = {}
        propagate.inject(context)
        if result.get("run_id"):
            trace.get_current_span().set_attribute("run.id", result["run_id"])
        session.add(
            Command(
                id=command_id,
                workspace_id=actor.workspace_id,
                actor_id=actor.actor_id,
                operation=operation,
                idempotency_key=key,
                body_hash=fingerprint,
                body=body,
                result=result,
                run_id=run_id or result.get("run_id"),
                trace_context=context,
            )
        )
        audit(
            session,
            actor,
            operation,
            result.get("resource_id", command_id),
            run_id or result.get("run_id"),
        )
        return result


def owned_run(session: DBSession, actor: Actor, run_id: str, lock: bool = False) -> Run:
    if session.get(Membership, (actor.workspace_id, actor.actor_id)) is None:
        reject("forbidden", "Workspace membership is no longer active", 403)
    query = select(Run).where(Run.id == run_id, Run.workspace_id == actor.workspace_id)
    if lock:
        query = query.with_for_update()
    run = session.scalar(query)
    if run is None:
        reject("not_found", "Run not found", 404)
    return run


def emit(
    session: DBSession, run: Run, event_type: str, resource_type: str, resource_id: str
) -> None:
    # Caller holds the run row lock; state and watermark commit in this transaction.
    run.event_sequence += 1
    run.revision += 1
    event = w.Event.model_validate(
        {
            "event_id": new_id(),
            "sequence": run.event_sequence,
            "run_id": run.id,
            "type": event_type,
            "occurred_at": datetime.now(UTC),
            "resource": {
                "type": resource_type,
                "id": resource_id,
                "revision": run.revision,
            },
            "proposal_set_version": run.current_proposal_set_version,
        }
    )
    session.add(
        Event(
            id=event.event_id,
            run_id=run.id,
            sequence=event.sequence,
            payload=event.model_dump(mode="json"),
        )
    )
