# Frontend handoff

Pitch prototype for product and project managers. Current G60 i5 M60 view uses a network-hosted creator model, bundled exterior image fallback, and separate static G60 520i cabin photograph. See [asset coverage](MODEL-COVERAGE.md). All metrics and research are synthetic.

Run from repository root: `cd frontend && npm ci && npm run dev`. Verification commands: `npm test`, `npm run build`. [Primary verification](VERIFICATION.md): 32 tests and production build pass; desktop/mobile and core demo workflow reviewed. Detailed matching-trim 3D cabin remains pending asset rights and inspection.

Read [epics](EPICS.md), [UI specification](UI-SPEC.md), [3D scope](3D-SPEC.md), [vehicle coverage](MODEL-COVERAGE.md) and [cabin candidate research](research/G60-INTERIOR-ASSETS.md). App owns workflow state; viewer uses shared contracts; fixtures and metrics live in `frontend/src/domain`.

Orchestrator order: validate source/context contracts; confirm derivative-matched assets and component mappings; implement backend ingestion/research; add identity and audit persistence; then complete integrated browser and workflow checks. Do not replace synthetic fixtures with live-looking invented findings.
