from sqlalchemy import select
from test_evidence import evidence_id
from test_ingestion_cache import feedback, frozen_run

from app.db import Audit, Session
from app.ingestion import publish_batch


def test_evidence_cursor_must_belong_to_the_authorized_run(client):
    run_id, generation, version, binding = frozen_run(client)
    publish_batch(run_id, generation, version, feedback(binding))
    other_run, other_generation, other_version, other_binding = frozen_run(client)
    publish_batch(other_run, other_generation, other_version, feedback(other_binding))
    for cursor in ("invalid", evidence_id(other_run)):
        response = client.get(
            f"/api/v1/runs/{run_id}/evidence", params={"cursor": cursor}
        )
        assert response.status_code == 422
        assert response.json()["code"] == "invalid_cursor"


def test_evidence_listing_is_workspace_scoped_and_audited(client):
    run_id, generation, version, binding = frozen_run(client)
    publish_batch(run_id, generation, version, feedback(binding))
    response = client.get(f"/api/v1/runs/{run_id}/evidence")
    assert response.status_code == 200
    assert response.json()["items"][0]["source_url"].startswith("/api/v1/sources/")
    with Session() as session:
        assert session.scalar(
            select(Audit.id).where(
                Audit.run_id == run_id, Audit.action == "evidence.read"
            )
        )
    assert (
        client.get(
            f"/api/v1/runs/{run_id}/evidence",
            headers={
                "Authorization": "Bearer development:pm_other",
                "X-Workspace-ID": "workspace_other",
            },
        ).status_code
        == 404
    )


def test_history_has_scoped_pagination_and_actor_identity(client):
    run_id, generation, version, binding = frozen_run(client)
    publish_batch(run_id, generation, version, feedback(binding))
    client.get(f"/api/v1/runs/{run_id}/evidence/{evidence_id(run_id)}")
    first = client.get(f"/api/v1/runs/{run_id}/history", params={"limit": 1})
    assert first.status_code == 200
    assert first.json()["items"][0]["actor_id"] == "pm_demo"
    cursor = first.json()["next_cursor"]
    assert cursor
    second = client.get(
        f"/api/v1/runs/{run_id}/history", params={"limit": 1, "cursor": cursor}
    )
    assert second.status_code == 200
    assert second.json()["items"][0]["audit_id"] != first.json()["items"][0]["audit_id"]
    assert (
        client.get(
            f"/api/v1/runs/{run_id}/history", params={"cursor": "invalid"}
        ).status_code
        == 422
    )
    assert (
        client.get(
            f"/api/v1/runs/{run_id}/history",
            headers={
                "Authorization": "Bearer development:pm_other",
                "X-Workspace-ID": "workspace_other",
            },
        ).status_code
        == 404
    )
