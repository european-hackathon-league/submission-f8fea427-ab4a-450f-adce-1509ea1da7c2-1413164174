from uuid import uuid4

from test_ingestion_cache import feedback, frozen_run

from app.artifacts import put_stage
from app.db import Run, Session
from app.ingestion import publish_batch
from app.wire import Evidence, Scope, WebLocator


def test_external_evidence_resolves_older_steps_and_deduplicates_final_snapshot(client):
    run_id, generation, version, binding = frozen_run(client)
    publish_batch(run_id, generation, version, feedback(binding))
    external = Evidence(
        evidence_id="synthetic_external_one",
        source_version_id="synthetic_web_snapshot",
        source_kind="external",
        locator=WebLocator(
            url="https://example.com/source", passage_start=0, passage_end=18
        ),
        scope=Scope(),
        excerpt="Synthetic evidence",
        source_url="https://example.com/source",
    )
    sources = [
        {
            "evidence": external.model_dump(mode="json"),
            "publisher": "example.com",
            "publication_date": None,
            "retrieved_at": "2026-10-10T12:00:00Z",
            "fingerprint": "synthetic",
        }
    ]
    put_stage(run_id, generation, "research:step:synthetic", {"sources": sources})
    put_stage(run_id, generation, "research_sources", {"sources": sources})
    with Session.begin() as session:
        session.get(Run, run_id).generation_id = str(uuid4())
    response = client.get(f"/api/v1/runs/{run_id}/evidence/{external.evidence_id}")
    assert response.status_code == 200
    assert response.json() == external.model_dump(mode="json")
    first = client.get(f"/api/v1/runs/{run_id}/evidence", params={"limit": 1}).json()
    second = client.get(
        f"/api/v1/runs/{run_id}/evidence",
        params={"limit": 1, "cursor": first["next_cursor"]},
    ).json()
    assert first["items"][0]["evidence_id"] != second["items"][0]["evidence_id"]
    assert second["next_cursor"] is None
    other_run, _, _, _ = frozen_run(client)
    assert (
        client.get(
            f"/api/v1/runs/{other_run}/evidence/{external.evidence_id}"
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/runs/{run_id}/evidence/{external.evidence_id}",
            headers={
                "Authorization": "Bearer development:pm_other",
                "X-Workspace-ID": "workspace_other",
            },
        ).status_code
        == 404
    )
