# UI specification

## Direction
BMW.de inspiration: vehicle-first composition, ample white space, strong sans-serif type, thin rules, blue primary actions. Tokens: white #fff; page #f5f6f8; ink #18212b; muted #69717d; blue #1c69d4; stage #151a21. Restrained 6–10px radii; body 16px; 8px spacing grid; visible focus and 44px primary controls. Normal English product copy; no caveman inside product.

## Layout and behavior
Left navigation: Overview, Vehicle Explorer, Compare, Requirements, Data & History. Context bar: G60 illustrative case, market, period, baseline. Overview opens with a large vehicle stage and a concise insight panel; three priority findings and executive metrics follow. Desktop uses asymmetric panels; mobile stacks with list-based component access.

Explorer pairs vehicle with component list and evidence detail. Compare supports periods and markets; labeled charts, sample counts and comparability context. Evidence opens a focus-managed drawer and preserves drafts. Deep Research presents prepared summary, supporting/contradictory evidence, hypotheses and validation gaps. Reimagine shows three proposals and creates a draft requirement. Requirement decisions require rationale and preserve prior version content; filters/search and CSV export work. Data view lists fixture sources, run history and honest upload limitations. Upload accepts local file metadata, then explains that actual analysis needs backend; never assigns fixture results to uploaded files. Presentation mode reduces chrome; print gives executive report.

## Contracts and acceptance
Use typed shared fixtures; selected component drives viewer and panel. Metric = negative feedback records / eligible feedback records, not failure rate. Distinguish percentage points and relative reduction; population/period changes and missing data remain visible. All synthetic/prepared content labeled. No runtime network required for main demo. Loading/empty/error states give next action. Focus trapping, Escape close, live announcements, reduced motion and readable charts required.

Tests: selection/context sync, comparison math via shared helpers, create/review requirement with rationale and preserved version, filtering/export, upload honesty. Primary verifies browser at 1440/1280/390px and keyboard interactions.
