import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Annotated, Any, NoReturn
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response

from app import wire as w
from app.auth import Actor, actor, reject
from app.commands import audit, command, new_id
from app.config import Settings
from app.db import Session, Source, SourceVersion
from app.limits import BodyLimit
from app.storage import digest, inspect_upload, storage
from app.telemetry import configure, latency, requests, tracer

app = FastAPI(title="Vehicle requirements backend", version="1")
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


router = APIRouter(
    prefix="/api/v1",
    dependencies=[Depends(actor)],
    responses={code: {"model": w.Error} for code in (401, 403, 404, 409, 422, 501)},
)
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=200)]
Auth = Annotated[Actor, Depends(actor)]
Limit = Annotated[int, Query(ge=1, le=100)]


def pending() -> NoReturn:
    raise HTTPException(
        501,
        w.Error(
            code="not_implemented", message="This operation is pending implementation"
        ).model_dump(),
    )


@router.get("/vehicles", response_model=w.Page[w.Vehicle])
def vehicles(limit: Limit = 50, cursor: str | None = None) -> NoReturn:
    pending()


@router.post("/uploads", response_model=w.Uploads)
def uploads(
    idempotency_key: Key, files: Annotated[list[UploadFile], File()], identity: Auth
) -> w.Uploads:
    settings = Settings()
    if len(files) > 20:
        reject("upload_limit", "At most twenty files per upload", 413)
    content = [(upload.filename or "unnamed", upload.file.read()) for upload in files]
    body = {
        "files": [
            {"filename": filename, "sha256": digest(data)} for filename, data in content
        ]
    }
    objects = storage(settings)
    written: list[str] = []

    def effect(session: DBSession, command_id: str) -> dict[str, Any]:
        results = []
        for filename, data in content:
            source_id = new_id()
            kind, reason = inspect_upload(filename, data, settings)
            source = Source(
                id=source_id,
                workspace_id=identity.workspace_id,
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
def create_run(body: w.RunConfig, idempotency_key: Key) -> NoReturn:
    pending()


@router.get("/runs/{run_id}", response_model=w.Snapshot)
def snapshot(run_id: str) -> NoReturn:
    pending()


@router.get(
    "/runs/{run_id}/events",
    response_model=None,
    responses={
        200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}},
        410: {"model": w.Error},
    },
)
def events(
    run_id: str, last_event_id: Annotated[str | None, Header()] = None
) -> NoReturn:
    pending()


@router.get("/runs/{run_id}/findings", response_model=w.FindingsPage)
def findings(
    run_id: str,
    limit: Limit = 50,
    cursor: str | None = None,
    part_id: str | None = None,
    cohort_id: str | None = None,
) -> NoReturn:
    pending()


@router.get("/runs/{run_id}/graph", response_model=w.Graph)
def graph(
    run_id: str,
    limit: Limit = 50,
    cursor: str | None = None,
    part_id: str | None = None,
    cohort_id: str | None = None,
) -> NoReturn:
    pending()


@router.get("/runs/{run_id}/research", response_model=w.Page[w.Research])
def research(run_id: str, limit: Limit = 50, cursor: str | None = None) -> NoReturn:
    pending()


@router.get("/runs/{run_id}/conflicts", response_model=w.Conflicts)
def conflicts(run_id: str) -> NoReturn:
    pending()


@router.get("/runs/{run_id}/proposals", response_model=w.Proposals)
def proposals(run_id: str, proposal_set_version: int | None = None) -> NoReturn:
    pending()


@router.get("/runs/{run_id}/evidence/{evidence_id}", response_model=w.Evidence)
def evidence(run_id: str, evidence_id: str) -> NoReturn:
    pending()


@router.post("/runs/{run_id}/instructions", response_model=w.Accepted, status_code=202)
def instructions(run_id: str, body: w.Instruction, idempotency_key: Key) -> NoReturn:
    pending()


@router.post(
    "/runs/{run_id}/checkpoints/{checkpoint_id}/continue",
    response_model=w.Accepted,
    status_code=202,
)
def continue_checkpoint(
    run_id: str, checkpoint_id: str, body: w.Continuation, idempotency_key: Key
) -> NoReturn:
    pending()


@router.post("/runs/{run_id}/decisions", response_model=w.Accepted, status_code=202)
def decisions(run_id: str, body: w.Decision, idempotency_key: Key) -> NoReturn:
    pending()


@router.post("/runs/{run_id}/renders", response_model=w.Accepted, status_code=202)
def create_render(run_id: str, body: w.RenderCommand, idempotency_key: Key) -> NoReturn:
    pending()


@router.get("/runs/{run_id}/renders/{render_request_id}", response_model=w.RenderResult)
def render(run_id: str, render_request_id: str) -> NoReturn:
    pending()


@router.post(
    "/runs/{run_id}/renders/{render_request_id}/retry",
    response_model=w.Accepted,
    status_code=202,
)
def retry_render(run_id: str, render_request_id: str, idempotency_key: Key) -> NoReturn:
    pending()


@router.get("/runs/{run_id}/history", response_model=w.Page[w.Audit])
def history(run_id: str, limit: Limit = 50, cursor: str | None = None) -> NoReturn:
    pending()


@router.post("/runs/{run_id}/exports", response_model=w.Accepted, status_code=202)
def create_export(run_id: str, body: w.ExportCommand, idempotency_key: Key) -> NoReturn:
    pending()


@router.get("/runs/{run_id}/exports/{export_id}", response_model=w.ExportResult)
def export(run_id: str, export_id: str) -> NoReturn:
    pending()


app.include_router(router)
