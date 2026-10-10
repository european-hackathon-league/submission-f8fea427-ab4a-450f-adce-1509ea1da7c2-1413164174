# FWD — BMW-inspired vehicle insights workspace

## 1. Product direction

Build polished, clickable pitch prototype for nontechnical project managers.

Core journey: **upload feedback → see affected car parts → compare periods and markets → inspect evidence → Deep Research → Reimagine → approve requirement.**

Success: manager understands what changed, why it matters, and next decision without technical help. Pitch delivers memorable 3D interaction backed by clear evidence.

Use existing product plan’s source tracing, human review, and version history. Frontend develops independently through prepared data and shared backend contracts.

## 2. Visual design and navigation

**Direction: light management workspace surrounding cinematic vehicle stage.** Inspired by [BMW.de](https://www.bmw.de/de/index.html): prominent vehicle imagery, generous space, restrained blue actions, thin dividers, strong typography.

Design defaults:

- White surfaces, soft gray background, graphite text; blue reserved for primary actions and selection.
- Dark neutral vehicle stage with realistic lighting. Heat overlays remain readable.
- Straightforward rectangular controls, subtle rounding, minimal shadows.
- Open sans-serif typography; 16px body text, strong headings, tabular numbers. Use Inter unless team supplies licensed BMW typography.
- Consistent 8px spacing scale; 44px primary interaction targets.
- Brief transitions; respect reduced-motion preferences.
- Professional English interface. Product labels use normal, clear language.

Five navigation destinations:

| Destination | Manager’s question |
|---|---|
| Overview | What needs attention? |
| Vehicle Explorer | Where are customers struggling? |
| Compare | What changed across periods or markets? |
| Requirements | What should we improve? |
| Data & History | Where did findings come from? |

Persistent context bar: vehicle, market, observation period, comparison baseline, latest analysis date. Selected context carries between screens.

## 3. Screens and signature interactions

### Overview

Show concise executive summary, then four indicators: feedback volume, negative-feedback share, largest comparable change, requirements awaiting decision.

Below: vehicle preview, three priority findings, recent analysis updates. Each finding includes plain-language headline, sample size, evidence status, and one next action.

### Vehicle Explorer

Main layout: component list left, interactive 3D vehicle center, selected-component detail right.

- Exterior and interior presets; dashboard and steering-wheel controls must be selectable.
- Click hotspot or component name to focus camera and synchronize detail panel.
- Controls: rotate, zoom, reset view, exterior/interior, heat overlay.
- Default overlay shows negative-feedback share using fixed legend. Comparison mode shows change using separate legend.
- Unknown or unmapped components appear gray and remain listed.
- Detail panel shows trend, counts, customer quotes, source links, and proposed next step.
- Accessible component list provides every action available through 3D.

Use optimized GLB asset with named component mappings. Accept user-supplied model; otherwise use appropriately licensed generic sedan labeled “Illustrative vehicle.” Generic cockpit inset provides interior hotspots if model lacks interior geometry. Static annotated view remains available when WebGL fails.

### Compare

Baseline/current panels share component, metric, and chart scale. Provide period comparison and market comparison as separate modes.

Display:

> “Negative feedback about steering-wheel controls: 68% → 25%. Down 43 percentage points; approximately 63% relative reduction.”

Every percentage exposes numerator, denominator, period, and source population. This example stays labeled synthetic until supported by actual data.

Additional rules:

- Never equate feedback frequency with vehicle failure rate.
- Keep model year separate from feedback collection period.
- Show changed samples or configurations alongside comparison.
- Missing comparable data produces explanation, never invented improvement.
- Observation of lower complaints does not establish that redesign caused improvement.

### Upload and analysis

Guided flow: **add files → review detected context and mappings → analyze → review changes.**

Show recognized records, duplicates, missing fields, and unsupported files. Preserve previous analysis as baseline.

Progress uses named stages. Completion highlights new findings, changed findings, and unresolved gaps. Retry preserves completed work.

Prototype processes documented sample fixtures locally; uploaded unsupported data receives honest “analysis integration pending” state.

### Deep Research

Selected finding opens investigation workspace with editable question and explicit component/market scope.

Suggested questions:

- Why does this component receive more negative feedback?
- Why does the same component differ across markets?
- What changed between observation periods?
- What evidence challenges this interpretation?

Results show summary, supporting evidence, counterevidence, possible explanations, coverage gaps, and recommended validation.

Distinguish **observed association**, **hypothesis**, and **supported explanation**. Provide meaningful progress, cancellation, retry, and unresolved-result states.

### Reimagine

Generate three evidence-linked improvement concepts for selected finding.

Each concept includes customer need, proposed experience, addressed complaints, tradeoffs, assumptions, and validation method. Optional concept image clearly labeled illustrative; concepts never claim predicted complaint reductions.

Manager compares concepts, edits preferred proposal, then chooses **Create draft requirement**.

### Requirements and history

Requirements support search, filters, priority sorting, and approve/edit/reject/defer/challenge actions. Detail view links evidence and explains priority.

Decisions capture rationale and exact version. Later proposals preserve earlier approvals.

Provide presentation mode, executive PDF through print layout, and structured CSV export. Exports retain filters, dates, evidence status, and selected requirement versions.

## 4. Frontend and backend handoff

Default frontend: React, TypeScript, Vite; accessible component primitives, reusable chart components, Three.js vehicle rendering. Pin compatible stable versions during implementation.

Separate screen components from typed data adapter. Prototype uses deterministic fixtures; backend connection replaces adapter.

Agree minimum shared interfaces:

| Interface | Required content |
|---|---|
| Analysis context | Vehicle, generation, market, observation window, dataset/run IDs |
| Component finding | Stable component ID, metric definition, counts, denominator, evidence links |
| Comparison | Baseline/current runs, values, population differences, comparability status |
| Research result | Question, scope, job state, explanations, citations, gaps |
| Improvement concept | Finding links, proposal, assumptions, tradeoffs, validation |
| Requirement decision | Requirement/version ID, action, rationale, actor, timestamp |

Include cancellation/error states and stable source locators. Unknown component mappings stay visible for review. Keep raw supplied datasets outside tracked frontend assets; use synthetic fixtures for distributable pitch build.

## 5. Delivery, quality, and acceptance

Build in sequence:

1. Audit supplied skills list; verify availability and relevance. Resolve missing required skills before their dependent work.
2. Define tokens, navigation, screen wireframes, component mappings, and backend contracts.
3. Build complete fixture-driven workflow, including upload and evidence drawers.
4. Add 3D hotspots, comparison, Deep Research, Reimagine, review, and exports.
5. Polish presentation mode; verify usability, accessibility, and performance.

Use explicit project **7Cs checklist**: clarity, consistency, concision, context, control, credibility, continuity. This is working design rubric, not claimed universal standard.

Acceptance checks:

- Five representative PM-like users attempt core workflow; at least four complete unaided and correctly explain comparison.
- Keyboard users reach every hotspot through component list; drawers restore focus; charts have text equivalents.
- Check WCAG 2.2 AA contrast, labels, focus, and reduced motion.
- Test 1440px and 1280px pitch layouts, tablet stacking, mobile list-first view, and 200% zoom.
- Verify percentage arithmetic, zero denominators, unavailable baselines, changed cohorts, unmapped parts, and insufficient evidence.
- Test failed upload, interrupted research, cancelled generation, WebGL failure, and stale-version decisions.
- Shell usable within 2.5 seconds and vehicle interactive within 5 seconds on agreed pitch laptop; optimize assets against measured results.
- Full pitch path works offline with clearly labeled prepared results. Live and prepared research remain distinguishable.
- Rehearse complete six-minute story: locate problem → compare → inspect quote → investigate → reimagine → decide → export.

**Defaults:** quality over deadline; pitch prototype first; both market and component investigation; improvement concepts as Reimagine output; synthetic longitudinal examples until comparable real data exists. Skills list remains pending and does not block design specification.
