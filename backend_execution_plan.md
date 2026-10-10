# Backend execution plan

Build the backend in **four epics and sixteen sequential story PRs**. Each story contains small, independently understandable commits. Merge each verified story into `backend` before starting the next story. The frontend and renderer implementation remain with the other team.

This is an implementation backlog, not a claim that the backend exists. On 2026-10-10 the repository contains plans and input documents, with no application code, dependency manifest, API, database migrations, or tests. The local `backend` branch and remote-tracking `origin/backend` exist. Verify the remote state before publishing story branches.

The governing product and API requirements are [plan.md](plan.md) and [backend_plan.md](backend_plan.md); [frontend_plan.md](frontend_plan.md) defines the other team's ownership. [backlog.md](backlog.md) defines exclusions. This document adds execution order and concrete technology choices without replacing their wire contract. Older examples in `first_plan.md` and the original full plan do not override the current shared plan.

## Technology stack

- **Python 3.14.8, FastAPI 0.143.0, Pydantic 2.14.0, Uvicorn 0.54.0.** One modular backend, run as an API process and a worker process from the same application source. Python suits the supplied workbook and PDF parsing. FastAPI supplies the generated API contract and native SSE support. Keep dependencies in `backend/pyproject.toml` and a committed `uv.lock`; verify the complete runtime in BE-01. These versions are a researched starting set, not an already-tested lockfile. [FastAPI](https://fastapi.tiangolo.com/features/), [native SSE](https://fastapi.tiangolo.com/tutorial/server-sent-events/).
- **PostgreSQL 18.6, SQLAlchemy 2.1.4, Psycopg 3.3.6, Alembic 1.20.0.** Relational entities and link tables hold provenance, counts, versions, audit, command dispatch records, and UI events. JSONB is for validated flexible payloads, not a substitute for foreign keys. PostgreSQL remains the application's system of record; Temporal holds workflow execution history. [PostgreSQL supported versions](https://www.postgresql.org/support/versioning/), [SQLAlchemy current documentation](https://docs.sqlalchemy.org/en/21/intro.html).
- **Temporal with Python SDK 1.34.0 replaces Procrastinate.** Use durable workflows for stages, retries, timeouts, guided waits, and renderer polling; put database, parsing, HTTP, and AI work in idempotent Activities. Recommend Temporal Cloud for production to reduce service operations; use a local Temporal development server for development and tests. The extra service, cost, replay rules, and deployment configuration are real tradeoffs. Persist commands and an outbox in PostgreSQL before dispatching to Temporal; there is no cross-system atomic transaction. BE-04 proves crash-safe dispatch, idempotent effects, and replay. This choice is motivated by this application's long-running workflow and PM pauses, plus documented production adoption, not by claiming Procrastinate is obsolete. [Python workflow messages](https://docs.temporal.io/develop/python/workflows/message-passing), [production examples](https://temporal.io/in-use).
- **openpyxl 3.1.5 for XLSX; Docling 2.137.0 for PDF layout and tables; pypdf 6.20.0 for PDF preflight/encryption inspection.** Preserve exact sheet/cell and page/bounding-box locators. Pin Docling's parser and model artifacts; benchmark the option-list symbols, model columns, footnotes, and annual-report passages in BE-07 before calling extraction accurate. Use local inference with bounded CPU/memory; avoid downloading models during requests. pdfplumber 0.11.10 is a comparison/fallback candidate only if a measured layout failure justifies it. Workbook formulas never execute; missing cached values remain explicit. OCR and additional upload formats remain outside v1 even though Docling can support them. [Docling capabilities](https://docling-project.github.io/docling/).
- **Private S3 object storage with boto3 1.43.111 for production.** Keep the local directory/volume adapter for development. S3-compatible providers require tests for the exact features used rather than assumed identical behavior. API-authorized streaming provides audited source access; exports/assets may use short-lived authorized links. Store no source bodies in public static directories. [AWS SDK documentation](https://docs.aws.amazon.com/boto3/latest/guide/s3-examples.html).
- **OpenAI Python SDK 3.28.0 and Responses API**, using structured outputs validated with Pydantic. Recommend `gpt-6.1-sol` as the initial configurable application model, subject to endpoint access, deployment rules, and the real-data evaluation in BE-08/BE-16. Its official model page lists structured outputs and web search support. Record model/prompt/schema versions and resolved model identifiers where provided. Deep Dive uses hosted web search plus bounded HTTPX retrieval. Verify actual citations in code; schema validity is not factual validity. Do not add an agent framework around this fixed workflow. [Model capabilities](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [web search](https://developers.openai.com/api/docs/guides/tools-web-search).
- **OIDC and OAuth access-token verification with PyJWT 2.15.1 and cryptography.** Integrate the selected identity provider rather than build account registration. Validate API audience, issuer, expiry, allowed signature algorithms, JWKS rotation, and server-side workspace membership; an ID token is not an API access token. Provide an explicit local development identity mode that refuses to start in production configuration. Identity-provider selection remains a deployment input, not an invented new auth service.
- **REST under `/api/v1`, generated OpenAPI/JSON Schema, FastAPI-native SSE, HTTPX 0.28.1 renderer client.** Persist replay events in PostgreSQL; native SSE framing does not provide application replay by itself. Poll `/renderer/v1/jobs`; callbacks remain optional. REST/SSE directly fit the agreed UI contract. A switch to GraphQL, WebSockets, or gRPC would need a concrete consumer requirement.
- **uv 0.13.0, pytest 9.1.1, Ruff 0.17.0, mypy 2.4.0, Docker Compose 5.6.0, GitHub Actions.** Test database behavior against PostgreSQL and workflow behavior with Temporal's test environment and replay checks. Use Ruff for formatting and linting. CI uses synthetic fixtures and fake external providers; configured smoke runs verify live integrations. Keep type checking on mypy while ty is beta. Pin container digests and action commit SHAs; resolve and test dependency updates before merging them.
- **OpenTelemetry Python SDK 1.45.1 for traces and metrics, plus structured JSON logs.** Trace upload, dispatch, workflow stages, model calls, and renderer calls with request/run/workflow IDs. Track duration, retries, failures, and available token/cost data. Export through configurable OTLP to the deployment's observability service. Python traces and metrics are stable; its logs signal remains in development, so use standard Python logging for logs. Begin with stable manual instrumentation; optional integrations require their own compatibility check. Redact source bodies, prompts, and credentials. [Signal maturity](https://opentelemetry.io/status/).

The user's requested Codex GPT-6.1 Soul/Sol coding model is the **builder**. Before dispatching future work, resolve its exact provider/model ID from the orchestration catalog; do not guess from the display name or silently substitute. The application's inference model is a separate deployment setting. No model-specific throughput or completion-time promise is assumed here.

Initial production topology: API + activity/workflow workers + application PostgreSQL + private S3 storage + managed Temporal. The outbox dispatcher can run with the worker deployment. Local Compose adds a persisted development Temporal service and the local storage adapter; a development server is not a production deployment. Begin with bounded worker/provider concurrency and isolate CPU-heavy parsing from the API event loop. Do not add a graph database, vector database, agent framework, Kubernetes, or a live Google Drive connector without a demonstrated need. The graph remains a relational projection; scoped retrieval starts with SQL filters and text search.

## Workflow and agent design review 2026 10 10

The recommended design is a durable application workflow containing bounded AI tasks and a tool-using research loop. The following decisions refine execution inside the existing product stages; they do not change public endpoints, frontend ownership, or the four-epic/sixteen-story delivery sequence. They are architecture recommendations for this corpus, not claims of measured performance before implementation.

### Ownership and execution

| Responsibility | Owner | Rule |
|---|---|---|
| Authorization, source identities, counts, scoring, version checks and publication | Application code and PostgreSQL | Models cannot override these rules or approve on behalf of a PM. |
| Scheduling, retries, deadlines, guided waits and recovery | Temporal | Durable orchestration invokes Activities; model/tool calls never execute during workflow replay. |
| Observation extraction, semantic grouping and requirement drafting | Typed, task-specific model calls | Return candidate records with evidence IDs; only validated records become application state. |
| Deep Dive investigation | Bounded research agent inside an Activity/task sequence | It chooses the next question/search within the accepted scope; the application enforces budgets and publication. |
| Facts, sources, tool outcomes and reusable artifacts | Versioned durable storage | A conversation summary or context window is never the authoritative evidence store. |

Separate the durable record, model reasoning loop, and tool execution interfaces. New hosted agent services also separate these responsibilities; adopting their whole runtime is not required for this application's fixed API and human checkpoints. Keep task inputs/outputs independent of the provider so a measured improvement can replace the model or harness later. [Current managed-agent architecture](https://www.anthropic.com/engineering/managed-agents).

### 1. Execute dependencies, not one long serial prompt chain

Freeze the run's input manifest, then parse independent files concurrently under resource limits. Feedback, studies, sales, equipment, and strategy extraction can progress independently. Consolidation waits for the relevant source outcomes; baseline lookup can run alongside finding generation where its inputs are already known. Deep Dive starts from published scoped findings. Conflict handling and proposal generation join the required evidence and research snapshots. A failed companion file produces explicit coverage rather than discarding valid inputs.

Keep the frontend's agreed stage names and events. Internally each output binds its input versions and generation ID. A visible snapshot contains one coherent generation; provisional results carry coverage and cannot silently mix old and new memberships. No valid evidence is a distinct failure outcome, not a successful empty proposal. Guided decisions suspend only their dependent work; independent parsing/retrieval can finish. Runtime concurrency is separate from the builder's sequential story PRs.

### 2. Give the agent a narrow investigation loop

Deep Dive follows: formulate a scoped question, search, retrieve supporting passages, assess applicability and counterevidence, then either ask the next useful question or stop. Persist the question, attempts, source references, remaining budget, and outcome after each completed step. Resume from durable outcomes after a crash. Stop on sufficient support, no new useful evidence, cancellation, deadline, or exhausted tool/token/cost limits; return supported claims plus explicit gaps.

Expose only typed tools for scoped evidence search/read and permitted public-source retrieval. Enforce workspace, source version, market, vehicle, date, output size, and remaining budget in code, not in prompts alone. Tools return IDs, locators, content, and structured failure reasons. No arbitrary SQL, shell, publication, or PM-decision tools. Independent research questions may run concurrently with a shared budget reserved atomically; there is no default recursive agent delegation. Structured extraction and scoring do not require an autonomous agent. This applies the distinction between predictable workflows and open-ended investigation to our product. [Workflow and agent patterns](https://www.anthropic.com/engineering/building-effective-agents).

### 3. Retrieve evidence on demand and preserve identity

Build small context packages using scope filters and exact source references. A model can request nearby rows, table legends, footnotes, or report sections as needed. Preserve raw passages separately from translations and interpretations. Start with relational filters and text search; evaluate multilingual/paraphrase recall before adding embeddings or hybrid retrieval. Retrieval must be evaluated against known relevant evidence, including opposing evidence, rather than judged only by fluent answers. [Context selection patterns](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

For thousands of feedback records, partition candidate grouping by relevant scope/topic and retrieve likely matches; avoid comparing every record with every other record or putting all workbooks in one prompt. Evaluate grouping across batch boundaries so partitioning cannot silently fragment a common need. Reconcile final group membership explicitly. Counts always come from record-ID sets. Cache extraction by workspace, content fingerprint, parser/model/prompt/schema versions and relevant configuration; a matching file hash permits reuse but does not establish respondent identity. External research reuse also binds its scope and freshness policy.

### 4. Validate meaning before publishing

Use separate gates for schema/ID/span validity, scope applicability, and whether the cited passage actually supports the claim. Literal quotation matching alone is insufficient. Code checks identities, quantities, units and scope; a bounded semantic assessment flags unsupported interpretations and contradictions. A model's confidence or agreement with another model is not proof. Keep source facts, observations, inferences, proposed targets, and PM-origin ideas distinguishable.

Allow a bounded repair attempt for invalid model output, then preserve an explicit gap or failed batch. Never loop until a judge approves. Introduce a small manually checked evaluation set in BE-07/BE-08, extend it with baseline and research cases in BE-09/BE-10, and run regressions when prompts/models change. Include misleading citations, contradictory sources, multilingual feedback, repeated annotations, and missing denominators. Measure extraction/grouping quality, evidence support, coverage, latency and cost separately. Set documented release thresholds against the reference set before tuning; BE-16 expands this evaluation rather than introducing it for the first time. [Agent evaluation guidance](https://developers.openai.com/api/docs/guides/agent-evals).

### 5. Make PM edits incremental and protect their work

Persist artifact dependencies from source versions through observations, findings, research bundles, requirements, scores and render manifests. Implement this with ordinary versioned records/link tables, not a separate graph service. A target edit recalculates affected scores and marks affected renders stale; it does not reparse every workbook. Regrouping reuses evidence membership. A new unsupported idea remains PM-origin. Research only reruns through an explicitly accepted operation within the existing contract.

Every asynchronous result carries its base proposal version and generation ID. Publishing compares those values with the current accepted generation in one transaction. A late model, research or renderer result may be retained for audit but cannot replace a newer PM-edited proposal. Cancelling provider work is best effort; preventing stale publication is mandatory. Existing versions remain readable during recomputation.

### 6. Measure complexity before adding it

Begin with one configurable application model and direct typed provider calls. Introduce cheaper-model routing, extra critique passes, hybrid search, or specialist agents only when the same reference tasks demonstrate a quality/cost/latency gain. Record the resolved model and policy per artifact. Distinguish provider retries from semantic repair; uncertain requests can incur duplicate external cost even when database effects are idempotent. Track that uncertainty and cap attempts. Workflow history, UI replay events and product audit serve different purposes; do not turn the entire application into an event-sourcing framework.

### Story gates added by this review

These are mandatory acceptance additions to the existing stories, implemented within their existing commit slices.

| Story | Additional acceptance evidence |
|---|---|
| BE-04 | Independent tasks overlap under bounded concurrency; joins publish coherent generations; recovery reuses committed artifacts. |
| BE-05–BE-07 | Reused parsing preserves source lineage and scoped identity; bounded parsing failures report coverage; PDF reference cases begin evaluation early. |
| BE-08 | Cross-batch grouping and retrieval recall are evaluated; supporting/opposing membership reconciles; claim validation separates valid citations from supported meaning. |
| BE-09 | Applicability cases test market/date/derivative mismatches and distinguish unknown from absent. |
| BE-10 | Research resumes after a completed step, stops at all configured limits, preserves counterevidence, and cannot exceed shared budgets through concurrent tasks. |
| BE-11 | A guided pause blocks dependent proposal publication while unrelated safe work can complete; repeated/stale decisions have one logical effect. |
| BE-12 | Unsupported claims fail publication or remain explicit gaps; atomic publication rejects a superseded generation. |
| BE-13–BE-14 | Tests prove minimal affected recomputation and reject late AI/research/render publication after a newer PM edit. |
| BE-16 | Report reference-set quality and retrieval/grouping errors alongside runtime/cost; compare any added agent/model complexity against the simpler baseline. |

## Technology currency review 2026 10 10

Selection rule: use current stable, supported components with evidence of real use, then verify that the selected versions work together on the deployment platform. A release date alone does not establish product fit, adoption, security, or compatibility. No single stack is objectively best for every application. This review checked publisher documentation and current package metadata; it did not install or benchmark the proposed application environment.

**Runtime exception:** Python 3.15.0 is the newest stable release, dated October 9, 2026. The selected local document-processing path currently has published CPython 3.14 Linux wheels but no CPython 3.15 wheels for PyTorch 2.14.1 and docling-parse 7.22.2. Choose Python 3.14.8 as the newest evidenced practical baseline for this whole stack. Do not build native ML dependencies from source or split runtimes merely to claim 3.15. Recheck wheels and the complete dependency resolution in BE-01; adopt 3.15 when the supported dependency set and tests pass. Wheel availability alone is not an integration test. [Python releases](https://www.python.org/downloads/), [PyTorch distribution files](https://pypi.org/project/torch/2.14.1/#files), [parser distribution files](https://pypi.org/project/docling-parse/7.22.2/#files).

**Database exception:** the official PostgreSQL page lists 18.6 as the current stable 18.x release and 19 as Beta 4. Use 18.6; beta 19 is not a production default. [Release status](https://www.postgresql.org/support/versioning/).

**Industry fit:** FastAPI's project documents production use; SQLAlchemy/PostgreSQL are established foundations. Temporal publishes customer cases including Replit and Retool. Docling originated at IBM Research and is hosted by LF AI & Data, with documented Red Hat integration. These support adoption and maintenance confidence; they do not prove this corpus's extraction accuracy or guarantee better performance. [FastAPI usage](https://fastapi.tiangolo.com/), [Temporal customer cases](https://temporal.io/in-use), [Docling in Red Hat](https://www.redhat.com/en/topics/ai/docling).

### Every component reviewed

Package versions below were read from the project's PyPI JSON metadata on 2026-10-10. Links identify the exact reviewed release. They are BE-01 resolution candidates, not instructions to combine incompatible versions or use floating `latest` tags. Re-resolve transitive dependencies and inspect advisories when creating the lockfile.

| Component | Reviewed release | Decision and role |
|---|---|---|
| Python | [3.15.0 latest; 3.14.8 selected](https://www.python.org/downloads/) | Upgrade from 3.12; documented native-dependency exception above. |
| FastAPI | [0.143.0](https://pypi.org/project/fastapi/0.143.0/) | Keep; current API framework and native SSE. |
| Pydantic | [2.14.0](https://pypi.org/project/pydantic/2.14.0/) | Keep; validate API and AI outputs using v2 APIs. |
| Uvicorn | [0.54.0](https://pypi.org/project/uvicorn/0.54.0/) | Keep; ASGI serving. |
| python-multipart | [0.0.32](https://pypi.org/project/python-multipart/0.0.32/) | Explicit upload dependency; cap request and parser resources. |
| PostgreSQL | [18.6](https://www.postgresql.org/support/versioning/) | Pin current stable major/patch; no preview database. |
| SQLAlchemy | [2.1.4](https://pypi.org/project/sqlalchemy/2.1.4/) | Use current 2.1 APIs and typed models. |
| Psycopg | [3.3.6](https://pypi.org/project/psycopg/3.3.6/) | Keep; current PostgreSQL driver. |
| Alembic | [1.20.0](https://pypi.org/project/alembic/1.20.0/) | Keep; versioned application migrations. |
| Temporal Python SDK | [1.34.0](https://pypi.org/project/temporalio/1.34.0/) | Adopt for durable workflows. Cloud manages the server; self-hosted server release reviewed: [1.32.1](https://github.com/temporalio/temporal/releases/tag/v1.32.1). |
| Procrastinate | [3.10.0](https://pypi.org/project/procrastinate/3.10.0/) | Current and valid, but replaced for workflow fit and broader documented adoption. Do not run both engines. |
| Celery | [5.6.3](https://pypi.org/project/celery/5.6.3/) | Established alternative evaluated; broker/tasks do not remove this product's durable checkpoint orchestration work. Not selected. |
| Docling | [2.137.0](https://pypi.org/project/docling/2.137.0/) | Adopt for layout-aware PDF extraction; benchmark and pin model artifacts. |
| openpyxl | [3.1.5](https://pypi.org/project/openpyxl/3.1.5/) | Keep for exact Excel cells, annotations, and XLSX export. Its release age does not make a semantic/LLM parser a better replacement. |
| pypdf | [6.20.0](https://pypi.org/project/pypdf/6.20.0/) | Keep for PDF preflight and crypto inspection, not the primary complex-table parser. |
| pdfplumber | [0.11.10](https://pypi.org/project/pdfplumber/0.11.10/) | Evaluation baseline or targeted fallback; do not install a second full extraction pipeline by default. |
| boto3 | [1.43.111](https://pypi.org/project/boto3/1.43.111/) | Keep official S3 SDK. |
| OpenAI SDK | [3.28.0](https://pypi.org/project/openai/3.28.0/) | Keep direct Responses integration; initial model candidate `gpt-6.1-sol`. |
| HTTPX | [0.28.1](https://pypi.org/project/httpx/0.28.1/) | Keep latest reviewed stable release for HTTP and tests; older release date is not evidence of incompatibility. |
| PyJWT | [2.15.1](https://pypi.org/project/PyJWT/2.15.1/) | Keep with [cryptography 50.0.2](https://pypi.org/project/cryptography/50.0.2/); provider-backed access-token verification. |
| uv | [0.13.0](https://pypi.org/project/uv/0.13.0/) | Keep; lock and reproduce Python environments. |
| pytest | [9.1.1](https://pypi.org/project/pytest/9.1.1/) | Keep; behavior, integration, and recovery tests. |
| Ruff | [0.17.0](https://pypi.org/project/ruff/0.17.0/) | Keep; formatting and linting. |
| mypy | [2.4.0](https://pypi.org/project/mypy/2.4.0/) | Keep current stable type checker. |
| ty | [0.0.86](https://pypi.org/project/ty/0.0.86/) | Newer checker evaluated; project explicitly [labels it beta](https://github.com/astral-sh/ty). Not a required gate for v1. |
| OpenTelemetry | [Python SDK 1.45.1](https://pypi.org/project/opentelemetry-sdk/1.45.1/) | Add stable traces/metrics with matching API/exporter versions. Keep normal JSON logging. |
| Docker Compose | [5.6.0](https://github.com/docker/compose/releases/tag/v5.6.0) | Current Compose plugin, `docker compose`; portable local environment. Host Engine/Desktop must be a supported patched release verified in BE-01, not silently upgraded by the agent. |
| GitHub Actions | [Hosted CI and secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use) | Keep; service has no application package version. Pin selected action SHAs and record runner/tool versions in BE-01. |
| Protocols and contracts | [FastAPI native SSE](https://fastapi.tiangolo.com/tutorial/server-sent-events/) | Keep REST/OpenAPI/JSON Schema, OAuth/OIDC, SSE, and OTLP. These are standards selected for behavior, not packages to replace based on age. |

### Alternatives deliberately not selected

- A TypeScript API remains viable, but these source formats and the local document/AI ecosystem make Python a direct fit. The frontend consumes the same language-neutral contract either way.
- LangGraph/Pydantic AI/OpenAI Agents SDK are useful for agent-centric systems. This backend already has explicit stages and Temporal for durable execution; adding another orchestration framework now would duplicate responsibilities. Use the provider SDK and typed task outputs first.
- The newer OpenAI Decisions API is explicitly public beta in its official documentation. It is a possible later experiment for narrow classification; it is not a required replacement for Responses-based research/drafting or deterministic scoring. [Current status](https://developers.openai.com/api/docs/guides/decisions).
- Docling's built-in OCR and additional formats do not automatically expand the agreed upload scope. Expose new capabilities only after source-specific acceptance tests and a product scope change.
- A new vector/graph store or Kubernetes cluster is not justified by the current file volumes and deployment needs. Reconsider retrieval infrastructure after measured recall/latency failures and orchestration infrastructure after a real hosting requirement.

### Version and dependency gate

BE-01 must resolve this starting set on the actual Linux deployment architecture, check Python and binary-wheel support including Docling's transitive ML dependencies, run package import/API/database and workflow-service connectivity smoke checks, and record any version deviations with their reason. Full workflow behavior is verified in BE-04. Build the shared lockfile once and use frozen sync in CI. Avoid beta/RC/nightly dependencies by default; inspect project maturity rather than trusting version syntax alone. Pin runtime/container digests, workflow SDK/server compatibility, parser model revisions, and action SHAs. A newer patch may replace a reviewed version only after compatibility and regression checks. Verify dependency advisories and licenses in the normal dependency review; this source review is not a security certification.

The review changes technology choices and acceptance details inside the existing **four epics and sixteen story PRs**. It does not add a separate infrastructure epic or authorize provisioning paid services.

## Input findings that change the implementation

The inspected Drive dataset is the local copy under `doc/googledrive`; it was not compared with the live folder for freshness. Source samples were read locally without modification. The detailed feedback text must remain private.

- The three feedback workbooks share `Feedback_Explorer` and twelve columns, including `ID`, `Source`, `Country`, `Derivate (e-code)`, `Engine Type`, `Feedback Type`, `Customer Feedback`, and VFC classification columns. Preserve misspelled source headers through a versioned alias map rather than changing originals.
- Repeated rows are different annotations of a feedback record. A record can contain several topics and both praise and complaints. Preserve all annotation locators while counting the record once per scope. Missing classification does not mean neutral or positive sentiment. Equal text under different IDs is not enough to merge independent records.
- Local regression baselines, excluding headers: F70 has 4,076 annotation rows and 2,128 distinct `(Source, ID)` keys; G60 has 5,005 and 4,000; G70 has 4,690 and 4,000. US-scoped record totals are respectively 0, 3,610, and 3,792. These are feedback-record counts, not verified people counts. No same-key conflicting feedback text was found within these individual workbooks. Treat these totals as sample checks, not hardcoded parser rules.
- `F70_G60_G68_G70_customer_studies.xlsx` has two fundamentally different layouts: `CN_EU_2025` uses multirow country/vehicle headers and alternating topic/mean rows; `US_2025` uses topic blocks with rating categories and fractions. Its `Sample total` values of 1 are proportion bases, not one respondent. Numeric sample sizes are not supplied by that label. Carry unknown sample sizes explicitly.
- `sales_volumes.xlsx` has derivative sheets and wide year columns for 2024, 2025, and 2030. Preserve actual zero values, distinguish future-year context from historical values, and keep the combined `G60_G68` scope. Do not assign combined sales to one derivative or use sales as feedback denominators.
- The option-list PDFs have 23, 28, and 27 pages for F70, G60, and G70 respectively. Their German-market context and July 2026 editions must not silently establish US or earlier equipment availability. Standard/optional symbols, model columns, package conditions, and footnotes require layout-aware interpretation.
- The 434-page annual report has extractable text. Index it by page and section, then retrieve relevant strategy/market passages; do not send the entire report into every prompt. Corporate strategy is context, not proof that a proposed vehicle change is feasible.
- The two-page hackathon briefing is image-only. It was visually inspected as product context. General OCR, PPTX ingestion, and image ingestion are outside the initial customer-upload support matrix; reject unsupported uploads clearly and continue with usable sources.

Use **G60 / US** for the first complete evidence demo, subject to the frontend's available baseline asset. Its feedback and US study align; the German equipment PDF remains scoped context until US applicability is verified. Use F70 as the second-derivative reuse check. Vehicle asset availability must remain explicit.

The original full plan says organizer data and extracted private content should stay outside tracked code. Some supplied files are already tracked despite the current ignore entry. Leave those existing files/history untouched in this planning task; during implementation keep new uploads, extracts, provider recordings, and exports outside Git and use synthetic CI fixtures. Any cleanup of existing tracked inputs is separate from implementing these stories.

## Delivery rules for the orchestrator

1. Read this document, `plan.md`, `backend_plan.md`, and any applicable `AGENTS.md`. Work only in `backend/`, backend-owned `contracts/`, and specifically necessary documentation/CI files. Do not change `frontend/`, renderer implementation, scene geometry, or unrelated working-tree changes.
2. Complete one story at a time in the order below. Branch from the latest merged `backend`, using `be/BE-01-contracts`, etc. A story is the PR boundary; an epic is a milestone, not a giant PR. Do not open sixteen overlapping branches in advance.
3. Use the listed commit slices. Each slice gets its own coherent commit with its relevant check; combine code and its regression test when separating them would leave a broken commit. Do not create a PR per helper, file, or test.
4. Use commit subjects such as `feat(backend): BE-05 normalize feedback annotations`. Use PR titles such as `[BE-05] Normalize feedback without inflating counts`. Every PR targets `backend`, never `main`. Include the story ID, resulting behavior, validation evidence, migrations, contract changes, and remaining limitations.
5. Preserve these small commits using a merge commit rather than squash, provided repository policy permits it. If policy requires squash, report that it conflicts with preserving individual commits; do not silently change the requested workflow. Do not force-push or bypass protections.
6. Run checks, review the complete diff, and resolve findings before merge. Merge only a verified head with passing required checks and applicable repository reviews. Confirm the PR is merged and refresh `backend` before advancing. Register created/worked-on PRs with the thread's PR-linking tool when available.
7. Maintain `backend/delivery_status.json`, starting in BE-01, with each story's status, branch, PR URL, tested commit, merge SHA, and blocker. PR/merge metadata may be reconciled on the next branch; repository/PR state is authoritative after a crash. Never mark a story done solely because an agent reports success.
8. On resume, inspect the ledger, Git state, and existing PRs before creating more work. Reuse the existing story branch/PR. If blocked by credentials, assets, or deployment access, finish independent implementation and record the exact outstanding live gate. Do not present a stub or fixture as a live integration.

All sixteen stories start **not started**. This planning task does not launch the implementation, create sixteen issues, or open implementation PRs.

## Epic 1  Backend foundation and shared contracts

Outcome: the frontend receives stable schemas immediately; authenticated uploads and runs survive API/worker restarts. Stories BE-01 through BE-04, in order.

### BE-01  Publish the contract and runnable backend shell

**User outcome:** the frontend developer can build against agreed payloads while the backend grows. Dependency: none.

**Commit slices:** (1) Python package, dependency compatibility record and lockfile, API health endpoint, Compose with local Temporal, example configuration, and initial delivery ledger; (2) Pydantic wire models, all planned route signatures, generated OpenAPI/JSON schemas, and contract generation command; (3) synthetic scene/renderer contract fixtures and CI schema checks for all ten named scenarios in `plan.md`.

**Acceptance:** the version and dependency gate above passes, and a clean checkout starts the API, PostgreSQL, and local Temporal with documented commands. Record the actual Python, package, container, Compose, and workflow-service versions tested. Verify connectivity and SDK imports without claiming the future pipeline already works. Every application operation in `plan.md` has a schema, including errors, pagination, idempotency headers, and proposal versions. Fixtures validate, reference consistent IDs, and use `contract_version: "1"` and snake_case. Implemented and pending endpoints are distinguishable; no placeholder returns fabricated success. Generated contract drift fails CI. The scene catalog is synthetic until the frontend supplies its versioned catalog. Introduce no frontend build dependency.

**Frontend handoff:** publish `contracts/openapi.json`, renderer schema, catalog example, scenario fixtures, base URL, and development identity/CORS conventions. Review shared changes with the other team through the established repository workflow.

### BE-02  Add persistence and access control

**User outcome:** a PM can access only their workspace's data and actions have reliable identity. Dependency: BE-01.

**Commit slices:** (1) SQLAlchemy models and migrations for workspace membership, runs, sources, audit, commands, dispatch outbox, and events; (2) OIDC/OAuth access-token verification, workspace authorization, request IDs, error envelopes, and guarded local identity mode; (3) append-only audit writes, database-backed authorization checks, and stable OpenTelemetry trace/metric setup.

**Acceptance:** migrations apply to empty and prior-version databases. Forged, expired, wrong-audience, ID-token-as-access-token, and unauthorized tokens fail; JWKS rotation works under the documented cache policy. Every resource lookup is scoped by server-verified membership, including nested IDs. The client cannot set authoritative actor identity. Mutations and their audit events commit together; service/AI actors are distinct from PMs. Production configuration rejects development authentication. Logs and traces exclude raw customer text and secrets. Trace/metric export is configurable and exporter failure cannot fail a business operation.

### BE-03  Store and validate uploads

**User outcome:** a PM can upload a partial evidence package and retain exact originals. Dependency: BE-02.

**Commit slices:** (1) multipart upload validation, file hashing, immutable source versions, and local private storage; (2) format inspection, per-file ready/rejected outcomes, limits, and safe cleanup of failed writes; (3) authorized audited downloads and configurable private S3 storage with contract tests.

**Acceptance:** `POST /uploads` supports the supplied XLSX and text-PDF families. Corrupt files, unsupported formats, password-required files, image-only PDFs, excessive file/page/archive sizes, and misleading extensions have explicit outcomes. Originals cannot be overwritten by filenames. No macros, formulas, or embedded instructions execute. Repeated upload commands return the same results; reused keys with changed bodies are rejected. Workspace boundaries hold for upload IDs and downloads. An unsupported companion does not discard valid files. Verify the selected production storage before deployment.

### BE-04  Run durable workflows and replayable events

**User outcome:** a PM can start a run, follow progress, and reconnect without losing work. Dependency: BE-03.

**Commit slices:** (1) vehicle catalog validation, frozen manifests, and atomic command/outbox creation; (2) idempotent outbox dispatch, Temporal workflows/Activities, bounded retries/timeouts, heartbeats, and reusable stage outputs; (3) coherent snapshots, FastAPI-native persisted SSE, replay expiry, available actions, and workflow recovery/replay checks.

**Acceptance:** `GET /vehicles`, `POST /runs`, snapshot, and events follow the contract. Source ownership, ready state, and asset/catalog compatibility are checked. Market hints do not create evidence. Commit each accepted command, its audit record, and dispatch intent in one PostgreSQL transaction. Dispatch starts a stable workflow ID derived from the command; retries after lost acknowledgements cannot start a second logical execution. A Temporal outage leaves commands queued for recoverable dispatch. Killing a worker after a committed Activity output and before acknowledgement causes no duplicate application effects on retry. Temporal does not make arbitrary external side effects exactly-once; deduplicate writes and record uncertain provider attempts. Keep workflow logic deterministic and perform IO/AI/parsing only in Activities. Persist references in workflow history rather than full feedback/files; bound history growth and test continued execution if needed. Prove replay safety and a compatible code-change path for in-flight workflows using supported versioning/patching. Concurrent application writers preserve monotonic per-run event sequences and a coherent snapshot watermark. Reconnect supports `Last-Event-ID`; expired cursors trigger defined snapshot recovery. Authenticate SSE using the agreed fetch-stream bearer-token approach; no tokens in URLs. Analysis and render states remain separate. Trace command dispatch through the test Activity. A test stage proves recovery; real analysis becomes available in Epic 2.

**Epic gate:** an authenticated synthetic run survives restart and reconnect; schemas and fixtures are usable by the frontend.

## Epic 2  Trusted source ingestion and findings

Outcome: the actual supplied formats produce traceable findings and defensible counts. Stories BE-05 through BE-08, in order.

### BE-05  Normalize feedback and preserve annotations

**User outcome:** feedback volume is reliable even when a record has many topic annotations. Dependency: BE-04.

**Commit slices:** (1) configurable feedback header mapping and exact row/cell provenance; (2) logical record identity, annotation membership, duplicate-upload handling, and overlap tracking; (3) coverage reporting, country/cohort mapping, and parser regression cases.

**Acceptance:** parse the shared twelve-column workbook format without vehicle-specific code branches. Logical identity includes dataset namespace, source namespace, and external record ID; IDs from unrelated datasets never collapse. Proven repeated uploads retain lineage without increasing counts. Conflicting content under the same scoped ID becomes an explicit conflict. Identical text under different IDs remains separate absent supporting identity evidence. Retain all annotations and original classifications, including blanks and unknown engine codes. Germany/Europe and other overlapping cohorts use set membership, never summed totals. The synthetic suite includes repeated annotations, independent equal text, shared IDs across namespaces, header aliases, and overlapping files; the local private sample audit supplies the exact real-file expectations.

### BE-06  Normalize studies and sales context

**User outcome:** aggregate research and market context inform proposals without becoming invented feedback records. Dependency: BE-05.

**Commit slices:** (1) CN/EU topic/mean parser with scoped country/vehicle headers; (2) US question-block/rating parser with units, fractions, and missing sample sizes; (3) wide-year sales parser and typed context joins.

**Acceptance:** both study layouts retain source cells, topic, metric, country, derivative, year, value, unit, and known denominator. Blank/spacer rows and trailing vehicle-name spaces do not corrupt blocks. Fractions and means remain different metric types; `Sample total = 1` is never treated as one person. Validate percentage ranges and totals with documented rounding tolerance; flag anomalies rather than silently normalize them. Preserve zero sales, unknown values, combined G60/G68 scope, and future-year uncertainty. Study/sales data cannot increase uploaded-comment counts. Unknown or changed layouts produce a mapping/coverage outcome rather than guessed semantics.

### BE-07  Extract equipment and strategy evidence

**User outcome:** baseline and strategic claims can be opened at the exact supporting document location. Dependency: BE-06.

**Commit slices:** (1) pypdf preflight plus bounded Docling extraction with page, region, section, parser/model revisions, and preloaded model artifacts; (2) equipment tables with option codes, derivative columns, standard/optional symbols, conditions, and footnotes; (3) annual-report section retrieval and a measured accuracy/resource check against rendered source pages.

**Acceptance:** inspect extracted samples against rendered pages, including a multi-model option table and its legend. Compare Docling outputs with a small manually verified reference set and, where useful, pdfplumber; record table/cell association errors, locator accuracy, duration, and peak memory. Correct source association is mandatory; add a targeted fallback only for demonstrated failures, preserving parser provenance. Docling model downloads do not occur on user requests, and resource exhaustion has a bounded failure outcome. Preserve the original German passage separately from any English interpretation. An ambiguous symbol or broken table alignment yields unknown availability, not a confident feature claim. Capture the July 2026 edition and German scope; reject automatic applicability to US or earlier baselines. The 434-page report processes in bounded batches and supports exact-page retrieval. Parsing failures remain source-specific and visible. Regulatory/engineering/pricing content is not converted into out-of-scope product requirements. Source reads are authorized and audited. Docling support for other formats does not silently enable them.

### BE-08  Produce observations, findings, graph, and part counts

**User outcome:** the frontend can display real findings, evidence links, and correctly weighted car tags. Dependency: BE-07.

**Commit slices:** (1) structured AI observation extraction with model/prompt versions, bounded batches, and recorded outcomes; (2) consolidation, support/opposition links, and catalog-based semantic part mapping; (3) paginated finding/graph/evidence endpoints and deterministic aggregate events.

**Acceptance:** multi-topic records create separately traceable observations; positive feedback and disagreements survive grouping. VFC labels are hints, not physical part IDs. Unknown, parent-area, multi-part, digital, and vehicle-wide mappings are supported. Validate AI IDs and quoted spans against supplied evidence; refusal, truncation, invalid output, and exhausted retries have explicit coverage/failure outcomes. Malformed output cannot publish. Counts use distinct logical records per part/cohort/finding; the overall count is a distinct union, never the sum of tags. Publish negative count, denominator, share or null, low-evidence state, provisional flag, and a versioned scale fixed across comparable run filters/variants. External research never changes these counts. Changing extraction policy records a new version rather than claiming bit-for-bit LLM reproducibility.

**First real integration gate:** upload a real supported workbook through the API, create a run, retrieve a finding and its original evidence, replay updates, and map an agreed part ID in the frontend. Verify the renderer contract against the supplied stub fixture now; renderer lifecycle implementation remains BE-14. Record any unavailable frontend/stub dependency explicitly.

## Epic 3  Research and prioritized proposal generation

Outcome: autonomous and guided processing yield coherent, explainable requirements and variants. Stories BE-09 through BE-12, in order.

### BE-09  Establish applicable baselines and customer needs

**User outcome:** proposals address a customer need without blindly proposing existing or irrelevant capabilities. Dependency: BE-08.

**Commit slices:** (1) evidence role/applicability checks and source-scoped baseline records; (2) need classification, preservation of strengths, and capability/usability/offering/service distinctions; (3) bounded baseline verification and explicit gaps.

**Acceptance:** vehicle, market, date, equipment, and software mismatches remain visible. A German option listing cannot validate US availability. An isolated possible defect stays distinguishable from a population-wide product need. Missing baseline evidence produces an unknown state; it does not imply absence. Standard mode can make bounded checks of a specific claim but never launches systematic competitor research. Every inference names its basis and uncertainty; future assumptions use a configurable planning horizon rather than masquerading as current facts.

### BE-10  Implement bounded Deep Dive research

**User outcome:** optional research improves solutions while preserving honest limitations. Dependency: BE-09.

**Commit slices:** (1) focused questions, competitor scope, configured search/source/time/token budgets, and research job states; (2) source retrieval, exact supporting passages, typed claims, provenance, and counterevidence; (3) candidate assessment, immutable research bundles, and timeout/partial completion.

**Acceptance:** off creates no research jobs. On moves through the specified research states. Capabilities, opinions, and system inferences are distinct; URLs, publishers, known publication dates, retrieval times, and vehicle/market context are retained. Search snippets alone cannot prove a capability. Syndicated material is not independent corroboration. Compare approaches to the underlying need and preserve strengths. Verify passages against fetched content; unsupported claims become gaps. Retrieval rejects unsafe schemes/private-network destinations, including redirects, and enforces byte/time limits. Retrieved instructions cannot control application actions. Timeouts, rate limits, unavailable tools, and exhausted budgets retain partial evidence and allow proposals to finish. Completed proposals bind a fixed research snapshot; late results cannot silently change them. External opinions never affect customer-feedback counts.

### BE-11  Resolve conflicts and create scoped variants

**User outcome:** regional and preference differences become coherent alternatives rather than arbitrary averages. Dependency: BE-10.

**Commit slices:** (1) context-aware conflict ledger and compatible cohort membership; (2) autonomous alternatives with a versioned initial limit of four; (3) durable guided checkpoints, outbox-dispatched Temporal messages, and idempotent continuation effects.

**Acceptance:** differences caused by equipment, software, or usage are distinguished from comparable opposing preferences. Autonomous mode never waits for an ordinary conflict decision. Guided mode persists the actual pause; only the matching checkpoint version resumes once. Validate and commit continuation commands in PostgreSQL before dispatching them to the waiting Temporal workflow. Deduplicate command IDs at the receiving workflow; a signal-delivery acknowledgement is not proof that continuation finished. A worker/service restart during the wait or message delivery preserves the checkpoint and its single logical effect. Repeated continuation returns the same effect and stale/mismatched commands fail. Shared findings and overlap-safe cohort membership carry into variants. Labels such as China/US cannot create missing regional evidence. Preserve conflicts beyond the initial alternative limit for later PM requests.

### BE-12  Generate and score immutable proposals

**User outcome:** a completed run contains measurable requirements with transparent ranking and evidence. Dependency: BE-11.

**Commit slices:** (1) requirement/change drafting with outcome, target basis, horizon, maturity, validation, and traceability; (2) deterministic versioned scoring and uncertain-factor scenarios; (3) atomic proposal-set publication, variant queries, and readiness events.

**Acceptance:** each requirement/change contains the required shared-contract fields, supporting/opposing evidence, baseline, origin, conditions, metric/unit, target or explicit unknown, and validation method. Proposed numbers are not marked validated. Use provisional impact/breadth/gap/future-relevance weights 35/25/20/20 with documented factor scales and normalization; label them product defaults rather than BMW rules. Unknown factors remain incomplete or scenario-based, never silently zero or renormalized. Same factors/policy produce the same scores and ordering, with a stable tie-break. Evidence strength is separate from priority. Distinct policy versions do not silently alter old scores. Proposal sets bind source/research/config versions, publish atomically, and expose unresolved gaps. Autonomous completion does not fabricate PM approval.

**Epic gate:** standard autonomous, Deep Dive success, Deep Dive partial, and guided conflict scenarios run through to proposals via the real API. At least one configured live AI run is required to call the AI integration verified; synthetic CI alone is insufficient.

## Epic 4  PM control, renderer handoff, and delivery

Outcome: the PM can refine, decide, visualize, and export exact versions; the backend is ready for integration. Stories BE-13 through BE-16, in order.

### BE-13  Apply PM edits and decisions with version control

**User outcome:** a PM can edit, add, remove, regroup, or decide without destroying evidence or prior work. Dependency: BE-12.

**Commit slices:** (1) all six typed instruction operations and atomic stale-version checks; (2) affected-stage recomputation, preserved earlier versions, and new proposal publication; (3) approve/reject/defer/select actions and paginated audit history.

**Acceptance:** handle `edit_change`, `remove_change`, `add_change`, `edit_target`, `regroup_variants`, and `request_more_variants`. Edits to the same base version cannot both overwrite the current proposal. `409 stale_version` returns the current version without partial effects. An accepted command/job is durable and retries do not duplicate changes. Removing a change does not remove customer evidence. PM-added unsupported ideas have `origin: pm`. Source extraction remains reusable; regenerate only affected dependencies. Reuse current research; an unanswered new question becomes a visible gap. Old proposals remain queryable during recomputation. Decisions bind exact versions; changing a requirement does not inherit an old approval as approval of the new content. AI actors cannot perform human decisions.

### BE-14  Orchestrate Reimagine through the renderer contract

**User outcome:** the PM can request concepts and understand supported, partial, failed, and outdated results. Dependency: BE-13.

**Commit slices:** (1) immutable render manifests and authenticated renderer submission; (2) Temporal durable polling timers, idempotent submission Activities, bounded retries, attempt history, and per-change results; (3) version-bound asset access and stale-result protection.

**Acceptance:** implement render create/get/retry operations and exact input validation. Reimagine is explicit. The request includes baseline/catalog, proposal version, variant IDs, stable change IDs, affected parts, visual instructions, preservation constraints, and evidence IDs. Submit retries use the same immutable identity; mismatched renderer results are quarantined. Digital changes can be annotated; unsupported geometry remains a proposal with a stated limitation. Mixed outcomes return partial status. Render failures preserve proposals. An old result cannot replace the current version's assets. Service secrets remain server-side. Test against the frontend-owned stub and switch to the real service by configuration; backend tests may fake HTTP responses but do not implement a competing renderer.

### BE-15  Export exact versions and complete the audit trail

**User outcome:** a PM can share a proposal package that matches what was actually reviewed. Dependency: BE-14.

**Commit slices:** (1) exact-version export commands, persisted manifests, and jobs; (2) JSON and XLSX outputs with requirements, variants, factors, evidence references, decisions, and history; (3) authorized downloads, export/access audit, and reconciliation checks.

**Acceptance:** exports bind selected proposal/variant versions, source/research snapshots, scoring policy, render references if present, and a decision/audit cutoff timestamp. Later decisions cannot mutate an already-issued file. Numeric values remain numeric, unknowns remain explicit, and untrusted spreadsheet text is escaped against formula injection. Avoid live external workbook links. Exported counts/scores/IDs reconcile to the versioned database state. Retried commands produce one logical export; artifacts survive restart and remain private. Old-version exports remain available according to the configured retention policy. JSON and XLSX are the initial agreed formats; PDF/DOCX are not implied.

### BE-16  Verify the full backend and hand it over

**User outcome:** the frontend team receives a reproducible backend with known capabilities and demonstrated recovery. Dependency: BE-15.

**Commit slices:** (1) the complete API acceptance suite, Temporal replay tests, and crash/concurrency/security regressions; (2) private real-data evaluation command, synthetic demo seed, and OpenTelemetry latency/cost/coverage reporting; (3) deployment image/configuration, Temporal namespace/worker setup, health/readiness checks, recovery runbook, and frontend handoff documentation.

**Acceptance:** all ten named shared scenarios pass against actual endpoints with external fakes clearly identified. Run both study layouts, all three feedback profiles, sales context, option PDFs, and a second derivative through the supplied private data check. Exercise simultaneous edits, repeat commands, worker death, missing credentials, malformed AI outputs, parser limits, provider timeout, partial renderer results, and expired replay cursors. Verify no cross-workspace access across every resource family. Benchmark counts, parser time and peak memory, stage latency, provider tokens/cost when available, and resumability on a declared machine; report results rather than invent performance claims. Test Temporal unavailability, outbox redispatch after lost acknowledgements, guided-wait recovery, and replay after a workflow code update. All published evidence references must resolve, and fabricated citations/approvals or inflated counts are release blockers. Review a bounded sample for useful grouping, correctly scoped baselines, plausible targets, and preserved counterevidence; retain private evaluation results outside Git. A clean checkout can migrate and start services with documented commands, synthetic fixtures, and no embedded secrets. Exercise configured live identity, storage, Temporal, AI/search, OTLP telemetry export, and real renderer integration before declaring those integrations ready. Record unavailable dependencies as outstanding gates. Do not change or deploy the frontend.

**Final backend gate:** all story PRs merged into `backend`; contracts current; backend checks passing; limitations and live-integration evidence documented. Full-application acceptance additionally requires the other team's UI, assets, and renderer checks. Merging `backend` into `main` or deploying infrastructure is a separate release action.

## Cross-story completion checklist

Each story PR must satisfy the applicable checks before merge:

- Lint/type checks and meaningful behavior tests pass on the PR head. Test observable behavior and edge cases rather than mirroring helper implementations.
- Migrations work from the previous story's schema; interrupted operations preserve data and can be retried safely.
- Workflow changes replay recorded synthetic histories safely and follow the supported deployment/versioning strategy. No unversioned change strands an in-flight run or guided pause.
- Every new mutation has authorization, validation, idempotency, version handling where needed, and audit behavior.
- Public schemas, examples, state transitions, and error envelopes remain compatible with the frontend contract.
- Runtime configuration and start/test instructions are updated; new dependencies are locked; secrets and private input derivatives are absent from the diff.
- Record what was tested with fakes and what was verified live. Missing live dependencies do not become silent successes.

Suggested commands after BE-01 establishes them: `uv run ruff check .`, `uv run mypy app`, `uv run pytest`, and `uv run python -m app.contracts --check`, run from `backend/`. The orchestrator must use the actual commands delivered by BE-01 rather than assume these exist today.

## Configuration dependencies and scope boundaries

- Before BE-02 live auth verification: supply the identity issuer, audience, and workspace membership convention agreed with frontend. Local development remains available through the guarded mode.
- Before BE-04 hosted workflow verification: supply the Temporal endpoint, namespace, service authentication, and required retention/data-handling settings. Local development and replay testing proceed without purchasing a service. Do not substitute a development Temporal server for production; if Cloud is unsuitable, document and verify the self-hosted operational deployment before claiming readiness.
- Before BE-08 live inference: supply the deployment-approved API endpoint/model and credentials, with the provider's applicable data handling configuration. Keep credentials in environment/secrets storage. Do not use the coding-agent subscription as an assumed application API entitlement.
- Before BE-10 live research: verify that the chosen endpoint/model supports the research tools and configure budgets. Tool unavailability is a visible research outcome, not permission to fabricate results.
- Before BE-14 real rendering: obtain the frontend team's versioned vehicle/part catalog, available assets, renderer URL, and service authentication. Synthetic IDs must be visibly synthetic until replaced.
- Before deployment: select hosting region, private storage, backup/restore and retention settings, and HTTPS/identity configuration. Container delivery can complete before a hosting account is selected; a production-readiness claim cannot.
- Initial uploads include the existing local Drive files. Live Drive browsing/import, scheduled ingestion, continuous monitoring, new-source reanalysis, graph/vector infrastructure, custom account management, full OCR, and engineering/regulatory/pricing workflows remain outside this delivery scope.

## Orchestrator starting brief

> Implement the sixteen stories in `backend_execution_plan.md` sequentially, beginning with BE-01. Preserve the product and wire contract in `plan.md` and the scope in `backend_plan.md`. Build only backend-owned code and shared contracts. Use the user's selected coding model after resolving its exact orchestration ID. Branch each story from the latest merged `backend`; make one commit per coherent small slice, one PR per story, and preserve commits when merging into `backend` subject to repository policy. Verify behavior and review the diff before merging. Update the delivery ledger and check remote PR state on resume. Never count annotation rows as independent feedback, infer absent market evidence, fabricate source support or PM approval, overwrite prior versions, or present mocks as working live integrations. Finish independent work when an external dependency is absent, and identify the precise remaining gate. Do not build the frontend or renderer, expand deferred scope, merge into `main`, or deploy infrastructure as part of this brief.
