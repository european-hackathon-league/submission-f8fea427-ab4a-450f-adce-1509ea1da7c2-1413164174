"""Authenticated external renderer orchestration with immutable manifests."""

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote, urlsplit

import httpx
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession
from temporalio import activity

from app import wire as w
from app.auth import Actor, reject
from app.commands import audit, command, emit, owned_run
from app.config import Settings
from app.control import accepted, proposal_row, require_pm, resource_row, stale
from app.db import EvidenceArtifact, Outbox, Run, RunEvidence, Session, StageOutput
from app.evidence import external_evidence


def build_manifest(
    proposals: w.Proposals,
    body: w.RenderCommand,
    render_id: str,
    config: dict[str, Any],
) -> w.RenderManifest:
    if body.proposal_set_version != proposals.proposal_set_version:
        reject(
            "stale_version", "Render must use the selected saved proposal version", 409
        )
    variants = {variant.variant_id: variant for variant in proposals.variants}
    if len(set(body.variant_ids)) != len(body.variant_ids) or any(
        value not in variants for value in body.variant_ids
    ):
        reject(
            "invalid_variant",
            "Render variants must belong to the selected proposal version",
            422,
        )
    if body.baseline_asset_id != config["baseline_asset_id"]:
        reject(
            "invalid_baseline",
            "Baseline asset does not belong to the frozen run configuration",
            422,
        )
    selected = {
        value
        for variant_id in body.variant_ids
        for value in variants[variant_id].change_ids
    }
    changes = [
        change
        for change in proposals.changes
        if change.change_id in selected
        and change.decision_state not in {"rejected", "deferred"}
    ]
    if not changes:
        reject(
            "no_selected_changes", "Select at least one saved, eligible suggestion", 422
        )
    return w.RenderManifest(
        **body.model_dump(),
        render_request_id=render_id,
        run_id=proposals.run_id,
        part_catalog_version=config["part_catalog_version"],
        changes=[
            w.ManifestChange(
                change_id=change.change_id,
                part_ids=change.part_ids,
                proposed_outcome=change.outcome,
                visual_instruction=change.after,
                preserve_constraints=change.preservation_constraints,
                evidence_ids=list(
                    dict.fromkeys(
                        change.supporting_evidence_ids + change.opposing_evidence_ids
                    )
                ),
                proposal_change_version=change.version,
                assumptions=list(
                    dict.fromkeys(
                        change.uncertainty
                        + change.conditions
                        + [
                            assumption
                            for variant_id in body.variant_ids
                            for assumption in variants[variant_id].assumptions
                        ]
                    )
                ),
            )
            for change in changes
        ],
    )


def queued_result(manifest: w.RenderManifest) -> w.RenderResult:
    return w.RenderResult(
        render_request_id=manifest.render_request_id,
        proposal_set_version=manifest.proposal_set_version,
        variant_ids=manifest.variant_ids,
        baseline_asset_id=manifest.baseline_asset_id,
        part_catalog_version=manifest.part_catalog_version,
        status="queued",
        assets=[],
        outcomes=[],
    )


def create_render(
    actor: Actor, run_id: str, body: w.RenderCommand, key: str
) -> w.Accepted:
    def effect(session: DBSession, command_id: str) -> dict[str, Any]:
        require_pm(actor)
        run = owned_run(session, actor, run_id, lock=True)
        if run.current_proposal_set_version != body.proposal_set_version:
            stale(run)
        proposals = w.Proposals.model_validate(
            proposal_row(session, run, body.proposal_set_version).payload
        )
        decisions = session.scalars(
            select(StageOutput).where(
                StageOutput.run_id == run.id, StageOutput.stage_key.like("decision:%")
            )
        ).all()
        for row in sorted(
            decisions, key=lambda value: str(value.payload["occurred_at"])
        ):
            decision = row.payload
            if decision["proposal_set_version"] == body.proposal_set_version:
                for change in proposals.changes:
                    if change.change_id in decision["change_ids"]:
                        change.decision_state = decision["state"]
        manifest = build_manifest(proposals, body, command_id, run.config)
        evidence_ids = {
            value for change in manifest.changes for value in change.evidence_ids
        }
        excerpts = {
            artifact.id: artifact.excerpt
            for artifact in session.scalars(
                select(EvidenceArtifact).where(
                    EvidenceArtifact.id.in_(evidence_ids),
                    EvidenceArtifact.id.in_(
                        select(RunEvidence.evidence_id).where(
                            RunEvidence.run_id == run.id
                        )
                    ),
                )
            )
        }
        excerpts.update(
            {
                key: value.excerpt
                for key, value in external_evidence(session, run.id).items()
                if key in evidence_ids
            }
        )
        for requested_change in manifest.changes:
            # Bound prompt excerpts; complete evidence remains available through its authorized links.
            requested_change.requested_wording = (
                "\n".join(
                    f"{evidence_id}: {excerpts[evidence_id][:2000]}"
                    for evidence_id in requested_change.evidence_ids[:6]
                    if evidence_id in excerpts
                )
                or None
            )
        # The workspace/run locks also prevent duplicate jobs from different tabs.
        existing = session.scalars(
            select(StageOutput).where(
                StageOutput.run_id == run.id, StageOutput.stage_key.like("render:%")
            )
        ).all()
        requested = manifest.model_dump(exclude={"render_request_id"}, mode="json")
        for row in existing:
            previous = w.RenderManifest.model_validate(row.payload["manifest"])
            if (
                previous.model_dump(exclude={"render_request_id"}, mode="json")
                == requested
            ):
                return accepted(
                    command_id, run_id, "renders", previous.render_request_id
                )
        session.add(
            StageOutput(
                run_id=run.id,
                generation_id=run.generation_id,
                stage_key=f"render:{command_id}",
                payload={
                    "manifest": manifest.model_dump(mode="json"),
                    "result": queued_result(manifest).model_dump(mode="json"),
                    "attempts": [],
                },
            )
        )
        session.add(Outbox(command_id=command_id))
        emit(session, run, "render.updated", "render", command_id)
        return accepted(command_id, run_id, "renders")

    return w.Accepted.model_validate(
        command(
            actor,
            "render",
            key,
            {"run_id": run_id, **body.model_dump(mode="json")},
            effect,
            run_id=run_id,
        )
    )


def get_render(actor: Actor, run_id: str, render_id: str) -> w.RenderResult:
    with Session() as session:
        run = owned_run(session, actor, run_id)
        row = resource_row(session, run_id, f"render:{render_id}")
        result = w.RenderResult.model_validate(row.payload["result"])
        result.stale = result.proposal_set_version != run.current_proposal_set_version
        for asset in result.assets:
            asset.url = f"/api/v1/runs/{run_id}/renders/{render_id}/assets/{quote(asset.asset_id, safe='')}"
        if result.scene_catalog is not None:
            original = next(
                (asset for asset in result.assets if asset.asset_id == "original"), None
            )
            result.scene_catalog.baseline_url = original.url if original else None
        return result


def retry_render(actor: Actor, run_id: str, render_id: str, key: str) -> w.Accepted:
    require_pm(actor)

    def effect(session: DBSession, command_id: str) -> dict[str, Any]:
        run = owned_run(session, actor, run_id, lock=True)
        previous = resource_row(session, run_id, f"render:{render_id}")
        result = w.RenderResult.model_validate(previous.payload["result"])
        if result.status not in {"failed", "partial"}:
            reject(
                "render_not_retryable",
                "Only failed or partial renders can be retried",
                409,
            )
        manifest = w.RenderManifest.model_validate(previous.payload["manifest"])
        payload = deepcopy(previous.payload)
        payload.setdefault("history", []).append(payload["result"])
        payload["result"] = queued_result(manifest).model_dump(mode="json")
        payload["result"]["job_id"] = result.job_id
        payload["retry_requested"] = command_id
        payload["attempts"].append(
            {
                "operation": "retry",
                "command_id": command_id,
                "occurred_at": datetime.now(UTC).isoformat(),
            }
        )
        previous.payload = payload
        session.add(Outbox(command_id=command_id))
        emit(session, run, "render.updated", "render", render_id)
        return accepted(command_id, run_id, "renders", render_id)

    return w.Accepted.model_validate(
        command(
            actor,
            "render",
            key,
            {"run_id": run_id, "render_id": render_id},
            effect,
            run_id=run_id,
        )
    )


def validate_result(
    manifest: w.RenderManifest, result: w.RenderResult
) -> w.RenderResult:
    if result.scene_catalog is not None and (
        result.scene_catalog.baseline_asset_id != manifest.baseline_asset_id
        or result.scene_catalog.part_catalog_version != manifest.part_catalog_version
        or result.scene_catalog.asset_id
        not in {asset.asset_id for asset in result.assets}
    ):
        raise ValueError("Renderer geometry catalog identity mismatch")
    for name in (
        "render_request_id",
        "proposal_set_version",
        "baseline_asset_id",
        "part_catalog_version",
    ):
        if getattr(manifest, name) != getattr(result, name):
            raise ValueError("Renderer result identity mismatch")
    if set(manifest.variant_ids) != set(result.variant_ids) or len(
        set(result.variant_ids)
    ) != len(result.variant_ids):
        raise ValueError("Renderer result variant mismatch")
    expected = {change.change_id for change in manifest.changes}
    actual = [outcome.change_id for outcome in result.outcomes]
    assets = {asset.asset_id for asset in result.assets}
    if (
        len(assets) != len(result.assets)
        or len(set(actual)) != len(actual)
        or set(actual) - expected
    ):
        raise ValueError("Renderer returned unknown or duplicate identities")
    if any(set(outcome.asset_ids) - assets for outcome in result.outcomes):
        raise ValueError("Renderer outcome references missing assets")
    if result.status in {"succeeded", "partial", "failed"}:
        if set(actual) != expected:
            raise ValueError("Terminal renderer result omits requested changes")
        successful = sum(
            outcome.outcome in {"rendered", "annotated"} for outcome in result.outcomes
        )
        needs_review = any(
            outcome.geometry_produced
            and (outcome.visual_review != "passed" or outcome.warnings)
            for outcome in result.outcomes
        )
        result.status = (
            "succeeded"
            if successful == len(expected) and expected and not needs_review
            else "partial"
            if successful
            else "failed"
        )
    return result


def renderer_call(
    method: str, path: str, request_id: str, body: dict[str, Any] | None = None
) -> dict[str, Any]:
    settings = Settings()
    token = settings.renderer_token.get_secret_value()
    if not settings.renderer_url or not token:
        raise ValueError("renderer_unconfigured")
    with httpx.Client(timeout=30, follow_redirects=False, trust_env=False) as client:
        with client.stream(
            method,
            settings.renderer_url.rstrip("/") + path,
            headers={"Authorization": f"Bearer {token}", "Idempotency-Key": request_id},
            json=body,
        ) as response:
            response.raise_for_status()
            data = bytearray()
            for chunk in response.iter_bytes():
                data.extend(chunk)
                if len(data) > 2 * 1024 * 1024:
                    raise ValueError("renderer_response_limit")
            import json

            value = json.loads(data)
            if not isinstance(value, dict):
                raise ValueError("invalid_renderer_response")
            return value


def _perform(args: list[str], poll: bool) -> str:
    run_id, generation, render_id = args
    with Session.begin() as session:
        row = resource_row(session, run_id, f"render:{render_id}")
        payload = deepcopy(row.payload)
        result = w.RenderResult.model_validate(payload["result"])
        if result.status in {"succeeded", "partial", "failed"}:
            return result.status
        if not poll and result.job_id and not payload.get("retry_requested"):
            return "rendering"
        payload["attempts"].append(
            {
                "operation": "poll" if poll else "submit",
                "occurred_at": datetime.now(UTC).isoformat(),
            }
        )
        row.payload = payload
    manifest = w.RenderManifest.model_validate(payload["manifest"])
    raw: dict[str, Any] | None = None
    try:
        if poll:
            if not result.job_id:
                raise ValueError("renderer_missing_job")
            raw = renderer_call(
                "GET", f"/renderer/v1/jobs/{quote(result.job_id, safe='')}", render_id
            )
        else:
            if result.job_id and payload.get("retry_requested"):
                raw = renderer_call(
                    "POST",
                    f"/renderer/v1/jobs/{quote(result.job_id, safe='')}/retry",
                    payload["retry_requested"],
                )
            else:
                raw = renderer_call(
                    "POST",
                    "/renderer/v1/jobs",
                    render_id,
                    manifest.model_dump(mode="json"),
                )
        if not poll and set(raw).issubset({"job_id", "status"}) and raw.get("job_id"):
            updated = queued_result(manifest)
            updated.job_id = str(raw["job_id"])
            updated.status = "rendering"
        else:
            updated = validate_result(manifest, w.RenderResult.model_validate(raw))
    except httpx.HTTPError, ValueError, ValidationError:
        updated = queued_result(manifest)
        updated.job_id = result.job_id
        updated.status = "failed"
        updated.failure_reason = "Renderer unavailable or returned an invalid version-bound result; proposals are preserved"
        updated.outcomes = [
            w.RenderOutcome(
                change_id=change.change_id,
                outcome="failed",
                reason=updated.failure_reason,
                asset_ids=[],
            )
            for change in manifest.changes
        ]
    with Session.begin() as session:
        run = session.scalar(select(Run).where(Run.id == run_id).with_for_update())
        row = resource_row(session, run_id, f"render:{render_id}")
        latest = w.RenderResult.model_validate(row.payload["result"])
        if latest.status in {"succeeded", "partial", "failed"}:
            return latest.status
        updated.stale = (
            run is None
            or run.generation_id != generation
            or run.current_proposal_set_version != manifest.proposal_set_version
        )
        value = deepcopy(row.payload)
        value["result"] = updated.model_dump(mode="json")
        if not poll and updated.job_id and updated.status != "failed":
            value.pop("retry_requested", None)
        if raw is not None and updated.status == "failed":
            value["quarantined"] = raw
        row.payload = value
        if run is not None:
            emit(session, run, "render.updated", "render", render_id)
    return updated.status


@activity.defn
def render_submit(args: list[str]) -> str:
    return _perform(args, False)


@activity.defn
def render_poll(args: list[str]) -> str:
    return _perform(args, True)


@activity.defn
def render_expire(args: list[str]) -> str:
    run_id, generation, render_id = args
    with Session.begin() as session:
        run = session.scalar(select(Run).where(Run.id == run_id).with_for_update())
        row = resource_row(session, run_id, f"render:{render_id}")
        payload = deepcopy(row.payload)
        result = w.RenderResult.model_validate(payload["result"])
        if result.status in {"succeeded", "partial", "failed"}:
            return result.status
        manifest = w.RenderManifest.model_validate(payload["manifest"])
        result.status = "failed"
        result.failure_reason = (
            "Renderer polling deadline exhausted; proposals are preserved"
        )
        result.outcomes = [
            w.RenderOutcome(
                change_id=change.change_id,
                outcome="failed",
                reason=result.failure_reason,
                asset_ids=[],
            )
            for change in manifest.changes
        ]
        result.stale = (
            run is None
            or run.generation_id != generation
            or run.current_proposal_set_version != result.proposal_set_version
        )
        payload["result"] = result.model_dump(mode="json")
        row.payload = payload
        if run is not None:
            emit(session, run, "render.updated", "render", render_id)
    return "failed"


def asset_bytes(
    actor: Actor, run_id: str, render_id: str, asset_id: str
) -> tuple[bytes, str]:
    with Session.begin() as session:
        owned_run(session, actor, run_id)
        row = resource_row(session, run_id, f"render:{render_id}")
        result = w.RenderResult.model_validate(row.payload["result"])
        asset = next(
            (value for value in result.assets if value.asset_id == asset_id), None
        )
        if asset is None:
            reject("not_found", "Render asset not found", 404)
        assert asset is not None
        settings = Settings()
        configured, target = urlsplit(settings.renderer_url), urlsplit(asset.url)
        if (
            (configured.scheme, configured.netloc) != (target.scheme, target.netloc)
            or target.username
            or target.password
            or target.fragment
        ):
            reject("invalid_asset", "Renderer asset origin is not configured", 502)
        if asset.media_type not in {
            "image/png",
            "image/jpeg",
            "image/webp",
            "model/gltf-binary",
        }:
            reject("invalid_asset", "Unsupported renderer media type", 502)
        audit(session, actor, "render.asset.read", asset_id, run_id)
    return renderer_asset_bytes(asset.url, asset.media_type)


def renderer_asset_bytes(url: str, media_type: str) -> tuple[bytes, str]:
    settings = Settings()
    configured, target = urlsplit(settings.renderer_url), urlsplit(url)
    if not settings.renderer_url or (
        (configured.scheme, configured.netloc) != (target.scheme, target.netloc)
        or target.username
        or target.password
        or target.fragment
    ):
        reject("invalid_asset", "Renderer asset origin is not configured", 502)
    with httpx.Client(timeout=30, follow_redirects=False, trust_env=False) as client:
        with client.stream(
            "GET",
            url,
            headers={
                "Authorization": f"Bearer {settings.renderer_token.get_secret_value()}"
            },
        ) as response:
            response.raise_for_status()
            data = bytearray()
            for chunk in response.iter_bytes():
                data.extend(chunk)
                if len(data) > 32 * 1024 * 1024:
                    reject(
                        "asset_size_limit", "Renderer asset exceeds bounded size", 502
                    )
    return bytes(data), media_type


def baseline_catalog(actor: Actor, run_id: str) -> w.GeometrySceneCatalog:
    with Session() as session:
        config = owned_run(session, actor, run_id).config
    try:
        catalog = w.GeometrySceneCatalog.model_validate(
            renderer_call("GET", "/renderer/v1/baseline/catalog", run_id)
        )
    except httpx.HTTPError, ValueError:
        reject(
            "geometry_unavailable",
            "Verified editable vehicle geometry is unavailable",
            503,
        )
    if (
        catalog.baseline_asset_id != config["baseline_asset_id"]
        or catalog.asset_id != config["baseline_asset_id"]
        or catalog.part_catalog_version != config["part_catalog_version"]
    ):
        reject(
            "invalid_catalog", "Geometry catalog does not match the saved vehicle", 502
        )
    catalog.baseline_url = f"/api/v1/runs/{run_id}/geometry/asset"
    return catalog


def baseline_bytes(actor: Actor, run_id: str) -> tuple[bytes, str]:
    baseline_catalog(actor, run_id)
    with Session.begin() as session:
        owned_run(session, actor, run_id)
        audit(session, actor, "geometry.asset.read", run_id, run_id)
    return renderer_asset_bytes(
        Settings().renderer_url.rstrip("/") + "/renderer/v1/baseline/asset",
        "model/gltf-binary",
    )
