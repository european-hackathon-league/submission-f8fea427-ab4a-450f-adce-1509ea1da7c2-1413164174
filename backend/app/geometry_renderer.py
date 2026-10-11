"""Private renderer HTTP adapter; expensive jobs run in a separate worker process."""

import hashlib
import hmac
import json
import os
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.geometry import GeometryCatalog, validate_plan
from app.geometry_agent import plan_geometry, review_geometry
from app.wire import (
    Asset,
    GeometryOperation,
    GeometrySceneCatalog,
    RenderManifest,
    RenderOutcome,
    RenderResult,
    RenderStage,
)


class RendererSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GEOMETRY_", extra="ignore")
    token: SecretStr = SecretStr("")
    jobs_path: Path = Path(".local/geometry-jobs")
    baseline_path: Path | None = None
    catalog_path: Path | None = None
    blender: str = "blender"
    public_url: str = "http://localhost:8090"
    timeout_seconds: int = Field(default=180, ge=1, le=600)
    openai_api_key: SecretStr = SecretStr("")
    openai_base_url: str = "https://api.openai.com/v1"
    model: str = ""
    ai_enabled: bool = False
    max_tool_rounds: int = Field(default=3, ge=1, le=4)
    max_correction_rounds: int = Field(default=2, ge=0, le=2)


def blender_call(
    settings: RendererSettings, path: Path, request: dict[str, Any]
) -> None:
    save(path / "geometry-request.json", request)
    environment = {
        key: value
        for key, value in os.environ.items()
        if key.upper()
        in {
            "PATH",
            "SYSTEMROOT",
            "WINDIR",
            "TEMP",
            "TMP",
            "HOME",
            "LANG",
            "LD_LIBRARY_PATH",
        }
    }
    subprocess.run(
        [
            settings.blender,
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            "--python-exit-code",
            "1",
            "--python",
            str(Path(__file__).with_name("blender_geometry.py")),
            "--",
            str((path / "geometry-request.json").resolve()),
        ],
        cwd=path,
        env=environment,
        timeout=settings.timeout_seconds,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def save(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value), encoding="utf-8")
    temporary.replace(path)


def retry_keys(path: Path) -> list[str]:
    """Read private retry metadata, including jobs written before atomic commits."""
    result_path = path / "result.json"
    value = json.loads(result_path.read_text()) if result_path.exists() else {}
    if "_retry_keys" in value:
        keys = value["_retry_keys"]
    else:
        legacy = path / "retry-keys.json"
        keys = json.loads(legacy.read_text())["keys"] if legacy.exists() else []
    if not isinstance(keys, list) or not all(
        isinstance(key, str) and 0 < len(key) <= 256 for key in keys
    ):
        raise ValueError("Invalid persisted retry keys")
    return [str(key) for key in keys]


def load_result(path: Path) -> RenderResult:
    value = json.loads((path / "result.json").read_text())
    value.pop("_retry_keys", None)
    return RenderResult.model_validate(value)


def save_result(
    path: Path, result: RenderResult, *, keys: list[str] | None = None
) -> None:
    """Commit queue state and retry deduplication together; preserve on progress."""
    value = result.model_dump(mode="json")
    committed_keys = retry_keys(path) if keys is None else keys
    if committed_keys:
        value["_retry_keys"] = committed_keys
    save(path / "result.json", value)


def persist_plan(
    path: Path,
    manifest: RenderManifest,
    plan: dict[str, GeometryOperation],
    audit: list[dict[str, Any]],
) -> None:
    known = {change.change_id for change in manifest.changes}
    interpretations: dict[str, list[str]] = {}
    for call in audit:
        if call.get("tool") != "propose_resize" or not call.get("result", {}).get(
            "accepted"
        ):
            continue
        arguments = json.loads(call["arguments"])
        change_id = arguments.get("change_id")
        assumption = arguments.get("assumption")
        if (
            change_id in known
            and change_id in plan
            and arguments.get("dimensions_m") == list(plan[change_id].dimensions_m)
        ):
            if not isinstance(assumption, str) or len(assumption) > 4000:
                raise ValueError("invalid interpretation assumption")
            interpretations[change_id] = [assumption] if assumption else []
    save(path / "interpretations.json", interpretations)
    save(
        path / "plan.json",
        {key: value.model_dump(mode="json") for key, value in plan.items()},
    )


def restore_interpretations(
    path: Path, manifest: RenderManifest, plan: dict[str, GeometryOperation]
) -> dict[str, list[str]]:
    checkpoint = path / "interpretations.json"
    if not checkpoint.exists() and (path / "tool-audit.json").exists():
        persist_plan(
            path,
            manifest,
            plan,
            json.loads((path / "tool-audit.json").read_text())["calls"],
        )
    interpretations = json.loads(checkpoint.read_text()) if checkpoint.exists() else {}
    changes = {change.change_id: change for change in manifest.changes}
    if (
        not isinstance(interpretations, dict)
        or set(interpretations) - changes.keys()
        or set(interpretations) - plan.keys()
    ):
        raise ValueError("invalid interpretation identity")
    for change_id, assumptions in interpretations.items():
        if (
            not isinstance(assumptions, list)
            or len(assumptions) > 20
            or any(
                not isinstance(value, str) or len(value) > 4000 for value in assumptions
            )
        ):
            raise ValueError("invalid interpretation assumptions")
        for assumption in assumptions:
            if assumption not in changes[change_id].assumptions:
                changes[change_id].assumptions.append(assumption)
    return interpretations


def initial_result(manifest: RenderManifest, job_id: str) -> RenderResult:
    return RenderResult(
        **{
            key: getattr(manifest, key)
            for key in (
                "render_request_id",
                "proposal_set_version",
                "variant_ids",
                "baseline_asset_id",
                "part_catalog_version",
            )
        },
        job_id=job_id,
        status="queued",
        stage="queued",
        assets=[],
        outcomes=[],
    )


def failed_result(manifest: RenderManifest, job_id: str, reason: str) -> RenderResult:
    result = initial_result(manifest, job_id)
    result.status, result.failure_reason = "failed", reason
    result.stage = "complete"
    result.outcomes = [
        RenderOutcome(
            change_id=change.change_id,
            number=index,
            outcome="failed",
            reason=reason,
            asset_ids=[],
            assumptions=change.assumptions,
        )
        for index, change in enumerate(manifest.changes, 1)
    ]
    return result


def configuration_error(settings: RendererSettings) -> str | None:
    if (
        not settings.baseline_path
        or not settings.catalog_path
        or not settings.baseline_path.is_file()
        or not settings.catalog_path.is_file()
    ):
        return "Verified editable baseline GLB and catalog are not configured; viewer photographs are not geometry"
    return None


def review_and_correct(
    settings: RendererSettings,
    path: Path,
    client: Any,
    manifest: RenderManifest,
    catalog: GeometryCatalog,
    request: dict[str, Any],
    plan: dict[str, GeometryOperation],
    report: dict[str, Any],
    progress: Callable[[RenderStage], None] | None = None,
) -> tuple[dict[str, GeometryOperation], dict[str, Any], dict[str, Any]]:
    review: dict[str, Any] = {}
    candidate_path = path
    for round_index in range(settings.max_correction_rounds + 1):
        if progress:
            progress("reviewing")
        review_path = path / f"visual-review-{round_index}.json"
        if review_path.exists():
            review = json.loads(review_path.read_text())
        else:
            try:
                review = review_geometry(
                    client,
                    settings.model,
                    manifest,
                    report,
                    sorted(path.glob("original-*.png"))
                    + sorted(candidate_path.glob("candidate-*.png")),
                )
            except Exception:
                review = {
                    "changes": [
                        {
                            "change_id": change.change_id,
                            "passed": False,
                            "reason": "Vision review unavailable; committed measured geometry retained",
                        }
                        for change in manifest.changes
                    ],
                    "unaffected_parts_preserved_visually": False,
                }
                return plan, report, review
            save(review_path, review)
        assessments = {value["change_id"]: value for value in review["changes"]}
        if review["unaffected_parts_preserved_visually"] and all(
            assessments[change_id]["passed"] for change_id in plan
        ):
            break
        if round_index == settings.max_correction_rounds:
            break
        correction_path = path / f"correction-{round_index + 1}"
        correction_path.mkdir(exist_ok=True)
        if (correction_path / "plan.json").exists():
            corrected = {
                key: GeometryOperation.model_validate(value)
                for key, value in json.loads(
                    (correction_path / "plan.json").read_text()
                ).items()
            }
        else:
            if progress:
                progress("planning")
            corrected, audit = plan_geometry(
                client,
                settings.model,
                manifest,
                catalog,
                sorted(path.glob("original-*.png"))
                + sorted(candidate_path.glob("candidate-*.png")),
                max_calls=settings.max_tool_rounds,
                previous_review=review,
            )
            save(correction_path / "tool-audit.json", {"calls": audit})
            persist_plan(correction_path, manifest, corrected, audit)
        interpretations = restore_interpretations(correction_path, manifest, corrected)
        if not corrected or corrected == plan or set(corrected) != set(plan):
            break
        validate_plan(manifest, catalog, corrected)
        correction_request = {
            **request,
            "output": str(correction_path.resolve()),
            "operations": {
                key: value.model_dump(mode="json") for key, value in corrected.items()
            },
        }
        if not (correction_path / "measurements.json").exists():
            if progress:
                progress("editing")
            blender_call(settings, correction_path, correction_request)
        if progress:
            progress("validating")
        report = json.loads((correction_path / "measurements.json").read_text())
        # One atomic pointer binds the immutable stage's geometry, plan and measurements.
        save(
            path / "committed-candidate.json",
            {
                "stage": correction_path.name,
                "plan": {
                    key: value.model_dump(mode="json")
                    for key, value in corrected.items()
                },
                "interpretations": interpretations,
            },
        )
        candidate_path = correction_path
        plan = corrected
    return plan, report, review


def create_app(settings: RendererSettings | None = None) -> FastAPI:
    settings = settings or RendererSettings()
    application = FastAPI(title="Private vehicle geometry renderer")
    lock = Lock()

    def authenticate(authorization: str = Header(default="")) -> None:
        token = settings.token.get_secret_value()
        if not token or not hmac.compare_digest(authorization, "Bearer " + token):
            raise HTTPException(401, "Renderer authentication required")

    def job_directory(job_id: str) -> Path:
        if len(job_id) != 64 or any(
            value not in "0123456789abcdef" for value in job_id
        ):
            raise HTTPException(404, "Job not found")
        path = settings.jobs_path / job_id
        if not (path / "manifest.json").is_file():
            raise HTTPException(404, "Job not found")
        return path

    @application.post("/renderer/v1/jobs", dependencies=[Depends(authenticate)])
    def submit(
        manifest: RenderManifest, idempotency_key: str = Header(alias="Idempotency-Key")
    ) -> dict[str, str]:
        if not idempotency_key or len(idempotency_key) > 256:
            raise HTTPException(422, "Bounded idempotency key required")
        # Include run identity so keys can never collide across workspace runs.
        job_id = hashlib.sha256(
            (manifest.run_id + ":" + idempotency_key).encode()
        ).hexdigest()
        path = settings.jobs_path / job_id
        with lock:
            path.mkdir(parents=True, exist_ok=True)
            value = manifest.model_dump(mode="json")
            if (path / "manifest.json").exists():
                if json.loads((path / "manifest.json").read_text()) != value:
                    raise HTTPException(
                        409, "Idempotency key bound to another manifest"
                    )
            else:
                result = initial_result(manifest, job_id)
                reason = configuration_error(settings)
                if reason:
                    result = failed_result(manifest, job_id, reason)
                save_result(path, result)
                save(path / "manifest.json", value)
        return {"job_id": job_id, "status": "queued"}

    def baseline_catalog() -> GeometryCatalog:
        reason = configuration_error(settings)
        if reason:
            raise HTTPException(503, reason)
        assert settings.catalog_path and settings.baseline_path
        catalog = GeometryCatalog.model_validate_json(settings.catalog_path.read_text())
        if (
            hashlib.sha256(settings.baseline_path.read_bytes()).hexdigest()
            != catalog.sha256
        ):
            raise HTTPException(
                503, "Baseline checksum does not match verified catalog"
            )
        return catalog

    @application.get(
        "/renderer/v1/baseline/catalog", dependencies=[Depends(authenticate)]
    )
    def catalog() -> GeometrySceneCatalog:
        verified = baseline_catalog()
        result = GeometrySceneCatalog.model_validate(
            verified.model_dump(exclude={"sha256"})
        )
        result.asset_id = verified.baseline_asset_id
        return result

    @application.get(
        "/renderer/v1/baseline/asset", dependencies=[Depends(authenticate)]
    )
    def baseline() -> FileResponse:
        baseline_catalog()
        assert settings.baseline_path
        if settings.baseline_path.stat().st_size > 32 * 1024 * 1024:
            raise HTTPException(503, "Baseline exceeds authorized asset size limit")
        return FileResponse(settings.baseline_path, media_type="model/gltf-binary")

    @application.get("/renderer/v1/jobs/{job_id}", dependencies=[Depends(authenticate)])
    def status(job_id: str) -> RenderResult:
        return load_result(job_directory(job_id))

    @application.post(
        "/renderer/v1/jobs/{job_id}/retry", dependencies=[Depends(authenticate)]
    )
    def retry(
        job_id: str, idempotency_key: str = Header(alias="Idempotency-Key")
    ) -> dict[str, str]:
        if not idempotency_key or len(idempotency_key) > 256:
            raise HTTPException(422, "Bounded idempotency key required")
        path = job_directory(job_id)
        with lock:
            keys = retry_keys(path)
            if idempotency_key in keys:
                return {"job_id": job_id, "status": "queued"}
            result = load_result(path)
            if result.status not in {"failed", "partial"}:
                raise HTTPException(409, "Only failed or partial jobs are retryable")
            manifest = RenderManifest.model_validate_json(
                (path / "manifest.json").read_text()
            )
            # Committed plan, geometry and review files survive explicit retries.
            keys.append(idempotency_key)
            save_result(path, initial_result(manifest, job_id), keys=keys)
        return {"job_id": job_id, "status": "queued"}

    @application.get(
        "/renderer/v1/jobs/{job_id}/assets/{asset_id}",
        dependencies=[Depends(authenticate)],
    )
    def asset(job_id: str, asset_id: str) -> FileResponse:
        path = job_directory(job_id)
        result = load_result(path)
        selected = next(
            (asset for asset in result.assets if asset.asset_id == asset_id), None
        )
        if selected is None or asset_id not in {"candidate", "original"}:
            raise HTTPException(404, "Asset not found")
        if asset_id == "candidate" and (path / "committed-candidate.json").exists():
            stage = json.loads((path / "committed-candidate.json").read_text())["stage"]
            if stage not in {"correction-1", "correction-2"}:
                raise HTTPException(502, "Invalid committed geometry stage")
            path = path / stage
        return FileResponse(path / (asset_id + ".glb"), media_type=selected.media_type)

    return application


def execute_job(settings: RendererSettings, path: Path) -> None:
    manifest = RenderManifest.model_validate_json((path / "manifest.json").read_text())
    job_id = path.name
    result = initial_result(manifest, job_id)
    client = None

    def progress(stage: RenderStage) -> None:
        result.status, result.stage = "rendering", stage
        save_result(path, result)

    try:
        progress("inspecting")
        reason = configuration_error(settings)
        if reason:
            raise ValueError(reason)
        assert settings.baseline_path and settings.catalog_path
        catalog = GeometryCatalog.model_validate_json(settings.catalog_path.read_text())
        if (
            hashlib.sha256(settings.baseline_path.read_bytes()).hexdigest()
            != catalog.sha256
        ):
            raise ValueError("Verified baseline SHA256 identity mismatch")
        blocked = {
            change.change_id: "Free-text preservation constraints require an independently measurable policy"
            for change in manifest.changes
            if change.preserve_constraints
        }
        parts = {part.part_id: part for part in catalog.parts}
        for change in manifest.changes:
            if not any(
                part_id in parts
                and parts[part_id].edit_origin_local is not None
                and "resize_local" in parts[part_id].operations
                for part_id in change.part_ids
            ):
                blocked[change.change_id] = (
                    "No compatible independent mesh with a verified geometry edit origin"
                )
        planning_manifest = manifest.model_copy(
            update={
                "changes": [
                    change
                    for change in manifest.changes
                    if change.change_id not in blocked
                ]
            }
        )
        plan = {
            change.change_id: change.geometry
            for change in manifest.changes
            if change.geometry is not None and change.change_id not in blocked
        }
        validate_plan(manifest, catalog, plan)
        request = {
            "baseline": str(settings.baseline_path.resolve()),
            "catalog": catalog.model_dump(mode="json"),
            "operations": {},
            "output": str(path.resolve()),
            "target_part_ids": list(
                dict.fromkeys(
                    part_id
                    for change in manifest.changes
                    for part_id in change.part_ids
                )
            ),
        }
        if settings.ai_enabled:
            if not settings.openai_api_key.get_secret_value() or not settings.model:
                raise ValueError("Explicit editing model and credential required")
            from openai import OpenAI

            client = OpenAI(
                api_key=settings.openai_api_key.get_secret_value(),
                base_url=settings.openai_base_url,
                timeout=30,
                max_retries=0,
            )
            if (path / "plan.json").exists():
                plan = {
                    key: GeometryOperation.model_validate(value)
                    for key, value in json.loads(
                        (path / "plan.json").read_text()
                    ).items()
                }
            elif not plan and planning_manifest.changes:
                blender_call(settings, path, request)
                progress("planning")
                plan, audit = plan_geometry(
                    client,
                    settings.model,
                    planning_manifest,
                    catalog,
                    sorted(path.glob("original-*.png")),
                    max_calls=settings.max_tool_rounds,
                )
                save(path / "tool-audit.json", {"calls": audit})
                persist_plan(path, manifest, plan, audit)
            restore_interpretations(path, manifest, plan)
            plan = {key: value for key, value in plan.items() if key not in blocked}
            validate_plan(manifest, catalog, plan)
        result.outcomes = [
            RenderOutcome(
                change_id=change.change_id,
                number=index,
                outcome="unsupported",
                reason=(
                    blocked.get(change.change_id)
                    or "No explicit geometry operation; design interpretation or novel component generation is required"
                ),
                asset_ids=[],
                assumptions=change.assumptions,
            )
            for index, change in enumerate(manifest.changes, 1)
        ]
        if plan:
            progress("editing")
            request["operations"] = {
                key: value.model_dump(mode="json") for key, value in plan.items()
            }
            # Trusted script only; Blender receives no application credentials.
            if not (path / "measurements.json").exists():
                blender_call(settings, path, request)
            progress("validating")
            report = json.loads((path / "measurements.json").read_text())
            review = None
            if client:
                try:
                    plan, report, review = review_and_correct(
                        settings,
                        path,
                        client,
                        manifest,
                        catalog,
                        request,
                        plan,
                        report,
                        progress,
                    )
                except Exception:
                    # Keep measured geometry if paid review or corrections cannot finish.
                    review = None
            candidate_path = path
            if (path / "committed-candidate.json").exists():
                committed = json.loads((path / "committed-candidate.json").read_text())
                if committed["stage"] not in {"correction-1", "correction-2"}:
                    raise ValueError("Invalid committed geometry stage")
                candidate_path = path / committed["stage"]
                plan = {
                    key: GeometryOperation.model_validate(value)
                    for key, value in committed["plan"].items()
                }
                report = json.loads((candidate_path / "measurements.json").read_text())
                restore_interpretations(candidate_path, manifest, plan)
            for asset_id in ("candidate", "original"):
                asset_path = candidate_path if asset_id == "candidate" else path
                if (
                    not (asset_path / (asset_id + ".glb")).is_file()
                    or (asset_path / (asset_id + ".glb")).stat().st_size
                    > 32 * 1024 * 1024
                ):
                    raise ValueError("Missing or oversized exported GLB")
                result.assets.append(
                    Asset(
                        asset_id=asset_id,
                        url=f"{settings.public_url.rstrip('/')}/renderer/v1/jobs/{job_id}/assets/{asset_id}",
                        media_type="model/gltf-binary",
                    )
                )
            result.scene_catalog = GeometrySceneCatalog.model_validate(
                report["scene_catalog"]
            )
            result.scene_catalog.baseline_url = result.assets[1].url
            for outcome in result.outcomes:
                if outcome.change_id in plan:
                    saved_change = next(
                        change
                        for change in manifest.changes
                        if change.change_id == outcome.change_id
                    )
                    outcome.assumptions = list(dict.fromkeys(saved_change.assumptions))
                    for audit_path in [
                        path / "tool-audit.json",
                        *sorted(path.glob("correction-*/tool-audit.json")),
                    ]:
                        if audit_path.exists():
                            for call in json.loads(audit_path.read_text())["calls"]:
                                if call.get("tool") == "propose_resize" and call.get(
                                    "result", {}
                                ).get("accepted"):
                                    arguments = json.loads(call["arguments"])
                                    if arguments[
                                        "change_id"
                                    ] == outcome.change_id and arguments[
                                        "dimensions_m"
                                    ] == list(plan[outcome.change_id].dimensions_m):
                                        assumption = arguments["assumption"]
                                        if (
                                            assumption
                                            and assumption not in outcome.assumptions
                                        ):
                                            outcome.assumptions.append(assumption)
                    outcome.outcome, outcome.geometry_produced = "rendered", True
                    outcome.asset_ids = ["candidate"]
                    outcome.measurements = report["changes"][outcome.change_id]
                    outcome.visual_review = "needs_review"
                    outcome.assumptions.append(
                        "The edit origin is a measured geometry pivot; physical mounting, exact collision clearances, and engineering validity are not assessed"
                    )
                    outcome.warnings = report.get("clearance_warnings", [])
                    outcome.reason = "Measured geometry produced; visual review and engineering validity remain unverified"
            if review:
                for outcome in result.outcomes:
                    assessment = next(
                        value
                        for value in review["changes"]
                        if value["change_id"] == outcome.change_id
                    )
                    if outcome.geometry_produced:
                        passed = (
                            assessment["passed"]
                            and review["unaffected_parts_preserved_visually"]
                            and not outcome.warnings
                        )
                        outcome.visual_review = "passed" if passed else "needs_review"
                        outcome.reason = assessment["reason"]
            result.status = (
                "succeeded"
                if all(
                    outcome.geometry_produced
                    and outcome.visual_review == "passed"
                    and not outcome.warnings
                    for outcome in result.outcomes
                )
                else "partial"
            )
        else:
            result.status = "failed"
            result.failure_reason = (
                "No supported explicit geometry operation was supplied"
            )
    except Exception:
        result = failed_result(
            manifest,
            job_id,
            "Geometry worker failed validation, timed out, or could not start Blender; original preserved",
        )
    finally:
        if client:
            client.close()
    result.stage = "complete"
    save_result(path, result)


app = create_app()


if __name__ == "__main__":
    settings = RendererSettings()
    # shortcut: one worker per jobs directory; use a transactional queue for horizontal scaling.
    while True:
        for path in settings.jobs_path.glob("*/manifest.json"):
            result = json.loads(path.with_name("result.json").read_text())
            if result["status"] in {"queued", "rendering"}:
                execute_job(settings, path.parent)
        time.sleep(1)
