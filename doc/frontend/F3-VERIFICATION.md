# F3 verification — 10 October 2026

Base: verified `codex/frontend-f2`, PR https://github.com/indkhan/vehicle-requirements-ai/pull/5 (including tag-navigation follow-up). Branch: `codex/frontend-f3`. Published backend contracts unchanged at `2d0483fd4d9bb4f95da5b8212db5d78b24a5ac46`.

## Executed gate

- Isolated worktree `npm ci` passed without secrets.
- `npm test`: **210 tests across 18 files, all pass**.
- `npm run typecheck`, `npm run build`, `git diff --check`: pass.
- Separate agents reviewed research, conflicts, API resource isolation, stale/retry behavior and reload persistence. Fixed late refresh resurrection after New run, unmounted continuation callbacks, irrelevant cohort drafts blocking ordinary continuation, missing checkpoint draft/command persistence and an invented mock restriction on contract-valid empty cohort arrays.

Research tests cover all six states, asynchronous changes, stable fact/opinion/inference identities, scope, limitations, exact citations/counterevidence, null recommendation, explicit unknown dates and retrieval retries. Exhausted network/timeout/server failures isolate research while coherent findings/proposals stay usable. Access errors, malformed research and revision incoherence remain visible errors rather than synthetic partial success.

Guided tests cover multiple actual opaque checkpoint IDs/versions, allowed actions, exact known variant/cohort assignments (including explicit empty scopes), stale-version reconciliation, removed checkpoints, accepted-but-not-yet-updated states, accepted refresh failure, repeated clicks, uncertain command retries with identical key/body, unmounted callbacks and real-mode remount recovery. Namespaces isolate workspace/run/checkpoint drafts; malformed or unavailable storage is handled. Backend continued state clears stored draft. Autonomous mode exposes alternatives/tradeoffs without PM continuation controls. Uploaded finding counts and cohort scopes remain unchanged locally during regrouping.

Browser: in-app WebKit at `127.0.0.1:5183`, 1440×1000, synthetic `guided_checkpoint_stale` scenario. Created Guided + Deep Dive run; submitted checkpoint version 1; observed server version 2 with retained `continue` draft and disabled submission. Explicitly reconciled version 2, continued, and observed backend continued state/proposal version 2 with focus on checkpoint heading. Keyboard-selected finding opened Evidence; partial Deep Dive displayed scope, stable inference ID, cited source, recommendation, alternatives, counterevidence and timeout/competitor gaps while original 172/400 feedback counts remained visible.

## External acceptance

Research publication/access/as-of dates and configured initial/max variant-limit fields are absent from published schemas. UI explicitly reports unknown metadata; dated research and configured limit presentation await contract additions. Existing research GET can be retried; no research rerun endpoint exists. Live research/conflict/checkpoint/proposal acceptance remains blocked by published 501 handlers and unreachable localhost backend. Browser and network fixtures are frontend evidence, not live research or customer analysis. F4–F6 gates remain pending.
