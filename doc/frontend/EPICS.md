# Frontend epics and integration map

Current state: local pitch prototype; all feedback and research fixtures are synthetic. The selected demonstration context is BMW i5 M60 / G60. It does not establish vehicle-specific customer outcomes or production approval.

| Epic | Current scope | Next gate | Depends on |
|---|---|---|---|
| FE-01 Context and navigation | Five destinations, responsive workspace, market/period/baseline controls. | Bind context to validated vehicle and source records. | Shared context contract |
| FE-02 Vehicle view | Hosted creator-uploaded i5 M60 exterior; bundled preview fallback; separate static G60 520i cabin photo. Component severity appears in HTML list and photo markers; no verified mesh coloring. | Approve matched assets and verify semantic part mapping for each derivative. | Asset/license review, viewer tests |
| FE-03 Insights and comparison | Synthetic component metrics; Europe has 2025/26 comparison, China/US have 2026 snapshots only. Market populations are unmatched. | Connect source denominators, coverage, and comparability metadata. | FE-01, source data |
| FE-04 Evidence and research | Prepared synthetic quotes, explicit stance labels, hypotheses, gaps, and three draft concepts. No live research job. | Add source locators and asynchronous research status/results. | FE-03, evidence contract |
| FE-05 Decisions and data | Rationale-required decisions; prior versions and decisions in browser storage; filtered CSV and print; upload retains file names only for this session. | Add authenticated server audit, import/parsing, and cross-user persistence. | FE-04, backend/auth |
| FE-06 Release checks | 32 tests and production build pass; desktop/mobile, hosted exterior controls, dialog keyboard and decision persistence reviewed. | Verify licensed cabin/mesh mapping, browser offline/reduced motion, print and target-device performance. See verification record. | FE-01–05 |

## Later orchestrator priorities

1. Define vehicle/derivative, market, period, eligibility denominator, evidence locator, and confidence contracts before replacing fixtures. Preserve unknown coverage as unknown.
2. Choose a target derivative; confirm licensed exterior and interior assets, source provenance, and component mapping. Do not equate a cabin photo with an interactive matching-trim model.
3. Replace upload metadata stub with backend-owned parsing and source linkage. Uploaded files must never inherit synthetic findings.
4. Add identity, server persistence, research-job states, and auditable approvals. Browser-local decisions are demo state only.
5. Complete integrated tests and browser review before describing workflow as production-ready.

See [UI specification](UI-SPEC.md), [3D specification](3D-SPEC.md), [asset coverage](MODEL-COVERAGE.md) and [verification](VERIFICATION.md). Styling stays outside viewer internals.
