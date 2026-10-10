# Backend development

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

Pending routes return `501 not_implemented`;
fixtures demonstrate contract shapes and are not live acceptance evidence.
S1 runs stop at `processing / foundation_ready`; ingestion starts in S2.
The worker dispatches the database outbox and polls Temporal for Activities.
PostgreSQL, Temporal history, and private original files persist in the Compose
volumes. `docker compose down` preserves them; deleting volumes deletes local data.
Upload preflight runs in an isolated Linux process with a 512 MiB address-space
limit, five CPU seconds, and a ten-second wall deadline. PDF content streams are
limited to 8 MiB each; limits produce explicit per-file rejections.

OIDC requires issuer, audience and JWKS URL. Only signed RS256 access tokens with
`typ: at+jwt` or `token_use: access` are accepted. Register subject/workspace
membership server-side. JWKS cache lifetime is five minutes; an unknown key ID
forces a refresh. Do not use ID tokens to call this API.

`Settings` loads the ignored repository-root `.env` locally and preserves inherited
environment overrides. In another worktree set `APP_ENV_FILE` to the original
checkout's absolute `.env` path. Never copy that file into an image. The bounded
live smoke command is `uv run python -m app.smoke`; it prints status/model/token
metadata only. Docker does not inherit that key automatically. Use a read-only
secret mount and `APP_ENV_FILE` for explicitly authorized live container checks.

The local persisted Temporal development service is not production infrastructure.
See `COMPATIBILITY.md` and `delivery_status.json` for tested versions and external
gates. Frontend assets/catalog and the renderer remain owned by the other team.
