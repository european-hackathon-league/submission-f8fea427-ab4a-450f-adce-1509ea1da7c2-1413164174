"""Layout-aware PDF evidence; uncertain table associations remain unknown."""

import json
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Literal, cast

from pydantic import JsonValue

from app.ingest_types import CoverageIssue, ParsedPassage, ParseResult
from app.parser_models import ModelArtifactsUnavailable, verify_artifacts
from app.wire import PDFLocator, Scope

PARSER_REVISION = "docling-pdf-v3"
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
PDFKind = Literal["equipment", "strategy"]


def _locator(
    document: dict[str, Any], provenance: dict[str, Any], section: str | None = None
) -> PDFLocator:
    page = int(provenance["page_no"])
    box = provenance.get("bbox")
    region = None
    if box:
        left, top, right, bottom = (float(box[key]) for key in ("l", "t", "r", "b"))
        if box.get("coord_origin") == "BOTTOMLEFT":
            height = float(
                document.get("pages", {})
                .get(str(page), {})
                .get("size", {})
                .get("height", 0)
            )
            if height:
                top, bottom = height - top, height - bottom
            else:
                return PDFLocator(page=page, section=section)
        region = (
            min(left, right),
            min(top, bottom),
            max(left, right),
            max(top, bottom),
        )
    return PDFLocator(page=page, bbox=region, section=section)


def normalize_document(
    document: dict[str, Any],
    kind: PDFKind,
    *,
    context_passages: list[ParsedPassage] | None = None,
) -> ParseResult:
    """Normalize an actual Docling export without translating original passages."""
    result = ParseResult(
        kind=kind,
        parser_revision=PARSER_REVISION,
        parser_versions={"docling": "2.137.0"},
    )
    texts = document.get("texts", [])
    context = [
        passage
        for passage in context_passages or []
        if passage.source_kind == kind
        and passage.attributes.get("label") != "table_row"
        and "option_code" not in passage.attributes
    ]
    source_text = "\n".join(
        [str(item.get("text", "")) for item in texts]
        + [passage.text for passage in context]
    )
    edition_match = re.search(r"Juli\s+(20\d{2})", source_text, re.IGNORECASE)
    year_match = re.search(
        r"(?:Report|Bericht)\s+(20\d{2})", source_text, re.IGNORECASE
    )
    edition = f"{edition_match[1]}-07" if edition_match else None
    scope = Scope(
        markets=["DE"]
        if re.search(r"\bDeutschland\b|(?:www\.)?bmw\.de/", source_text, re.IGNORECASE)
        else [],
        year=int(edition_match[1])
        if edition_match
        else int(year_match[1])
        if year_match
        else None,
        vehicle_ids=sorted(set(re.findall(r"\b(?:F|G)\d{2}\b", source_text))),
    )
    if kind == "equipment" and (not scope.markets or edition is None):
        result.coverage.append(
            CoverageIssue(
                code="unknown_document_scope",
                message="Equipment market or edition is not established by source text",
            )
        )
    legends: dict[str, str] = {}
    for symbol, description in re.findall(
        r"([^\w\s;:,])\s*(Serienausstattung|Sonderausstattung|nicht verfügbar)",
        source_text,
        re.IGNORECASE,
    ):
        availability = {
            "serienausstattung": "standard",
            "sonderausstattung": "optional",
            "nicht verfügbar": "absent",
        }[description.lower()]
        if symbol in legends and legends[symbol] != availability:
            legends[symbol] = "unknown"
        else:
            legends[symbol] = availability
    section = None
    for item in texts:
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        if item.get("label") in {"section_header", "title"}:
            section = text
        provenance = item.get("prov", [])
        if len(provenance) != 1:
            result.coverage.append(
                CoverageIssue(
                    code="ambiguous_text_location",
                    message="Text spans lack a unique page association",
                )
            )
            continue
        result.passages.append(
            ParsedPassage(
                source_kind=kind,
                text=text,
                locator=_locator(document, provenance[0], section),
                scope=scope,
                attributes={
                    "edition": edition,
                    "claim_role": "context" if kind == "strategy" else "source_text",
                    "label": str(item.get("label", "text")),
                },
                limitations=[
                    "Corporate strategy is context, not engineering feasibility"
                ]
                if kind == "strategy"
                else [],
            )
        )
    source_context = context + result.passages
    footnotes = [
        passage
        for passage in source_context
        if passage.attributes.get("label") == "footnote"
        or re.match(r"^\d+[). ]", passage.text)
    ]
    footnotes = [
        passage.model_copy(update={"text": note.strip()})
        for passage in footnotes
        for note in re.split(r"\n(?=\s*\d+[). ]\s*)", passage.text)
        if note.strip()
    ]
    context_locators = [
        passage.locator.model_dump(mode="json")
        for passage in source_context
        if re.search(
            r"Juli\s+20\d{2}|Deutschland|bmw\.de/|Serienausstattung|Sonderausstattung",
            passage.text,
            re.IGNORECASE,
        )
    ]
    for table in document.get("tables", []):
        provenance = table.get("prov", [])
        if len(provenance) != 1:
            result.coverage.append(
                CoverageIssue(
                    code="ambiguous_table_location",
                    message="Table does not have a unique page association",
                )
            )
            continue
        table_locator = _locator(document, provenance[0], section)
        data = table.get("data", {})
        cells = data.get("table_cells", [])
        rows: dict[int, list[dict[str, Any]]] = defaultdict(list)
        headers: dict[int, list[str]] = defaultdict(list)
        header_cells: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for cell in cells:
            row, col = (
                int(cell["start_row_offset_idx"]),
                int(cell["start_col_offset_idx"]),
            )
            rows[row].append(cell)
            if cell.get("column_header"):
                for column in range(col, int(cell["end_col_offset_idx"])):
                    headers[column].append(str(cell["text"]).strip())
                    header_cells[column].append(cell)
        for row, row_cells in sorted(rows.items()):
            if all(cell.get("column_header") for cell in row_cells):
                continue
            row_cells.sort(key=lambda cell: int(cell["start_col_offset_idx"]))
            if kind == "strategy":
                result.passages.append(
                    ParsedPassage(
                        source_kind=kind,
                        text=" | ".join(str(cell["text"]) for cell in row_cells),
                        locator=table_locator,
                        scope=scope,
                        attributes={
                            "label": "table_row",
                            "claim_role": "context",
                            "table_row": row,
                        },
                        limitations=[
                            "Corporate strategy is context, not engineering feasibility"
                        ],
                    )
                )
                continue
            code_cells = [
                cell
                for cell in cells
                if not cell.get("column_header")
                and int(cell["start_row_offset_idx"])
                <= row
                < int(cell["end_row_offset_idx"])
                and re.fullmatch(r"[A-Z0-9]{3}", str(cell["text"]).strip())
            ]
            code = str(code_cells[0]["text"]).strip() if len(code_cells) == 1 else None
            description_cells = [
                cell
                for cell in row_cells
                if cell not in code_cells and len(str(cell["text"]).strip()) > 3
            ]
            description = " | ".join(str(cell["text"]) for cell in description_cells)
            condition_ids = re.findall(r"\b(\d+)\)|(?<!\d)([¹²³⁴⁵⁶⁷⁸⁹])", description)
            superscripts = str.maketrans("¹²³⁴⁵⁶⁷⁸⁹", "123456789")
            condition_ids = [
                number or superscript.translate(superscripts)
                for number, superscript in condition_ids
            ]
            # Docling can flatten a superscript into a word-final or isolated digit.
            condition_ids.extend(
                word_final or isolated
                for word_final, isolated in re.findall(
                    r"(?<=[^\W\d])([1-9])(?=\s|$)|(?<=\s)([1-9])(?=\s*(?:\n|$))",
                    description,
                )
            )
            condition_ids = list(dict.fromkeys(condition_ids))
            matching_notes = []
            unresolved = []
            for number in condition_ids:
                candidates = [
                    note
                    for note in footnotes
                    if re.match(rf"^{number}[). ]", note.text)
                    and (
                        note.locator.page == table_locator.page
                        or note.attributes.get("condition_scope") == "document"
                    )
                ]
                if len({note.text for note in candidates}) != 1:
                    unresolved.append(number)
                else:
                    matching_notes.extend(candidates)
            conditions = [note.text for note in matching_notes]
            if unresolved:
                result.coverage.append(
                    CoverageIssue(
                        code="unresolved_footnote",
                        message="Referenced condition lacks an unambiguous page-associated note",
                        locator=table_locator,
                    )
                )
            conditions.extend(
                line.strip()
                for line in description.splitlines()
                if re.search(r"Nur in Verbindung|Hinweis:|nur mit", line, re.IGNORECASE)
            )
            for cell in row_cells:
                col = int(cell["start_col_offset_idx"])
                header = " / ".join(headers.get(col, [])) or None
                if cell in code_cells or cell in description_cells:
                    continue
                symbol = str(cell["text"]).strip()
                model_headers = header_cells.get(col, [])
                leaf_headers = [
                    candidate
                    for candidate in model_headers
                    if int(candidate["start_row_offset_idx"])
                    == max(int(item["start_row_offset_idx"]) for item in model_headers)
                ]
                if len(leaf_headers) == 1:
                    header = str(leaf_headers[0]["text"]).strip() or None
                ambiguous = (
                    int(cell["end_col_offset_idx"]) - col != 1
                    or int(cell["end_row_offset_idx"]) - row != 1
                    or sum(
                        int(other["start_row_offset_idx"])
                        <= row
                        < int(other["end_row_offset_idx"])
                        and int(other["start_col_offset_idx"])
                        <= col
                        < int(other["end_col_offset_idx"])
                        for other in cells
                    )
                    != 1
                    or header is None
                    or len(leaf_headers) != 1
                    or int(leaf_headers[0]["end_col_offset_idx"])
                    - int(leaf_headers[0]["start_col_offset_idx"])
                    != 1
                    or not description
                    or bool(unresolved)
                )
                availability = (
                    "unknown" if ambiguous else legends.get(symbol, "unknown")
                )
                if availability == "unknown":
                    result.coverage.append(
                        CoverageIssue(
                            code="ambiguous_table_cell",
                            message="Symbol or row/model association cannot establish availability",
                            locator=table_locator,
                        )
                    )
                bbox_provenance = {
                    "page_no": provenance[0]["page_no"],
                    "bbox": cell.get("bbox"),
                }
                result.passages.append(
                    ParsedPassage(
                        source_kind=kind,
                        text=" | ".join(
                            filter(None, [code, description, header, symbol])
                        ),
                        locator=_locator(document, bbox_provenance, section)
                        if cell.get("bbox")
                        else table_locator,
                        scope=scope,
                        attributes=cast(
                            dict[str, JsonValue],
                            {
                                "option_code": code,
                                "model_column": header,
                                "symbol": symbol,
                                "availability": availability,
                                "conditions": conditions,
                                "footnote_references": condition_ids,
                                "edition": edition,
                                "table_row": row,
                                "table_column": col,
                                "context_locators": context_locators,
                                "condition_locators": [
                                    note.locator.model_dump(mode="json")
                                    for note in matching_notes
                                ],
                                "claim_role": "availability"
                                if kind == "equipment"
                                else "context",
                            },
                        ),
                        limitations=["Unknown availability is not absence"]
                        if availability == "unknown"
                        else [],
                    )
                )
    result.status = "partial" if result.coverage else "ready"
    return result


def parse_pdf(
    data: bytes,
    filename: str,
    *,
    artifacts_path: Path | None = None,
    page_range: tuple[int, int] | None = None,
    timeout_seconds: int = 600,
    memory_mb: int = 4096,
    context_passages: list[ParsedPassage] | None = None,
) -> ParseResult:
    """Run PDF inference in an offline child; no file bodies enter logs or history."""
    if Path(filename).suffix.lower() != ".pdf" or not data.startswith(b"%PDF-"):
        return ParseResult(
            kind="unknown",
            parser_revision=PARSER_REVISION,
            status="unsupported",
            coverage=[
                CoverageIssue(
                    code="unsupported_pdf", message="Only text PDF input is supported"
                )
            ],
        )
    root = artifacts_path or Path(
        os.environ.get("PDF_ARTIFACTS_PATH", ".local/pdf-models")
    )
    try:
        revisions = verify_artifacts(root)
    except ModelArtifactsUnavailable:
        return ParseResult(
            kind="unknown",
            parser_revision=PARSER_REVISION,
            status="failed",
            coverage=[
                CoverageIssue(
                    code="pdf_models_unavailable",
                    message="Preloaded pinned PDF model artifacts are unavailable",
                )
            ],
        )
    with tempfile.TemporaryDirectory(prefix="vehicle-pdf-") as directory:
        original = Path(directory) / "original.pdf"
        original.write_bytes(data)
        request = {
            "path": str(original),
            "filename": filename,
            "artifacts_path": str(root.resolve()),
            "page_range": page_range,
            "timeout_seconds": timeout_seconds,
            "memory_mb": memory_mb,
            "context_passages": [
                passage.model_dump(mode="json") for passage in context_passages or []
            ],
            "max_output_bytes": MAX_OUTPUT_BYTES,
        }
        env = {
            key: value
            for key, value in os.environ.items()
            if key in {"PATH", "PYTHONPATH", "SYSTEMROOT", "TEMP", "TMP"}
        }
        env.update(
            {
                "HF_HUB_OFFLINE": "1",
                "TRANSFORMERS_OFFLINE": "1",
                "OMP_NUM_THREADS": "2",
                "OPENBLAS_NUM_THREADS": "2",
            }
        )
        try:
            with tempfile.TemporaryFile() as output:
                child = subprocess.run(
                    [sys.executable, "-m", "app.pdf_worker"],
                    input=json.dumps(request).encode(),
                    stdout=output,
                    stderr=subprocess.DEVNULL,
                    timeout=timeout_seconds + 10,
                    env=env,
                )
                if child.returncode:
                    raise ValueError("Parser process failed")
                output.seek(0)
                payload = output.read(MAX_OUTPUT_BYTES + 1)
            if len(payload) > MAX_OUTPUT_BYTES:
                return ParseResult(
                    kind="unknown",
                    parser_revision=PARSER_REVISION,
                    status="failed",
                    parser_versions=revisions,
                    coverage=[
                        CoverageIssue(
                            code="pdf_output_limit",
                            message="PDF parser output exceeds its bounded size",
                        )
                    ],
                )
            result = ParseResult.model_validate_json(payload)
            result.parser_versions.update(revisions)
            return result
        except ValueError, OSError, subprocess.TimeoutExpired:
            return ParseResult(
                kind="unknown",
                parser_revision=PARSER_REVISION,
                status="failed",
                parser_versions=revisions,
                coverage=[
                    CoverageIssue(
                        code="pdf_parser_limit",
                        message="Bounded PDF parser failed or exhausted resources",
                    )
                ],
            )
