# Frontend scope

User direction, 10 October 2026: the frontend must contain only the experience specified by [frontend_plan.md](../../frontend_plan.md). Read [plan.md](../../plan.md) for its shared integration contract. Do not treat older pitch briefs or previous UI implementations as additional product scope.

Keep vehicle selection, uploads, participation mode, initial Deep Dive selection, Create run, baseline car navigation, tags, typed graph, finding/evidence panels, scoped alternatives, proposal editing, explicit Reimagine, numbered change explanations, history and version-bound export interactions within one workspace. Counts, scores and research come from the application API boundary. Unsupported assets and rendering capabilities must remain explicit.

Removed: separate Overview and Compare destinations, period/market comparison modes and baseline-period controls, executive KPI summaries and trends, pitch analysis updates, presentation/print controls, prepared-question research controls, mandatory sample-review steps, browser-owned approval/history state, local requirement scoring, and CSV reconstruction from partially loaded UI state. Obsolete pitch planning documents were removed as well.

Deep Dive evidence stays attached to the current finding. It does not authorize a general competitor dashboard. Regional evidence and variant cohort grouping remain in scope; a separate market-comparison workspace does not. Scheduled imports, source refresh and ongoing monitoring remain deferred in [backlog.md](../../backlog.md).

Default operation is a synthetic mock, with a configurable real API adapter. Server integration and the renderer service are not complete. Current supported assets and limits are documented in [frontend/README.md](../../frontend/README.md). Future additions must map to the controlling plan, and acceptance claims must distinguish mock checks from joint backend checks.
