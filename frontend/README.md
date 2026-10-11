# Frontend

Scope follows [frontend_plan.md](../frontend_plan.md), [plan.md](../plan.md) and [backlog.md](../backlog.md). Requirements and package evidence live in [acceptance ledger](../doc/frontend/ACCEPTANCE.md). One vehicle workspace contains setup, graph, findings, evidence, proposals, Reimagine and history; deferred pitch/comparison dashboards remain excluded.

## Workshop review experience

The workshop follows the approved HTML preview: a persistent 60/40 vehicle and suggestions layout, Autonomous and Deep Dive switches, and one Add files action that becomes Start analysis after upload. Countries come from source evidence; there is no manual market selector.

Suggestions open a compact review with an actual negative-feedback share, proposed change, source evidence, and version-bound approve/defer/reject commands. Customer feedback uses finding-level bars; Evidence separates supporting and opposing excerpts; Research shows candidate approaches and claim types; Conflicts preserves backend scopes and guided checkpoint controls. Renders retains per-change outcomes and authorized assets. History uses server audit events and keeps exact-version inspection/export under Versions & exports. Detailed editing remains under Edit suggestions & variants.

The workspace keeps the compact PR #13 layout with the vehicle beside the analysis tabs. Verified editable geometry uses named part tags, synchronized selection and session-scoped camera recovery; failed model loads retain the reference viewer and retry. Interior photos remain separate references. Render model comparison, provenance and diagnostics are expandable, while review/engineering limitations remain visible. Suggestions show backend preservation requirements; render details show supplied baseline/result dimensions in metres. Finding counts and cohort scopes stay separate without reconstructing part totals.

Counts are backend logical-record counts. Overlapping findings and cohorts are never summed into invented respondent totals, and unknown shares stay unknown. The graph draws only supplied node/edge identities. Sketchfab labels project asset-specific reference coordinates each frame, with collision-aware screen placement and leader lines; cabin coordinates are approximate regions, not verified meshes. Existing semantic part controls remain available if projection or 3D loading is unavailable.

Normal development uses the authenticated backend. Follow the [connected application setup](../README.md#run-the-connected-application) to start the API, worker and database with the shared i5 catalog. Synthetic fixtures remain available with `npm run dev:mock` or `npm run dev:harness`.

## Collection and model browsing

The default entry shows the BMW journey and 24-model collection imported selectively from PR #10. `#workspace` opens the existing requirements workshop directly. Collection selections carry into run setup, and returning to the journey preserves the mounted workshop's uploads and edits. A saved run keeps its original vehicle configuration until **New run**.

**Explore model in 360°** opens the PR's exterior sequence and interior panorama viewer from the workshop as well. These are representative family configurations, not verified exact-trim geometry or feedback mappings. Only catalog vehicles with baseline and part-catalog identifiers can start an analysis; the live stack and mock catalog enable the i5 M60. Other collection trims remain browsable without substituting that baseline.

`src/collection/` retains the PR's JavaScript views, motion helpers and scoped styles. The PR's workspace, global stylesheet and application shell are excluded. Local assets include the 36 sampled spin frames per family, iX preview sequence, cabin panoramas and source manifests; unused high-resolution sequences are excluded. The cabin renderer loads Three.js lazily and requires WebGL.

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

- `VITE_API_MODE=mock`: explicit synthetic wire fixtures, never analysis of uploaded contents. `npm run dev:mock` selects this mode. Refresh starts a new mock session. Published upload formats are XLSX/PDF; unsupported formats yield per-file rejection. Duplicate bytes share a synthetic source ID.
- `VITE_API_MODE=real` (default, including when unset): the API boundary calls `VITE_API_BASE_URL` (default `/api/v1`). Vite proxies `/api` to `http://127.0.0.1:8000`, preserving authorization, event streams and downloads. No CORS configuration is needed for this same-origin development path. Production needs its own reverse proxy or an explicitly configured backend URL and credentialed CORS policy.
- `VITE_MOCK_SCENARIO`: named scenario, including `pm_edit_stale`, `deep_dive_success` and `deep_dive_partial`. Fixtures are synthetic and do not establish live analysis or generation.

Real mode asks for an existing API access token and authorized workspace ID. It sends `Authorization: Bearer …` and `X-Workspace-ID`, matching the published backend contract. Tokens stay in memory, never browser storage, environment examples or URLs. Enter access again after reload; matching API/workspace restores current-tab run identity, selections and versioned proposal drafts. API consumers can instead supply `createRealApi(base, { headers: async () => applicationSessionHeaders, sessionNamespace })`. Existing identity provider, token issuance and membership remain external.

`src/api/wire.ts` follows backend fixture pin `2d0483fd4d9bb4f95da5b8212db5d78b24a5ac46`. Read-only copies of its OpenAPI, schemas and ten scenarios are pinned under `fixtures/`. `src/api/contracts.ts` contains UI projections; normalizers retain original wire metadata and never rewrite semantic IDs or calculate counts/scores. Schema tests validate shared and frontend fixture payloads without coercion.

A coherent snapshot precedes authenticated fetch SSE. Resume uses last event ID; snapshots recover gaps/expired cursors. Duplicate and older events cannot patch displayed resources. Polling provides fallback when transport is unavailable. Access errors stop background retries; Reconnect restarts recovery after access is restored. Mutation network retries reuse the original idempotency key and body. Saved configuration comes from the server snapshot; only completed source IDs create a run.

## Assets and rendering

The G60 i5 M60 hosted exterior and bundled preview are labeled visual references. Interior is a G60 520i photo, not an exact-trim i5 M60 3D cabin. F70/G68/G70 remain unavailable and never borrow another vehicle's label. See [coverage](../doc/frontend/MODEL-COVERAGE.md) and [asset provenance](src/viewer/README-bmw.md). Actual SDK camera coordinates survive cabin toggles, data updates and same-tab reload when session storage is available; unavailable hosted SDK uses the explicit local fallback.

Reimagine calls the application API, never a provider or `/renderer/v1/jobs`. Synthetic render outcomes do not generate geometry. Real exports must use API-returned authorized links and exact versions.

The backend implements analysis, proposal edits, decisions, history and exports. `npm run test:live` exercises the real upload-to-export path with the included synthetic workbook and configured AI provider. Historical F6 fixture evidence remains separate from this live integration check. Blender/rendering, external research and PDF model acceptance are separate gates. Research dates and configured variant limits remain absent from the published schema.


F2 graph navigation resolves exact entity IDs, then exposes explicit finding choices. Search/type filters and progressive detail retain selected entity; paginated resources preserve server revisions. Findings stay grouped as spatially mapped, vehicle-wide, or unmapped/non-geometric. Unknown semantic IDs and hierarchy-only parts never select an unrelated viewer component. Saved run asset/catalog IDs, rather than current catalog defaults, determine viewer compatibility.

Evidence loads independently per row, with retry preserving successful references. Source references retain structured locators, source versions, scope, applicability and limitations. Protected original-file URLs are fetched through the API boundary with runtime authorization, cancellation and a bounded deadline; temporary download URLs are revoked on close. External public citations never receive application authorization. Scene mappings are validated and contain no guessed mesh aliases. Scoped part aggregates remain separate; no global totals are reconstructed.


Deep Dive renders queued/searching/checking/ready/partial/unavailable research independently of uploaded findings. Failed research retrieval remains a local gap with retrieval retry; access failures and malformed responses are not suppressed. Claims retain stable IDs, fact/opinion/inference types, scope, limitations and exact supporting/counterevidence citations. Missing recommendation/date metadata stays explicit. No research rerun endpoint is invented.

Guided participation uses actual backend checkpoints, exact versions, allowed resolutions and known variant/cohort assignments. Stale questions preserve drafts until explicit reconciliation; uncertain continuation retries the same command, and accepted continuation only retries resource retrieval. Real-mode same-tab checkpoint drafts/uncertain commands persist under API/workspace/run/checkpoint identity. Autonomous mode shows alternatives/tradeoffs without requiring a PM continuation. Backend variant-limit metadata is absent and disclosed; cohort labels never alter uploaded counts locally.

F4 proposal instructions bind exact proposal versions. Text/target, PM-idea and cohort-grouping drafts reconcile independently; removed entities retain readable drafts. Accepted edits show recomputation and wait for authoritative updated proposals. Unknown request outcomes retry the same key/body; accepted commands retry retrieval. History reads immutable proposals from the API by version, and numbered explanations retain exact change/variant identities. Historical finding counts are absent from the published contract, so explanations label retrieved counts as current.

Render jobs remain bound to their original baseline/catalog/proposal/variant identities; old or stale jobs stay inspectable without replacing current assets. Export requests use the inspected immutable version and selected variants. Queued/processing/ready/failed jobs recover through resource retrieval; download links appear only after server manifest verification. JSON and XLSX are application API formats; the synthetic mock supplies JSON and explicitly rejects XLSX rather than fabricating a spreadsheet export.

F5 scene and render-asset acceptance: [verification](../doc/frontend/F5-VERIFICATION.md). Synthetic render fixtures include a labeled static annotation card, never generated vehicle imagery. The scene capability panel explains supported IDs, separate photo references and unavailable physical preservation verification. Variant preview failures retain proposal explanations and permit retry or API status/link refresh.


## F6 HTTP acceptance harness

A clean checkout can run the real API adapter against an opt-in **frontend test harness** without a backend or secrets:

```sh
cd frontend
npm ci
npm run test:acceptance
npm run dev:harness
```

Open the printed localhost URL. Use public fixture token `harness-token` and one exact shared scenario name as Workspace ID: `standard_autonomous`, `deep_dive_success`, `deep_dive_partial`, `guided_conflict`, `duplicate_uploads`, `pm_edit_stale`, `render_partial`, `render_late`, `reconnect`, or `versioned_export`. Do not enter real credentials. The UI banner identifies synthetic HTTP fixtures; uploaded bytes are retained for source-opening tests but never analyzed. A file named `.xlsx` or `.pdf` exercises upload interaction without proving spreadsheet/PDF parsing.

Tracked `.env.harness` sets `VITE_API_MODE=real`, same-origin `/api/v1`, and development-only harness activation. Existing shell variables or `.env.local` can override Vite configuration; remove those overrides when reproducing clean harness acceptance. The harness disables the backend proxy and is excluded from production builds. Normal `npm run dev` connects to the backend. Production requires a separately deployed backend and existing authorized access.

Each harness workspace has isolated in-memory fixture state. Browser reload/reconnect preserves the run while that development server process remains alive; restarting the process clears harness runs. Tokens remain memory-only in the browser, so re-enter public fixture access after reload. The fixed `run-synthetic` identity belongs to its isolated workspace, not a live global run. Never use the harness to certify live backend persistence or multiple-user authorization.

To exercise an actual image-loading failure and retry locally:

```sh
FRONTEND_HARNESS_FAIL_ASSET_ONCE=1 npm run dev:harness
```

The first request for the known synthetic annotation SVG returns 503 without caching; retry serves its unchanged static bytes. No provider generation occurs. Automated tests also inject API access denial, interrupted requests, research failure, duplicate/replayed SSE and cursor expiry over native HTTP.

Final [F6 evidence](../doc/frontend/F6-VERIFICATION.md) records 387 passing tests, typecheck/build, clean installation/start, native 1440×1000/390×844 checks and all ten scenario mappings. Read-only F6 backend refresh at `12c1ade5dd3829cd6f48d7336091f954207f161f` found no `contracts/` changes from the fixture pin. See the ledger for precise live API, metadata and asset dependencies.
