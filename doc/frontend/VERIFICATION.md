# Frontend verification handoff

10 October 2026. Frontend-owned F1–F6 interactions and recovery paths are implemented and verified against the published application contract. Live-system acceptance remains externally blocked. Controlling scope: [frontend_plan.md](../../frontend_plan.md), [plan.md](../../plan.md), [backlog.md](../../backlog.md). No backend, renderer service, provider, auth infrastructure or deferred comparison/pitch scope was added.

| Package | Passing tests at package gate | Detailed evidence |
|---|---:|---|
| F1 | 79 / 9 files | [API/setup/recovery](F1-VERIFICATION.md) |
| F2 | 142 / 14 files | [Workspace/graph/evidence](F2-VERIFICATION.md) |
| F3 | 210 / 18 files | [Research/conflicts](F3-VERIFICATION.md) |
| F4 | 309 / 26 files | [Editing/history/export](F4-VERIFICATION.md) |
| F5 | 345 / 29 files | [Scene/render assets](F5-VERIFICATION.md) |
| F6 | 387 / 34 files | [HTTP integration/browser/clean checkout](F6-VERIFICATION.md) |

Every package passed relevant tests, typecheck, production build, diff checks, applicable native browser checks and separate sub-agent review before dependent implementation. Available GitGuardian PR checks passed for F1–F5; F6 records its check after opening. There is no configured frontend CI workflow. PRs remain open and stacked; no merges authorized or performed.

The [requirement ledger](ACCEPTANCE.md) maps every frontend requirement and all ten shared scenarios to code, tests and dependencies. F6 verifies actual HTTP/SSE using the real adapter, not fetch stubs, plus the complete real-mode UI chain and native desktop/mobile browser failure/recovery. Clean checkout installation/test/build/start uses documented commands without secrets.

Frontend fixtures do not analyze uploads, research externally, generate geometry or certify approval/validation. No backend listener was reachable on documented localhost port; current read-only backend handlers remain 501. Missing research dates, variant limits, immutable historical count/research content and preservation validation are disclosed. Exact assets/mesh mappings remain unavailable or unverified as recorded in [model coverage](MODEL-COVERAGE.md). See [F6 external acceptance](F6-VERIFICATION.md#separate-review-and-external-acceptance) for exact affected requirements.
