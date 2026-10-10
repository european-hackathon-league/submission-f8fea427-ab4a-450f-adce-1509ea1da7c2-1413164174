# Frontend requirement acceptance ledger

Updated 10 October 2026 through the F4 implementation gate. Scope: `frontend_plan.md`, `plan.md`, `backlog.md`; frontend-only authority from the implementation request. Each package updates its rows with exact executed evidence before its PR gate. A screen or happy-path mock does not establish acceptance.

## Status and evidence rules

- **Partial**: some implementation or tests exist, but acceptance gaps remain.
- **Missing**: required frontend behavior or meaningful verification absent.
- **Frontend verified / external blocked**: frontend behavior passes contract-valid tests; live dependency remains unavailable. Use only after recorded checks.
- **Verified**: requirement passes recorded applicable checks, including live evidence when claimed.

Initial inspection is static evidence, not a fresh test execution. Existing checks below are pointers, not newly certified passing results. Later-package rows retain initial gaps until their own verification gate.

Common code pointers: `frontend/src/App.tsx` (workspace, panels and commands), `frontend/src/api/{client,contracts,fixtures}.ts` (API boundary), `frontend/src/App.test.tsx` (workspace tests), `frontend/src/api/client.test.ts` (adapter tests), `frontend/src/viewer/{BmwAssetViewer,modelMapping}.ts*` (vehicle navigation/mapping). All tests and changes stay within frontend-owned paths.

## Published contracts and external dependencies

Pinned backend: `origin/backend` at `2d0483fd4d9bb4f95da5b8212db5d78b24a5ac46`, inspected read-only after root refreshed refs. Published artifacts: `contracts/openapi.json`, `contracts/schemas.json`, `contracts/scenarios.json`, `contracts/catalog.example.json`, `contracts/renderer.schema.json` on that ref. Local historical DTOs differ substantially and are not shared schemas.

- **API-501**: backend `backend/app/main.py` routes for findings, graph, research, conflicts, proposals, evidence, instructions and checkpoint continuation call `pending()` and return `501 not_implemented`; rendering/export/history routes must likewise be checked before live claims. Implement established frontend API surfaces and verify with frontend network harness; never label harness evidence live analysis/generation.
- **DATES**: Research/Claim/Evidence schemas do not publish research as-of, publication or accessed timestamps. Local `Research.as_of` is not an authoritative wire field. Display unavailable date honestly; dated research acceptance requires backend contract addition.
- **LIMITS**: no published initial/max variant-limit field. Do not hardcode four; display provided scopes and state missing limit metadata.
- **ASSETS**: only labeled G60 i5 M60 hosted exterior/reference preview exists; G60 520i cabin is a separate reference photo. F70, G68, G70 exact assets unavailable. Geometry, exact-trim cabin and mesh mappings unverified; list/photo fallback must remain usable. See `MODEL-COVERAGE.md`.
- **HISTORICAL**: immutable proposal snapshots expose finding and research IDs, but no immutable historical finding counts or research contents endpoint. Explain exact proposal fields/evidence IDs; label separately retrieved counts/research current and disclose historical content unavailable.
- **RETRY**: published research GET supports retrieval retry; no research rerun endpoint exists. Do not invent one.
- **AUTH**: use existing published application authentication/workspace headers and errors; frontend must not build identity infrastructure.

Published distinctions important for acceptance: Graph nodes are `{id, entity_type, revision}`; edges carry `evidence_ids`; graph has `revision`, `next_cursor` and supports `limit/cursor/part_id/cohort_id`. FindingsPage owns counts and part aggregates; counts contain records/share, while part aggregates separately carry intensity/scale/provisional/low-evidence. Evidence has structured scope and cell/pdf/web locators. Conflicts contains arrays of conflicts/checkpoints; continuation uses `checkpoint_version`, `resolution`, optional `cohort_assignments`. Research has stable claim IDs/limitations, counterevidence IDs and nullable recommendation. Variants reference top-level proposal changes by IDs.

## F1 — API adapter, run setup, states and recovery

| ID | Required acceptance behavior | Code / existing test pointers | Initial status / gap | External dependency |
|---|---|---|---|---|
| F1.01 | Types, payloads, errors, IDs, versions and fixtures match published shared contract | `api/wire.ts`, `normalize.ts`, pinned `fixtures/`, `contractsValidation.test.ts`, `api/published.test.ts` | Frontend verified / external blocked: exact published wire fields, immutable IDs/versions, multipart/envelopes, numeric targets and schema-valid fixtures; incompatible snapshot versions rejected | Pinned contracts; API-501 for live resource acceptance |
| F1.02 | One API boundary; configuration selects mock/real | `api/client.ts`, `api/mock.ts`, `ApiAccess.tsx`, `.env.example`; published adapter/header tests | Frontend verified / external blocked: same projection for synthetic/real wire transports; configuration selection, runtime Bearer/workspace headers | AUTH; real service deployment |
| F1.03 | Uploads support partial/rejected packages, completed source IDs, saved config and available actions | `App.tsx:createRun/uploadFiles`; `App.test.tsx` partial/rejected/frozen/uncertain/second-run cases | Frontend verified / external blocked: completed source IDs, explicit rejected formats, saved configuration/actions, accepted identity frozen before snapshot; unknown outcome retries original key/body through reload | Upload API; API-501 downstream |
| F1.04 | Required event transport, replay, dedup, expired cursor and coherent snapshots | `runRecovery.ts/test`, `api/client.ts:events/workspace`, published pagination/coherence tests | Frontend verified / external blocked: authenticated SSE, exclusive cursor replay, dedup/order/gap/410 reconciliation, bounded setup and polling fallback | Live SSE deployment |
| F1.05 | Run identity, selections, camera and unsaved drafts survive supported reconnect/reload | `session.ts/test`, App real-mode remount test, viewer camera tests/browser toggle | Frontend verified / external blocked: API/workspace-isolated same-tab run/selections/drafts; original pending config retained; actual validated SDK camera cache; storage-disabled memory fallback | Persisted backend run; hosted asset/SDK availability |
| F1.06 | Contract authentication/access errors handled without invented auth infrastructure | `ApiAccess.test.tsx`, `api/published.test.ts`, `runRecovery.test.ts`, App restored-access test | Frontend verified / external blocked: runtime headers; full error metadata/request ID, access denial stops retries, manual reconnect restarts; no token storage or auth infrastructure | Existing identity provider/workspace membership |
| F1.07 | Duplicate/out-of-order events, interrupted requests, stale state and recovery tested | `runRecovery.test.ts`, `api/published.test.ts`, `App.test.tsx` uncertain/stale/remount cases | Frontend verified / external blocked: replay duplicates/order/expiry, bounded interrupted requests with same key, stale snapshots and access recovery tested | Live replay/persistence acceptance |

## F2 — Baseline workspace, graph, tags and evidence

| ID | Required acceptance behavior | Code / existing test pointers | Initial status / gap | External dependency |
|---|---|---|---|---|
| F2.01 | Vehicle navigation, graph navigation/filtering/progressive detail and contract pagination | Viewer controls; `components/GraphPanel.tsx/test`; `api/client.ts`, `published.test.ts` | Frontend verified / external blocked: keyboard graph entity/relationship navigation, type/search filters, progressive 20-node detail; opaque vehicle/graph/findings pagination with revision checks | API-501 graph/findings |
| F2.02 | Finding/part/graph/evidence identities remain consistent | App selection tests; GraphPanel exact/ambiguous/removed entity tests | Frontend verified / external blocked: opaque IDs retained; unknown and hierarchy-only parts remain nonspatial; graph requires explicit finding choice | Published IDs; ASSETS |
| F2.03 | Selection/camera survive data updates | App missing-selection/opaque-ID tests; viewer camera/reorder tests | Frontend verified / external blocked: explicit removed finding never silently substitutes; actual camera survives data updates/toggles | ASSETS |
| F2.04 | Keyboard equivalents and non-color cues expose spatial findings | App tab keyboard test; viewer keyboard tests; F2 browser report | Frontend verified: component lists, numeric denominators/status labels, graph relationship buttons, source dialog focus and Escape | None |
| F2.05 | Display backend counts, denominator, provisional status, coverage, uncertainty; no local scoring/global part sums | FindingDetails null/zero/overlap/scope tests; viewer scoped aggregate tests | Frontend verified / external blocked: independent backend counts/shares/scales/cohort scopes, provisional/low-evidence/coverage/uncertainty; no sums or local scoring | Published aggregate contract |
| F2.06 | Vehicle-wide, unmapped and non-geometric findings usable | App unknown/hierarchy part tests; grouped Findings list | Frontend verified / external blocked: vehicle-wide, unsupported and non-geometric findings inspectable without selecting unrelated spatial part | ASSETS |
| F2.07 | Exact source references and authorized source-opening interactions | EvidenceList/SourceDialog tests; published source-access tests; browser exact-locator path | Frontend verified / external blocked: structured cell/PDF/web locators, source versions/scope/applicability, per-row failure/retry; protected originals use authenticated bounded fetch with cancellation/blob cleanup | API-501 evidence; authorized source links |
| F2.08 | Validate supported assets/part mappings; explicit fallback; no relabeled vehicle | modelMapping validator tests; viewer image/network recovery tests; App saved-triple tests | Frontend verified / external blocked: saved vehicle/asset/catalog triple gates viewer; no guessed mesh names; valid parent graph, explicit list/photo reference fallback and image retries | ASSETS |

## F3 — Deep Dive, conflicts and alternatives

| ID | Required acceptance behavior | Code / existing test pointers | Initial status / gap | External dependency |
|---|---|---|---|---|
| F3.01 | Queued/searching/checking/ready/partial/unavailable research states complete | `components/ResearchPanel.tsx/test`; `api/researchRecovery.test.ts`; App research integration | Frontend verified / external blocked: six distinct states, stable asynchronous updates and useful finding access throughout research failure | API-501 research |
| F3.02 | Facts/opinions/inferences, citations, dates, scope, counterevidence, alternatives and gaps distinct | ResearchPanel stable claims/limitations/scopes; EvidenceList/SourceDialog source access | Frontend verified / external blocked: fact/public opinion/system inference distinct; exact citations/counterevidence, alternatives, null recommendation, scope and gaps; unavailable dates explicit | DATES; API-501 evidence |
| F3.03 | Useful findings remain usable during research failure | `api/client.ts:researchResource`, recovery tests; App failure/late-refresh tests | Frontend verified / external blocked: network/timeout/server research failure isolated from coherent findings/proposals; access and invalid data remain errors; safe retrieval retry | API-501; RETRY |
| F3.04 | Autonomous mode never requires PM decisions | ConflictPanel autonomous tests; App unexpected-checkpoint regression | Frontend verified / external blocked: authoritative alternatives/tradeoffs shown; no autonomous PM continuation controls | API-501 proposals/conflicts |
| F3.05 | Guided actual versioned checkpoints, stale recovery, continuation and supported cohort regrouping | ConflictPanel/checkpointDraft tests; mock continuation tests; guided browser path | Frontend verified / external blocked: exact ID/version/allowed resolutions, known-ID cohort assignment, stale explicit reconciliation, uncertain command reuse, accepted-refresh recovery, real-mode draft persistence | Published Conflicts/Continuation; API-501 |
| F3.06 | Backend variant scope/limits shown without changing counts | ConflictPanel variants/scopes/related IDs; unchanged counts regroup regression | Frontend verified / external blocked: backend variant scopes and relations shown; overlapping scopes not added; configured limit metadata absent and disclosed | LIMITS |
| F3.07 | Async updates and error/retry paths verified | ResearchPanel async/citation/retry tests; ConflictPanel stale/unmount/reload tests; App run-generation regression | Frontend verified / external blocked: late refresh discarded after New run, repeated continuation protected, retrieval retries and partial gaps preserve findings | RETRY; API-501 |

## F4 — Proposal editing, results, history and export

| ID | Required acceptance behavior | Code / existing test pointers | Initial status / gap | External dependency |
|---|---|---|---|---|
| F4.01 | Edit/remove/add proposal, target editing and variant regrouping complete | `components/ProposalWorkspace.tsx/test`, `api/proposalHistory.test.ts` | Frontend verified / external blocked: canonical text/remove/add/numeric-or-null target/regroup instructions, known cohort IDs and empty scopes; feedback counts unchanged | API-501 instructions |
| F4.02 | Exact proposal versions; drafts retained through stale reconciliation | `proposalDraft.ts/test`, ProposalWorkspace stale/reload/removed-ID tests; `session.ts/test` | Frontend verified / external blocked: separate text/target/idea/grouping base versions, explicit reconciliation, removed draft inspection, unknown command same-key/body and namespaced recovery | Published stale-version contract; persisted backend run |
| F4.03 | Accepted edit recomputation and updated versions shown | ProposalWorkspace accepted/failed/waiting tests; mock processing/coherent publication tests | Frontend verified / external blocked: accepted resource separate from processing/new version, retrieval-only recovery, failed recomputation retains prior proposals/drafts | API-501 proposals |
| F4.04 | Immutable earlier proposal inspection uses established API | `HistoryPanel.tsx/test`, `api/client.ts:proposals` and immutable mock versions | Frontend verified / external blocked: exact API run/version query; mismatch rejection, late-read cancellation, read-only snapshots and server audit version choices | Published proposals version query; API-501 |
| F4.05 | Render assets/numbered explanations bind exact change/variant/proposal identities | `RenderPanel.tsx/test`, `renderJobs.ts/test`, `ChangeExplanation.tsx/test`; F4 browser report | Frontend verified / external blocked: exact job baseline/catalog/proposal/variant/change, outcome-bound asset IDs and numbered explanations; current counts/research explicitly separate from immutable proposal | Published RenderResult; ASSETS; HISTORICAL |
| F4.06 | Late old render cannot replace current-version asset | RenderPanel concurrent old/new, stale and late-result tests; older render browser path | Frontend verified / external blocked: old jobs remain independently inspectable; late/stale results cannot supply current selection assets | Published versions; API-501 rendering |
| F4.07 | Async render/export states, polling/events, retry and cleanup | RenderPanel/renderJobs and HistoryPanel/exportJob lifecycle tests | Frontend verified / external blocked: queued/rendering/partial/failed/succeeded render; queued/processing/ready/failed export; serial polling, exact retry, cancellation and uncertain/accepted recovery | API-501 render/export |
| F4.08 | API authoritative exact-version export and returned authorized links | HistoryPanel/exportJob manifest/reload/format tests; earlier-version export browser path | Frontend verified / external blocked: authoritative selected-version API request, manifest/source/optional research/scoring checks; safe authorized returned links only; no UI-owned real export | Published export; API-501; synthetic XLSX explicitly unavailable |
| F4.09 | Proposals, PM selections, approvals, rendering and validation distinct | ProposalWorkspace decision tests; ChangeExplanation immutable context; readable server audit | Frontend verified / external blocked: AI/PM origin, alternative selection, decision state, approval, rendering and target maturity shown separately; PM ideas never substitute customer findings | Backend authoritative decisions |

## F5 — Frontend renderer surface and scene integration

| ID | Required acceptance behavior | Code / existing test pointers | Initial status / gap | External dependency |
|---|---|---|---|---|
| F5.01 | Versioned scene catalog, supported assets, semantic mapping and capabilities/limits | `public/vehicles/scene-catalog-v1.json`, viewer/readmes | Partial: catalog exists; published shape/validation and mapping gates needed | ASSETS |
| F5.02 | Reimagine request/result through application API | App Reimagine; adapter render test | Partial: published request/result shape differs; no provider calls present | Published application renders; API-501 |
| F5.03 | All render states, per-change outcomes, preservation limits, unsupported changes | Render section; partial render test | Partial: status/outcome text exists; full state/limit/asset behavior missing | ASSETS; renderer externally owned |
| F5.04 | Baseline and variant assets independently addressable | Baseline viewer; render result assets | Partial: current UI does not fully consume result assets | Published asset refs |
| F5.05 | Duplicate protection, exact version, stale/late assets, load failure/fallback verified | Command lock/idempotency; render test; viewer fallback tests | Partial: asynchronous/stale/result-asset cases missing | ASSETS |
| F5.06 | Contract-valid success/partial/failure/late frontend fixtures | `api/fixtures.ts`, local mock scenarios | Partial: historical fixtures incompatible with published schemas | Pinned shared scenarios |
| F5.07 | No browser renderer service/provider integration | `api/client.ts`; source inspection | Partial: boundary respected historically; explicit boundary test/evidence needed | Renderer service outside task |
| F5.08 | No fabricated geometry/exact-trim mappings/generated results | Viewer disclosures, coverage docs | Partial: clear photo/asset labels; guessed mesh mapping needs gating | ASSETS |

## F6 — Frontend integration and acceptance

| ID | Required acceptance behavior | Code / existing test pointers | Initial status / gap | External dependency |
|---|---|---|---|---|
| F6.01 | Configuration real mode verified against published schemas/fixtures | Real adapter test; `.env.example` | Partial: old shape only; schema-valid network harness missing | Pinned contracts; AUTH |
| F6.02 | Run against existing reachable backend without backend edits | README integration notes | Missing: no fresh reachable backend evidence | API-501 |
| F6.03 | Otherwise network harness; clear separation from live acceptance | Existing fetch stub unit test | Missing: full frontend network harness and evidence labels | API-501 |
| F6.04 | All ten shared scenarios covered | Mock scenario switch; client/App tests | Partial: several historical local cases; full named scenario mapping missing | Pinned scenarios |
| F6.05 | Upload → run → finding → evidence → edit → Reimagine → numbered explanation → exact-version export | App workflow tests; historical verification doc | Partial: individual checks; complete contract-valid network path missing | API-501; ASSETS |
| F6.06 | Desktop/mobile, keyboard/focus/reduced motion, loading/empty/errors, asset/network failures | CSS/viewer tests; historical browser report | Partial: fresh cross-state browser acceptance missing | Hosted asset network |
| F6.07 | Clean checkout installs/tests/builds/starts from documented commands/config without secrets | Frontend README, package scripts, `.env.example` | Partial: commands exist; clean isolated install/start evidence missing | None |
| F6.08 | Ledger/handoff records exact evidence | This ledger; `VERIFICATION.md`, `frontend/README.md` | Partial: initial static ledger only; package PR/check results pending | None |

## Shared scenario gate

| Scenario | Initial coverage pointer | Required final evidence |
|---|---|---|
| standard_autonomous | App create/default/partial package tests | Published fixture + network workflow, no PM wait |
| deep_dive_success | Mock scenario switch | Ready claims/citations; uploaded counts unchanged |
| deep_dive_partial | App partial gap test | Partial/null recommendation preserves useful results |
| guided_conflict | App continuation/client checkpoint test | Published cohort assignments, stale recovery, resume once |
| duplicate_uploads | Client duplicate contents test | Published upload shape; no count inflation |
| pm_edit_stale | App/client stale draft tests | Exact-version rejection/reconcile preserving all drafts |
| render_partial | App/client partial tests | Useful asset + unsupported outcome and limits |
| render_late | Old-render label test only | Old async completion cannot replace current asset |
| reconnect | No event test | Replay/dedup/gap/expired cursor and draft/selection recovery |
| versioned_export | Historical browser mock export report | Authoritative manifest/link matches selected exact version |

## Package gates and handoff evidence

F1 gate: 79 tests across 9 files pass; `npm run typecheck`, `npm run build`, `git diff --check` pass. See [F1 verification](F1-VERIFICATION.md). Separate sub-agent review found setup/retry/access/session/opaque-ID issues; all fixed with regression tests. F2 gate: 142 tests across 14 files, typecheck/build/diff-check pass; final native browser focus and graph/source path verified. See [F2 verification](F2-VERIFICATION.md). F3 gate: 210 tests across 18 files, typecheck/build/diff-check pass; stale guided browser reconciliation and scoped research verified. See [F3 verification](F3-VERIFICATION.md). F4 gate: 309 tests across 26 files, typecheck/build/diff-check pass; exact edit/render/explanation/history/export browser path verified. See [F4 verification](F4-VERIFICATION.md). F5–F6 gates pending. Each package records commit/PR/base dependency, executed test counts, typecheck/build, applicable browser checks, separate reviewer findings and resolution, CI result, plus precise remaining external acceptance. Dependent work starts only after predecessor verification/PR gate; do not merge without user approval.
