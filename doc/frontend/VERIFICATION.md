# Frontend scope verification

10 October 2026. Scope source: `frontend_plan.md` and `plan.md` from `origin/main` at `80e328e`, already present on the frontend branch. This is a scope cleanup with a mock API, not joint backend acceptance.

- Automated workflow and adapter tests cover autonomous defaults, Deep Dive configuration, partial and rejected uploads, unavailable assets, frozen settings, feedback-record counts, source locators and focus return, version-bound edits, unsaved/stale draft retention, guided continuation, partial research/rendering, old render labels, command idempotency, duplicate file contents and real-adapter error/header behavior.
- Production TypeScript/Vite build checked.
- Browser reviewed at 1440x1000 and 390x844. No page-level horizontal overflow; reviewed mobile controls had no text overflow. Local exterior preview and cabin image loaded. The hosted exterior model rendered and its camera controls became available.
- Browser workflow: partial upload, autonomous Deep Dive run, typed graph, supporting/opposing observations, exact source dialog, PM edit to proposal version 2, annotation-only Reimagine and export of that exact version.
- Downloaded mock export inspected: `synthetic: true`, `proposal_set_version: 2`, `variant_ids: ["variant-digital"]`, `source_version_ids: ["synthetic-source-v1"]`.

The default mock does not analyze uploaded contents. Research gaps and unsupported geometry remain visible. The browser does not call a rendering provider, score requirements, sum part counts into a global count, or reconstruct real exports. F70, G68 and G70 are unavailable rather than relabeled G60 models.

Remaining integration gates: published backend schemas and shared fixtures; real upload-to-finding flow; authorized original-file access; SSE replay and graph pagination; immutable proposal-history browsing; server-side renderer contract; real external research/generation; joint ten-scenario smoke tests. Full acceptance in `frontend_plan.md` is not claimed. Asset geometry, exact-trim cabin and mesh mapping remain limited as documented in `MODEL-COVERAGE.md`.
