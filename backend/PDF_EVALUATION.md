# PDF extraction reference gate

Thresholds declared before corpus extraction or parser tuning (2026-10-10).

Use manually inspected rendered pages as the reference, never parser output.
Keep rendered pages, source passages, reference answers and extracted artifacts
in ignored private evaluation storage. Report only aggregate measurements.

- Correct page, option row, model column and availability association: 100% of
  checked claims. A wrong association blocks publication of confident availability.
- Ambiguous symbols, merged model cells or missing legends: availability unknown,
  with coverage warnings; never infer absence from a blank or unreadable cell.
- Explicit legend, package condition and referenced footnote preservation: 100%
  in the checked reference cases, or explicit unknown/coverage instead of a claim.
- Locator regions: at least 95% contain the checked original passage/cell, with
  two PDF points of tolerance. Page references must be exact in every case.
- Text/table reference coverage: at least 90%; report missed cells separately from
  incorrect cells. A partial extraction cannot be called a complete baseline.
- Reference scope includes a multi-model equipment table and legend, a footnote,
  two option-list derivatives, and annual-report section/passages on exact pages.
- Report duration, peak child RSS, parser/model revisions, errors and coverage.
  Resource limits must produce a bounded, source-specific failure outcome.

The initial production parser uses Docling 2.137.0, CPU layout Heron and accurate
TableFormer. Model revisions, checksums and publisher license declarations are
in `parser_models.json`. Layout weights declare Apache-2.0; TableFormer weights
declare CDLA-Permissive-2.0. Preserve publisher notices when distributing weights.
These declarations are metadata review, not legal clearance.

Setup downloads only declared public model files; it does not read application
credentials. Request-time parsing verifies local checksums and disables network,
OCR, remote services and external plugins. Missing weights are an explicit gate.

## Measured BE-07 sample (2026-10-10)

The current `docling-pdf-v2` implementation was checked in the local Linux
`vehicle-backend-parser` image with the current application and model manifest
mounted, CPU inference and Docker networking disabled. The host Docker VM had
7.612 GiB memory and other workloads running; these timings are observations,
not throughput promises. Private originals, rendered pages, checked references,
parser output and diagnostics remain under ignored `.local/pdf-evaluation`.

- G60 option list, page 13: 69 passages, 64 candidate cells, 55 known
  availability values; two checked model/cell associations and both page/region
  anchors correct. Duration 94.221 s; peak child RSS 1,415,552 KiB.
- F70 option list, page 13: 42 passages; four checked availability associations,
  the rendered legend and a footnote all correct, six of six page/region anchors
  correct, and the checked package condition preserved. Duration 52.926 s;
  peak child RSS 1,293,332 KiB.
- Annual report, page 14: 15 passages; two checked strategy passages and both
  exact page/region anchors correct. Duration 67.249 s; peak child RSS
  1,214,784 KiB. Empty-password encryption is handled by copying pages into a
  temporary unencrypted file without cloning the unrelated structure tree.

All three small reference sets pass the thresholds above; no incorrect checked
association required a fallback parser. Equipment samples are partial: unknown
cells remain explicit, and extracting a table page without its cover cannot
establish edition scope. Production batches carry earlier grounded cover/legend
passages with their original locators. A prior busy-host attempt failed within
the resource boundary (170.841 s, no published passages); a fresh attempt
succeeded. Do not treat a partial extraction as a complete equipment baseline.

The evaluator counts missing cases against locator and condition thresholds,
ignores ordinary text wrapping, and uses independently checked region anchors
to disambiguate repeated wording on a page. It never derives reference answers
from parser output. Model identities remain the immutable revisions declared in
`parser_models.json`; changing association policy changes the parser revision.

For an existing private reference file, run inside the configured Linux parser:

```sh
python -m app.pdf_evaluation --source /private/source.pdf \
  --reference /private/reference.json --artifacts /models --pages 13 13
```

References contain `cases` with exact `page`, either `option_code`,
`model_column`, `availability` or `text_contains`, independently checked
`anchor: [x, y]` in PDF points from the top left, and optional
`condition_contains`. The command prints aggregate counts and resource metadata
only. Retain the printed `release_gate_passed` outcome with private run metadata.

BE-16 still must expand the sample across the third option-list derivative,
complete source documents, all annual-report batches, frozen upload/workflow
execution and deployment hardware. These checks establish the bounded BE-07
reference sample, not complete-corpus accuracy or production integration readiness.
