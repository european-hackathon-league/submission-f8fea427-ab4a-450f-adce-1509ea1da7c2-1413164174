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
