# Pitch verification — 10 October 2026

Primary review covered the integrated UI and viewer from both managed worktrees. All feedback and prepared research remain synthetic; no backend is connected.

- `npm --prefix frontend test`: 6 files, 32 tests passed.
- `npm --prefix frontend run build`: TypeScript and Vite production build passed.
- Browser: 1440×1000 and 1280×800 desktop; 390×844 mobile. Reviewed overview, explorer, comparison, requirements and data/history; no page-level horizontal overflow at mobile width.
- Live hosted exterior rendered; orbit, zoom, reset and exterior/interior switching verified. Static cabin reference and severity markers reviewed. This does not verify matching-trim 3D cabin geometry or mesh heat coloring.
- Keyboard dialog focus loop, Escape/focus return and missing-rationale validation verified.
- Production preview: prepared research → draft → rationale-required approval → reload persistence → prior version inspection verified. CSV browser download inspected; updated evidence-ID export and formula/quote handling covered by tests.
- Presentation mode retained vehicle/market/period/baseline/synthetic context. OS print dialog, full offline/WebGL failure simulation and browser-level reduced-motion emulation were not exercised. Viewer failure/retry and reduced-motion camera behavior are unit-tested.

Non-blocking test warning comes from Three.js CommonJS through the retained procedural study. That scene is not loaded by the current pitch route.

Outstanding acceptance gates: obtain and inspect a licensed detailed i5 M60 cabin; validate semantic mesh mapping; verify optimized local assets across target devices; bind real backend records and source denominators. See [3D spec](3D-SPEC.md) and [cabin research](research/G60-INTERIOR-ASSETS.md).
