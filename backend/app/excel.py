"""Normalize workbook facts without executing formulas or inventing identities."""

import re
from io import BytesIO
from typing import Any

import openpyxl
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

from app.ingest_types import (
    CoverageIssue,
    FeedbackAnnotation,
    FeedbackRecord,
    ParseResult,
)
from app.wire import CellLocator, Scope

REVISION = "excel-v1"
HEADERS = {
    "id": "id",
    "source": "source",
    "country": "country",
    "derivate (e-code)": "vehicle",
    "derivative (e-code)": "vehicle",
    "customer feedback": "text",
}
COUNTRIES = {
    "germany": "DE",
    "de": "DE",
    "deutschland": "DE",
    "france": "FR",
    "fr": "FR",
    "italy": "IT",
    "it": "IT",
    "spain": "ES",
    "es": "ES",
    "netherlands": "NL",
    "nl": "NL",
    "austria": "AT",
    "at": "AT",
    "belgium": "BE",
    "be": "BE",
    "poland": "PL",
    "pl": "PL",
    "sweden": "SE",
    "se": "SE",
    "china": "CN",
    "cn": "CN",
    "usa": "US",
    "us": "US",
    "united states": "US",
    "united states of america": "US",
    "europe": "EU",
    "eu": "EU",
    "united kingdom": "GB",
    "uk": "GB",
    "gb": "GB",
    "japan": "JP",
    "jp": "JP",
    "south korea": "KR",
}
EU_MARKETS = {"DE", "FR", "IT", "ES", "NL", "AT", "BE", "PL", "SE"}


def text(value: Any) -> str:
    return "" if value is None else str(value)


def locator(sheet: str, row: int, columns: list[int]) -> CellLocator:
    return CellLocator(
        sheet=sheet, row=row, cells=[f"{get_column_letter(c)}{row}" for c in columns]
    )


def issue(result: ParseResult, code: str, location: CellLocator | None = None) -> None:
    result.coverage.append(
        CoverageIssue(code=code, message=code.replace("_", " "), locator=location)
    )
    if result.status == "ready":
        result.status = "partial"


def scope_for(
    country: Any, vehicle: Any, result: ParseResult, location: CellLocator
) -> Scope:
    country_text = text(country).strip()
    market = COUNTRIES.get(country_text.casefold())
    if country_text and market is None:
        issue(result, "unknown_country_mapping", location)
    vehicles = re.findall(r"\b[A-Z]\d{2}\b", text(vehicle).upper())
    if text(vehicle).strip() and not vehicles:
        issue(result, "unknown_vehicle_mapping", location)
    cohorts = [market] if market else []
    if market in EU_MARKETS:
        cohorts.append("EU")
    return Scope(
        vehicle_ids=sorted(set(vehicles)),
        markets=[market] if market else [],
        cohort_ids=cohorts,
    )


def feedback(
    sheet: Any,
    raw_sheet: Any,
    result: ParseResult,
    namespace: str,
    aliases: dict[str, str],
) -> None:
    rows = sheet.iter_rows()
    raw_rows = raw_sheet.iter_rows()
    headers = [text(cell.value) for cell in next(rows, ())]
    next(raw_rows, ())
    mapped = [aliases.get(" ".join(header.casefold().split())) for header in headers]
    required = {"id", "source", "country", "vehicle", "text"}
    if not required.issubset(mapped) or any(
        mapped.count(name) != 1 for name in required
    ):
        result.status = "unsupported"
        issue(
            result,
            "mapping_required",
            locator(sheet.title, 1, list(range(1, len(headers) + 1))),
        )
        return
    columns = {name: mapped.index(name) for name in required}
    records: dict[tuple[str, str], FeedbackRecord] = {}
    for row_number, (row, raw_row) in enumerate(zip(rows, raw_rows, strict=True), 2):
        values = [cell.value for cell in row]
        if not any(value is not None for value in values):
            continue
        location = locator(sheet.title, row_number, list(range(1, len(headers) + 1)))
        scope = scope_for(
            values[columns["country"]], values[columns["vehicle"]], result, location
        )
        missing_cache = any(
            cell.data_type == "f" and values[index] is None
            for index, cell in enumerate(raw_row)
        )
        if missing_cache:
            issue(result, "missing_formula_cache", location)
        annotation = FeedbackAnnotation(
            text=text(values[columns["text"]]),
            locator=location,
            scope=scope,
            classifications={
                header: text(raw_row[index].value)
                if raw_row[index].value is not None
                else None
                for index, header in enumerate(headers)
            },
        )
        external_id = text(values[columns["id"]]).strip()
        source = text(values[columns["source"]]).strip()
        if not external_id or not source or len(external_id) > 200 or len(source) > 200:
            issue(result, "missing_record_identity", location)
            result.unresolved_annotations.append(annotation)
            continue
        if not annotation.text.strip():
            issue(result, "missing_feedback_text", location)
            result.unresolved_annotations.append(annotation)
            continue
        key = (source, external_id)
        record = records.get(key)
        if record is None:
            record = FeedbackRecord(
                dataset_namespace=namespace,
                source_namespace=source,
                external_record_id=external_id,
                text=annotation.text,
                annotations=[],
                scope=scope.model_copy(deep=True),
                text_variants=[annotation.text],
            )
            records[key] = record
        if annotation.text not in record.text_variants:
            record.text_variants.append(annotation.text)
            record.limitations = ["conflicting_feedback_text"]
            issue(result, "conflicting_feedback_text", location)
        record.annotations.append(annotation)
        for name in ("vehicle_ids", "markets", "cohort_ids"):
            setattr(
                record.scope,
                name,
                sorted(set(getattr(record.scope, name)) | set(getattr(scope, name))),
            )
    result.records.extend(records.values())


def parse_excel(
    data: bytes,
    *,
    dataset_namespace: str,
    reference_year: int = 2026,
    header_aliases: dict[str, str] | None = None,
) -> ParseResult:
    result = ParseResult(
        kind="unknown",
        parser_revision=REVISION,
        parser_versions={"openpyxl": openpyxl.__version__},
    )
    book = load_workbook(
        BytesIO(data), read_only=True, data_only=True, keep_links=False
    )
    raw_book = load_workbook(
        BytesIO(data), read_only=True, data_only=False, keep_links=False
    )
    try:
        if "Feedback_Explorer" in book.sheetnames:
            result.kind = "feedback"
            aliases = HEADERS | {
                " ".join(key.casefold().split()): value
                for key, value in (header_aliases or {}).items()
            }
            feedback(
                book["Feedback_Explorer"],
                raw_book["Feedback_Explorer"],
                result,
                dataset_namespace,
                aliases,
            )
        else:
            result.status = "unsupported"
            issue(result, "mapping_required")
        return result
    finally:
        book.close()
        raw_book.close()
