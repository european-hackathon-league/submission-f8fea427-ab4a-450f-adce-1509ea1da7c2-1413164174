# Frontend and 3D team plan

**Purpose:** Build the PM experience, vehicle visualization and renderer integration surface.

Read the shared product decisions, API contract and integration checklist in [plan.md](plan.md). The matching producer is the [backend team plan](backend_plan.md). Both teams use the same contract and synthetic fixtures.

## 1. Ownership and independent development

The frontend team owns the application UI, interaction states, graph display, car navigation, part annotations, evidence panels, variant views, proposal editing, history and export interactions.

The frontend/3D workstream also owns the baseline car assets, scene/part catalog and visualization service implementation. A dedicated 3D teammate may implement that service within this workstream. Backend owns orchestration and calls its contract; model/provider credentials stay server-side even when the service is owned by this team.

Build against a mock API using the exact shared payloads, states and events. Keep a single API adapter so switching from mock to real service changes configuration rather than screen logic. UI components must not perform customer counting, requirement scoring or competitor research independently.

## 2. Main workspace

The initial workspace contains vehicle selection, upload controls, Deep Dive, participation mode and Create run, with the navigable baseline car beside the work area.

- Autonomous is the default participation mode.
- Deep Dive is off by default and can be selected before Create run.
- Allow a partial package, multiple files and multiple regional files.
- Display upload progress, unsupported-file errors and missing coverage without implying that all evidence types are compulsory.
- Show model and asset availability honestly; unsupported models must not silently reuse a differently labeled car.
- Create run uses completed upload IDs. Do not send local file paths as source references.
- After creation, settings shown for the run reflect the saved configuration. A new configuration creates a new run; PM proposal edits use the existing run.

Reimagine remains an explicit visualization button under the current working assumption. The PM does not have to approve each finding or choose each alternative to get proposals in autonomous mode.

## 3. Analysis experience

Show meaningful processing stages from backend state. As findings arrive:

1. Update the graph with typed nodes and links.
2. Place findings on the baseline car using stable part IDs.
3. Show counts and red intensity from backend-provided aggregates.
4. Keep provisional counts visibly provisional until their scope is finalized.
5. Make evidence, findings and history available through panels/toggles.

Preserve selection and camera position when new events arrive. Large graphs should remain navigable with filtering or progressive detail. Keyboard-accessible lists and panels must expose the same findings as spatial markers; interaction must not depend entirely on color or precise 3D clicking.

Use backend `available_actions` and states to render enabled controls, while handling server-side rejection if state changes after the screen loads.

## 4. Car tags, graph and evidence panels

Each tag identifies the relevant part, finding, sentiment and distinct feedback-record count. Red intensity follows negative-record volume using the shared scale returned by backend. Also expose the denominator, negative share, coverage and low-evidence status.

Label counts as feedback records unless the backend explicitly supplies a validated people-based measure. Do not add per-part counts to derive a global count: one record can mention several parts. External competitor opinions must not make the uploaded-feedback tags redder.

Support vehicle-wide and unmapped findings in a visible group. Digital or non-geometric requirements should remain accessible through panels or suitable interface previews.

Clicking a tag opens:

- The customer problem and affected cohort.
- Supporting and opposing observations.
- Exact source references and the source-opening action.
- Current baseline and applicability limits.
- Proposed requirements and target maturity.
- Deep Dive evidence when present.
- Edit, remove or add-proposal actions when available.

Display customer evidence and PM instructions distinctly. Edits change proposals; the UI never rewrites the original customer record.

## 5. Deep Dive experience

Deep Dive starts as part of the run when selected. Display its progress alongside existing findings using `queued`, `searching`, `checking`, `ready`, `partial` and `unavailable` states.

The evidence card for a finding shows:

1. What uploaded customers struggle with.
2. Competitor approaches and verified capability sources.
3. What sampled owners/reviewers value or criticize, with their own sources.
4. Recommended improvement and why it fits the selected vehicle and market.
5. Alternatives, counterevidence and uncertainty.

Distinguish facts, public opinions and system inferences. Retain dates, scope and citation access. A research timeout should yield a useful partial/gap panel while other results remain usable.

This is evidence within the current vehicle workspace. Do not add a separate general competitor or market-comparison dashboard.

## 6. Conflicts and alternative views

In autonomous mode, show completed alternatives and the tradeoffs behind them without blocking progress with a mandatory modal.

In guided mode, the right-side panel can present a backend checkpoint: choose an approach, edit the proposal, or group cohorts into variants. Submit the checkpoint ID and version so continuation cannot apply to an outdated question.

Allow the PM to inspect and request changes to variant assignments. Show scope explicitly; Germany and Europe may overlap, and changing a label must not change underlying counts locally.

Display the backend's initial coherent alternative set and any unresolved conflicts. The provisional four-variant limit is configuration, not a hardcoded UI assumption.

## 7. Proposal editing and Reimagine

Support editing/removing an existing change, adding a PM-originated idea, editing a target and regrouping variants. Submit instructions against the displayed proposal-set version.

After an edit is accepted, show recomputation progress and the new version. On a stale-version response, retain the user's draft, fetch the current version and let them reconcile it. Do not silently overwrite the current proposal or discard a draft.

Reimagine sends exact variant/proposal versions to backend. The UI does not call a generation provider directly. Show queued/rendering/partial/failed/succeeded states and per-change limitations.

An older render may remain inspectable but must be labeled with its original proposal version. A late completion cannot replace the currently selected version's asset.

## 8. 3D service and asset responsibilities

Publish a versioned scene catalog containing vehicle IDs, baseline asset IDs, stable part IDs, parent relationships, anchor/mesh mappings and supported visualization capabilities. Backend maps findings to these semantic IDs; scene internals stay owned by this team.

Implement the renderer adapter contract in [plan.md](plan.md#renderer-contract). Given a manifest, return a request/job ID, status, matching version identifiers, asset references and per-change outcomes.

- Apply only supported requested changes and honor preservation constraints.
- Report unsupported geometry or digital changes explicitly.
- Keep baseline and variant assets independently addressable.
- Make repeated submission of the same renderer request idempotent.
- Provide a development stub using the same contract, including success, partial and failure responses.
- Keep rendering implementation choices within this team; backend integration must not depend on a specific provider or modeling technique.

## 9. Results, history and export

Show each variant's concept and numbered markers. Marker numbers are display labels; stable change IDs are the identity. Clicking a marker reveals before/after, rationale, uploaded evidence, competitor evidence when used, counts, target maturity and assumptions.

Provide proposal/render version history and a readable audit view. Distinguish AI proposals, PM selections and actual PM approvals. “Rendered” does not mean “validated” or “approved.”

Exports are requested from backend with exact versions and downloaded through the returned authorized link. The UI does not reconstruct an authoritative export from partially loaded state.

## 10. Build work packages

| Package | Deliverable | Independent development path |
|---|---|---|
| F1: API adapter and states | Mock-backed run setup, uploads, snapshots and event handling | Shared contract fixtures; no dependency on completed AI processing. |
| F2: Baseline workspace | Car navigation, graph, tags and evidence panels | Synthetic scene catalog and finding fixtures. |
| F3: Deep Dive and conflicts | Research cards, partial results, guided panel and autonomous alternatives | Research/conflict event scripts from the shared fixtures. |
| F4: Editing and results | Version-bound edits, variant selection, numbered explanations, history/export | Proposal, stale-edit and render-result fixtures. |
| F5: Renderer | Scene catalog, manifest consumer, assets and per-change outcomes | Stub first, then real visual generation behind the same interface. |
| F6: Integration | Replace mock adapter with API and exercise joint scenarios | Begin with the first real upload-to-finding path, not only at final merge. |

## 11. Frontend acceptance and handoff

- Autonomous runs reach proposals without required PM decisions; guided runs show only actual checkpoints.
- Deep Dive selection is present before run creation and saved settings are visible afterward.
- The car, graph and evidence panels consistently refer to the same finding/part IDs.
- Provisional counts, missing evidence and unmapped findings remain understandable.
- Standard and Deep Dive results work without a separate comparison workspace.
- Partial research and partial rendering preserve useful results.
- Keyboard access and non-color cues cover core actions and findings.
- Reconnection restores a coherent run without duplicated events or lost user drafts.
- Repeated actions do not create duplicate render requests; stale edits have a visible recovery path.
- Old render results do not replace new proposal versions.
- Numbered markers open the correct version's explanations and source evidence.
- Mock and real API modes use the same contract and can be switched by configuration.

Deliver the runnable UI, scene catalog/assets, renderer or clearly stated supported subset, mock adapter, fixture scenarios, local configuration instructions and passing joint smoke-test results. Deferred product work remains in [backlog.md](backlog.md).
