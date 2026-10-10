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
