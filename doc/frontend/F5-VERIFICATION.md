# F5 verification — 10 October 2026

Base: verified `codex/frontend-f4`, PR https://github.com/indkhan/vehicle-requirements-ai/pull/7. Branch: `codex/frontend-f5`. Backend contracts remain pinned at `2d0483fd4d9bb4f95da5b8212db5d78b24a5ac46`.

## Behavior and boundaries

Scene capabilities expose the exact saved vehicle/baseline/catalog tuple, independently authorized baseline references, semantic parts, unverified mappings, separate cabin photo identity and explicit limitations. Invalid or unsupported tuples cannot borrow another vehicle's model. Catalog validation rejects unsafe asset links and conflicting asset identities.

Application Reimagine retains canonical exact-version commands and asynchronous states from F4. Variant assets now load as native image previews with loading/error/timeout, keyboard retry and focus recovery. Refreshing asset links retrieves render status without another submission. Unsupported media retain authorized links; unsafe links and conflicting IDs are withheld. Old assets remain independently inspectable and are loaded only after their disclosure opens.

Six schema-valid frontend render fixtures cover queued, rendering, success, partial, failure and late completion. Useful partial results reference a labeled static synthetic annotation card; unsupported physical and unknown edited changes stay explicit. No geometry, exact-trim mapping, generated vehicle or browser provider integration was added.

## Executed gate

- Isolated `npm ci`: pass, no secrets.
- `npm test`: **345 tests across 29 files, all pass**.
- `npm run typecheck`, `npm run build`, `git diff --check`: pass.
- Separate agents reviewed scene mapping, fixtures/API, previews and root integration. Fixed duplicate empty-asset fallback and an unmatched CSS wrapper that left long asset IDs unwrapped. Focused affected suites rerun after fixes.

Tests include application-only authenticated/version-bound requests, fixture Ajv validation, partial scope filtering, unknown edits, exact late/current asset identities, duplicate submissions, stale results, safe links, duplicate/conflicting asset IDs, unsupported media, native load failure and 15-second timeout, retry focus, cancelled timers and GET-only refreshed links. Existing F4 tests retain complete render-job lifecycle and cleanup coverage.

Browser: in-app WebKit, `127.0.0.1:5185`, 1440×1000. F70 selection showed its own identity, no compatible scene and no substituted links. Returning to G60 exposed exact baseline/catalog IDs and separate G60 520i photo. Keyboard Enter opened semantic part capability table with no mesh/geometry anchors. Synthetic upload/run/Reimagine displayed queued then partial; actual SVG image loaded (`naturalWidth=960`) and remained separate from baseline. Keyboard numbered explanation focused exact proposal-version-1 / variant-digital / change-dashboard with supporting evidence and limitations. Hosted Sketchfab reports this device's model is too heavy; local baseline preview and component list remain available.

## External acceptance

Live rendering and provider generation remain blocked by unavailable backend/501 handlers. Published application RenderResult does not expose preservation constraints or their validation; UI explicitly reports unavailable verification. Exact-trim cabin, physical geometry and mesh mappings remain external asset gaps. Synthetic fixture/browser evidence is not live generation or preservation acceptance. F6 integration gate remains pending.
