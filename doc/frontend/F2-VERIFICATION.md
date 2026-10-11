# F2 verification — 10 October 2026

Base: verified `codex/frontend-f1`, PR https://github.com/indkhan/vehicle-requirements-ai/pull/4. Branch: `codex/frontend-f2`. Contracts remain pinned to backend `2d0483fd4d9bb4f95da5b8212db5d78b24a5ac46`.

## Executed gate

- `npm ci`: isolated worktree installation passed.
- `npm test`: **142 tests across 14 files, all pass**.
- `npm run typecheck`, `npm run build`, `git diff --check`: pass.
- Separate agents reviewed API/App/components and viewer/catalog against F2 and failure paths. Fixed with regressions: saved-run asset/catalog mismatch, hierarchy-only component IDs, ambiguous cohort aggregates, opaque finding IDs, first-match selection, changed finding mappings, source-kind labels, native modal focus and finding-navigation focus.

API tests cover opaque vehicle pagination, duplicate/cyclic cursors, separate aggregate cohort scopes, conflicting page data, protected source URL restrictions, runtime headers, deadline, abort, errors and redirect rejection. Component tests cover progressive graph details/search/type filters/keyboard relationships, unknown/ambiguous/removed entities, exact relationship citations, null/zero denominators and separate scoped counts, row-level evidence failure/retry, stale source results, cell/PDF/web locators and safe links. Viewer tests cover catalog hierarchy/mapping validation, unavailable images/retry, null selection, distinct cohort summaries and retained camera coordinates. App tests cover unsupported/non-geometric grouping, saved asset identity, opaque/removed finding selections, mapping updates and keyboard focus.

Browser: in-app WebKit at `127.0.0.1:5182`, 1440×1000 desktop. Created synthetic XLSX run; navigated graph entity → explicit finding by keyboard; inspected exact row/cell/source version/scope. Selected vehicle-wide finding with no spatial part selected. Final browser pass confirmed keyboard finding selection focuses Evidence panel and pointer-opened native source modal restores its exact opener after Escape (DOM focus assertions true). Exterior model and separately labeled cabin reference remain available; third-party model exposes a device-weight warning. Synthetic upload bytes are not analyzed.

## External acceptance

Live findings/graph/evidence and protected original-source acceptance remain blocked by published backend 501 handlers and unavailable localhost backend. Protected download behavior above uses frontend tests, not a live original file. Geometry, exact-trim cabin, verified mesh references and unsupported vehicle assets remain external. No guessed mesh aliases remain; list/photo annotations explicitly disclose their limits. F3–F6 gates remain pending.

Follow-up acceptance check: component tags now open their mapped Evidence panel directly; multiple matches retain explicit selection/choice behavior. Regression included in 142-test gate.
