# Backend testing and handoff

Implementation and verification are separate. This runbook describes the backend
modules and the remaining release checks; it does not assert that those checks
passed. Bind final results to the tested commit in `delivery_status.json`.

## Start from a clean checkout

Use the versions locked in `pyproject.toml`, `uv.lock` and `COMPATIBILITY.md`.
Run these commands from `backend/`:

```sh
docker compose build api worker
docker compose up -d postgres temporal
docker compose run --rm api python -m alembic upgrade head
docker compose run --rm api python -m app.seed
docker compose up -d api worker
```

API documentation is `/docs`; application operations are under `/api/v1`.
The guarded development identity is `Bearer development:pm_demo` with
`X-Workspace-ID: workspace_demo`. Production refuses development identity.
Originals, database state and Temporal history use persisted private volumes.
Never delete volumes as part of recovery or testing against an existing dataset.

PDF workers need offline, checksum-verified weights at `PDF_MODEL_DIRECTORY`.
Use `python -m app.parser_models --directory <private-model-directory> --download`
as an explicit setup operation. Request-time parsing does not download models.
Load the ignored `.env` through `APP_ENV_FILE`; container runs need an explicit
read-only secret mount. Do not print or copy credentials into images or artifacts.

## Processing and ownership

| Stage | Implementation | Durable boundary |
|---|---|---|
| Authentication, uploads, run creation | `auth`, `main`, `commands`, `storage` | Workspace membership, original source versions, command/audit/outbox transaction |
| Execution and reconnect | `dispatch`, `workflows`, `worker`, `runs` | Stable workflow identity, version-bound generation, persisted SSE sequence/watermark |
| Feedback, study, sales, equipment and strategy ingestion | `excel`, `excel_process`, `pdf`, `pdf_worker`, `ingestion` | Frozen parser bindings, logical identities, source-linked cached evidence, coverage |
| Observations, findings, counts and applicable baselines | `findings` | Typed source-supported observations, explicit membership and source-scoped baselines |
| Optional Deep Dive | `research` | Persisted steps, shared reservations/deadline, exact fetched passages and final research snapshot |
| Conflicts, guided pause and proposals | `proposals`, `control` | Explicit alternatives/checkpoint, typed draft, deterministic policy, immutable proposal publication |
| PM changes, decisions and history | `control`, `evidence` | Version-bound commands, preserved prior proposals, authenticated actor audit |
| Explicit Reimagine | `rendering` | Immutable authenticated renderer manifest, polling/attempt history, per-change outcomes |
| Exact-version JSON/XLSX export | `exports` | Frozen proposal/source/research/decision cutoff and private downloadable artifact |

Frontend, geometry, vehicle assets and renderer implementation belong to the
other team. The checked-in catalog is synthetic until their real catalog arrives.
Missing inference credentials must produce explicit failure; unavailable research
or rendering must not fabricate citations, assets or human approval.

## Final automated gate

Rebuild images after source changes. Run the complete checks against PostgreSQL
and Temporal, with deterministic inference/search/renderer fakes where appropriate:

```sh
docker compose run --rm api python -m ruff check app tests migrations
docker compose run --rm api python -m ruff format --check app tests migrations
docker compose run --rm api python -m mypy app
docker compose run --rm api python -m alembic upgrade head
docker compose run --rm api python -m alembic check
docker compose run --rm api python -m app.contracts --check
docker compose run --rm api python -m pytest -ra
```

Apply migrations both to an empty test database and to the previous story schema.
Repeat upgrade to prove safe reentry. Regenerate public contracts only after route
integration; never change fixtures to conceal incompatible observable behavior.

Exercise all ten named shared scenarios through actual endpoints:
`standard_autonomous`, `deep_dive_success`, `deep_dive_partial`, `guided_conflict`,
`duplicate_uploads`, `pm_edit_stale`, `render_partial`, `render_late`, `reconnect`
and `versioned_export`. Schema-only fixture validation is insufficient.

Required regressions include cross-workspace access for every resource family,
repeat commands, same-base simultaneous edits, invalid model IDs/quotes/targets,
unknown denominators, overlapping cohorts, provider timeout, parser limits,
private-address redirects, formula injection, partial renderer outcomes and
expired SSE cursors. Every published uploaded or external evidence ID must resolve.

Recovery checks must kill a worker after a committed output, redispatch after a
lost acknowledgement, interrupt a guided wait, preserve queued commands during a
Temporal outage and replay histories from before workflow changes. A late AI,
research or render result cannot replace a newer PM generation. Verify unaffected
ingestion/research artifacts are reused during edits.

## Private evaluation and live gates

Run aggregate Excel checks with a private reference JSON containing `counts`
(supported keys: `records`, `annotations`, `unresolved_annotations`, `metrics`,
`unknown_values`). This checks normalization counts, not semantic AI quality:

```sh
python -m app.excel_evaluation --source <private.xlsx> --reference <private-reference.json>
```

The command reports parser revision, coverage codes, duration and peak child
memory without printing workbook text or identifiers. A mismatch exits nonzero.
Use `app.pdf_evaluation` with page-specific manual references for PDF checks.

Keep supplied documents, rendered pages, passages, reference answers and detailed
evaluation results outside Git. Evaluate all three feedback profiles, both study
layouts, sales zeros/combined derivatives, option PDFs and a second derivative.
Follow the declared thresholds in `PDF_EVALUATION.md`; compare PDF association and
locators against manually inspected rendered pages rather than parser output.

Report measured extraction/grouping/retrieval errors, counterevidence retention,
scope applicability, counts, target plausibility, stage latency, parser peak RSS,
resumability and available provider tokens/cost on a declared machine. Missing
cost metadata remains unknown. Invented citations/approvals or inflated counts
block release.

Record configured live evidence separately for API access tokens/JWKS rotation,
private production storage, hosted or operationally supported Temporal, structured
inference, hosted search, OTLP export and the other team's authenticated renderer.
The bounded `python -m app.smoke` connectivity check alone does not verify these
pipeline behaviors. Unconfigured services remain outstanding gates.

Production release also needs HTTPS, hosting/data region, backup/restore and
retention choices, worker namespace/task queues, readiness checks and a tested
recovery procedure. `/health` reports API liveness, not dependency readiness.

Hand over current OpenAPI/schema artifacts, synthetic examples, catalog IDs,
documented states/actions, the bearer-authenticated SSE replay contract, exact
version behavior, failure outcomes and the tested commit. Full-application
acceptance requires joint UI/asset/renderer checks. Merging into `main` or deploying
infrastructure is a separate release action.

## Synthetic demo fixtures and dependency readiness

From `backend/`, generate synthetic feedback, study and sales workbooks into an
explicit destination. Existing fixture filenames are never overwritten:

```sh
python -m app.demo --directory .local/synthetic-demo
```

Upload the generated files through the normal authenticated upload endpoint and
create a run using the configured synthetic vehicle/catalog identifiers. The
fixtures contain invented contrasting seat feedback, a scoped study proportion,
and a literal sales zero. They never read supplied private documents or credentials.
Provider and renderer configuration is still required for those pipeline stages;
the fixtures do not fabricate model responses or human approval.

The dependency readiness endpoint uses `app.readiness.check_readiness`: PostgreSQL
and the configured Temporal namespace are checked in parallel with three-second
request budgets. Healthy dependencies return 200; either failure returns 503.
The response contains dependency booleans and configuration flags for AI,
research, renderer, OIDC, S3 and telemetry, without endpoint URLs or secret values.
Configuration flags establish presence only; live feature behavior remains a
separate integration gate. `/health` remains the API liveness probe.

## Backend audit, 10 October 2026

Audited against `backend_plan.md`, `plan.md`, the supplied brief and this runbook.
Code tested: `441386b` on `main`. The backend has working local foundations and a
successful live synthetic AI pipeline, but it has not passed all release gates.
The fresh-image cumulative suite passed **207 tests in 137.58 seconds**. Ruff lint,
formatting (89 files), strict mypy (38 files), generated contracts, Alembic upgrade
and no-drift check all passed. The restarted API returned HTTP 200 from `/ready`
with database and Temporal ready. Automated AI/search/renderer tests use controlled
providers; the separate live evidence below identifies actual external calls.
The machine used Windows with Docker Desktop, Python 3.14.8 in Linux containers,
local PostgreSQL/Temporal and CPU PDF parsing; Docker had about 7.6 GiB memory
and other running services. Provider calls used the configured real credentials.
Private documents, passages, reference answers and credentials remain outside Git.

### Corrections committed separately

| Commit | Reproduced defect and correction |
|---|---|
| `d5d69a9` | OpenAI rejected the proposal schema with HTTP 400. Factor rationales now use closed, named properties in the provider schema. |
| `6d13c1b` | The PDF evaluation CLI exited successfully on a failed reference gate. It now exits nonzero. |
| `a26f90f` | Extraction/baseline calls ignored the endpoint frozen in run configuration. They now honor it. |
| `7564dfc` | Proposal/research requests omitted the provider response-storage opt-out. Every such request now sends `store=False`. This does not establish a provider zero-retention agreement. |
| `8d2b665` | Eight supplied country codes lost market scope. Mappings and EU membership were corrected, with a parser revision increment to invalidate old cached interpretations. |
| `441386b` | Positive-only feedback could not support a requirement preserving that strength. Related positive evidence is now accepted; unrelated citations remain rejected and negative counts stay unchanged. |
| `1d6513c` | Added endpoint acceptance coverage for PM edits, decisions, frozen exports, late rendering, history, event replay and workspace isolation. Proposals and renderer outcomes in this test are synthetic. |

### Measured private-source checks

| Input | Result |
|---|---|
| F70 feedback | 2,128 distinct records; 4,076 annotations; no unresolved annotations or coverage gaps. |
| G60 feedback | 4,000 distinct records; 5,005 annotations; no unresolved annotations or coverage gaps. |
| G70 feedback | 4,000 distinct records; 4,690 annotations; no unresolved annotations or coverage gaps. |
| Study workbook | Both sheet layouts processed; 1,627 metrics, no unknown values. All cell meanings were not manually evaluated. |
| Sales workbook | Three sheets; 36 metrics, including six literal zeros; partial coverage for unmapped country/region labels. |
| F70 equipment PDF, page 13 | Six manual cases and locators matched; partial document coverage remains explicit. |
| G60 equipment PDF, page 13 | Two manual availability cases and locators matched; partial coverage. |
| G70 equipment PDF, page 14 | Two manually inspected availability cases and locators matched; partial coverage. |
| Annual report, page 14 | Two manual text cases and locators matched. |

Feedback distinct counts were independently reconciled from source/record IDs,
rather than checked against parser output alone. Counts above are per input and
do not imply that different profiles contain disjoint people. Excel checks took
about 0.6–4.2 seconds per workbook. Sequential PDF samples took 23–47 seconds,
with peak child RSS about 1.15–1.36 GiB. Offline PDF model checksums passed.
Two concurrent PDF samples on the busy host exceeded the default 180-second
parser deadline; sequential runs passed. Full-document PDF fidelity, especially
the entire annual report, and sustained concurrent workload quality remain open.

### Live connections and plan coverage

| Plan area | Evidence and remaining gate |
|---|---|
| B1: API foundations | Local database/Temporal readiness, authenticated workspace checks, uploads, immutable configurations and reconnect behavior exercised. Production OIDC/JWKS rotation is unconfigured. |
| B2: Evidence pipeline | Real workbooks normalized and PDF samples checked. Synthetic live extraction/review/grouping/reconciliation completed with resolving citations. Full-corpus semantic accuracy is not established. |
| B3: Deep Dive | Real hosted search and safe retrieval of two public sources ran. One retrieval failed and the shared time budget expired before claim assessment: final status unavailable, zero validated claims. Validated capability/opinion quality and counterevidence are open. |
| B4: Proposals | Live synthetic upload-to-proposals finished in 71 seconds with one finding, one change and one variant; decision stayed proposed and all citations resolved. Unknown baseline scope remained explicit. Real-feedback completion is still open. |
| B5: Refinement | Endpoint tests verify exact versions, stale rejection, decisions, preserved proposals, history and frozen export. Guided/checkpoint and reuse behavior also have deterministic coverage; the whole guided AI flow was not tested live. |
| B6: Renderer | Failure/unsupported outcomes and late-version behavior tested with controlled adapters. The other team's authenticated renderer is unconfigured. |
| B7: Evaluation/recovery | Local real Temporal recovery/replay tests and replay of the successful live pipeline passed. Joint frontend scenarios, large-scale AI quality, backup/restore and business impact remain open. |

The successful live synthetic run was `00619bef-5695-4ad1-9a28-1766b4f7f417`.
A three-record real G60 sample reached findings/baselines but failed at proposal
generation. A subsequent run after the preservation fix failed during extraction
with provider connection-refused errors. Other attempts observed intermittent DNS
failures. A test-container-only hostname override allowed the synthetic run;
no permanent application networking override was committed. A connectivity smoke
pass therefore does not establish reliable end-to-end service availability.

Provider token usage was present for extraction and review stages, but complete
pipeline cost and production throughput were not measured. The live sample used
the existing synthetic vehicle/part catalog; it does not validate actual G60/F70/G70
equipment applicability. Production S3, supported hosted Temporal, OTLP, renderer,
HTTPS/data-region choices and backup/restore remain unconfigured or unchecked.

The API was rebuilt/restarted with audited code. PostgreSQL, Temporal and all
volumes were preserved. The global worker is stopped to avoid consuming accumulated
test commands and making unintended provider calls; live tests used an isolated
queue and dispatched only their own command. Starting normal processing requires
reviewing that test backlog before starting the worker. This audit made local
commits only; it did not deploy or push them.

## Backend audit follow-up, 11 October 2026

This section supersedes the earlier live-connection results. Tested application
code: `378e578`. Real provider calls used the private environment file mounted
as a Docker secret. Private inputs, passages and reference answers remain ignored.
Full PDF corpus ingestion is still running; this is an interim evidence record.

Fresh-image regressions passed in both environments: **219 tests in 88.84s**
in the API image and **219 tests in 236.91s** in the parser image. Ruff lint,
formatting (91 files), strict mypy (38 source files), generated contracts,
repeatable Alembic upgrade/no-drift and `git diff --check` passed.

### Separately committed corrections

| Commit | Reproduced defect and correction |
|---|---|
| `a19ad53` | Native OpenBLAS thread creation exhausted the upload sandbox in the actual parser image. Upload and Excel subprocesses now bound native thread pools. |
| `f7216f8` | Ten-page PDF checkpoints exhausted the CPU budget. New source bindings freeze two-page checkpoints. |
| `b923e6a` | A returned invalid AI draft was lost and retries reported an uncertain call. Provider outputs are cached before validation, with at most one bounded correction attempt. Unsupported scopes remain rejected. |
| `7ba8234` | Full PDF ingestion could exceed the one-hour activity budget. A Temporal patch gives new workflows four hours while preserving legacy replay. |
| `344c7b1` | A failed page pair dropped readable pages. Exhausted pairs split into single-page checkpoints; successful caches retain their identity. A single-page failure stays explicit. |
| `b04d170` | Research assessment saw navigation prefixes instead of substantive body text. It now selects an exact, bounded lexical match to the need. Synonym recall remains limited. |
| `5263454` | Added controlled assessment coverage for exact quotes, scoped applicability, opinion/counterevidence retention, unchanged feedback counts and idempotent reuse. |
| `3ac5bd3` | Live preservation proposals cited positive feedback only as opposition and were rejected. Prompt and correction errors now explicitly require related supporting citations for every change, including preservation. Validation remains strict. |
| `378e578` | Baseline review omitted the operator's target scope, incorrectly treating configured target context as unsupported. Assessment and review now receive the same frozen target context; source scope remains separate. |

### Live AI and HTTP acceptance

The independent `vehicle-backend-acceptance` Docker project uses fresh local
PostgreSQL/Temporal/objects volumes, the normal API and dispatcher/worker, and real
OpenAI calls. Its API is available at `http://127.0.0.1:8001`. AI and research
timeouts in this acceptance configuration are 180 seconds. The normal project
keeps its existing volumes and API at port 8000. Both APIs returned `/ready` HTTP
200 after rebuilding, with database and Temporal ready.

| Check | Measured result |
|---|---|
| Real G60 sample | Run `86baabd2-6f21-4d88-ba8a-5541c9450a1c`: three independent records, three findings, three changes, one variant; proposals ready in 195 seconds; citations resolved and history replay passed. |
| Real F70/G60/G70 HTTP pipeline | Run `716d50dc-2a4c-431d-92e1-95fb62f4402b`: six independent records with seven retained annotation rows, plus the complete study and sales workbooks; six findings, five changes, three variants. Upload-to-edit/export acceptance took 482 seconds, including a deliberately stopped worker. |
| Native PDF plus real feedback | Run `58122149-2fca-461e-9076-1db2c75e8c17`: actual 23-page F70 PDF and three real F70 records, plus synthetic demo study/sales context; nine findings, five changes and one variant in 554 seconds. Citations resolved, decisions stayed proposed and real Temporal replay passed. |
| Refinement/recovery | The edit remained queued while the worker was stopped and completed after restart. Version one and findings stayed unchanged; version two published. Idempotent retries, stale edits, score recomputation and citation resolution passed. |
| PM decisions/export/events | Explicit test decision deferred a change. JSON/XLSX downloads, frozen version two, history, exclusive SSE replay and nonmember denial passed. No approval was fabricated. |
| Live guided conflict | Synthetic run `415ed95b-7e6d-430e-89c5-57ef7ddf5043`: four contrasting records produced one conflict; processing waited for PM; an idempotent `preserve_alternatives` continuation published two variants, still proposed. The fixture first used an unsupported workbook layout, which was correctly rejected; an invalid resolution was also rejected. |
| Live research | Run `c69dbed8-e87a-47db-954b-1679d9a6c5cf`: hosted search, two safely fetched public sources, two validated claims, zero validated counterevidence; partial with explicit long-duration, equipment and market-applicability gaps. One search, five reserved fetches and 6,000 reserved tokens. Reserved tokens are a conservative budget, not measured billing. |
| Real Temporal replay | Six histories replayed with latest workflow code: real analysis, guided analysis/continuation, edit, two exports and renderer failure. |
| Renderer | The real request failed explicitly because no renderer is configured; proposals stayed available. Successful authenticated renderer integration remains open. |

Live AI completion establishes connectivity and the listed contracts, not semantic
correctness for every customer statement. The sample uses the demo vehicle/part/
asset catalog, so actual derivative equipment applicability is still a gate.
Research's live opposing-evidence quality remains open despite controlled tests.
Manual review of the six-record live sample found the nine extracted observations
faithful to their source texts: positive strengths, the negative paper-manual
complaint and overlapping annotations were preserved without invented physical
part mappings. The two live research claims were checked against the selected
manufacturer passage; they distinguish a qualified comfort claim from a described
seat feature and do not claim proven sustained comfort or current market fit.

The native PDF/feedback run recorded 38 distinct provider responses: 657,944 input
and 20,973 output tokens, including one proposal-provider call. No uncertain
provider outcome was observed in that run. This is measured token usage for one
sample, not full-corpus cost or production throughput. English need text can
retrieve irrelevant German equipment passages; review rejected unsupported
baseline claims and retained unknown states. Cross-language retrieval quality
remains a limitation. Research at the default 60-second budget can run out of
assessment time after retrieval; the validated live research used 180 seconds.

After the target-context correction, a real SDK baseline review accepted a reused
validated assessment with the original bounded source selection, retaining its
unknown baseline. Assessment was reused in this focused check; it was not another
complete paid pipeline. A separate live assessment rejected feedback citations
offered as equipment-baseline evidence, as required.

XLSX export already neutralizes untrusted formula-like strings. Existing tests
verify literal string cells, numeric values, nulls and deterministic output; no
additional export implementation was needed.

### Cleaning, source integrity and recovery

All supplied feedback workbooks were normalized in the actual parser image:
F70 2,128 records/4,076 annotations; G60 4,000/5,005; G70 4,000/4,690.
Independent checks matched every one of the 13,771 annotation texts and identities
to original cells, including complete row locators. All 1,663 study/sales metrics
matched source values and raw cell references: 1,627 study metrics and 36 sales
metrics, including six literal zeros. These checks exercised 173,346 original
cell/locator comparisons. Fractions, proportion bases, unknown sample sizes and
future-year flags were checked. Unmapped sales regions remain explicitly partial.
This checks numeric/source fidelity; it does not manually validate every metric's
business interpretation.

An actual PostgreSQL custom-format dump was restored into a separate database.
All row values matched across 17 tables and 8,619 rows at that snapshot. Original
data was retained. A separate object-store restore copied 19 files/383,137 bytes
to a disposable destination; every byte digest matched, including all 17 source
versions. These are local restore checks, not a production backup policy.

The inspected unrelated Supabase Docker projects expose local auth/storage
services, but they are not configured for this backend; one storage service
returned 503. Their JWT keys use ES256 while this backend currently accepts RS256.
No renderer or OTLP container was found. No unrelated Docker service was modified.
Production OIDC/S3/telemetry and hosted Temporal integration remain open.

The default project's worker remains stopped to avoid consuming accumulated test
commands and making unintended AI calls. The separate acceptance worker is running
with the latest application code. This audit only creates local commits.
