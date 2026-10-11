import hashlib
import json

import pytest
from test_geometry import catalog, manifest

from app.geometry import validate_plan
from app.geometry_renderer import (
    RendererSettings,
    execute_job,
    persist_plan,
    restore_interpretations,
    review_and_correct,
    save,
)
from app.wire import GeometryOperation


def test_forward_dependencies_can_be_planned_before_final_validation():
    request = manifest()
    request.changes[0].dependencies = ["later"]
    operation = GeometryOperation(
        part_id="seat", operation="resize_local", dimensions_m=[0.6, 0.5, 1]
    )
    validate_plan(request, catalog(), {"c": operation}, validate_dependencies=False)


def test_plan_interpretation_survives_cached_retry_and_rejects_unknown_ids(tmp_path):
    original = manifest()
    plan = {
        "c": GeometryOperation(
            operation="resize_local", part_id="seat", dimensions_m=[0.6, 0.5, 1]
        )
    }
    audit = [
        {
            "tool": "propose_resize",
            "result": {"accepted": True},
            "arguments": json.dumps(
                {
                    "change_id": "c",
                    "dimensions_m": [0.6, 0.5, 1],
                    "assumption": "Interpret spacious as wider cushion; other dimensions unchanged",
                }
            ),
        }
    ]
    persist_plan(tmp_path, original, plan, audit)
    recovered = manifest()
    restore_interpretations(tmp_path, recovered, plan)
    assert recovered.changes[0].assumptions == [
        "Interpret spacious as wider cushion; other dimensions unchanged"
    ]
    save(tmp_path / "interpretations.json", {"unknown": ["fabricated"]})
    with pytest.raises(ValueError, match="interpretation"):
        restore_interpretations(tmp_path, recovered, plan)


@pytest.mark.parametrize("constraints", [[], ["unverified mounting clearance"]])
def test_worker_retains_unreviewed_geometry_as_partial_and_constraints_unsupported(
    tmp_path, monkeypatch, constraints
):
    baseline = tmp_path / "baseline.glb"
    baseline.write_bytes(b"fixture-only")
    catalog_path = tmp_path / "catalog.json"
    source_catalog = catalog().model_dump(mode="json")
    source_catalog["sha256"] = hashlib.sha256(baseline.read_bytes()).hexdigest()
    save(catalog_path, source_catalog)
    job = tmp_path / "job"
    job.mkdir()
    request = manifest()
    request.changes[0].geometry = GeometryOperation(
        operation="resize_local", part_id="seat", dimensions_m=[0.6, 0.5, 1]
    )
    request.changes[0].preserve_constraints = constraints
    save(job / "manifest.json", request.model_dump(mode="json"))

    def blender(settings, path, request):
        for name in ["original", "candidate"]:
            (path / (name + ".glb")).write_bytes(b"test-only")
        scene = {key: value for key, value in source_catalog.items() if key != "sha256"}
        scene["asset_id"] = "candidate"
        save(
            path / "measurements.json",
            {
                "scene_catalog": scene,
                "changes": {"c": {"before_m": [0.5, 0.5, 1], "after_m": [0.6, 0.5, 1]}},
            },
        )

    monkeypatch.setattr("app.geometry_renderer.blender_call", blender)
    execute_job(
        RendererSettings(baseline_path=baseline, catalog_path=catalog_path), job
    )
    result = json.loads((job / "result.json").read_text())
    if constraints:
        assert result["outcomes"][0]["outcome"] == "unsupported"
        assert not result["outcomes"][0]["geometry_produced"]
        assert not result["assets"]
    else:
        assert result["status"] == "partial"
        assert result["outcomes"][0]["geometry_produced"]
        assert result["outcomes"][0]["visual_review"] == "needs_review"


def test_review_failure_after_correction_retains_committed_plan_and_measurement(
    tmp_path, monkeypatch
):
    initial = GeometryOperation(
        part_id="seat", operation="resize_local", dimensions_m=[0.6, 0.5, 1]
    )
    corrected = initial.model_copy(update={"dimensions_m": (0.62, 0.5, 1)})
    reviews = []

    def review(*args, **kwargs):
        reviews.append(True)
        if len(reviews) > 1:
            raise RuntimeError("vision unavailable")
        return {
            "changes": [
                {"change_id": "c", "passed": False, "reason": "Needs correction"}
            ],
            "unaffected_parts_preserved_visually": True,
        }

    def blender(settings, path, request):
        save(
            path / "measurements.json", {"changes": {"c": {"after_m": [0.62, 0.5, 1]}}}
        )
        (path / "candidate.glb").write_bytes(b"corrected-test-only")

    monkeypatch.setattr("app.geometry_renderer.review_geometry", review)
    monkeypatch.setattr(
        "app.geometry_renderer.plan_geometry",
        lambda *args, **kwargs: ({"c": corrected}, []),
    )
    monkeypatch.setattr("app.geometry_renderer.blender_call", blender)
    plan, report, assessment = review_and_correct(
        RendererSettings(),
        tmp_path,
        object(),
        manifest(),
        catalog(),
        {"output": str(tmp_path)},
        {"c": initial},
        {},
    )
    assert plan["c"] == corrected
    assert report["changes"]["c"]["after_m"] == [0.62, 0.5, 1]
    assert assessment["changes"][0]["passed"] is False
    committed = json.loads((tmp_path / "committed-candidate.json").read_text())
    assert committed["stage"] == "correction-1"
    assert committed["plan"]["c"]["dimensions_m"] == [0.62, 0.5, 1]
