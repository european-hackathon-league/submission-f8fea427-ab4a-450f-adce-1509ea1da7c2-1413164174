# F4 verification — 10 October 2026

Base: verified `codex/frontend-f3`, PR https://github.com/indkhan/vehicle-requirements-ai/pull/6. Branch: `codex/frontend-f4`. Published backend contracts pinned at `2d0483fd4d9bb4f95da5b8212db5d78b24a5ac46`.

## Behavior and boundaries

Proposal editing submits canonical version-bound instructions for text, numeric or cleared targets, removal, PM-originated additions and known-ID cohort regrouping. Text/target drafts, PM ideas and grouping drafts retain independent base versions. Stale responses refresh authoritative proposals and require explicit reconciliation; disappeared changes and variants retain readable drafts without binding them to replacement IDs. Accepted instructions show recomputation separately from publication of a new version. Unknown submission outcomes retain the original command and idempotency key. Accepted commands retry retrieval rather than resubmitting. Same-tab real-mode storage and in-memory recovery remain isolated by API/workspace/run and entity identity.

History retrieves immutable earlier proposals with the published `proposal_set_version` query. Browser-owned drafts and audit text never replace authoritative history. Numbered explanations bind exact run/proposal/variant/change identities, show proposal evidence and referenced research, and keep approval, PM selection, rendering and target validation separate.

Rendering retains independently versioned jobs and assets. A late or stale job cannot supply the current selection's assets. Export requests carry the inspected proposal version, selected variants and format; returned job status and manifest determine whether an authorized download link is exposed. No authoritative export is rebuilt from loaded UI resources.

## Executed gate

- Isolated worktree `npm ci`: pass, without secrets.
- `npm test`: **309 tests across 26 files, all pass**.
- `npm run typecheck`, `npm run build`, `git diff --check`: pass.
- Separate agents reviewed proposal drafts, API/history/export, render jobs and root integration against the controlling plan. Fixed cross-run proposal acceptance, orphan requirement references, uncertain HTTP 500 command loss, missing in-memory job recovery, raw relative asset URLs, uncancelled reads, first explanation focus, default selection drift and unrelated finding fallback for PM ideas. Regression tests cover each finding.

Tests cover all five proposal operations, independent stale drafts, reload and disabled-storage recovery, uncertain same-key commands, accepted recomputation and failure, immutable version queries, manifest mismatch withholding, JSON/XLSX request binding, render state transitions, duplicate submissions, per-change asset references, old/late/stale results, retry endpoint binding and cancelled/unmounted reads. Synthetic XLSX export is explicitly unavailable; the real API boundary and UI submit its established format without fabricating a spreadsheet.

Browser: in-app WebKit at `127.0.0.1:5184`, 1440×1000, synthetic autonomous scenario. Submitted version-1 proposal edit and observed `processing` with frozen inputs before version 2. Requested Reimagine for version 2; observed queued then partial annotation-only outcome. Keyboard activated numbered `change-dashboard` explanation; exact version/variant/change, before/after, supporting sources and current-count/history limitations appeared, with focus confirmed on explanation container. Inspected immutable proposal version 1 after editing, requested exact-version JSON export, observed queued and authorized returned blob link. Added PM idea against reconciled version 2; version 3 retained old render as version 2, and PM idea View evidence opened its own exact explanation with no unrelated customer finding. Evidence panel focus confirmed through DOM inspection.

These are frontend fixture/browser checks, not live processing, research, generation or exports.

## External acceptance

Live proposal mutations, immutable history, rendering and export remain externally blocked by published 501 handlers and unavailable local backend. No renderer service, provider, backend or database implementation is included.

Published immutable proposals contain finding IDs, but neither historical finding counts nor a proposal-version parameter on finding retrieval. Explanations explicitly label retrieved counts **current finding counts**; they do not claim those counts existed when an earlier proposal was created. Immutable historical count display requires a contract addition. Research retrieval likewise has no immutable proposal-version query; referenced research IDs can be retrieved with explicitly current contents, while historical research claim contents require a contract addition. Proposal-bound supporting/opposing evidence IDs remain exact. Research dates and variant-limit metadata remain the F3 dependencies. Exact geometry and exact-trim assets remain unavailable as documented in `MODEL-COVERAGE.md`.
