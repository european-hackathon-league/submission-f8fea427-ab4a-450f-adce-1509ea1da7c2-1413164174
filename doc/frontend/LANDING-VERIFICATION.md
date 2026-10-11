# Landing page refinement

Scope: the BMW collection landing page and its handoff to the existing workshop. Workshop components, API behavior and workflow styles are unchanged.

The current FORM journey, the earlier `frontend` branch and `artifacts/frontpage-preview/index.html` were inspected. The supplied screenshots informed the visual direction; the preview's design notes were treated as reference material.

## Changes

- Keep the warm off-white studio, blue three-stripe mark and scrolling vehicle rotation.
- Remove the FORM wordmark, promotional headings, descriptive paragraphs, persona captions, chapter dots, counters and repeated workspace links.
- Render family names beneath the vehicle layer (`z-index: 0` for names; `1` for vehicles).
- Replace 24 repeated cards with four named family choices and a variant selector. All 24 variants remain available. The additional iX reference remains available inside the existing 360° viewer.
- Keep one family-specific Explore F70/G60/G68/G70 action that opens the selected vehicle's actual workshop immediately, with no preview handoff dialog or separate workspace button.
- Remove the visible variant label, image disclaimer and imagery link from the landing page. Keep the variant selector accessible and preserve source metadata and the existing viewer attribution.
- Remember the selected variant per family while browsing and restore the last opened model on return or a fresh visit within the same browser session.
- Show the selected trim poster during initial loading; hold the painted canvas through loaded family transitions. Failed-view retries are scoped to the affected family.
- Honor reduced-motion preferences with a static vehicle and direct family selection.

## Verification

- `npm test -- --maxWorkers=2`: 48 files passed, 1 skipped; 479 tests passed, 1 skipped. The skipped test is the opt-in live backend suite. Default parallel execution hit timing-sensitive workflow test failures under load; limiting workers avoids that contention without changing workflow code.
- `npm run build`: TypeScript and production build passed.
- Impeccable detector: no findings for the changed landing targets.
- `git diff --check`: passed.
- Browser: desktop 1440×900, mobile 390×844 and small phone 320×568. No horizontal overflow at the mobile widths; controls remain visible at 320×568.
- Native browser selection: Explore G68 opens its G68 workshop directly; BMW i5 M60 xDrive opens `#workspace` with the correct vehicle. Browser Back restores its selection. The secondary 360° viewer opens that selected model and closes successfully.
- Integration tests cover all family variant counts, direct handoff, unsupported trim handling, retained variants, retained uploads and session restoration.
- A focused rendering test proves a late-loading family shows its own poster rather than a previously loaded family's car.

Screenshots: [desktop](evidence/landing-desktop.png), [mobile](evidence/landing-mobile.png).

Limit: browser validation used explicit mock mode. Live backend behavior and existing baseline availability were not changed or retested.

## Resolution, selection and scroll fixes

The original imported journey already used representative family images for every trim and shrank decoded frames to 768px. Enlarging those images made the softness more visible. The later landing refinement introduced a separate issue: the parent active-family update could briefly disagree with the stage's readiness state, inserting an oversized HTML poster between canvas paints.

- Ship 864 unmodified original frames: 23 trim sequences at 2560×1440, plus G68 at its native 1200×500. The additional iX remains at its supplied native 960×540.
- Use each selected trim's model code and actual default equipment configuration in both landing and exterior 360 viewer. Similar engine trims can legitimately share body styling; M and electric variants now use their own real renders.
- Fetch complete compressed sequences with bounded concurrency, then decode only requested angles into a three-bitmap LRU cache. Preserve native resolution without keeping all large frames decoded.
- Size the 360 canvas to its actual display and screen density, preserving source aspect ratio through resizing.
- Keep one visible canvas through family handoffs and reject older variant requests that finish after a newer selection. Preserve the original damped scroll and aligned camera crossfade.
- Prevent React active-family renders from resetting the scroll-controlled title crossfade.

Regression checks cover native resolution, all 864 image headers and dimensions, bounded fetching, cache eviction, cancellation cleanup, every forward/reverse family boundary, late trim requests, model replacement during an in-flight crossfade, retry after decoding failure, actual picker image changes, and 360 model replacement/display density. Browser checks confirmed 116 → M135 and M135 → i5 M60 replacements, 360 angle changes, and all four families loaded while scrolling in both directions with no poster present.

Additional evidence: [360 viewer](evidence/landing-360.png).


## Follow-up: model audit, zoom and scroll continuity

- Audited source briefing, keynote, option lists, study/feedback/sales workbooks. See `MODEL-COVERAGE.md` for 4/4 family and 23/23 option-list derivative coverage, plus G68 family entry and regional limitations.
- Added 100–300% exterior zoom (buttons, wheel, +/− keys), native-resolution repaint, model/reset behavior and accessible disabled bounds.
- Removed “Synthetic workspace” header label; connected-workspace indicator remains.
- Regression reproduced G60 → G68 tyre baseline rising 42.25 CSS px at 1200×900; shared ground anchor now matches.
- Reproduced decode blocking: new native angles took ~17–21 ms in 562×682 browser probe. A trial with high-quality resize was slower (~54–73 ms) and was rejected. Final drawing uses cached nearest angle during background decode; measured paint scheduling ~0–0.2 ms through scrolling. This is scheduling latency, not a claim about GPU FPS or greater than 36 source angles.
- Regression explicitly holds next-frame decoding unresolved and verifies both models continue crossfading on subsequent animation frames.

Final follow-up verification: `npm --prefix frontend test -- --maxWorkers=2` — 48 files passed, 1 skipped; 483 tests passed, 1 skipped. `npm --prefix frontend run build` passed. `git diff --check` passed. Browser checked native 2560px source at button and wheel zoom, angle change retaining zoom, reset, 1440×900 desktop and 390×844 mobile. Workshop header verified without synthetic label. Zoom evidence: `evidence/landing-zoom.png`, `evidence/landing-zoom-mobile.png`. Temporary debug probes removed.
