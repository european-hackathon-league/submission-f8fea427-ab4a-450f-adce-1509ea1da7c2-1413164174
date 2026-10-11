"""Authorized, audited evidence and run history queries."""

from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session as DBSession

from app import wire as w
from app.auth import Actor, reject
from app.commands import audit, owned_run
from app.db import (
    Audit,
    EvidenceArtifact,
    RunEvidence,
    Session,
    SourceVersion,
    StageOutput,
)


def external_evidence(session: DBSession, run_id: str) -> dict[str, w.Evidence]:
    outputs = session.scalars(
        select(StageOutput)
        .where(
            StageOutput.run_id == run_id,
            (StageOutput.stage_key == "research_sources")
            | StageOutput.stage_key.like("research:step:%"),
        )
        .order_by(StageOutput.generation_id, StageOutput.stage_key)
    )
    evidence: dict[str, w.Evidence] = {}
    for output in outputs:
        for source in output.payload.get("sources", []):
            item = w.Evidence.model_validate(source["evidence"])
            if item.source_kind != "external":
                raise ValueError("Research source has an invalid evidence kind")
            previous = evidence.get(item.evidence_id)
            if previous is not None and previous != item:
                raise ValueError("Research evidence identity changed across snapshots")
            evidence[item.evidence_id] = item
    return evidence


def wire_evidence(session: DBSession, artifact: EvidenceArtifact) -> w.Evidence:
    version = session.get(SourceVersion, artifact.source_version_id)
    if version is None:
        raise ValueError("Evidence source version is missing")
    return w.Evidence.model_validate(
        {
            "evidence_id": artifact.id,
            "source_version_id": artifact.source_version_id,
            "source_kind": artifact.source_kind,
            "locator": artifact.locator,
            "scope": artifact.scope,
            "excerpt": artifact.excerpt,
            "limitations": artifact.limitations,
            "source_url": f"/api/v1/sources/{version.source_id}/content",
        }
    )


def read(identity: Actor, run_id: str, evidence_id: str) -> w.Evidence:
    with Session.begin() as session:
        owned_run(session, identity, run_id)
        artifact = session.scalar(
            select(EvidenceArtifact).where(
                EvidenceArtifact.id == evidence_id,
                EvidenceArtifact.id.in_(
                    select(RunEvidence.evidence_id).where(RunEvidence.run_id == run_id)
                ),
            )
        )
        if artifact is None:
            result = external_evidence(session, run_id).get(evidence_id)
            if result is None:
                reject("not_found", "Evidence not found", 404)
        else:
            result = wire_evidence(session, artifact)
        audit(session, identity, "evidence.read", evidence_id, run_id)
        return result


def listing(
    identity: Actor, run_id: str, limit: int = 50, cursor: str | None = None
) -> w.Page[w.Evidence]:
    with Session.begin() as session:
        run = owned_run(session, identity, run_id)
        query = select(EvidenceArtifact).where(
            EvidenceArtifact.id.in_(
                select(RunEvidence.evidence_id).where(RunEvidence.run_id == run_id)
            )
        )
        external = external_evidence(session, run_id)
        if cursor is not None:
            if (
                cursor not in external
                and session.scalar(query.where(EvidenceArtifact.id == cursor)) is None
            ):
                reject("invalid_cursor", "Cursor does not belong to this run", 422)
            query = query.where(EvidenceArtifact.id > cursor)
        rows = session.scalars(
            query.order_by(EvidenceArtifact.id).limit(limit + 1)
        ).all()
        combined = {row.id: wire_evidence(session, row) for row in rows}
        combined.update(
            {
                identifier: item
                for identifier, item in external.items()
                if cursor is None or identifier > cursor
            }
        )
        items = sorted(combined.values(), key=lambda item: item.evidence_id)
        results = items[:limit]
        for item in results:
            audit(session, identity, "evidence.read", item.evidence_id, run_id)
        return w.Page[w.Evidence](
            items=results,
            next_cursor=results[-1].evidence_id if len(items) > limit else None,
            revision=run.revision,
        )


def history(
    identity: Actor, run_id: str, limit: int = 50, cursor: str | None = None
) -> w.Page[w.Audit]:
    with Session() as session:
        run = owned_run(session, identity, run_id)
        query = select(Audit).where(
            Audit.run_id == run_id, Audit.workspace_id == identity.workspace_id
        )
        if cursor is not None:
            previous = session.scalar(query.where(Audit.id == cursor))
            if previous is None:
                reject("invalid_cursor", "Cursor does not belong to this run", 422)
            query = query.where(
                tuple_(Audit.occurred_at, Audit.id)
                > tuple_(previous.occurred_at, previous.id)
            )
        rows = session.scalars(
            query.order_by(Audit.occurred_at, Audit.id).limit(limit + 1)
        ).all()
        return w.Page[w.Audit](
            items=[
                w.Audit.model_validate(
                    {
                        "audit_id": row.id,
                        "actor_id": row.actor_id,
                        "actor_type": row.actor_type,
                        "action": row.action,
                        "occurred_at": row.occurred_at,
                        "resource_id": row.resource_id,
                        "proposal_set_version": row.proposal_set_version,
                        "rationale": row.rationale,
                    }
                )
                for row in rows[:limit]
            ],
            next_cursor=rows[limit - 1].id if len(rows) > limit else None,
            revision=run.revision,
        )
