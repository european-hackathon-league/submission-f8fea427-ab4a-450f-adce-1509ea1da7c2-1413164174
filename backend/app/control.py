"""Version-bound PM commands; source artifacts and previous proposals are immutable."""

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession
from temporalio import activity

from app import wire as w
from app.auth import Actor, reject
from app.commands import command, emit, new_id, owned_run
from app.db import Audit, Outbox, Run, RunEvidence, Session, StageOutput


def resource_row(session: DBSession, run_id: str, key: str) -> StageOutput:
    row = session.scalar(
        select(StageOutput).where(
            StageOutput.run_id == run_id,
            StageOutput.stage_key == key,
        )
    )
    if row is None:
        reject("not_found", "Resource not found", 404)
    return row


def proposal_row(session: DBSession, run: Run, version: int | None) -> StageOutput:
    selected = version if version is not None else run.current_proposal_set_version
    if selected is None:
        reject("proposals_unavailable", "Proposals are not ready", 409)
    return resource_row(session, run.id, f"proposals:{selected}")


def stale(run: Run) -> None:
    raise HTTPException(
        409,
        w.Error(
            code="stale_version",
            message="Proposal version is no longer current",
            current_version=run.current_proposal_set_version,
        ).model_dump(),
    )


def require_pm(actor: Actor) -> None:
    if actor.actor_type != "pm":
        reject("human_decision_required", "A PM actor is required", 403)


def get_proposals(actor: Actor, run_id: str, version: int | None = None) -> w.Proposals:
    with Session() as session:
        run = owned_run(session, actor, run_id)
        proposals = w.Proposals.model_validate(
            proposal_row(session, run, version).payload
        )
        decisions = session.scalars(
            select(StageOutput).where(
                StageOutput.run_id == run.id,
                StageOutput.stage_key.like("decision:%"),
            )
        ).all()
        for row in sorted(
            decisions, key=lambda value: str(value.payload["occurred_at"])
        ):
            decision = row.payload
            if decision["proposal_set_version"] == proposals.proposal_set_version:
                for change in proposals.changes:
                    if change.change_id in decision["change_ids"]:
                        change.decision_state = decision["state"]
        return proposals


def accepted(
    command_id: str, run_id: str, family: str, resource_id: str | None = None
) -> dict[str, Any]:
    resource_id = resource_id or command_id
    return w.Accepted(
        command_id=command_id,
        resource_id=resource_id,
        resource_url=(
            f"/api/v1/runs/{run_id}/{family}/{resource_id}"
            if family in {"renders", "exports"}
            else f"/api/v1/runs/{run_id}"
        ),
    ).model_dump(mode="json")


EDIT_FIELDS = {
    "outcome",
    "after",
    "before",
    "part_ids",
    "horizon",
    "metric",
    "unit",
    "target",
    "target_basis",
    "conditions",
    "validation_method",
}


def apply_instruction(
    base: w.Proposals,
    instruction: w.Instruction,
    generation: str,
    planning_horizon: int | None = None,
) -> w.Proposals:
    result = base.model_copy(deep=True)
    result.generation_id = generation
    result.proposal_set_version += 1
    changes = {change.change_id: change for change in result.changes}
    variants = {variant.variant_id: variant for variant in result.variants}
    targets = instruction.target_ids
    fields = instruction.changed_fields
    operation = instruction.operation
    if operation in {"edit_change", "edit_target", "remove_change"}:
        if not targets or any(target not in changes for target in targets):
            reject(
                "invalid_target",
                "Change targets must exist in the selected version",
                422,
            )
    if operation in {"edit_change", "edit_target", "add_change"}:
        allowed = (
            EDIT_FIELDS
            if operation != "edit_target"
            else {"metric", "unit", "target", "target_basis", "validation_method"}
        )
        if not fields or set(fields) - allowed:
            reject("invalid_instruction", "Unsupported or empty changed fields", 422)
    if operation == "remove_change":
        if fields:
            reject("invalid_instruction", "Remove accepts no changed fields", 422)
        removed = set(targets)
        result.changes = [
            change for change in result.changes if change.change_id not in removed
        ]
        remaining_requirements = {change.requirement_id for change in result.changes}
        for variant in result.variants:
            variant.change_ids = [
                value for value in variant.change_ids if value not in removed
            ]
            variant.requirement_ids = [
                value
                for value in variant.requirement_ids
                if value in remaining_requirements
            ]
    elif operation in {"edit_change", "edit_target"}:
        for target in targets:
            previous = changes[target]
            value = previous.model_dump()
            value.update(fields)
            value.update(
                version=previous.version + 1,
                origin="pm",
                decision_state="proposed",
                target_maturity="needs_validation",
                score=None,
                factors=w.Factors(
                    rationales={"revision": "PM revision requires factor reassessment"}
                ),
            )
            try:
                changed = w.Change.model_validate(value)
            except ValidationError:
                reject(
                    "invalid_instruction",
                    "Changed fields do not match the requirement schema",
                    422,
                )
            changed.uncertainty = list(
                dict.fromkeys(changed.uncertainty + ["PM revision requires validation"])
            )
            result.changes[result.changes.index(previous)] = changed
    elif operation == "add_change":
        if any(target not in variants for target in targets):
            reject("invalid_target", "Variant targets must exist", 422)
        identifier = new_id()
        value = dict(
            change_id=identifier,
            requirement_id=new_id(),
            version=1,
            origin="pm",
            outcome=instruction.intent or "PM proposed customer outcome",
            part_ids=[],
            scope=w.Scope(),
            horizon=planning_horizon
            or (base.changes[0].horizon if base.changes else 2030),
            before=None,
            after=instruction.intent or "PM proposed change",
            finding_ids=[],
            supporting_evidence_ids=[],
            opposing_evidence_ids=[],
            metric=None,
            unit=None,
            target=None,
            target_basis=None,
            conditions=[],
            validation_method="Validate customer value, applicability and feasibility",
            target_maturity="needs_validation",
            factors=w.Factors(rationales={}),
            score=None,
            scoring_policy_version=result.scoring_policy_version,
            evidence_strength="low",
            uncertainty=["PM idea has no verified supporting evidence"],
            decision_state="proposed",
        )
        value.update(fields)
        try:
            change = w.Change.model_validate(value)
        except ValidationError:
            reject(
                "invalid_instruction",
                "Changed fields do not match the requirement schema",
                422,
            )
        result.changes.append(change)
        for variant in result.variants:
            if not targets or variant.variant_id in targets:
                variant.change_ids.append(change.change_id)
                variant.requirement_ids.append(change.requirement_id)
    elif operation == "regroup_variants":
        if (
            not targets
            or any(target not in variants for target in targets)
            or set(fields) not in ({"change_ids"}, {"cohort_ids"})
        ):
            reject(
                "invalid_instruction",
                "Regroup requires variants and change_ids or cohort_ids",
                422,
            )
        field = "cohort_ids" if "cohort_ids" in fields else "change_ids"
        known = (
            {cohort for variant in result.variants for cohort in variant.cohort_ids}
            | {
                cohort
                for change in result.changes
                for cohort in change.scope.cohort_ids
            }
            if field == "cohort_ids"
            else set(changes)
        )
        requested = fields[field]
        if not isinstance(requested, list) or any(
            value not in known for value in requested
        ):
            reject("invalid_target", "Regrouped changes or cohorts must exist", 422)
        for target in targets:
            if field == "cohort_ids":
                variants[target].cohort_ids = list(dict.fromkeys(requested))
            else:
                variants[target].change_ids = list(dict.fromkeys(requested))
                variants[target].requirement_ids = list(
                    dict.fromkeys(changes[value].requirement_id for value in requested)
                )
    elif operation == "request_more_variants":
        if (
            fields
            or not instruction.intent
            or any(target not in variants for target in targets)
        ):
            reject(
                "invalid_instruction",
                "More variants requires intent and valid optional variant targets",
                422,
            )
        selected = [
            variant
            for variant in result.variants
            if not targets or variant.variant_id in targets
        ]
        existing = {
            (tuple(sorted(variant.cohort_ids)), tuple(sorted(variant.change_ids)))
            for variant in result.variants
        }
        for variant in selected:
            for cohort in variant.cohort_ids:
                scoped = [
                    change
                    for change in result.changes
                    if change.change_id in variant.change_ids
                    and (
                        not change.scope.cohort_ids or cohort in change.scope.cohort_ids
                    )
                ]
                identity = (
                    (cohort,),
                    tuple(sorted(change.change_id for change in scoped)),
                )
                if not scoped or identity in existing:
                    continue
                existing.add(identity)
                result.variants.append(
                    w.Variant(
                        variant_id=new_id(),
                        title=f"{instruction.intent}: {cohort}",
                        cohort_ids=[cohort],
                        assumptions=[
                            "Uses existing cohort evidence; new customer solution remains unverified"
                        ],
                        requirement_ids=list(
                            dict.fromkeys(change.requirement_id for change in scoped)
                        ),
                        change_ids=[change.change_id for change in scoped],
                        related_variant_ids=[variant.variant_id],
                    )
                )
        result.gaps = list(
            dict.fromkeys(
                result.gaps
                + [f"Additional research needed for PM intent: {instruction.intent}"]
            )
        )
    if operation in {"edit_change", "edit_target", "add_change"}:
        for change in result.changes:
            if change.target is not None and (
                not change.metric or not change.unit or not change.target_basis
            ):
                reject(
                    "invalid_target",
                    "Numeric targets need a metric, unit and explicit basis",
                    422,
                )
            if (
                not change.after.strip()
                or not change.outcome.strip()
                or not change.validation_method.strip()
            ):
                reject(
                    "invalid_instruction",
                    "Outcome, proposed change and validation must be nonempty",
                    422,
                )
            if (
                planning_horizon is not None
                and not 1900 <= change.horizon <= planning_horizon
            ):
                reject(
                    "invalid_horizon",
                    "Change horizon exceeds the frozen planning period",
                    422,
                )
    return w.Proposals.model_validate(result.model_dump())


def instruct(actor: Actor, run_id: str, body: w.Instruction, key: str) -> w.Accepted:
    require_pm(actor)

    def effect(session: DBSession, command_id: str) -> dict[str, Any]:
        run = owned_run(session, actor, run_id, lock=True)
        if (
            run.current_proposal_set_version != body.base_proposal_set_version
            or run.analysis_status != "proposals_ready"
        ):
            stale(run)
        base = w.Proposals.model_validate(
            proposal_row(session, run, body.base_proposal_set_version).payload
        )
        generation = new_id()
        policy = session.get(StageOutput, (run.id, run.generation_id, "configuration"))
        horizon = int(policy.payload["planning_horizon"]) if policy else None
        planned = apply_instruction(base, body, generation, horizon)
        if policy:
            valid_parts = {
                value["part_id"] for value in policy.payload["catalog"]["parts"]
            }
            if any(set(change.part_ids) - valid_parts for change in planned.changes):
                reject(
                    "invalid_part",
                    "Changed parts must exist in the frozen catalog",
                    422,
                )
        previous_generation = run.generation_id
        for stage in (
            "findings",
            "baselines",
            "research",
            "research_sources",
            "conflicts",
            "configuration",
        ):
            row = session.get(StageOutput, (run.id, previous_generation, stage))
            if row is not None:
                session.add(
                    StageOutput(
                        run_id=run.id,
                        generation_id=generation,
                        stage_key=stage,
                        payload=deepcopy(row.payload),
                    )
                )
        for evidence_id in session.scalars(
            select(RunEvidence.evidence_id).where(
                RunEvidence.run_id == run.id,
                RunEvidence.generation_id == previous_generation,
            )
        ):
            session.add(
                RunEvidence(
                    run_id=run.id, generation_id=generation, evidence_id=evidence_id
                )
            )
        session.add(
            StageOutput(
                run_id=run.id,
                generation_id=generation,
                stage_key=f"instruction:{command_id}",
                payload=planned.model_dump(mode="json"),
            )
        )
        run.generation_id = generation
        run.analysis_status = "processing"
        run.stage = "proposal_refinement"
        session.add(Outbox(command_id=command_id))
        emit(session, run, "analysis.updated", "instruction", command_id)
        return accepted(command_id, run_id, "instructions")

    return w.Accepted.model_validate(
        command(
            actor,
            "instruction",
            key,
            {"run_id": run_id, **body.model_dump(mode="json")},
            effect,
            run_id=run_id,
        )
    )


@activity.defn
def refine_proposals(args: list[str]) -> str:
    run_id, generation, command_id = args
    with Session.begin() as session:
        run = session.scalar(select(Run).where(Run.id == run_id).with_for_update())
        if run is None or run.generation_id != generation:
            return "superseded"
        planned = w.Proposals.model_validate(
            resource_row(session, run_id, f"instruction:{command_id}").payload
        )
        key = (run_id, generation, f"proposals:{planned.proposal_set_version}")
        if session.get(StageOutput, key) is None:
            session.add(
                StageOutput(
                    run_id=run_id,
                    generation_id=generation,
                    stage_key=key[2],
                    payload=planned.model_dump(mode="json"),
                )
            )
            run.current_proposal_set_version = planned.proposal_set_version
            run.analysis_status = "proposals_ready"
            run.stage = "proposals"
            emit(
                session,
                run,
                "proposals.ready",
                "proposals",
                str(planned.proposal_set_version),
            )
        return "ready"


def decide(actor: Actor, run_id: str, body: w.Decision, key: str) -> w.Accepted:
    require_pm(actor)

    def effect(session: DBSession, command_id: str) -> dict[str, Any]:
        run = owned_run(session, actor, run_id, lock=True)
        if (
            run.current_proposal_set_version != body.proposal_set_version
            or run.analysis_status != "proposals_ready"
        ):
            stale(run)
        proposals = w.Proposals.model_validate(
            proposal_row(session, run, body.proposal_set_version).payload
        )
        variant = next(
            (
                value
                for value in proposals.variants
                if value.variant_id == body.variant_id
            ),
            None,
        )
        if (
            variant is None
            or not body.rationale.strip()
            or not body.change_ids
            or not set(body.change_ids).issubset(variant.change_ids)
        ):
            reject(
                "invalid_decision",
                "Decision needs a rationale and changes from the selected variant",
                422,
            )
        payload = {
            **body.model_dump(mode="json"),
            "actor_id": actor.actor_id,
            "occurred_at": datetime.now(UTC).isoformat(),
            "state": {
                "approve": "approved",
                "reject": "rejected",
                "defer": "deferred",
                "select": "selected",
            }[body.action],
        }
        session.add(
            StageOutput(
                run_id=run.id,
                generation_id=run.generation_id,
                stage_key=f"decision:{command_id}",
                payload=payload,
            )
        )
        session.add(
            Audit(
                id=new_id(),
                workspace_id=actor.workspace_id,
                run_id=run.id,
                actor_id=actor.actor_id,
                actor_type="pm",
                action=f"decision.{body.action}",
                resource_id=command_id,
                rationale=body.rationale,
                proposal_set_version=body.proposal_set_version,
            )
        )
        emit(session, run, "audit.appended", "decision", command_id)
        return accepted(command_id, run_id, "decisions")

    return w.Accepted.model_validate(
        command(
            actor,
            "decision",
            key,
            {"run_id": run_id, **body.model_dump(mode="json")},
            effect,
            run_id=run_id,
        )
    )


def continue_run(
    actor: Actor, run_id: str, checkpoint_id: str, body: w.Continuation, key: str
) -> w.Accepted:
    require_pm(actor)

    def effect(session: DBSession, command_id: str) -> dict[str, Any]:
        run = owned_run(session, actor, run_id, lock=True)
        row = session.get(StageOutput, (run.id, run.generation_id, "conflicts"))
        if row is None:
            reject("not_found", "Checkpoint not found", 404)
        conflicts = w.Conflicts.model_validate(row.payload)
        checkpoint = next(
            (
                value
                for value in conflicts.checkpoints
                if value.checkpoint_id == checkpoint_id
            ),
            None,
        )
        if checkpoint is None:
            reject("not_found", "Checkpoint not found", 404)
        assert checkpoint is not None
        if (
            checkpoint.version != body.checkpoint_version
            or checkpoint.wait_state != "waiting"
            or run.analysis_status != "waiting_for_pm"
        ):
            stale(run)
        if body.resolution not in checkpoint.allowed_actions:
            reject("invalid_resolution", "A checkpoint resolution is required", 422)
        draft = session.get(StageOutput, (run.id, run.generation_id, "proposal_draft"))
        draft_variants = draft.payload.get("variants", []) if draft else []
        variant_ids = {value["variant_id"] for value in draft_variants}
        actual_cohorts = {
            value
            for conflict in conflicts.conflicts
            for scope in conflict.alternatives
            for value in scope.cohort_ids
        }
        if body.resolution in {"regroup", "select"} and (
            not body.cohort_assignments
            or set(body.cohort_assignments) - variant_ids
            or any(
                not values or set(values) - actual_cohorts
                for values in body.cohort_assignments.values()
            )
        ):
            reject(
                "invalid_resolution",
                "Assignments must use existing variants and evidence cohorts",
                422,
            )
        checkpoint.wait_state = "continued"
        row.payload = conflicts.model_dump(mode="json")
        session.add(
            StageOutput(
                run_id=run.id,
                generation_id=run.generation_id,
                stage_key=f"continuation:{command_id}",
                payload={
                    "checkpoint_id": checkpoint_id,
                    **body.model_dump(mode="json"),
                },
            )
        )
        session.add(
            StageOutput(
                run_id=run.id,
                generation_id=run.generation_id,
                stage_key="checkpoint_resolution",
                payload={"command_id": command_id, **body.model_dump(mode="json")},
            )
        )
        session.add(Outbox(command_id=command_id))
        run.analysis_status = "processing"
        emit(session, run, "conflicts.updated", "checkpoint", checkpoint_id)
        return accepted(command_id, run_id, "checkpoints", checkpoint_id)

    return w.Accepted.model_validate(
        command(
            actor,
            "continuation",
            key,
            {
                "run_id": run_id,
                "checkpoint_id": checkpoint_id,
                **body.model_dump(mode="json"),
            },
            effect,
            run_id=run_id,
        )
    )
