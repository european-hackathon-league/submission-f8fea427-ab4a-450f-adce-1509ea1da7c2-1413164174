# Pitch verification — 10 October 2026

Primary review covered integrated changes from the separate Luna UI and vehicle worktrees. Controlling scope is [the supplied frontend plan](PITCH-PLAN.md), not the broader GitHub product plan. All feedback and prepared research remain synthetic; no backend is connected.

- `npm --prefix frontend test`: 7 files, 45 tests passed.
- `npm --prefix frontend run build`: TypeScript and Vite production build passed. Main JS 283.74 kB / 87.02 kB gzip; lazy viewer 13.68 kB / 4.63 kB gzip. These exclude hosted model transfer.
- `git diff --check`: passed. Rejected procedural viewer and its unused R3F/Three.js dependencies removed; original state preserved at `aae4732` in `pitch-before-plan-polish`.
- Browser: 1440×1000 and 1280×800 desktop, 390×844 mobile. Reviewed overview, component explorer, separate period/market comparisons, requirements and data/history. Mobile market selector readable; no page-level horizontal overflow in reviewed layouts.
- Live hosted exterior rendered. Orbit, zoom and reset verified; narrow Explorer framing now fits the complete car. Exterior/interior switching preserves valid selections. Interior remains a separately attributed 520i reference photograph; detailed M60 cabin geometry and mesh heat coloring are not verified.
- Production preview: sample review → analysis stages → changes; selected-market requirement review; linked evidence retaining edits; saved edit → reload → earlier approved version; edited concept → inline evidence → draft verified. Filtered CSV download inspected for version, market, period, baseline, analysis date, evidence status and filters.
- Tests cover metric arithmetic, unavailable samples, comparison tab keyboard navigation, unsupported research, cancel/retry, requirement actions/history, editable concepts, fixture workflow, camera math and asset failure/retry. Prior browser pass also checked drawer focus trap, Escape/return focus, rationale validation and presentation context.
- No new console errors in final production preview. Historical dev hot-reload errors preceded the integrated fixes.

## Remaining acceptance gates

The full brief remains the target; this is a prepared pitch prototype. Matching licensed 3D cabin, verified component-mesh hotspots/recoloring, optimized self-hosted GLB and complete offline operation remain open. Hosted exterior requires network; local preview/photo and HTML component controls provide fallback.

Five PM-like user sessions, formal WCAG contrast audit, 200% zoom, tablet-specific review, OS print output, browser-level reduced-motion/offline/WebGL failure simulation and timed performance on the agreed pitch laptop were not completed. Backend parsing, real source denominators, research jobs, identity and server audit remain handoff work. Do not describe these gates as passed.

See [epics](EPICS.md), [3D scope](3D-SPEC.md) and [cabin research](research/G60-INTERIOR-ASSETS.md).
