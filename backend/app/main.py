import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated, Any
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response

from app import control, rendering, runs
from app import evidence as evidence_queries
from app import exports as export_jobs
from app import findings as finding_queries
from app import proposals as proposal_queries
from app import research as research_queries
from app import wire as w
from app.auth import Actor, actor, reject
from app.commands import audit, command, emit, new_id
from app.config import Settings
from app.db import Outbox, Run, RunSource, Session, Source, SourceVersion, StageOutput
from app.ingestion import parser_binding
from app.limits import BodyLimit
from app.readiness import check_readiness
from app.storage import digest, inspect_upload, storage
from app.telemetry import configure, latency, requests, tracer

app = FastAPI(
    title="Vehicle requirements backend",
    version="1",
    telemetry={"logs": False, "auto_configure": False},
)
app.add_middleware(BodyLimit)
configure(Settings())
app.add_middleware(
    CORSMiddleware,
    allow_origins=Settings().cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=[
        "Authorization",
        "X-Workspace-ID",
        "Idempotency-Key",
        "Last-Event-ID",
    ],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_id(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    request.state.request_id = str(uuid4())
    started = time.perf_counter()
    with tracer.start_as_current_span("api.request") as span:
        span.set_attribute("request.id", request.state.request_id)
        try:
            response = await call_next(request)
        except Exception as error:
            span.set_attribute("error.type", type(error).__name__)
            response = JSONResponse(
                status_code=500,
                content=w.Error(
                    code="internal_error", message="The operation failed"
                ).model_dump(),
            )
        span.set_attribute("http.status_code", response.status_code)
        requests.add(
            1, {"http.method": request.method, "http.status_code": response.status_code}
        )
        latency.record(time.perf_counter() - started, {"http.method": request.method})
        logging.getLogger("backend").info(
            json.dumps(
                {
                    "event": "api.request",
                    "request_id": request.state.request_id,
                    "method": request.method,
                    "status": response.status_code,
                }
            )
        )
    response.headers["X-Request-ID"] = request.state.request_id
    return response


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, error: StarletteHTTPException) -> JSONResponse:
    body = (
        error.detail
        if isinstance(error.detail, dict)
        else w.Error(code="http_error", message=str(error.detail)).model_dump()
    )
    return JSONResponse(status_code=error.status_code, content=body)


@app.exception_handler(RequestValidationError)
async def validation_error(
    request: Request, error: RequestValidationError
) -> JSONResponse:
    # Validation inputs may contain private text or tokens; return locations only.
    return JSONResponse(
        status_code=422,
        content=w.Error(
            code="validation_error",
            message="Invalid request",
            field_errors=[
                {"field": ".".join(map(str, item["loc"])), "message": item["type"]}
                for item in error.errors()
            ],
        ).model_dump(),
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "alive", "contract_version": "1"}


@app.get("/ready")
async def readiness() -> JSONResponse:
    payload, status = await check_readiness()
    return JSONResponse(
        payload, status_code=status, headers={"Cache-Control": "no-store"}
    )


router = APIRouter(
    prefix="/api/v1",
    dependencies=[Depends(actor)],
    responses={
        code: {"model": w.Error} for code in (401, 403, 404, 409, 413, 422, 500, 501)
    },
)
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=200)]
Auth = Annotated[Actor, Depends(actor)]
Limit = Annotated[int, Query(ge=1, le=100)]


@router.get("/vehicles", response_model=w.Page[w.Vehicle])
def vehicles(limit: Limit = 50, cursor: str | None = None) -> w.Page[w.Vehicle]:
    catalog = runs.catalog()
    return w.Page[w.Vehicle](
        items=[]
        if cursor
        else [
            w.Vehicle(
                vehicle_id=catalog["vehicle_id"],
                baseline_asset_ids=[catalog["baseline_asset_id"]],
                part_catalog_versions=[catalog["part_catalog_version"]],
                capabilities=sorted(
                    {
                        capability
                        for part in catalog["parts"]
                        for capability in part["capabilities"]
                    }
                ),
                synthetic=catalog["synthetic"],
            )
        ]
    )


@router.post("/uploads", response_model=w.Uploads)
def uploads(
    idempotency_key: Key,
    files: Annotated[list[UploadFile], File()],
    identity: Auth,
    dataset_namespace: Annotated[
        str | None, Form(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_.:-]+$")
    ] = None,
) -> w.Uploads:
    settings = Settings()
    if len(files) > 20:
        reject("upload_limit", "At most twenty files per upload", 413)
    content = [(upload.filename or "unnamed", upload.file.read()) for upload in files]
    body = {
        "dataset_namespace": dataset_namespace,
        "files": [
            {"filename": filename, "sha256": digest(data)} for filename, data in content
        ],
    }
    objects = storage(settings)
    written: list[str] = []

    def effect(session: DBSession, command_id: str) -> dict[str, Any]:
        results = []
        for filename, data in content:
            source_id = new_id()
            kind, reason = inspect_upload(filename, data, settings)
            namespace = dataset_namespace
            namespace_warnings = []
            if namespace is None:
                namespace = new_id()
                namespace_warnings = ["generated_dataset_namespace"]
            source = Source(
                id=source_id,
                workspace_id=identity.workspace_id,
                dataset_namespace=namespace,
                namespace_warnings=namespace_warnings,
                filename=filename,
                detected_type=kind,
                status="rejected" if reason else "ready",
                reason=reason,
            )
            session.add(source)
            session.flush()
            if reason is None:
                version_id = new_id()
                key = f"{identity.workspace_id}/{version_id}"
                objects.put(key, data)
                written.append(key)
                session.add(
                    SourceVersion(
                        id=version_id,
                        source_id=source_id,
                        sha256=digest(data),
                        object_key=key,
                        byte_size=len(data),
                    )
                )
            audit(session, identity, "source.upload", source_id)
            results.append(
                w.UploadResult.model_validate(
                    {
                        "source_id": source_id,
                        "filename": filename,
                        "detected_type": kind,
                        "status": source.status,
                        "reason": reason,
                    }
                ).model_dump()
            )
        return {"sources": results}

    try:
        return w.Uploads.model_validate(
            command(identity, "uploads", idempotency_key, body, effect)
        )
    except Exception:
        for key in written:
            objects.delete(key)
        raise


@router.get("/sources/{source_id}/content", response_class=Response)
def source_content(source_id: str, identity: Auth) -> Response:
    with Session.begin() as session:
        source = session.scalar(
            select(Source).where(
                Source.id == source_id, Source.workspace_id == identity.workspace_id
            )
        )
        if source is None or source.status != "ready":
            reject("not_found", "Source not found", 404)
        version = session.scalar(
            select(SourceVersion).where(SourceVersion.source_id == source.id)
        )
        if version is None:
            reject("not_found", "Source version not found", 404)
        data = storage(Settings()).read(version.object_key)
        audit(session, identity, "source.read", source.id)
        return Response(
            data,
            media_type="application/octet-stream",
            headers={"Cache-Control": "no-store"},
        )


@router.post("/runs", response_model=w.RunAccepted, status_code=202)
def create_run(
    body: w.RunConfig, idempotency_key: Key, identity: Auth
) -> w.RunAccepted:
    catalog = runs.catalog()
    if (body.vehicle_id, body.baseline_asset_id, body.part_catalog_version) != (
        catalog["vehicle_id"],
        catalog["baseline_asset_id"],
        catalog["part_catalog_version"],
    ):
        reject("invalid_catalog", "Vehicle, baseline asset and catalog must match", 422)

    def effect(session: DBSession, command_id: str) -> dict[str, Any]:
        source_ids = set(body.source_ids)
        sources = session.scalars(
            select(Source).where(
                Source.id.in_(source_ids), Source.workspace_id == identity.workspace_id
            )
        ).all()
        if len(sources) != len(source_ids):
            reject("not_found", "Source not found", 404)
        if any(source.status != "ready" for source in sources):
            reject("source_not_ready", "Runs require ready sources", 422)
        versions = session.scalars(
            select(SourceVersion).where(SourceVersion.source_id.in_(source_ids))
        ).all()
        if len(versions) != len(source_ids):
            reject("source_not_ready", "Source version is missing", 422)
        run = Run(
            id=new_id(),
            workspace_id=identity.workspace_id,
            config=body.model_dump(mode="json"),
            generation_id=new_id(),
            analysis_status="queued",
            stage="queued",
            revision=1,
            event_sequence=0,
            warnings=[
                f"Source {source.id}: dataset namespace was generated; overlapping-file identity is not established without an explicit shared namespace"
                for source in sources
                if source.namespace_warnings
            ],
        )
        session.add(run)
        session.flush()
        settings = Settings()
        session.add(
            StageOutput(
                run_id=run.id,
                generation_id=run.generation_id,
                stage_key="configuration",
                payload={
                    "model": settings.app_model,
                    "base_url": settings.openai_base_url,
                    "prompt_revision": finding_queries.PROMPT_REVISION,
                    "schema_revision": finding_queries.PROMPT_REVISION,
                    "planning_horizon": settings.planning_horizon,
                    "reference_year": settings.reference_year,
                    "catalog": runs.catalog(),
                    "research_max_searches": settings.research_max_searches,
                    "research_max_sources": settings.research_max_sources,
                    "research_timeout_seconds": settings.research_timeout_seconds,
                    "research_max_bytes": settings.research_max_bytes,
                    "research_max_tokens": settings.research_max_tokens,
                    "ai_batch_size": settings.ai_batch_size,
                    "ai_timeout_seconds": settings.ai_timeout_seconds,
                    "ai_max_output_tokens": settings.ai_max_output_tokens,
                },
            )
        )
        for version in versions:
            source = next(
                source for source in sources if source.id == version.source_id
            )
            session.add(
                RunSource(
                    run_id=run.id,
                    source_version_id=version.id,
                    binding=parser_binding(source),
                )
            )
        session.add(Outbox(command_id=command_id))
        emit(session, run, "analysis.updated", "analysis", run.id)
        return {
            "run_id": run.id,
            "snapshot_url": f"/api/v1/runs/{run.id}",
            "events_url": f"/api/v1/runs/{run.id}/events",
        }

    return w.RunAccepted.model_validate(
        command(identity, "runs", idempotency_key, body.model_dump(mode="json"), effect)
    )


@router.get("/runs/{run_id}", response_model=w.Snapshot)
def snapshot(run_id: str, identity: Auth) -> w.Snapshot:
    return runs.snapshot(identity, run_id)


def event_cursor(
    run_id: str,
    identity: Auth,
    last_event_id: Annotated[str | None, Header()] = None,
    after_sequence: Annotated[int | None, Query(ge=0)] = None,
) -> int:
    return runs.cursor(identity, run_id, last_event_id, after_sequence)


@router.get(
    "/runs/{run_id}/events",
    response_model=None,
    response_class=EventSourceResponse,
    responses={
        200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}},
        410: {"model": w.Error},
    },
)
async def events(
    run_id: str,
    identity: Auth,
    sequence: Annotated[int, Depends(event_cursor)],
    follow: bool = True,
) -> AsyncIterator[ServerSentEvent]:
    while True:
        try:
            batch = await asyncio.to_thread(runs.backlog, identity, run_id, sequence)
        except HTTPException as error:
            if error.status_code in (403, 404):
                return
            raise
        for event in batch:
            yield event
            sequence = event.data["sequence"]
        if not follow:
            if len(batch) < 100:
                return
        else:
            await asyncio.sleep(1)


@router.get("/runs/{run_id}/findings", response_model=w.FindingsPage)
def findings(
    run_id: str,
    identity: Auth,
    limit: Limit = 50,
    cursor: str | None = None,
    part_id: str | None = None,
    cohort_id: str | None = None,
) -> w.FindingsPage:
    return finding_queries.listing(identity, run_id, limit, cursor, part_id, cohort_id)


@router.get("/runs/{run_id}/graph", response_model=w.Graph)
def graph(
    run_id: str,
    identity: Auth,
    limit: Limit = 50,
    cursor: str | None = None,
    part_id: str | None = None,
    cohort_id: str | None = None,
) -> w.Graph:
    return finding_queries.graph(identity, run_id, limit, cursor, part_id, cohort_id)


@router.get("/runs/{run_id}/research", response_model=w.Page[w.Research])
def research(
    run_id: str, identity: Auth, limit: Limit = 50, cursor: str | None = None
) -> w.Page[w.Research]:
    return research_queries.listing(identity, run_id, limit, cursor)


@router.get("/runs/{run_id}/conflicts", response_model=w.Conflicts)
def conflicts(run_id: str, identity: Auth) -> w.Conflicts:
    return proposal_queries.conflicts(identity, run_id)


@router.get("/runs/{run_id}/proposals", response_model=w.Proposals)
def proposals(
    run_id: str,
    identity: Auth,
    proposal_set_version: int | None = Query(default=None, ge=1),
) -> w.Proposals:
    return control.get_proposals(identity, run_id, proposal_set_version)


@router.get("/runs/{run_id}/evidence/{evidence_id}", response_model=w.Evidence)
def evidence(run_id: str, evidence_id: str, identity: Auth) -> w.Evidence:
    return evidence_queries.read(identity, run_id, evidence_id)


@router.get("/runs/{run_id}/evidence", response_model=w.Page[w.Evidence])
def evidence_list(
    run_id: str, identity: Auth, limit: Limit = 50, cursor: str | None = None
) -> w.Page[w.Evidence]:
    return evidence_queries.listing(identity, run_id, limit, cursor)


@router.post("/runs/{run_id}/instructions", response_model=w.Accepted, status_code=202)
def instructions(
    run_id: str, body: w.Instruction, idempotency_key: Key, identity: Auth
) -> w.Accepted:
    return control.instruct(identity, run_id, body, idempotency_key)


@router.post(
    "/runs/{run_id}/checkpoints/{checkpoint_id}/continue",
    response_model=w.Accepted,
    status_code=202,
)
def continue_checkpoint(
    run_id: str,
    checkpoint_id: str,
    body: w.Continuation,
    idempotency_key: Key,
    identity: Auth,
) -> w.Accepted:
    return control.continue_run(identity, run_id, checkpoint_id, body, idempotency_key)


@router.post("/runs/{run_id}/decisions", response_model=w.Accepted, status_code=202)
def decisions(
    run_id: str, body: w.Decision, idempotency_key: Key, identity: Auth
) -> w.Accepted:
    return control.decide(identity, run_id, body, idempotency_key)


@router.get("/runs/{run_id}/geometry", response_model=w.GeometrySceneCatalog)
def geometry_catalog(run_id: str, identity: Auth) -> w.GeometrySceneCatalog:
    return rendering.baseline_catalog(identity, run_id)


@router.get("/vehicles/{vehicle_id}/geometry", response_model=w.GeometrySceneCatalog)
def vehicle_geometry_catalog(vehicle_id: str, identity: Auth) -> w.GeometrySceneCatalog:
    return rendering.vehicle_baseline_catalog(vehicle_id)


@router.get("/vehicles/{vehicle_id}/geometry/asset", response_model=None)
def vehicle_geometry_asset(vehicle_id: str, identity: Auth) -> Response:
    data, media_type = rendering.vehicle_baseline_bytes(identity, vehicle_id)
    return Response(
        data,
        media_type=media_type,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/runs/{run_id}/geometry/asset", response_model=None)
def geometry_asset(run_id: str, identity: Auth) -> Response:
    data, media_type = rendering.baseline_bytes(identity, run_id)
    return Response(data, media_type=media_type, headers={"Cache-Control": "no-store"})


@router.post("/runs/{run_id}/renders", response_model=w.Accepted, status_code=202)
def create_render(
    run_id: str, body: w.RenderCommand, idempotency_key: Key, identity: Auth
) -> w.Accepted:
    return rendering.create_render(identity, run_id, body, idempotency_key)


@router.get("/runs/{run_id}/renders/{render_request_id}", response_model=w.RenderResult)
def render(run_id: str, render_request_id: str, identity: Auth) -> w.RenderResult:
    return rendering.get_render(identity, run_id, render_request_id)


@router.post(
    "/runs/{run_id}/renders/{render_request_id}/retry",
    response_model=w.Accepted,
    status_code=202,
)
def retry_render(
    run_id: str, render_request_id: str, idempotency_key: Key, identity: Auth
) -> w.Accepted:
    return rendering.retry_render(identity, run_id, render_request_id, idempotency_key)


@router.get(
    "/runs/{run_id}/renders/{render_request_id}/assets/{asset_id}", response_model=None
)
def render_asset(
    run_id: str, render_request_id: str, asset_id: str, identity: Auth
) -> Response:
    data, media_type = rendering.asset_bytes(
        identity, run_id, render_request_id, asset_id
    )
    return Response(
        data,
        media_type=media_type,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/runs/{run_id}/history", response_model=w.Page[w.Audit])
def history(
    run_id: str, identity: Auth, limit: Limit = 50, cursor: str | None = None
) -> w.Page[w.Audit]:
    return evidence_queries.history(identity, run_id, limit, cursor)


@router.post("/runs/{run_id}/exports", response_model=w.Accepted, status_code=202)
def create_export(
    run_id: str, body: w.ExportCommand, idempotency_key: Key, identity: Auth
) -> w.Accepted:
    return export_jobs.create_export(identity, run_id, body, idempotency_key)


@router.get("/runs/{run_id}/exports/{export_id}", response_model=w.ExportResult)
def export(run_id: str, export_id: str, identity: Auth) -> w.ExportResult:
    return export_jobs.get_export(identity, run_id, export_id)


@router.get("/runs/{run_id}/exports/{export_id}/download", response_model=None)
def export_download(run_id: str, export_id: str, identity: Auth) -> Response:
    data, media_type = export_jobs.download_export(identity, run_id, export_id)
    extension = "json" if media_type == "application/json" else "xlsx"
    return Response(
        data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="proposal-export.{extension}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


app.include_router(router)
