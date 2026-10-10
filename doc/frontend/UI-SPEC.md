# UI specification

Controlling scope is [PITCH-PLAN.md](PITCH-PLAN.md). This concise specification records implementation and data limits; it does not replace that brief.

## Product direction

BMW.de-inspired planning workspace: white canvas, large restrained typography, thin rules, blue actions, squared controls, and an authentic vehicle stage. Keep labels and product copy in normal English. Core demo context: **BMW i5 M60 / G60**. Mark all findings, comparisons, research, and requirements as illustrative or synthetic; do not imply BMW endorsement or measured i5 M60 outcomes.

## Destinations and behavior

Horizontal navigation: Overview, Vehicle Explorer, Compare, Requirements, Data & History. Keep vehicle, market, period, and baseline context visible outside presentation mode. Overview pairs vehicle view with selected-component insight, four context-scoped indicators, analysis updates and three priority findings. Latest prepared-analysis date remains visible. Explorer combines exterior/interior mode, component controls, evidence, and research.

Component selection must stay synchronized across viewer, insight panel, Compare, evidence, and draft creation. Compare separates period and market modes, showing the selected component, period values, denominators, percentage-point change, relative change, and population caveat. Europe supports 2025/26 longitudinal fixtures; China and United States have 2026 snapshots only. Do not compare identical periods or invent missing baselines.

Evidence drawer shows synthetic quotes and their source market/period. Deep Research is a prepared example, not a live job: keep supporting/counter stance tied to each quote; separate hypotheses and validation gaps. Editable research question and market scope expose unsupported questions as unresolved; cancel/retry operates on prepared results only. Reimagine offers three editable, selectable concepts with evidence, assumptions, tradeoffs and validation before creating a visible draft.

Requirement search, status filters and negative-share sorting work together; unavailable scores stay unscored. Approve, edit, reject, defer and challenge require rationale; prior title, status, rationale, and evidence IDs remain inspectable by version. CSV reflects visible filtered requirements, versions, context, analysis date and evidence status. Requirement decisions/history persist in this browser only. Data & History explains fixture provenance and upload limits. Built-in sample follows add → review → analyze → changes. Review explains aggregate mappings and unavailable row checks; arbitrary uploads retain file names only and need backend integration. Presentation reduces chrome; print produces the current destination’s report.

## Data and acceptance

Metric is negative feedback records / eligible records, not failure rate. Show counts with percentages; distinguish percentage points from relative change. Synthetic content and missing data stay explicit. Do not assign fixture outcomes to uploaded files. No identity, backend, live research, or production approval authority is connected.

Accessible controls need labels, visible focus, keyboard use, Escape/return focus for drawers, live status announcements, reduced-motion behavior, and non-color chart equivalents. Empty/error states offer a next action. Charts include text/sample equivalents. Responsive layout must retain component access and readable context.

Before calling the prototype release-ready, run workflow tests and build; verify 1440/1280/390px, keyboard/drawer flows, same-period handling, selected-component comparison, creation under active filters, asset/network fallback, and print.
