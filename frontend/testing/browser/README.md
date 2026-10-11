# Opt-in real browser verification

Run the actual frontend, backend, database, Temporal worker, and geometry adapter first (see the repository Reimagine setup). These tests use installed Microsoft Edge by default; set `PLAYWRIGHT_CHANNEL` for another installed supported browser, or install Chromium and remove the channel setting locally.

`npm run test:e2e` skips live tests unless the environment below is supplied. No fake API responses are used. `LIVE_REIMAGINE_URL` defaults to `http://127.0.0.1:5175`; `LIVE_REIMAGINE_WORKSPACE` and `LIVE_REIMAGINE_TOKEN` must identify an authorized workspace. Credentials stay in browser memory; traces are disabled so token entry is not recorded.

For read-only baseline loading, rotation, and reconnect, also set `LIVE_REIMAGINE_RUN_ID` to an existing run with configured editable geometry. Run `npm run test:e2e -- --grep "verified original"`.

The upload/analysis/Reimagine test creates exactly one new run and one job and can spend provider budget. Run it only after establishing a concrete bounded live budget and worker limits. Set `LIVE_REIMAGINE_ALLOW_SUBMIT=1` and `LIVE_REIMAGINE_FEEDBACK` to an XLSX/PDF feedback fixture, then run `npm run test:e2e -- --grep "upload feedback"`. It does not retry failed paid jobs. It checks real feedback/evidence navigation, rendering, rotation, version switching, and reload recovery. Provider failures are test failures rather than mocked successes.

Screenshots and failure context are written to ignored `test-results/`. Unit tests exclude this directory of opt-in browser tests. Browser screenshots establish visible behavior; geometry measurements and unchanged-part checks belong to the backend worker tests and recorded job validation.

To resume a diagnosed failed run instead of submitting new analysis, set the same authorized access and `LIVE_REIMAGINE_RUN_ID`, plus `LIVE_REIMAGINE_RETRY_REQUEST_ID` and `LIVE_REIMAGINE_ALLOW_SUBMIT=1`. Run `npm run test:e2e -- --grep "retry one existing"` only after coordinating worker startup and the remaining bounded provider budget. This clicks retry once for that specific failed request, then checks the modified GLB, numbered marker, matching-camera original toggle, and reconnect. Recovery metadata is attached even on failure; credentials are excluded.

Read-only result verification requires `LIVE_REIMAGINE_RESULT_REQUEST_ID` and `npm run test:e2e -- --grep "Reimagine an existing saved"`. It seeds the existing request and checks the actual downloaded result without submitting or retrying anything. The same test can explicitly create one new job for a saved version-2 design interpretation using `LIVE_REIMAGINE_EXISTING_SUBMIT=1` plus the bounded submit allowance; do not set the result ID in that mode.

The saved interpretation test requires `LIVE_REIMAGINE_ALLOW_EDIT=1`, the existing run ID, and `LIVE_REIMAGINE_RETRY_REQUEST_ID` referencing its version-1 result. Run `npm run test:e2e -- --grep "save an explicit"`. It saves an explicitly labelled visualization assumption as proposal version 2: widen the mapped representative driver seat by 10% along its verified local Y width axis, preserve length/height, and make no claim of validated comfort or engineering improvement. Customer excerpts remain unchanged. The test checks unsaved Reimagine blocking and stale version-1 results. When that exact version-2 text already exists, it only verifies it and the stale result instead of creating another proposal version. It submits no provider jobs.

For the honest unsupported-result path, set `LIVE_REIMAGINE_FAILURE_REQUEST_ID` and run `npm run test:e2e -- --grep "unsupported request"`. This checks the original remains rotatable and evidence remains accessible, without creating any new geometry job.
