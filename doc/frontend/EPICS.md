# Frontend epics

| ID | Outcome / deliverables | Acceptance | Depends on |
|---|---|---|---|
| FE-01 | Context, navigation, visual tokens, evidence-linked fixtures | Five destinations; vehicle/market/period visible; responsive and keyboard usable | Shared contracts |
| FE-02 | Exterior/interior viewer, component selection, heat overlay | Named selections sync with UI; red/amber/teal/gray legend; reset; WebGL fallback | FE-01, 3D spec |
| FE-03 | Overview, explorer, comparable periods/markets | Counts and denominators visible; 68→25 displays −43pp and 63.2% reduction; missing comparison handled | FE-01, FE-02 |
| FE-04 | Evidence drawer, Deep Research, Reimagine | Citations and hypotheses separate; prepared results labeled; draft requirement created | FE-03 |
| FE-05 | Requirements review, data/history, exports | Rationale-bound decisions; immutable versions; CSV and print presentation | FE-04 |
| FE-06 | Pitch polish and integration | Build/typecheck/tests pass; desktop/mobile/reduced motion/fallback checked; demo rehearsed | FE-01–05 |

This build implements synthetic local workflows. Later integration replaces fixture adapter with backend-owned parsing, research jobs, identity, persistence, and source locators. Do not claim production approval authority or actual BMW measurements.

Parallel ownership: viewer agent owns `frontend/src/viewer/`; UI agent owns `App.tsx`, UI styles/components and local workflow tests; integrator owns contracts, fixtures, configuration, documentation, and final verification. UI styling must not target viewer internals.
