# Frontend

Scope follows [frontend_plan.md](../frontend_plan.md), [plan.md](../plan.md) and [backlog.md](../backlog.md). Requirements and package evidence live in [acceptance ledger](../doc/frontend/ACCEPTANCE.md). One vehicle workspace contains setup, graph, findings, evidence, proposals, Reimagine and history; deferred pitch/comparison dashboards remain excluded.

## Run and verify

```sh
cd frontend
npm ci
npm run dev
npm test
npm run typecheck
npm run build
```

Copy `.env.example` to `.env.local` as needed. No secrets are needed for mock mode. The development server binds to `127.0.0.1:5173` by default.

- `VITE_API_MODE=mock` (default): synthetic wire fixtures, never analysis of uploaded contents. Refresh starts a new mock session. Published upload formats are XLSX/PDF; unsupported formats yield per-file rejection. Duplicate bytes share a synthetic source ID.
- `VITE_API_MODE=real`: the same API boundary calls `VITE_API_BASE_URL` (default `/api/v1`). A separate backend must allow the frontend origin and credentialed requests. No development proxy is implicit. For local backend at port 8000, use `VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1` and the backend's configured allowed frontend origin.
- `VITE_MOCK_SCENARIO`: named scenario, including `pm_edit_stale`, `deep_dive_success` and `deep_dive_partial`. Fixtures are synthetic and do not establish live analysis or generation.

Real mode asks for an existing API access token and authorized workspace ID. It sends `Authorization: Bearer …` and `X-Workspace-ID`, matching the published backend contract. Tokens stay in memory, never browser storage, environment examples or URLs. Enter access again after reload; matching API/workspace restores current-tab run identity, selections and versioned proposal drafts. API consumers can instead supply `createRealApi(base, { headers: async () => applicationSessionHeaders, sessionNamespace })`. Existing identity provider, token issuance and membership remain external.

`src/api/wire.ts` follows backend `origin/backend` at `2d0483fd4d9bb4f95da5b8212db5d78b24a5ac46`. Read-only copies of its OpenAPI, schemas and ten scenarios are pinned under `fixtures/`. `src/api/contracts.ts` contains UI projections; normalizers retain original wire metadata and never rewrite semantic IDs or calculate counts/scores. Schema tests validate shared and frontend fixture payloads without coercion.

A coherent snapshot precedes authenticated fetch SSE. Resume uses last event ID; snapshots recover gaps/expired cursors. Duplicate and older events cannot patch displayed resources. Polling provides fallback when transport is unavailable. Access errors stop background retries; Reconnect restarts recovery after access is restored. Mutation network retries reuse the original idempotency key and body. Saved configuration comes from the server snapshot; only completed source IDs create a run.

## Assets and rendering

The G60 i5 M60 hosted exterior and bundled preview are labeled visual references. Interior is a G60 520i photo, not an exact-trim i5 M60 3D cabin. F70/G68/G70 remain unavailable and never borrow another vehicle's label. See [coverage](../doc/frontend/MODEL-COVERAGE.md) and [asset provenance](src/viewer/README-bmw.md). Actual SDK camera coordinates survive cabin toggles, data updates and same-tab reload when session storage is available; unavailable hosted SDK uses the explicit local fallback.

Reimagine calls the application API, never a provider or `/renderer/v1/jobs`. Synthetic render outcomes do not generate geometry. Real exports must use API-returned authorized links and exact versions.

Backend routes currently publish schemas but several analysis/proposal/render/export handlers return `501 not_implemented`. No backend was reachable at the documented localhost port during initial acceptance. Frontend fixture/network evidence is separate from live backend, original-file, external research and generation acceptance. Research dates and configured variant limits are absent from the current published schema; these dependencies remain explicit in the ledger.


F2 graph navigation resolves exact entity IDs, then exposes explicit finding choices. Search/type filters and progressive detail retain selected entity; paginated resources preserve server revisions. Findings stay grouped as spatially mapped, vehicle-wide, or unmapped/non-geometric. Unknown semantic IDs and hierarchy-only parts never select an unrelated viewer component. Saved run asset/catalog IDs, rather than current catalog defaults, determine viewer compatibility.

Evidence loads independently per row, with retry preserving successful references. Source references retain structured locators, source versions, scope, applicability and limitations. Protected original-file URLs are fetched through the API boundary with runtime authorization, cancellation and a bounded deadline; temporary download URLs are revoked on close. External public citations never receive application authorization. Scene mappings are validated and contain no guessed mesh aliases. Scoped part aggregates remain separate; no global totals are reconstructed.


Deep Dive renders queued/searching/checking/ready/partial/unavailable research independently of uploaded findings. Failed research retrieval remains a local gap with retrieval retry; access failures and malformed responses are not suppressed. Claims retain stable IDs, fact/opinion/inference types, scope, limitations and exact supporting/counterevidence citations. Missing recommendation/date metadata stays explicit. No research rerun endpoint is invented.

Guided participation uses actual backend checkpoints, exact versions, allowed resolutions and known variant/cohort assignments. Stale questions preserve drafts until explicit reconciliation; uncertain continuation retries the same command, and accepted continuation only retries resource retrieval. Real-mode same-tab checkpoint drafts/uncertain commands persist under API/workspace/run/checkpoint identity. Autonomous mode shows alternatives/tradeoffs without requiring a PM continuation. Backend variant-limit metadata is absent and disclosed; cohort labels never alter uploaded counts locally.

F4 proposal instructions bind exact proposal versions. Text/target, PM-idea and cohort-grouping drafts reconcile independently; removed entities retain readable drafts. Accepted edits show recomputation and wait for authoritative updated proposals. Unknown request outcomes retry the same key/body; accepted commands retry retrieval. History reads immutable proposals from the API by version, and numbered explanations retain exact change/variant identities. Historical finding counts are absent from the published contract, so explanations label retrieved counts as current.

Render jobs remain bound to their original baseline/catalog/proposal/variant identities; old or stale jobs stay inspectable without replacing current assets. Export requests use the inspected immutable version and selected variants. Queued/processing/ready/failed jobs recover through resource retrieval; download links appear only after server manifest verification. JSON and XLSX are application API formats; the synthetic mock supplies JSON and explicitly rejects XLSX rather than fabricating a spreadsheet export.
