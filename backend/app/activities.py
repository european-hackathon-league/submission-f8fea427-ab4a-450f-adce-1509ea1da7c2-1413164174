from opentelemetry import trace
from sqlalchemy import select
from temporalio import activity

from app.commands import emit
from app.db import Run, RunSource, Session, StageOutput
from app.telemetry import tracer


@activity.defn
@tracer.start_as_current_span(
    "activity.source_check", record_exception=False, set_status_on_exception=False
)
def source_check(args: list[str]) -> str:
    run_id, generation, source_version_id = args
    trace.get_current_span().set_attribute("run.id", run_id)
    if activity.in_activity():
        trace.get_current_span().set_attribute(
            "workflow.id", activity.info().workflow_id
        )
        activity.heartbeat(source_version_id)
    with Session.begin() as session:
        run = session.scalar(select(Run).where(Run.id == run_id).with_for_update())
        if run is None or run.generation_id != generation:
            raise ValueError("Superseded run generation")
        if session.get(RunSource, (run_id, source_version_id)) is None:
            raise ValueError("Source outside frozen manifest")
        key = (run_id, generation, source_version_id)
        if session.get(StageOutput, key) is None:
            session.add(
                StageOutput(
                    run_id=run_id,
                    generation_id=generation,
                    stage_key=source_version_id,
                    payload={
                        "source_version_id": source_version_id,
                        "status": "checked",
                    },
                )
            )
        return source_version_id


@activity.defn
@tracer.start_as_current_span(
    "activity.complete_foundation",
    record_exception=False,
    set_status_on_exception=False,
)
def complete_foundation(args: list[str]) -> None:
    run_id, generation = args
    with Session.begin() as session:
        run = session.scalar(select(Run).where(Run.id == run_id).with_for_update())
        if run is None or run.generation_id != generation:
            raise ValueError("Superseded run generation")
        if session.get(StageOutput, (run_id, generation, "foundation")) is not None:
            return
        members = session.scalars(
            select(RunSource.source_version_id).where(RunSource.run_id == run_id)
        ).all()
        if not all(
            session.get(StageOutput, (run_id, generation, member)) for member in members
        ):
            raise ValueError("Cannot publish an incomplete join")
        session.add(
            StageOutput(
                run_id=run_id,
                generation_id=generation,
                stage_key="foundation",
                payload={"source_version_ids": list(members)},
            )
        )
        run.analysis_status = "processing"
        run.stage = "foundation_ready"
        bindings = session.scalars(
            select(RunSource).where(RunSource.run_id == run_id)
        ).all()
        if not bindings or not all(
            binding.binding.get("workflow_revision") in {"ingestion-v1", "analysis-v1"}
            for binding in bindings
        ):
            run.warnings = [*run.warnings, "Source ingestion is pending implementation"]
        emit(session, run, "analysis.updated", "analysis", run.id)


@activity.defn
def fail_analysis(args: list[str]) -> None:
    run_id, generation = args
    with Session.begin() as session:
        run = session.scalar(select(Run).where(Run.id == run_id).with_for_update())
        if (
            run is None
            or run.generation_id != generation
            or run.analysis_status == "failed"
        ):
            return
        run.analysis_status = "failed"
        run.stage = "failed"
        run.warnings = [*run.warnings, "Stage retries exhausted; source data retained"]
        emit(session, run, "analysis.updated", "analysis", run.id)
