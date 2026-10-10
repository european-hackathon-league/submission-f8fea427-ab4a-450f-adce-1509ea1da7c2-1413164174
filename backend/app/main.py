from collections.abc import Awaitable, Callable
from typing import Annotated, NoReturn
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
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response

from app import wire as w
from app.auth import Actor, actor
from app.config import Settings

app = FastAPI(title="Vehicle requirements backend", version="1")
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
    response = await call_next(request)
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
    idempotency_key: Key, files: Annotated[list[UploadFile], File()]
) -> NoReturn:
    pending()


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
