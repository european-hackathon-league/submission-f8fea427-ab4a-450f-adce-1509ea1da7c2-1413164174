# Frontend

Scope follows [frontend_plan.md](../frontend_plan.md), [plan.md](../plan.md) and [backlog.md](../backlog.md). These are the authority for future frontend changes. Keep features within that plan; do not restore the earlier pitch dashboards or comparison workspace.

## Run and verify

```sh
cd frontend
npm ci
npm run dev
npm test
npm run build
```

The first screen is a single vehicle workspace: vehicle selection, multi-file uploads, autonomous/guided mode, Deep Dive (off by default), and Create run. Saved configuration is frozen. Findings, graph, evidence, proposals and history are panels within that workspace. PM instructions, Reimagine and exports name exact proposal versions. Counts and intensity are displayed from adapter responses, without local scoring or global sums of part counts.

## API configuration

Copy the values needed from `.env.example` into `frontend/.env.local`, or set them in the shell before starting Vite. No provider credentials belong in browser configuration.

- `VITE_API_MODE=mock` (default): in-memory synthetic responses. Uploaded bytes are used only to identify duplicate files; their contents are not analyzed. Refreshing the page starts a new mock session.
- `VITE_API_MODE=real`: call the application API through the same adapter. `VITE_API_BASE_URL` defaults to `/api/v1`; a separately hosted backend must allow the frontend origin and credentialed requests.
- `VITE_MOCK_SCENARIO=pm_edit_stale`: inject a concurrent proposal version before the first edit. The normal scenario includes partial research when Deep Dive is enabled, a guided checkpoint when guided mode is selected, and annotation-only partial render outcomes.

`src/api/contracts.ts` is the local integration shape derived from `plan.md`, not a published backend schema. Backend schemas and joint fixtures still require coordination. Snapshot polling reloads a coherent revision, retains selections and drafts, and retries connection failures. SSE replay is not implemented. Graph responses currently use one typed node/edge payload; findings, research and history consume paginated responses.

## Assets and rendering

The versioned scene catalog is served at `/vehicles/scene-catalog-v1.json`. Only its matching G60 i5 M60 baseline is available. F70, G68 and G70 remain unavailable; they never reuse the G60 asset under another label. Exterior navigation uses the existing licensed hosted Sketchfab model with a local preview fallback. Interior is an explicitly labeled G60 520i reference photo, not an i5 M60 3D cabin. See [asset provenance](src/viewer/README-bmw.md).

The mock application's render endpoint returns version-bound annotation outcomes. It does not generate geometry, call a provider, or implement the server-side `/renderer/v1/jobs` service. Mock export generation is confined to the mock API boundary and marked synthetic. Real exports are downloaded from the backend-returned link.

Backend ingestion/research, production identity/audit, renderer service, immutable proposal-history browsing, graph pagination and full joint acceptance remain integration work. This cleanup establishes the planned UI scope; it does not claim completion of every work package.
