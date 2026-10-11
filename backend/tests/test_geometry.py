import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.geometry import GeometryCatalog, validate_plan
from app.geometry_agent import plan_geometry
from app.geometry_renderer import (
    RendererSettings,
    create_app,
    execute_job,
    initial_result,
    review_and_correct,
    save,
)
from app.wire import GeometryOperation, RenderManifest


def catalog():
    return GeometryCatalog.model_validate(
        {
            "contract_version": "1",
            "baseline_asset_id": "car",
            "asset_id": "car",
            "part_catalog_version": "parts-1",
            "units": "m",
            "sha256": "a" * 64,
            "parts": [
                {
                    "part_id": "seat",
                    "mesh_refs": ["Seat"],
                    "anchor_mesh_ref": "Seat",
                    "anchor_local": [0, 0, 0],
                    "dimensions_m": [0.5, 0.5, 1.0],
                    "edit_origin_local": [0, 0, 0],
                    "operations": ["resize_local"],
                }
            ],
        }
    )


def test_renderer_loads_private_local_configuration(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".local").mkdir()
    (tmp_path / ".local/geometry.env").write_text(
        "GEOMETRY_TOKEN=synthetic-private-token\nGEOMETRY_AI_ENABLED=false\n"
    )
    settings = RendererSettings()
    assert settings.token.get_secret_value() == "synthetic-private-token"
    assert not settings.ai_enabled


def manifest():
    return RenderManifest(
        render_request_id="request",
        run_id="run",
        proposal_set_version=1,
        variant_ids=["v"],
        baseline_asset_id="car",
        part_catalog_version="parts-1",
        changes=[
            dict(
                change_id="c",
                part_ids=["seat"],
                proposed_outcome="wider",
                visual_instruction="wider seat",
                preserve_constraints=[],
                evidence_ids=["e"],
            )
        ],
    )


def test_verified_mapping_rejects_duplicate_meshes_and_invalid_anchors():
    data = catalog().model_dump()
    data["parts"].append({**data["parts"][0], "part_id": "other"})
    with pytest.raises(ValueError, match="mesh"):
        GeometryCatalog.model_validate(data)


def test_plan_is_targeted_bounded_and_version_bound():
    operation = GeometryOperation(
        part_id="seat", operation="resize_local", dimensions_m=[0.6, 0.5, 1]
    )
    validate_plan(manifest(), catalog(), {"c": operation})
    with pytest.raises(ValueError, match="target"):
        validate_plan(
            manifest(),
            catalog(),
            {"c": operation.model_copy(update={"part_id": "body"})},
        )
    with pytest.raises(ValueError, match="bound"):
        validate_plan(
            manifest(),
            catalog(),
            {"c": operation.model_copy(update={"dimensions_m": [5, 0.5, 1]})},
        )
    with pytest.raises(ValueError, match="identity"):
        validate_plan(
            manifest().model_copy(update={"baseline_asset_id": "other"}), catalog(), {}
        )


def test_renderer_auth_idempotency_failure_and_recovery(tmp_path):
    settings = RendererSettings(
        token="test", jobs_path=tmp_path, public_url="http://renderer", _env_file=None
    )
    with TestClient(create_app(settings)) as client:
        assert (
            client.post("/renderer/v1/jobs", json=manifest().model_dump()).status_code
            == 401
        )
        headers = {"Authorization": "Bearer test", "Idempotency-Key": "key"}
        first = client.post(
            "/renderer/v1/jobs", headers=headers, json=manifest().model_dump()
        )
        assert first.status_code == 200
        job_id = first.json()["job_id"]
        again = client.post(
            "/renderer/v1/jobs", headers=headers, json=manifest().model_dump()
        )
        assert again.json()["job_id"] == job_id
        changed = manifest().model_dump()
        changed["proposal_set_version"] = 2
        assert (
            client.post("/renderer/v1/jobs", headers=headers, json=changed).status_code
            == 409
        )
        result = client.get(f"/renderer/v1/jobs/{job_id}", headers=headers).json()
        assert result["status"] == "failed"
        assert "baseline" in result["failure_reason"].lower()
        assert result["outcomes"][0]["geometry_produced"] is False
        assert (
            json.loads((tmp_path / job_id / "manifest.json").read_text())["run_id"]
            == "run"
        )
    with TestClient(create_app(settings)) as client:
        assert (
            client.get(f"/renderer/v1/jobs/{job_id}", headers=headers).json() == result
        )


def test_explicit_retry_resets_failed_job_and_deduplicates(tmp_path):
    with TestClient(
        create_app(RendererSettings(token="test", jobs_path=tmp_path, _env_file=None))
    ) as client:
        headers = {"Authorization": "Bearer test", "Idempotency-Key": "key"}
        job_id = client.post(
            "/renderer/v1/jobs", headers=headers, json=manifest().model_dump()
        ).json()["job_id"]
        retry_headers = {**headers, "Idempotency-Key": "explicit-retry"}
        retry = client.post(f"/renderer/v1/jobs/{job_id}/retry", headers=retry_headers)
        assert retry.status_code == 200
        assert (
            client.get(f"/renderer/v1/jobs/{job_id}", headers=headers).json()["status"]
            == "queued"
        )
        assert (
            client.post(
                f"/renderer/v1/jobs/{job_id}/retry", headers=retry_headers
            ).json()
            == retry.json()
        )
        assert (
            client.post(
                f"/renderer/v1/jobs/{job_id}/retry",
                headers={**headers, "Idempotency-Key": "another"},
            ).status_code
            == 409
        )


def test_retry_commit_is_atomic_and_survives_worker_result_updates(
    tmp_path, monkeypatch
):
    settings = RendererSettings(token="test", jobs_path=tmp_path, _env_file=None)
    with TestClient(create_app(settings)) as client:
        headers = {"Authorization": "Bearer test", "Idempotency-Key": "key"}
        job_id = client.post(
            "/renderer/v1/jobs", headers=headers, json=manifest().model_dump()
        ).json()["job_id"]
        path = tmp_path / job_id
        before = (path / "result.json").read_bytes()
        retry_headers = {**headers, "Idempotency-Key": "crash-retry"}
        replace = Path.replace

        def crash_before_commit(source, target):
            if Path(target) == path / "result.json":
                raise OSError("simulated crash before atomic commit")
            return replace(source, target)

        with monkeypatch.context() as patch:
            patch.setattr(Path, "replace", crash_before_commit)
            with pytest.raises(OSError, match="simulated crash"):
                client.post(f"/renderer/v1/jobs/{job_id}/retry", headers=retry_headers)
        assert (path / "result.json").read_bytes() == before
        assert not (path / "retry-keys.json").exists()
        assert (
            client.post(
                f"/renderer/v1/jobs/{job_id}/retry", headers=retry_headers
            ).status_code
            == 200
        )
        queued = client.get(f"/renderer/v1/jobs/{job_id}", headers=headers).json()
        assert queued["status"] == "queued"
        assert "_retry_keys" not in queued
        execute_job(settings, path)
        assert json.loads((path / "result.json").read_text())["status"] == "failed"
        # Replaying the committed retry after worker completion must not requeue it.
        assert (
            client.post(
                f"/renderer/v1/jobs/{job_id}/retry", headers=retry_headers
            ).status_code
            == 200
        )
        assert (
            client.get(f"/renderer/v1/jobs/{job_id}", headers=headers).json()["status"]
            == "failed"
        )


def test_editing_agent_executes_validated_tools_and_bounds_calls():
    from types import SimpleNamespace

    calls = []

    class Responses:
        def create(self, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                return SimpleNamespace(
                    output=[
                        SimpleNamespace(
                            type="function_call",
                            name="inspect_part",
                            call_id="1",
                            arguments='{"part_id":"seat"}',
                            model_dump=lambda **kwargs: {
                                "async" if kwargs.get("by_alias") else "async_": False,
                                "type": "function_call",
                                "name": "inspect_part",
                                "call_id": "1",
                                "arguments": '{"part_id":"seat"}',
                            },
                        )
                    ],
                    usage=None,
                    id="one",
                )
            if len(calls) == 2:
                return SimpleNamespace(
                    output=[
                        SimpleNamespace(
                            type="function_call",
                            name="propose_resize",
                            call_id="2",
                            arguments='{"change_id":"c","part_id":"seat","dimensions_m":[0.6,0.5,1],"assumption":"wider cushion"}',
                            model_dump=lambda **kwargs: {
                                "type": "function_call",
                                "name": "propose_resize",
                                "call_id": "2",
                                "arguments": '{"change_id":"c","part_id":"seat","dimensions_m":[0.6,0.5,1],"assumption":"wider cushion"}',
                            },
                        )
                    ],
                    usage=None,
                    id="two",
                )
            return SimpleNamespace(output=[], usage=None, id="three")

    plan, audit = plan_geometry(
        SimpleNamespace(responses=Responses()),
        "test-model",
        manifest(),
        catalog(),
        [],
        max_calls=3,
    )
    assert plan["c"].dimensions_m == (0.6, 0.5, 1)
    assert len(calls) == 3
    assert calls[0]["store"] is False
    assert "async_" not in calls[1]["input"][-2]
    assert '"dimensions_m": [0.5, 0.5, 1.0]' in calls[1]["input"][-1]["output"]
    assert audit[1]["tool"] == "propose_resize"


def test_multiple_changes_conflicts_and_dependencies_are_not_fake_success():
    first = GeometryOperation(
        part_id="seat", operation="resize_local", dimensions_m=[0.6, 0.5, 1]
    )
    request = manifest()
    request.changes.append(request.changes[0].model_copy(update={"change_id": "other"}))
    with pytest.raises(ValueError, match="conflicting"):
        validate_plan(request, catalog(), {"c": first, "other": first})
    request.changes[0].dependencies = ["other"]
    with pytest.raises(ValueError, match="dependency"):
        validate_plan(request, catalog(), {"c": first})


def test_worker_timeout_records_failure_and_preserves_baseline(tmp_path, monkeypatch):
    import hashlib
    import subprocess

    baseline = tmp_path / "baseline.glb"
    baseline.write_bytes(b"immutable-original")
    catalog_path = tmp_path / "catalog.json"
    data = catalog().model_dump(mode="json")
    data["sha256"] = hashlib.sha256(baseline.read_bytes()).hexdigest()
    save(catalog_path, data)
    job = tmp_path / "job"
    job.mkdir()
    request = manifest()
    request.changes[0].geometry = GeometryOperation(
        operation="resize_local", part_id="seat", dimensions_m=[0.6, 0.5, 1]
    )
    save(job / "manifest.json", request.model_dump(mode="json"))
    save(job / "result.json", initial_result(request, "job").model_dump(mode="json"))

    environments = []
    monkeypatch.setenv("SYSTEMROOT", "C:/Windows")
    monkeypatch.setenv("OPENAI_API_KEY", "test-secret-must-not-reach-blender")

    def timeout(*args, **kwargs):
        environments.append(kwargs["env"])
        assert "--disable-autoexec" in args[0]
        assert json.loads((job / "result.json").read_text())["stage"] == "editing"
        raise subprocess.TimeoutExpired("blender", 1)

    monkeypatch.setattr(subprocess, "run", timeout)
    execute_job(
        RendererSettings(
            token="test",
            baseline_path=baseline,
            catalog_path=catalog_path,
            _env_file=None,
        ),
        job,
    )
    result = json.loads((job / "result.json").read_text())
    assert environments[0]["SYSTEMROOT"] == "C:/Windows"
    assert "OPENAI_API_KEY" not in environments[0]
    assert result["status"] == "failed"
    assert result["stage"] == "complete"
    assert result["outcomes"][0]["geometry_produced"] is False
    assert baseline.read_bytes() == b"immutable-original"


def test_unconfigured_baseline_routes_report_capability_limit(tmp_path):
    with TestClient(
        create_app(RendererSettings(token="test", jobs_path=tmp_path, _env_file=None))
    ) as client:
        assert client.get("/renderer/v1/baseline/catalog").status_code == 401
        response = client.get(
            "/renderer/v1/baseline/catalog", headers={"Authorization": "Bearer test"}
        )
        assert response.status_code == 503
        assert "not configured" in response.json()["detail"]


def test_corrections_exhaust_at_two_and_replay_without_paid_calls(
    tmp_path, monkeypatch
):
    calls = {"review": 0, "plan": 0, "blender": 0}
    initial = GeometryOperation(
        part_id="seat", operation="resize_local", dimensions_m=[0.6, 0.5, 1]
    )
    request = {"output": str(tmp_path)}

    def review(*args, **kwargs):
        calls["review"] += 1
        return {
            "changes": [
                {"change_id": "c", "passed": False, "reason": "Needs visual correction"}
            ],
            "unaffected_parts_preserved_visually": True,
        }

    def plan(*args, **kwargs):
        calls["plan"] += 1
        return {
            "c": initial.model_copy(
                update={"dimensions_m": (0.6 + calls["plan"] * 0.01, 0.5, 1)}
            )
        }, []

    def blender(settings, path, request):
        calls["blender"] += 1
        save(path / "measurements.json", {"correction": calls["blender"]})
        (path / "candidate.glb").write_bytes(b"deterministic-test-only")

    monkeypatch.setattr("app.geometry_renderer.review_geometry", review)
    monkeypatch.setattr("app.geometry_renderer.plan_geometry", plan)
    monkeypatch.setattr("app.geometry_renderer.blender_call", blender)
    result = review_and_correct(
        RendererSettings(max_correction_rounds=2, _env_file=None),
        tmp_path,
        object(),
        manifest(),
        catalog(),
        request,
        {"c": initial},
        {},
    )
    assert calls == {"review": 3, "plan": 2, "blender": 2}
    assert result[2]["changes"][0]["passed"] is False
    again = review_and_correct(
        RendererSettings(max_correction_rounds=2, _env_file=None),
        tmp_path,
        object(),
        manifest(),
        catalog(),
        request,
        {"c": initial},
        {},
    )
    assert again == result
    assert calls == {"review": 3, "plan": 2, "blender": 2}
