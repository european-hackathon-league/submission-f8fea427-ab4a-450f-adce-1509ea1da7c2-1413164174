"""Private reference evaluation; reports aggregates, never source passages."""

import argparse
import json
import logging
import re
import time
from pathlib import Path
from typing import Any

from app.ingest_types import ParseResult
from app.pdf import parse_pdf


def evaluate_reference(
    result: ParseResult, references: list[dict[str, Any]]
) -> dict[str, int | bool]:
    report: dict[str, int | bool] = {
        name: 0
        for name in [
            "reference_cases",
            "matched",
            "missing_or_ambiguous",
            "correct_availability",
            "wrong_availability",
            "unknown_availability",
            "correct_text",
            "locator_checks",
            "correct_locators",
            "condition_checks",
            "correct_conditions",
        ]
    }
    for case in references:
        report["reference_cases"] += 1
        report["locator_checks"] += int("anchor" in case)
        report["condition_checks"] += int("condition_contains" in case)
        matches = [
            passage
            for passage in result.passages
            if passage.locator.page == case["page"]
        ]
        if "option_code" in case:
            matches = [
                passage
                for passage in matches
                if passage.attributes.get("option_code") == case["option_code"]
                and re.sub(
                    r"\s+", "", str(passage.attributes.get("model_column", ""))
                ).casefold()
                == re.sub(r"\s+", "", case["model_column"]).casefold()
            ]
        else:
            matches = [
                passage
                for passage in matches
                if " ".join(case["text_contains"].split()).casefold()
                in " ".join(passage.text.split()).casefold()
            ]
        if len(matches) > 1 and "anchor" in case:
            x, y = case["anchor"]
            matches = [
                passage
                for passage in matches
                if (box := passage.locator.bbox)
                and box[0] - 2 <= x <= box[2] + 2
                and box[1] - 2 <= y <= box[3] + 2
            ]
        if len(matches) != 1:
            report["missing_or_ambiguous"] += 1
            continue
        passage = matches[0]
        report["matched"] += 1
        if "availability" in case:
            actual = passage.attributes.get("availability")
            field = (
                "correct_availability"
                if actual == case["availability"]
                else "unknown_availability"
                if actual == "unknown"
                else "wrong_availability"
            )
            report[field] += 1
        else:
            report["correct_text"] += 1
        if "anchor" in case:
            bbox = passage.locator.bbox
            x, y = case["anchor"]
            if (
                bbox
                and bbox[0] - 2 <= x <= bbox[2] + 2
                and bbox[1] - 2 <= y <= bbox[3] + 2
            ):
                report["correct_locators"] += 1
        if "condition_contains" in case:
            if case["condition_contains"] in str(
                passage.attributes.get("conditions", [])
            ):
                report["correct_conditions"] += 1
    covered = int(report["correct_availability"]) + int(report["correct_text"])
    report["release_gate_passed"] = bool(
        references
        and not report["wrong_availability"]
        and covered / len(references) >= 0.9
        and report["locator_checks"]
        and int(report["correct_locators"]) / int(report["locator_checks"]) >= 0.95
        and report["correct_conditions"] == report["condition_checks"]
    )
    return report


def main() -> None:
    import resource

    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--pages", nargs=2, type=int, required=True)
    parser.add_argument("--timeout-seconds", type=int, default=180)
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    started = time.perf_counter()
    result = parse_pdf(
        args.source.read_bytes(),
        args.source.name,
        artifacts_path=args.artifacts,
        page_range=tuple(args.pages),
        timeout_seconds=args.timeout_seconds,
    )
    reference = json.loads(args.reference.read_text())
    report = evaluate_reference(result, reference["cases"])
    print(
        json.dumps(
            {
                "status": result.status,
                "evaluation": report,
                "duration_seconds": round(time.perf_counter() - started, 3),
                "peak_child_rss_kib": resource.getrusage(
                    resource.RUSAGE_CHILDREN
                ).ru_maxrss,
                "parser_versions": result.parser_versions,
                "coverage_codes": sorted({issue.code for issue in result.coverage}),
            }
        )
    )
    if result.status not in {"ready", "partial"} or not report["release_gate_passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
