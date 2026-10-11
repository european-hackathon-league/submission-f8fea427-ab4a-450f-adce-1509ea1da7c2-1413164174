# vehicle-requirements-ai
AI-assisted vehicle requirements planning: turn customer feedback and market evidence into prioritized proposals with linked sources, product manager review, and a decision audit trail.

## Project plan

[Full product, architecture, and hackathon implementation plan](doc/BMW_AI_Requirements_Full_Plan.md)

The plan covers eight solution approaches, a reusable vehicle and market strategy, the complete evidence-to-decision pipeline, prioritization, PM review, audit history, four implementation phases, synthetic sample requirements, and a six-minute demonstration script.

## Run the connected application

Requires Docker, Node.js and an ignored root `.env` containing `OPENAI_API_KEY` and `APP_MODEL` (see [backend configuration](backend/.env.example)). The live override mounts this file as a secret and shares the frontend's i5 M60 scene catalog with the API and worker.

From the repository root:

```sh
docker compose -p vehicle-app -f backend/compose.yaml -f backend/compose.live.yaml build api worker
docker compose -p vehicle-app -f backend/compose.yaml -f backend/compose.live.yaml up -d postgres temporal
docker compose -p vehicle-app -f backend/compose.yaml -f backend/compose.live.yaml run --rm api python -m alembic upgrade head
docker compose -p vehicle-app -f backend/compose.yaml -f backend/compose.live.yaml run --rm api python -m app.seed
docker compose -p vehicle-app -f backend/compose.yaml -f backend/compose.live.yaml up -d api worker
cd frontend
npm ci
npm run dev
```

Open [the workshop](http://127.0.0.1:5173/#workspace). For this local development stack, enter workspace `workspace_demo` and API access token `development:pm_demo`. These are seeded development credentials; production must use the configured identity provider. Tokens remain in memory.

Upload XLSX/PDF evidence and choose **Start analysis**. The frontend proxies `/api` to port 8000, including authenticated event streams and downloads. The worker parses sources and calls the configured AI provider; findings, proposals, edits, decisions, history and exports use persisted backend data. Set `VITE_API_PROXY_TARGET` to target another local API. PDF parsing also needs the offline models described in [backend setup](backend/README.md).

**Reimagine** uses the selected saved proposal version. A configured geometry worker supplies the rotatable baseline, part-local feedback tags and measured candidate GLB; result markers retain customer evidence links. Unsaved changes must be saved or discarded first. Original and reimagined models can be switched without deleting the result. Failed or unsupported changes stay in the summary; visual review and engineering validity are reported separately.

See [geometry worker setup](docs/geometry-worker.md), [asset provenance and preparation](doc/reimagine-assets.md), and [verification evidence and limits](doc/reimagine-verification.md). The real downloaded BMW currently supports a bounded resize of one independently separated front seat. Larger displays and novel replacement shapes require additional verified component mappings or a configured generation provider. These are explicit limitations, not simulated successes. Large GLB/source files stay outside Git and are delivered through owned-run application routes.

The `vehicle-app` Compose project keeps application data separate from backend test fixtures. If the older `vehicle-backend` stack occupies ports 8000/7233/8233, stop it with `docker compose -f backend/compose.yaml stop` first; its volumes remain intact. Do not run backend database tests against the application database. Rebuild both API and worker after backend changes.

## Verify

With the application running, from `frontend/`:

```sh
npm test
npm run build
npm run test:live
```

The opt-in live test uploads [a two-record synthetic workbook](frontend/testing/fixtures/integration-feedback.xlsx), checks the shared vehicle catalog, processing snapshots, real AI findings, original-file access, events, approval, PM edits, cohort grouping, history and version-bound JSON/XLSX exports. It creates persistent test records and incurs configured AI provider usage. Optional `LIVE_API_BASE_URL`, `LIVE_API_TOKEN` and `LIVE_WORKSPACE_ID` environment variables target another development stack; defaults match the commands above. Normal tests skip this live test.

`npm run dev:mock` keeps the synthetic frontend available without a backend. `npm run dev:harness` runs the separate HTTP fixture harness. Neither establishes live AI analysis. Production deployments must route `/api` to the backend or configure `VITE_API_BASE_URL`; the Vite proxy is development-only.

BMW-inspired i5 M60 workspace: [frontend details](frontend/README.md), [frontend handoff](doc/frontend/README.md).
