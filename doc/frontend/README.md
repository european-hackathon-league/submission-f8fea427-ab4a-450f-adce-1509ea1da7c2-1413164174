# Frontend handoff

The controlling scope is [frontend_plan.md](../../frontend_plan.md) with the shared contract in [plan.md](../../plan.md). See [scope](SCOPE.md) and the runnable [frontend README](../../frontend/README.md).

Branch `frontend` now uses one vehicle workspace with run setup and findings, graph, evidence, proposals and history panels. The earlier pitch destinations and local analysis/export code have been removed. The old pitch plan, epics and UI specification were removed because they prescribed features outside the controlling plan.

All default responses remain explicitly synthetic. The real API adapter is configurable but has not been tested against a running backend. The hosted exterior model, preview and separately labeled cabin reference remain; see [model coverage](MODEL-COVERAGE.md) and [asset provenance](../../frontend/src/viewer/README-bmw.md).

Backend source data and other branches are outside this frontend cleanup. See [verification](VERIFICATION.md) for the checks and remaining integration gates.
