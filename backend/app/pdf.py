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

PARSER_REVISION = "docling-pdf-v1"
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


def normalize_document(document: dict[str, Any], kind: PDFKind) -> ParseResult:
    """Normalize an actual Docling export without translating original passages."""
    result = ParseResult(
        kind=kind,
        parser_revision=PARSER_REVISION,
        parser_versions={"docling": "2.137.0"},
    )
    texts = document.get("texts", [])
    source_text = "\n".join(str(item.get("text", "")) for item in texts)
    edition_match = re.search(r"Juli\s+(20\d{2})", source_text, re.IGNORECASE)
    year_match = re.search(
        r"(?:Report|Bericht)\s+(20\d{2})", source_text, re.IGNORECASE
    )
    edition = f"{edition_match[1]}-07" if edition_match else None
    scope = Scope(
        markets=["DE"]
        if re.search(r"\bDeutschland\b", source_text, re.IGNORECASE)
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
    footnotes = [
        str(item.get("text", ""))
        for item in texts
        if item.get("label") == "footnote"
        or re.match(r"^\d+\)", str(item.get("text", "")))
    ]
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
        for cell in cells:
            row, col = (
                int(cell["start_row_offset_idx"]),
                int(cell["start_col_offset_idx"]),
            )
            rows[row].append(cell)
            if cell.get("column_header"):
                for column in range(col, int(cell["end_col_offset_idx"])):
                    headers[column].append(str(cell["text"]).strip())
        for row, row_cells in sorted(rows.items()):
            if all(cell.get("column_header") for cell in row_cells):
                continue
            row_cells.sort(key=lambda cell: int(cell["start_col_offset_idx"]))
            code_cells = [
                cell
                for cell in row_cells
                if re.fullmatch(r"[A-Z0-9]{3}", str(cell["text"]).strip())
            ]
            code = str(code_cells[0]["text"]).strip() if len(code_cells) == 1 else None
            description_cells = [
                cell
                for cell in row_cells
                if cell not in code_cells and len(str(cell["text"]).strip()) > 3
            ]
            description = " | ".join(str(cell["text"]) for cell in description_cells)
            condition_ids = re.findall(r"\b(\d+)\)", description)
            conditions = [
                note
                for note in footnotes
                if any(re.match(rf"^{number}\)", note) for number in condition_ids)
            ]
            for cell in row_cells:
                col = int(cell["start_col_offset_idx"])
                header = " / ".join(headers.get(col, [])) or None
                if cell in code_cells or cell in description_cells:
                    continue
                symbol = str(cell["text"]).strip()
                ambiguous = (
                    int(cell["end_col_offset_idx"]) - col != 1
                    or int(cell["end_row_offset_idx"]) - row != 1
                    or header is None
                    or code is None
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
    timeout_seconds: int = 180,
    memory_mb: int = 4096,
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
            child = subprocess.run(
                [sys.executable, "-m", "app.pdf_worker"],
                input=json.dumps(request).encode(),
                capture_output=True,
                timeout=timeout_seconds + 10,
                env=env,
            )
            if child.returncode:
                raise ValueError("Parser process failed")
            result = ParseResult.model_validate_json(child.stdout)
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
