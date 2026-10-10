"""Private workbook evaluation; stdout contains aggregate measurements only."""

import argparse
import json
import logging
import time
from pathlib import Path

from app.config import Settings
from app.excel_process import parse_excel_bounded


def main() -> None:
    import resource

    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    settings = Settings()
    started = time.perf_counter()
    result = parse_excel_bounded(
        args.source.read_bytes(),
        {
            "dataset_namespace": "private-evaluation",
            "reference_year": settings.reference_year,
            "header_aliases": settings.feedback_header_aliases,
            "excel_max_rows": settings.excel_max_rows,
            "excel_max_columns": settings.excel_max_columns,
            "excel_max_cells": settings.excel_max_cells,
        },
    )
    measured = {
        "records": len(result.records),
        "annotations": sum(len(item.annotations) for item in result.records),
        "unresolved_annotations": len(result.unresolved_annotations),
        "metrics": len(result.metrics),
        "unknown_values": sum(item.value is None for item in result.metrics),
    }
    reference = json.loads(args.reference.read_text(encoding="utf-8"))
    expected = reference["counts"]
    if not expected or any(
        key not in measured or type(value) is not int or value < 0
        for key, value in expected.items()
    ):
        raise SystemExit(
            "Reference must contain supported nonnegative aggregate counts"
        )
    mismatches = [key for key, value in expected.items() if measured[key] != value]
    passed = result.status in {"ready", "partial"} and not mismatches
    print(
        json.dumps(
            {
                "kind": result.kind,
                "status": result.status,
                "counts": measured,
                "mismatched_counts": mismatches,
                "reference_passed": passed,
                "parser_revision": result.parser_revision,
                "coverage_codes": sorted({issue.code for issue in result.coverage}),
                "duration_seconds": round(time.perf_counter() - started, 3),
                "peak_child_rss_kib": resource.getrusage(
                    resource.RUSAGE_CHILDREN
                ).ru_maxrss,
            }
        )
    )
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
