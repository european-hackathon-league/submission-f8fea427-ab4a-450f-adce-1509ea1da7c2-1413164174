# Frontend handoff

Pitch prototype: BMW.de-inspired white workspace and a dark, interactive vehicle stage. Primary audience: nontechnical product/project managers. All analysis fixtures are synthetic, including longitudinal and market comparisons.

Run: `cd frontend && npm ci && npm run dev`. Checks: `npm test`, `npm run build`. Backend implementation remains independent.

Read [epics](EPICS.md), [UI spec](UI-SPEC.md), [3D spec](3D-SPEC.md). Shared TypeScript interfaces live in `frontend/src/domain/contracts.ts`; fixtures in `frontend/src/domain/fixtures.ts`.

Orchestrator protocol: assign UI and viewer work independently; preserve shared contracts; require focused behavior checks and browser review; integrate only verified commits. Never replace data fixtures with live-looking invented results. Existing approved versions survive new proposals.
