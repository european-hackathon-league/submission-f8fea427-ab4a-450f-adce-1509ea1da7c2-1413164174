# FWD vehicle insights

BMW-inspired pitch prototype for evidence-led vehicle planning. Uses synthetic feedback and prepared research; it does not establish real BMW issue rates or causal findings.

```sh
npm ci
npm run dev
npm test
npm run build
```

Vite prints the local preview URL. Runtime dependencies are pinned in the lockfile. Main demo runs without remote imagery, models, fonts or research APIs.

## Parallel build and handoff

Concise [epics](../doc/frontend/EPICS.md), [UI spec](../doc/frontend/UI-SPEC.md), and [3D spec](../doc/frontend/3D-SPEC.md) define ownership and acceptance. Viewer lives in `src/viewer`; application in `src/App.tsx`; shared types and synthetic fixtures in `src/domain`.

Backend team should supply context-scoped source records, comparison denominators and comparability status, job progress/results, authenticated decisions and version history. UI fixtures are demonstration content, never a substitute for uploaded-file analysis.

## Vehicle assets

Bundled vehicle is original illustrative geometry, not an exact BMW model. Viewer can receive an optional GLB URL and stable semantic node mapping; consult `src/viewer/README.md` for asset replacement. Heat color describes feedback share, not verified damage. Missing samples remain gray. No-WebGL view preserves component selection.
