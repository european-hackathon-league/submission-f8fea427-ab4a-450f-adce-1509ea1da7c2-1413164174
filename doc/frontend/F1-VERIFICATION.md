# F1 verification — 10 October 2026

Base: `frontend` / `origin/frontend` at `7f6020d13391bb243741534d8ec18ca2dfe8f2b5`. Branch: `codex/frontend-f1`. Published backend contracts pinned read-only from `origin/backend` at `2d0483fd4d9bb4f95da5b8212db5d78b24a5ac46`.

## Executed gate

From isolated managed worktree, `frontend/`:

- `npm ci`: clean installation succeeded; no secrets.
- `npm test`: **79 tests, 9 files, all pass**.
- `npm run typecheck`: passes.
- `npm run build`: TypeScript + production Vite build passes.
- `git diff --check`: passes.

Schema tests validate every payload of all ten published scenarios and the frontend synthetic vehicles/findings/graph/proposals/research/evidence against pinned JSON schemas without coercion. Adapter tests cover exact multipart `files` / `sources`, frozen configuration, nullable initial proposal version, split proposals, canonical mutations, response errors/request IDs, auth headers, graph pages/dedup/revision coherence, bounded retries and exclusive SSE cursors.

Recovery tests cover fragmented CRLF events/comments, invalid envelopes, duplicate/out-of-order events, gaps, expired replay, repeated expiry fallback, cursor reuse, access denial and abort cleanup. App tests cover partial/rejected packages, second independent synthetic run, server-supported vehicle with unavailable local visualization, accepted-run refresh failure, access restoration/reconnect, versioned drafts after remount and uncertain accepted-run replay after remount using identical key/body and original Guided/Deep Dive settings.

Viewer tests cover 17 cases including actual SDK coordinate capture/restore, aggregate reorder, hidden mounted exterior during cabin view, invalid caches and blocked storage. Browser at `127.0.0.1:5181`, including 1440×1000 desktop: uploaded synthetic XLSX bytes, created autonomous run, inspected frozen completed source IDs/asset/catalog/context, navigated exterior zoom → labeled cabin photo → exterior and observed preserved exterior framing. The hosted model rendered; the third-party viewer also exposes a device-weight warning in its DOM. Local preview remains available. Browser evidence is frontend synthetic evidence, not live API analysis.

## Review and limitations

Separate sub-agent reviewed API/recovery/App against plan and failure paths. Fixed: expired-cursor hot loop, reconnect not restarting after access restoration, missing workspace namespace, mock New run reuse, local-asset gate blocking valid server configuration, duplicate submission before first snapshot, raw opaque IDs, invisible restored sources, unknown-outcome command duplication, unbounded SSE headers and pending-config display mismatch.

No backend listener reachable at documented `http://127.0.0.1:8000/health` (connection refused). Published findings/graph/research/conflicts/proposals/evidence/instructions/checkpoint/history/render/export handlers currently return `501 not_implemented`. These are external live-system blockers, not proof of frontend completion in later packages. F2–F6 acceptance remains pending in the ledger. Exact-trim cabin/geometry/mesh maps remain unavailable. Mock reload deliberately starts a new synthetic session; real-mode current-tab recovery is supported after reentering existing credentials. Browser storage disabled means reload persistence unavailable; in-memory reconnect/drafts still work.
