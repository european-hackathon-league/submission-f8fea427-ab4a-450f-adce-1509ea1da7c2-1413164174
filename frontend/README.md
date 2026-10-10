# Frontend

Local pitch prototype. Run `npm ci`, `npm run dev`; checks are `npm test` and `npm run build`.

Five destinations use synthetic feedback and prepared research. Requirement decisions and versions persist in this browser only. Built-in sample offers guided review → prepared analysis → changes. Arbitrary file upload retains names in the current session; no content is parsed. No backend, live research, identity, or production approval is connected.

The pitch route lazy-loads `src/viewer/BmwAssetViewer.tsx`: hosted 2023 i5 M60 3D (network required) with bundled exterior image fallback, plus a separate static G60 520i cabin photo. No GLB is self-hosted, and mesh-to-component coloring is unverified. See [`../doc/frontend/3D-SPEC.md`](../doc/frontend/3D-SPEC.md) and [`../doc/frontend/MODEL-COVERAGE.md`](../doc/frontend/MODEL-COVERAGE.md).

The rejected procedural study is excluded from this pitch branch and preserved at checkpoint `aae4732` in the separate `pitch-before-plan-polish` worktree. Scope follows [the supplied frontend plan](../doc/frontend/PITCH-PLAN.md); see [scope decisions](../doc/frontend/SCOPE.md).
