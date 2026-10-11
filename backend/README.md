# Backend development

For the connected frontend, use the [root startup instructions](../README.md#run-the-connected-application). They use the separate `vehicle-app` Compose project and `compose.live.yaml`, which loads the configured AI credentials and mounts the frontend's i5 M60 scene catalog into both API and worker. The base Compose configuration below retains the synthetic backend catalog for backend development/tests. Keep backend database tests separate from the application database.

Work in `backend/`. The runtime and parser dependencies are locked with uv
0.13.0 for Python 3.14.8. Docker is the verified path on Windows; host application
control can block Python extension modules. Development services bind to loopback.
PostgreSQL is accessible within the Compose network, avoiding reserved host ports.

```sh
docker compose build api worker
docker compose up -d postgres temporal
docker compose run --rm api python -m alembic upgrade head
docker compose run --rm api python -m app.seed
docker compose up -d api worker
```

API: `http://localhost:8000`, documentation: `/docs`. `/health` reports API
liveness only. Local development identity uses `Authorization: Bearer
development:pm_demo` plus `X-Workspace-ID: workspace_demo`. Membership is seeded
server-side. This explicitly insecure local identity mode is refused in production.
Development CORS allows `http://localhost:3000`; deployments configure their own
origin list. Browser SSE clients must use an authenticated fetch stream with both
authorization and workspace headers; do not put tokens in URLs. Fetch the snapshot
first, then open `/api/v1/runs/{run_id}/events?after_sequence={last_event_sequence}`
using its watermark. `after_sequence` is exclusive. On reconnect, send the last
received event ID in `Last-Event-ID` instead of `after_sequence`. A
`410 replay_expired` response requires a fresh snapshot and its watermark.
`follow=false` returns a bounded replay without keeping the connection open.

```sh
docker compose run --rm api python -m ruff check app tests migrations
docker compose run --rm api python -m ruff format --check app tests migrations
docker compose run --rm api python -m mypy app
docker compose run --rm api python -m alembic check
docker compose run --rm api python -m app.contracts --check
docker compose run --rm api python -m pytest -ra
docker build --target parser -t vehicle-backend-parser .
```

Contracts live in `../contracts`. Regenerate with `python -m app.contracts` on
a supported local environment. For Docker, use a separate writable mount because
Compose already mounts `/srv/contracts` read-only:

```sh
docker compose run --rm -v "../contracts:/generated-contracts" api python -m app.contracts --output /generated-contracts
```

New runs execute source ingestion, validated AI finding extraction, scoped baseline
assessment, optional Deep Dive research, conflict handling, and proposal generation.
Guided runs pause at unresolved conflict checkpoints; autonomous runs preserve
unresolved assumptions in proposals. Findings, graph, evidence, research, conflicts,
proposals and history are available through the run's resource links. Snapshot
`available_actions` reflects the current state and actor: processing runs have no
proposal mutation actions, guided waits expose continuation to PMs, and ready
proposals expose edits, rendering, decisions and exports. Proposal commands bind
exact versions; stale edits return `409` without partial changes. JSON/XLSX exports
retain their source, proposal, research and decision snapshots. Renderer failures
retain explicit per-change outcomes and can be retried without changing proposals.
Contract fixtures demonstrate shapes; they are not live acceptance evidence.
Persisted S1 runs retain their original foundation execution policy.
Parsing is cached by workspace, original content,
and frozen parser/model configuration; reuse preserves each source's lineage
and does not establish shared respondent identity. Unsupported source layouts
and parser limits remain visible coverage outcomes. Evidence is available at
`/api/v1/runs/{run_id}/evidence`, with paginated audited access and authorized
original downloads. Run history is available at `/api/v1/runs/{run_id}/history`.
The worker dispatches the database outbox and polls Temporal for Activities.
PDF inference requires pinned offline models in `PDF_MODEL_DIRECTORY` (default
`backend/.local/pdf-models`). Prepare them explicitly with the parser image's
`python -m app.parser_models --directory /models --download` setup command;
parsing never downloads models. Missing artifacts produce source-specific
coverage rather than blocking valid companion workbooks. PDF execution uses
two-page checkpoints and bounded concurrency; exhausted pairs fall back to
single pages, and committed batches are reused after worker failure. Native
inference defaults to 180 CPU seconds per subprocess, a 190-second wall deadline,
and 4 GiB address space. `PDF_TIMEOUT_SECONDS` accepts 1 through 600 and controls
both the CPU budget and the wall deadline (budget plus ten seconds). Dense pages
can exceed the default even with single-page fallback. Configure the API and
worker consistently before uploading a new source version; parser settings are
frozen in source bindings, so changing the environment does not alter existing
runs or silently replace their cached evidence. Higher budgets can recover text
without resolving ambiguous table cells. See `PDF_EVALUATION.md` for the private
reference gate and `TESTING_HANDOFF.md` for measured corpus limits.
PostgreSQL, Temporal history, and private original files persist in the Compose
volumes. `docker compose down` preserves them; deleting volumes deletes local data.
Upload preflight runs in an isolated Linux process with a 512 MiB address-space
limit for both formats. XLSX has five CPU seconds and a ten-second wall deadline;
PDF has fifteen CPU seconds and a thirty-second wall deadline. PDFs are limited
to 500 pages, 8 MiB per decoded page content stream, and 256 MiB aggregate decoded
page content by default. Limits produce explicit per-file rejections. Permissions
encryption with an empty user password is supported; PDFs requiring a password
are rejected.

OIDC requires issuer, audience and JWKS URL. Only signed RS256 access tokens with
`typ: at+jwt` or `token_use: access` are accepted. Register subject/workspace
membership server-side. JWKS cache lifetime is five minutes; an unknown key ID
forces a refresh. Do not use ID tokens to call this API.

AI extraction uses the configured Responses API model and strict typed outputs;
missing credentials, refusals, exhausted repairs and unsupported evidence remain
explicit failed/partial stages. Counts include distinct uploaded logical feedback
records only. Studies, sales and external research never increase those counts.
The model, catalog, prompt/schema revisions, reference year and planning horizon
are frozen for each run. Extraction and baseline batches retain provider response
IDs, token usage and coverage outcomes so worker retries resume committed work.
Future assumptions refer to `PLANNING_HORIZON`; unknown baselines are not absence,
and German equipment evidence cannot establish US availability. Deep Dive is off
by default and uses bounded retrieval when enabled. Live provider, identity,
storage, telemetry and renderer validation remains a separate integration gate.

`Settings` loads the ignored repository-root `.env` locally and preserves inherited
environment overrides. In another worktree set `APP_ENV_FILE` to the original
checkout's absolute `.env` path. Never copy that file into an image. The bounded
live smoke command is `uv run python -m app.smoke`; it prints status/model/token
metadata only. Docker does not inherit that key automatically. The optional live
override mounts the existing ignored `.env` as a read-only Compose secret for API
and worker; it does not bake credentials into either image:

```sh
docker compose -f compose.yaml -f compose.live.yaml up -d api worker
docker compose -f compose.yaml -f compose.live.yaml run --rm api python -m app.smoke
```

Configure `OPENAI_API_KEY`, `APP_MODEL` and optional `OPENAI_BASE_URL` for model
calls, and `RENDERER_URL`/`RENDERER_TOKEN` for the renderer integration. Set the
OIDC, S3 and OTLP settings when exercising those live integrations. Keep database,
storage and Temporal settings appropriate to the Compose network. Run the checks
above after implementation, with PostgreSQL and Temporal running; tests that fake
providers do not establish live integration readiness. Rebuild API/worker images
after code changes before testing their image contents.

The local persisted Temporal development service is not production infrastructure.
See `COMPATIBILITY.md` and `delivery_status.json` for tested versions and external
gates. Frontend assets/catalog and the renderer remain owned by the other team.
