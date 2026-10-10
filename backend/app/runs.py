import json
from typing import Any

from fastapi.sse import ServerSentEvent
from sqlalchemy import select

from app import wire as w
from app.auth import Actor, reject
from app.commands import owned_run
from app.config import Settings
from app.db import Event, Session


def catalog() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(Settings().catalog_path.read_text())
    return data


def snapshot(identity: Actor, run_id: str) -> w.Snapshot:
    with Session() as session:
        run = owned_run(session, identity, run_id)
        return w.Snapshot.model_validate(
            {
                "run_id": run.id,
                "config": run.config,
                "analysis_status": run.analysis_status,
                "stage": run.stage,
                "revision": run.revision,
                "last_event_sequence": run.event_sequence,
                "current_proposal_set_version": run.current_proposal_set_version,
                "available_actions": [],
                "warnings": run.warnings,
                "resource_links": {
                    name: f"/api/v1/runs/{run.id}/{name}"
                    for name in (
                        "findings",
                        "graph",
                        "research",
                        "conflicts",
                        "proposals",
                        "history",
                    )
                },
            }
        )


def cursor(
    identity: Actor,
    run_id: str,
    last_event_id: str | None,
    after_sequence: int | None = None,
) -> int:
    with Session() as session:
        run = owned_run(session, identity, run_id)
        oldest = max(0, run.event_sequence - Settings().event_retention)
        if after_sequence is not None:
            if last_event_id is not None or after_sequence > run.event_sequence:
                reject(
                    "invalid_cursor",
                    "Use one valid cursor within the run watermark",
                    422,
                )
            if after_sequence < oldest:
                reject("replay_expired", "Fetch a fresh run snapshot", 410)
            return after_sequence
        if last_event_id is None:
            return oldest
        row = session.scalar(
            select(Event).where(Event.id == last_event_id, Event.run_id == run_id)
        )
        if row is None or row.sequence < oldest:
            reject(
                "replay_expired",
                "Fetch a fresh run snapshot and resume from its watermark",
                410,
            )
        return row.sequence


def backlog(identity: Actor, run_id: str, sequence: int) -> list[ServerSentEvent]:
    with Session() as session:
        owned_run(session, identity, run_id)
        rows = session.scalars(
            select(Event)
            .where(Event.run_id == run_id, Event.sequence > sequence)
            .order_by(Event.sequence)
            .limit(100)
        ).all()
        return [
            ServerSentEvent(id=row.id, event=row.payload["type"], data=row.payload)
            for row in rows
        ]
