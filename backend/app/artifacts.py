"""Persisted stage references, shared by analysis and downstream jobs."""

from typing import Any

from sqlalchemy import select

from app.commands import emit
from app.db import Run, Session, StageOutput, Workspace


def get_stage(run_id: str, generation: str, key: str) -> dict[str, Any] | None:
    with Session() as session:
        output = session.get(StageOutput, (run_id, generation, key))
        return output.payload if output else None


def put_stage(
    run_id: str,
    generation: str,
    key: str,
    payload: dict[str, Any],
    event_type: str = "analysis.updated",
) -> None:
    with Session.begin() as session:
        run = session.get(Run, run_id)
        if run is None:
            raise ValueError("Run not found")
        session.scalar(
            select(Workspace).where(Workspace.id == run.workspace_id).with_for_update()
        )
        run = session.scalar(
            select(Run)
            .where(Run.id == run_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if run is None or run.generation_id != generation:
            raise ValueError("Superseded run generation")
        if session.get(StageOutput, (run_id, generation, key)) is not None:
            return
        session.add(
            StageOutput(
                run_id=run_id, generation_id=generation, stage_key=key, payload=payload
            )
        )
        if key in {"findings", "baselines"}:
            run.stage = key
            if payload.get("status") == "failed":
                run.analysis_status = "failed"
            for warning in payload.get("coverage", []):
                if warning not in run.warnings:
                    run.warnings = [*run.warnings, warning]
        emit(session, run, event_type, key.split(":", 1)[0], run_id)
        if key == "findings":
            emit(session, run, "graph.updated", "graph", run_id)
            emit(session, run, "part_counts.updated", "part_counts", run_id)
