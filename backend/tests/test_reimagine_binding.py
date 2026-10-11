from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from test_control_delivery import ready_run, sample

from app import wire as w
from app.auth import Actor
from app.rendering import build_manifest, create_render, queued_result, validate_result


def request(version=1):
    return w.RenderCommand(
        proposal_set_version=version,
        variant_ids=["variant_a"],
        baseline_asset_id="asset_demo_v1",
    )


def test_manifest_rejects_mismatched_saved_version():
    with pytest.raises(HTTPException) as error:
        build_manifest(
            sample(),
            request(2),
            "render_a",
            {
                "baseline_asset_id": "asset_demo_v1",
                "part_catalog_version": "catalog_demo_v1",
            },
        )
    assert error.value.status_code == 409


def test_conditions_are_distinct_from_geometry_preservation():
    proposals = sample()
    proposals.changes[0].conditions = ["Confirm vehicle applicability"]
    proposals.changes[0].preservation_constraints = [
        "Keep the physical seat mounts unchanged"
    ]
    manifest = build_manifest(
        proposals,
        request(),
        "render_a",
        {
            "baseline_asset_id": "asset_demo_v1",
            "part_catalog_version": "catalog_demo_v1",
        },
    )
    assert manifest.changes[0].preserve_constraints == [
        "Keep the physical seat mounts unchanged"
    ]
    assert "Confirm vehicle applicability" in manifest.changes[0].assumptions


def test_manifest_does_not_execute_rejected_or_deferred_suggestions():
    proposals = sample()
    proposals.changes[0].decision_state = "rejected"
    with pytest.raises(HTTPException) as error:
        build_manifest(
            proposals,
            request(),
            "render_a",
            {
                "baseline_asset_id": "asset_demo_v1",
                "part_catalog_version": "catalog_demo_v1",
            },
        )
    assert error.value.status_code == 422


def test_duplicate_binding_with_new_key_reuses_job(client):
    run_id, _ = ready_run(client)
    actor = Actor("pm_demo", "workspace_demo", "pm")
    first = create_render(actor, run_id, request(), str(uuid4()))
    second = create_render(actor, run_id, request(), str(uuid4()))
    assert second.resource_id == first.resource_id


def test_manifest_binds_customer_wording_separately_from_design(client):
    from sqlalchemy import select
    from test_ingestion_cache import feedback

    from app.control import resource_row
    from app.db import RunEvidence, RunSource, Session
    from app.ingestion import publish_batch

    run_id, generation = ready_run(client)
    with Session() as session:
        source = session.scalar(select(RunSource).where(RunSource.run_id == run_id))
        version, binding = source.source_version_id, source.binding
    publish_batch(
        run_id,
        generation,
        version,
        feedback(binding, "Customer: the seat feels too narrow"),
    )
    with Session.begin() as session:
        evidence_id = session.scalar(
            select(RunEvidence.evidence_id).where(RunEvidence.run_id == run_id)
        )
        row = resource_row(session, run_id, "proposals:1")
        payload = deepcopy(row.payload)
        payload["changes"][0]["supporting_evidence_ids"] = [evidence_id]
        row.payload = payload
    result = create_render(
        Actor("pm_demo", "workspace_demo", "pm"), run_id, request(), str(uuid4())
    )
    with Session() as session:
        change = resource_row(session, run_id, f"render:{result.resource_id}").payload[
            "manifest"
        ]["changes"][0]
        assert (
            change["requested_wording"]
            == f"{evidence_id}: Customer: the seat feels too narrow"
        )
        assert change["visual_instruction"] == "Evaluate comfort"


def test_stale_saved_version_cannot_start_a_paid_job(client):
    from app.db import Run, Session

    run_id, _ = ready_run(client)
    with Session.begin() as session:
        session.get(Run, run_id).current_proposal_set_version = 2
    with pytest.raises(HTTPException) as error:
        create_render(
            Actor("pm_demo", "workspace_demo", "pm"), run_id, request(), str(uuid4())
        )
    assert error.value.status_code == 409


def test_renderer_cannot_attach_an_unrelated_geometry_catalog():
    manifest = build_manifest(
        sample(),
        request(),
        "render_a",
        {
            "baseline_asset_id": "asset_demo_v1",
            "part_catalog_version": "catalog_demo_v1",
        },
    )
    result = queued_result(manifest)
    result.scene_catalog = w.GeometrySceneCatalog(
        baseline_asset_id="other_vehicle",
        asset_id="candidate",
        part_catalog_version="catalog_demo_v1",
        parts=[],
    )
    with pytest.raises(ValueError, match="catalog"):
        validate_result(manifest, result)


def test_baseline_catalog_is_authorized_and_bound_to_the_run(client, monkeypatch):
    import app.rendering as rendering

    run_id, _ = ready_run(client)
    catalog = {
        "contract_version": "1",
        "baseline_asset_id": "asset_demo_v1",
        "asset_id": "asset_demo_v1",
        "part_catalog_version": "catalog_demo_v1",
        "units": "m",
        "parts": [],
        "baseline_url": "http://private/asset",
    }
    monkeypatch.setattr(rendering, "renderer_call", lambda *args, **kwargs: catalog)
    response = client.get(f"/api/v1/runs/{run_id}/geometry")
    assert response.status_code == 200
    assert response.json()["baseline_url"] == f"/api/v1/runs/{run_id}/geometry/asset"
    assert (
        client.get(
            f"/api/v1/runs/{run_id}/geometry",
            headers={
                "Authorization": "Bearer development:pm_other",
                "X-Workspace-ID": "workspace_other",
            },
        ).status_code
        == 404
    )
    catalog["part_catalog_version"] = "other"
    assert client.get(f"/api/v1/runs/{run_id}/geometry").status_code == 502


def test_vehicle_geometry_is_authenticated_and_verified_without_a_run(
    client, monkeypatch
):
    import app.rendering as rendering
    from app import runs
    from app.db import Audit, Session

    config = runs.catalog()
    path = f"/api/v1/vehicles/{config['vehicle_id']}/geometry"
    catalog = {
        "contract_version": "1",
        "baseline_asset_id": config["baseline_asset_id"],
        "asset_id": config["baseline_asset_id"],
        "part_catalog_version": config["part_catalog_version"],
        "units": "m",
        "parts": [],
        "baseline_url": "http://private/asset",
    }
    calls = []
    monkeypatch.setattr(
        rendering, "renderer_call", lambda *args: calls.append(args) or catalog
    )
    monkeypatch.setattr(
        rendering, "renderer_asset_bytes", lambda *args: (b"glTF", "model/gltf-binary")
    )
    assert client.get(path, headers={"Authorization": ""}).status_code == 401
    assert (
        client.get(path, headers={"X-Workspace-ID": "workspace_other"}).status_code
        == 403
    )
    assert client.get("/api/v1/vehicles/unknown/geometry").status_code == 404
    assert calls == []
    response = client.get(path)
    assert response.status_code == 200
    assert response.json()["baseline_url"] == path + "/asset"
    asset = client.get(path + "/asset")
    assert asset.status_code == 200
    assert asset.content == b"glTF"
    assert asset.headers["cache-control"] == "private, no-store"
    with Session() as session:
        row = session.scalars(
            select(Audit).where(
                Audit.action == "geometry.asset.read",
                Audit.resource_id == config["vehicle_id"],
            )
        ).first()
        assert row is not None and row.run_id is None
    catalog["part_catalog_version"] = "other"
    assert client.get(path).status_code == 502
    assert client.get(path + "/asset").status_code == 502


def test_retry_resumes_existing_renderer_job(client, monkeypatch):
    import app.rendering as rendering
    from app.control import resource_row
    from app.db import Session

    run_id, generation = ready_run(client)
    actor = Actor("pm_demo", "workspace_demo", "pm")
    created = create_render(actor, run_id, request(), str(uuid4()))
    with Session.begin() as session:
        row = resource_row(session, run_id, f"render:{created.resource_id}")
        payload = dict(row.payload)
        payload["result"] = {
            **payload["result"],
            "status": "failed",
            "job_id": "worker-job",
        }
        row.payload = payload
    calls = []

    def renderer(method, path, key, body=None):
        calls.append((method, path, key))
        return {"job_id": "worker-job", "status": "queued"}

    monkeypatch.setattr(rendering, "renderer_call", renderer)
    retried = rendering.retry_render(actor, run_id, created.resource_id, str(uuid4()))
    assert (
        rendering.render_submit([run_id, generation, created.resource_id])
        == "rendering"
    )
    assert calls == [("POST", "/renderer/v1/jobs/worker-job/retry", retried.command_id)]


def test_retry_requires_pm(client):
    from app.rendering import retry_render

    run_id, _ = ready_run(client)
    created = create_render(
        Actor("pm_demo", "workspace_demo", "pm"), run_id, request(), str(uuid4())
    )
    with pytest.raises(HTTPException) as error:
        retry_render(
            Actor("pm_demo", "workspace_demo", "reviewer"),
            run_id,
            created.resource_id,
            str(uuid4()),
        )
    assert error.value.status_code == 403


def test_unreviewed_geometry_is_partial():
    manifest = build_manifest(
        sample(),
        request(),
        "render_a",
        {
            "baseline_asset_id": "asset_demo_v1",
            "part_catalog_version": "catalog_demo_v1",
        },
    )
    result = queued_result(manifest)
    result.status = "succeeded"
    result.outcomes = [
        w.RenderOutcome(
            change_id="change_a",
            outcome="rendered",
            reason="Measured",
            asset_ids=[],
            geometry_produced=True,
            visual_review="needs_review",
        )
    ]
    assert validate_result(manifest, result).status == "partial"


def test_poll_failure_preserves_remote_job_for_retry(client, monkeypatch):
    import app.rendering as rendering
    from app.control import resource_row
    from app.db import Session

    run_id, generation = ready_run(client)
    actor = Actor("pm_demo", "workspace_demo", "pm")
    created = create_render(actor, run_id, request(), str(uuid4()))
    monkeypatch.setattr(
        rendering,
        "renderer_call",
        lambda *args: {"job_id": "worker-job", "status": "queued"},
    )
    rendering.render_submit([run_id, generation, created.resource_id])

    def unavailable(*args):
        raise ValueError("transport failure")

    monkeypatch.setattr(rendering, "renderer_call", unavailable)
    assert rendering.render_poll([run_id, generation, created.resource_id]) == "failed"
    with Session.begin() as session:
        assert (
            resource_row(session, run_id, f"render:{created.resource_id}").payload[
                "result"
            ]["job_id"]
            == "worker-job"
        )
