from sqlalchemy import func, select
from test_ingestion_cache import feedback, frozen_run

from app.db import Audit, EvidenceArtifact, RunEvidence, Session
from app.ingestion import publish_batch


def evidence_id(run_id):
    with Session() as session:
        return session.scalar(
            select(RunEvidence.evidence_id).where(RunEvidence.run_id == run_id)
        )


def test_evidence_read_preserves_frozen_locator_scope_and_audits(client):
    run_id, generation, version, binding = frozen_run(client)
    publish_batch(run_id, generation, version, feedback(binding))
    identifier = evidence_id(run_id)
    response = client.get(f"/api/v1/runs/{run_id}/evidence/{identifier}")
    assert response.status_code == 200
    body = response.json()
    assert body["source_version_id"] == version
    assert body["locator"] == {
        "type": "cell",
        "sheet": "Sheet",
        "row": 2,
        "cells": ["A2", "B2"],
    }
    assert body["excerpt"] == "Synthetic seat comfort feedback"
    assert body["scope"]["cohort_ids"] == ["DE", "EU"]
    assert body["applicability"] == "unknown"
    with Session() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(Audit)
                .where(
                    Audit.run_id == run_id,
                    Audit.action == "evidence.read",
                    Audit.resource_id == identifier,
                )
            )
            == 1
        )


def test_evidence_cannot_be_read_through_other_run_or_workspace(client):
    run_id, generation, version, binding = frozen_run(client)
    publish_batch(run_id, generation, version, feedback(binding))
    identifier = evidence_id(run_id)
    other_run, _, _, _ = frozen_run(client)
    assert (
        client.get(f"/api/v1/runs/{other_run}/evidence/{identifier}").status_code == 404
    )
    assert (
        client.get(
            f"/api/v1/runs/{run_id}/evidence/{identifier}",
            headers={
                "Authorization": "Bearer development:pm_other",
                "X-Workspace-ID": "workspace_other",
            },
        ).status_code
        == 404
    )
    with Session() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(Audit)
                .where(Audit.action == "evidence.read", Audit.resource_id == identifier)
            )
            == 0
        )
        assert session.get(EvidenceArtifact, identifier) is not None


def test_evidence_pagination_is_scoped_and_does_not_repeat(client):
    run_id, generation, version, binding = frozen_run(client)
    result = feedback(binding)
    result.records[0].annotations.append(
        result.records[0]
        .annotations[0]
        .model_copy(update={"text": "Synthetic second annotation"})
    )
    publish_batch(run_id, generation, version, result)
    first = client.get(f"/api/v1/runs/{run_id}/evidence?limit=1")
    assert first.status_code == 200
    assert len(first.json()["items"]) == 1
    cursor = first.json()["next_cursor"]
    assert cursor
    second = client.get(
        f"/api/v1/runs/{run_id}/evidence", params={"limit": 1, "cursor": cursor}
    )
    assert second.status_code == 200
    assert len(second.json()["items"]) == 1
    assert (
        first.json()["items"][0]["evidence_id"]
        != second.json()["items"][0]["evidence_id"]
    )
    assert second.json()["next_cursor"] is None
