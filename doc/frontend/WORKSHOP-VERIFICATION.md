# Visual workshop integration — 2026-10-11

The approved HTML workshop design is implemented in the React application. Existing BMW collection and 360° browsing remain connected to it.

## Backend mapping

Read-only backend review used `origin/main` at `1f11f373c0c35ffa096a7c059c9f2d3c018ac582`. No backend or wire-contract changes are required by this redesign.

- Setup uses existing source uploads and run creation. Autonomous maps to participation mode; Deep Dive maps to its existing enabled flag. Market context is derived from sources.
- Suggestions show actual proposal changes and finding counts. Decision commands bind the displayed proposal version, variant, change IDs and rationale. Uncertain retries retain their original idempotency key and payload, including session recovery for authenticated API access.
- Customer feedback and Evidence visualize backend negative shares and supporting/opposing evidence IDs. Counts from overlapping findings or cohorts are not added together; unknown shares are not estimated.
- Graph edges come only from supplied identities and relationships. Research displays actual candidate approaches, claim types, recommendation and gaps. Conflicts retains scope alternatives and version-bound checkpoint continuation.
- Renders preserves exact proposal bindings, per-change outcomes, authorized assets, polling and retries. History visualizes audit events and retains immutable version inspection and exact-version exports.
- Sketchfab tags project asset-specific reference coordinates during rotation. Collision handling keeps visible labels within the preview; invalid/offscreen anchors are hidden. Seat/dashboard anchors are approximate cabin regions rather than verified mesh identities. Existing semantic part controls provide a fallback.

## Verification

- `npm test --prefix frontend`: 455 passed, zero failed, including native HTTP contract-harness acceptance and protected download coverage.
- `npm run typecheck --prefix frontend`: passed.
- `npm run build --prefix frontend`: passed.
- `git diff --check`: passed.
- Native browser checks: upload → Start analysis, compact suggestion review, attached tag movement during orbit, customer-feedback charts, selected-finding research, render request/polling/outcome, and responsive layout.
- Tag leader anchor moved from approximately `(339, 250)` to `(306, 249)` after orbiting the vehicle; the label moved with it.
- At 390×844 the document width is 390px: no horizontal overflow. Temporary viewport override was reset after testing.

[Desktop evidence](evidence/workshop-desktop.png) · [Mobile evidence](evidence/workshop-mobile.png)

The browser and HTTP harness use synthetic records. These checks do not certify live backend parsing, AI research, provider rendering, or production persistence. The Sketchfab model requires external network access; static preview and semantic controls remain available when 3D fails.
