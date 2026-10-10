# Backend team plan

**Purpose:** Build the evidence-to-proposal pipeline, API, persistence and renderer orchestration.

Read the shared product decisions, API contract and integration checklist in [plan.md](plan.md). The matching consumer is the [frontend team plan](frontend_plan.md). These are two parallel workstreams for one product.

## 1. Ownership and starting point

The backend team owns uploads and source snapshots, parsing, evidence extraction, counts, part mappings, Deep Dive, conflict resolution, variants, requirement scoring, edits, audit, exports, API authorization and durable jobs.

The frontend/3D team owns the application interface, vehicle assets, scene catalog and renderer implementation. The backend calls the renderer through the shared contract; it does not implement car geometry generation.

Start with the contract fixtures and a stub renderer. Implement the API against the same fixtures the frontend uses. Keep the UI's model catalog and renderer's baseline assets connected through stable catalog IDs rather than embedding model-specific rules in pipeline code.

Product defaults: autonomous processing, Deep Dive off unless selected, and an explicit Reimagine button. The scope is market research/needs analysis and product planning. Partial evidence must produce useful results with visible gaps; ordinary conflicts do not block autonomous runs. Guided mode can pause at explicit checkpoints.

## 2. Processing pipeline

### Stage 1: create and scope the run

Save the vehicle context, participation mode, Deep Dive flag, uploads and configuration versions. Assign stable run and source-version IDs. Preserve original files and any known derivative, market, generation, period, equipment and software context.

**Output:** run configuration and input manifest.

### Stage 2: normalize evidence

Parse supported workbook and document structures into typed evidence records. Keep original content and exact locators: workbook/sheet/row/cell, PDF page and relevant region, or web passage and URL.

Resolve reusable mappings, detect overlapping uploads and prevent duplicate counting. A repeated ID across unrelated source namespaces must not automatically be treated as the same record. Separate exact duplicates, repeated annotations and genuinely independent feedback.

Preserve missing or uncertain metadata. Germany and Europe may overlap; cohort membership must be explicit so uploading both does not double-count records.

**Output:** normalized, source-linked evidence and a coverage report.

### Stage 3: extract observations, findings and part mappings

Split multi-topic feedback into observations. Identify the customer task, sentiment, requested outcome, reported issue and relevant car area. Group equivalent observations into findings while retaining disagreements, positive feedback and traceable membership.

Use a shared part catalog with stable IDs agreed with the 3D team. Support parent areas, multiple relevant parts and an unmapped/vehicle-wide category. Do not force a physical location for an app or vehicle-wide software issue.

**Output:** finding graph, tags, counts and provisional progress events.

### Stage 4: Deep Dive, when enabled

Research better approaches to the underlying customer need, including cases where customers express dissatisfaction but cannot specify a solution.

1. Convert the finding into a focused research question.
2. Select relevant competitors using vehicle class, market, model year, equipment and customer task.
3. Research actual competitor capabilities and public experience separately.
4. Verify applicability, source support, independence and counterevidence.
5. Assess candidate approaches against the original need and the selected vehicle baseline.
6. Return supported recommendations, alternatives or an explicit validation gap.

**Output:** a versioned research bundle attached to the finding and relevant parts. The Deep Dive section below defines the research behavior in more detail.

When Deep Dive is off, skip systematic competitor research. Ordinary bounded checks needed to verify a specific baseline or evidence claim may remain part of standard analysis.

### Stage 5: resolve conflicts and form alternatives

Check whether opposing opinions concern the same capability under comparable conditions. Different equipment, software, usage or regional context may explain the difference without a genuine contradiction.

In autonomous mode, generate coherent alternatives and explain the tradeoffs. In guided mode, surface the conflict so the PM can choose a direction or assign cohorts to variants.

Variants share common findings but retain their own scope, assumptions and changes. For example, a combined China/US variant and a Europe variant are valid only when the supplied evidence supports those assignments. A selected label does not create absent regional evidence.

Avoid the combinatorial explosion of every possible combination. Preserve the conflict ledger even when only a small initial alternative set is generated.

**Output:** variant definitions and recorded conflict resolutions or unresolved tradeoffs.

### Stage 6: define and prioritize changes

Check the applicable product baseline before proposing a new feature. Classify each proposal as a capability change, usability improvement, offering/availability change or preservation of an existing strength. Distinguish a customer requirement from a possible individual fault or service issue.

Use Deep Dive evidence when available to assess possible solutions. Produce measurable customer outcomes with target maturity, validation method, rationale and uncertainties.

Calculate priorities reproducibly from a versioned policy. Keep evidence strength separate from priority. An incomplete factor remains unknown or scenario-based rather than becoming zero.

**Output:** complete proposed requirements and change sets for each variant. Autonomous completion means the proposal set is finished, not that every target is validated or PM-approved.

### Stage 7: Reimagine handoff

Bind the request to exact proposal and baseline versions. Send explicit supported changes, affected part IDs and preservation constraints to the visualization service. Receive status, asset references and per-change outcomes.

Digital experience improvements may require annotations or an interface preview rather than altered geometry. Unsupported visual changes remain understandable in the proposal and are reported explicitly.

**Output:** concept assets linked to exact changes and proposal versions.

### Stage 8: explain and refine

Numbered markers use stable change IDs. Each opens the before/after proposal, why it changed, underlying findings, feedback counts, competitor evidence where used, target maturity and assumptions.

Record PM edits as instructions or proposal changes without modifying source evidence. A PM-added idea without customer support is identified as a PM proposal.

Rerun affected stages using the saved evidence. Preserve prior proposal and render versions. Reuse existing research; a new unanswered question becomes a visible gap rather than triggering deferred background monitoring.

## 3. Deep Dive research and evidence

### Research the need, not only the requested feature

A complaint such as difficulty reaching a frequent control should lead to research into easier ways to perform that task. A customer-suggested solution can be evaluated alongside other approaches.

The result should explain:

- What the uploaded customers struggle with.
- How relevant competitors address the same need.
- What sampled owners, reviewers or study participants appreciate or dislike about those approaches.
- Which improvement best fits the available evidence for this vehicle and market.
- Why alternatives were weaker, and what remains uncertain.

### Separate capability facts from preference evidence

Official manuals and specifications can establish feature availability. Owner feedback, independent reviews and usability studies can inform experience and preferences. Neither source type automatically proves the other claim.

Store the URL, publisher, publication date when known, retrieval time, exact supporting passage, vehicle/market scope and claim type. Distinguish source statements from the system's inferences.

Deduplicate syndicated material, retain counterevidence and inspect whether a claim is firsthand experience or marketing. Treat retrieved content as evidence, never as instructions to the application.

Public feedback is a sample. Describe what the reviewed sources support; do not infer what the entire general public prefers from a few posts. External opinions must not increase uploaded BMW feedback counts or car-tag redness.

### Recommendation rules

Assess candidate approaches using relevance to the original need, applicability, source quality, baseline fit, tradeoffs and plausible attainability. Preserve strengths existing customers value. A competitor feature being popular does not automatically make it appropriate for this vehicle.

Recommend the best-supported approach under the stated criteria. If coverage is weak or contradictory, produce alternatives or a validation proposal rather than inventing certainty.

### Bounded execution

Research status is `queued → searching → checking → ready / partial / unavailable`.

Version the limits for searches, sources, duration and retries. On failure or timeout, preserve useful evidence, report the gap and allow autonomous completion. Every proposal records the research snapshot used. Late results cannot silently change completed proposals or rendered concepts.

This initial research is current scope. Continuous source refresh is deferred in [backlog.md](backlog.md).

## 4. Evidence graph, counts and visual meaning

The logical graph connects:

`source version → evidence → observation → finding → requirement → change → variant`

Findings and changes also reference vehicle parts. Research bundles connect competitor claims and public-experience evidence to the relevant findings. Relations distinguish support, contradiction, applicability and simple mention.

Counts use distinct feedback records after deduplication. Do not call them unique people unless reliable respondent identifiers support that claim. One record mentioning two parts may count once for each part, but only once in the overall distinct total.

Provide the UI with:

- Negative-record count for red intensity.
- Total relevant records, negative share and coverage limits.
- A consistent intensity scale across comparable filters and variants.
- Provisional/final status and low-evidence indicators.
- The source membership behind every count.

Missing mentions are not evidence of satisfied customers. Review frequency is not population prevalence. External evidence has its own provenance and counts.

## 5. Requirement quality and prioritization

Each requirement includes:

- Stable ID and version; applicable vehicle, market/cohort and horizon.
- Clear customer outcome and affected parts or experiences.
- Linked findings, supporting sources and counterevidence.
- Metric, unit, proposed target, conditions, baseline when known and validation method.
- Target origin and maturity: proposed, needs validation, validated or PM-accepted as applicable.
- Priority factors, rationales, score or incomplete-assessment state, and policy version.
- Evidence level, future assumptions, uncertainties and decision/proposal status.

Follow the supplied emphasis on specific, measurable, attainable, relevant and timely outcomes. A numerical target still needs a defensible basis. Concept rendering does not validate engineering feasibility.

The earlier impact/breadth/gap/future-relevance policy at 35/25/20/20 can remain a provisional starting point for evaluation. These weights are not prescribed by BMW. Compare alternatives using the same documented policy and expose sensitivity to uncertain factors.

A source's role matters: equipment establishes availability, feedback describes observed experience, a study provides scoped customer context, and sales/strategy data provides broader context. Do not average incompatible sources into false corroboration.

## 6. Backend architecture and ownership

Use one persisted workflow with reusable stages:

`authenticated API → durable job queue → pipeline workers → relational database + original-file storage`

Workers publish progress, graph updates, tag updates and research status to the UI. A separate visualization service consumes change manifests and returns asset references.

AI interprets evidence, proposes mappings where needed, groups observations, researches needs and drafts alternatives. Application code owns deterministic parsing where supported, IDs, deduplication, counts, score calculation, workflow state, permissions and versioning.

A relational database can store typed graph relationships initially. A graph visualization does not itself require a graph database. Select providers and infrastructure against BMW's deployment constraints and measured quality.

### Main persisted objects

- Run, run configuration and source snapshot.
- Original source, source version and evidence locator.
- Observation, finding and finding membership.
- Part reference and part mapping.
- Research job, research bundle and typed external claim.
- Conflict, variant and cohort membership.
- Requirement version, factor assessment and change version.
- PM instruction, selection/decision and audit event.
- Render request, per-change outcome, asset reference and export manifest.

### Execution and version rules

- Run progression: uploaded → processing, including research when selected → proposals ready → rendering → completed.
- Guided pauses and failures have explicit states; autonomous runs do not pause on ordinary preference conflicts.
- Retries do not duplicate evidence, decisions, variants or render requests.
- Edits and render requests identify exact versions.
- A late render belongs to its original version and cannot replace a newer result silently.
- PM edits invalidate affected downstream work, not the entire source extraction pipeline.
- Access, interpretation, automated choices, changes, scoring and PM actions are auditable with actor, time and rationale.
- AI proposals, PM selections and PM approvals remain distinguishable. Autonomous processing cannot fabricate a human approval.

## 7. API and runtime responsibilities

Implement the operations and object fields in [the shared contract](plan.md#shared-integration-contract). Keep wire names, enums and example payloads aligned with that contract.

- Validate source IDs, vehicle/asset compatibility, permissions and immutable run settings before starting a run.
- Publish a coherent run snapshot with a monotonic event sequence. Support event replay and snapshot recovery after reconnect.
- Produce typed graph relations, part counts, research bundles, conflicts, proposal versions and explicit capabilities/actions for the UI.
- Accept PM instructions against an exact base proposal version. Persist the instruction and schedule only affected downstream work.
- Reimagine creates a durable render request against exact versions. Preserve proposals if rendering fails or only some changes can be visualized.
- Enforce idempotency and stale-version handling on mutations. A disabled UI button is not backend validation.
- Keep provider credentials on the server and authorize source downloads and renderer callbacks.
- Record source access and actor identity from server context. Never trust a client-supplied actor to establish audit identity.
- Exports identify exact variants, proposal versions, evidence and decision states.

The API's detailed analysis and render states in plan.md refine the conceptual run progression in this document. A completed proposal and a completed render are separate facts; one run may have several render requests.

## 8. Build work packages

| Package | Deliverable | Independent development path |
|---|---|---|
| B1: API skeleton | Upload flow, vehicle catalog, run creation, snapshot and events | Return shared synthetic fixtures before the full AI pipeline exists. |
| B2: Evidence pipeline | Source normalization, deduplication, observations, findings, part counts and exact locators | Validate with supplied formats and an agreed synthetic scene catalog. |
| B3: Deep Dive | Bounded research jobs, typed claims, source checks and partial-result behavior | Run without UI; publish research states and bundles through the contract. |
| B4: Proposals | Conflict handling, coherent variants, targets, deterministic scoring and immutable versions | Exercise autonomous and guided cases through API requests. |
| B5: Refinement | PM instructions, guided continuation, affected-stage reruns, audit and export | Use command fixtures and stale-version scenarios. |
| B6: Renderer integration | Durable requests, status/results, retries and version-bound assets | Use the renderer stub first, then the team's real service. |
| B7: Evaluation | Evidence quality, reuse, failure recovery and measured PM value | Use the joint acceptance scenarios from plan.md. |

Agree schemas and renderer capabilities at the start. Integrate a thin real upload-to-finding path while the rest is still being built; do not defer all integration until both teams finish.

## 9. Backend acceptance checks

- Fresh supported uploads yield reproducible counts and exact source locations.
- Duplicate IDs/annotations and overlapping regional files do not inflate distinct-record totals.
- A second derivative and changed input headers use reusable configuration rather than new hardcoded workflow branches.
- Partial evidence, unknown markets and unsupported files have explicit outcomes.
- Autonomous runs finish proposals without intermediate PM choices; guided runs resume the correct checkpoint once.
- Research verifies capabilities separately from opinion, preserves counterevidence and finishes with a partial/unavailable status when necessary.
- External opinions never change uploaded feedback counts.
- Every requirement, target and score retains its basis and policy version; unknowns remain explicit.
- PM edits create new versions and preserve source evidence and earlier results.
- Retried commands and render requests do not create duplicates. Stale edits are rejected predictably.
- An old render completion cannot replace the active proposal's result. Unsupported changes remain in the proposal with rendering limitations.
- Event reconnection recovers a coherent snapshot, including after the replay window expires.
- Authorization, source access auditing and exact-version export are enforced server-side.

## 10. Handoff to the frontend team

Deliver a runnable API, documented local configuration with placeholders for secrets, shared contract examples, a synthetic demo package, stable catalog IDs, seeded demo runs, the event/reconnect behavior and a stub/real renderer switch for development.

Document which source formats and rendering capabilities actually work. Provide failure fixtures as well as the successful demonstration. Follow the shared integration checklist before merging the complete application.

## 11. Deferred work and evaluation

Ongoing source refresh, monitoring and automatic reconsideration thresholds remain in [backlog.md](backlog.md). Initial Deep Dive is current scope.

Use all five evaluation criteria from [image6.png](doc/image6.png): explainable decision logic, clear workflow responsibilities, reconstructable audit, useful realistic outcomes, and demonstrated scalability/business impact. No numerical judging weights are supplied.

The source brief is [more.md](doc/more.md); measurable targets are reinforced by [image4.png](doc/image4.png) and [image5.png](doc/image5.png). The shared plan retains the product-wide requirements and full application flow.
