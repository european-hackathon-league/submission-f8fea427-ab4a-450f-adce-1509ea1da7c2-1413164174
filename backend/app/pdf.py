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

PARSER_REVISION = "docling-pdf-v6"
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


def _positioned_descriptions(
    document: dict[str, Any],
    cells: list[dict[str, Any]],
    provenance: dict[str, Any],
    fragments: list[dict[str, Any]],
) -> dict[int, tuple[str, str]]:
    """Recover physical equipment rows, keeping Docling's model/symbol grid."""
    if not fragments:
        return {}
    page = int(provenance["page_no"])
    boxed = [
        (cell, _locator(document, {"page_no": page, "bbox": cell.get("bbox")}).bbox)
        for cell in cells
    ]
    codes = [
        (cell, box)
        for cell, box in boxed
        if box
        and not cell.get("column_header")
        and re.fullmatch(r"[A-Z0-9]{3}", str(cell["text"]).strip())
    ]
    if not codes:
        return {}
    code_columns = {int(cell["start_col_offset_idx"]) for cell, _ in codes}
    if len(code_columns) != 1:
        return {}
    # A description column contains prose, unlike prices and availability symbols.
    descriptions = [
        (cell, box)
        for cell, box in boxed
        if box
        and not cell.get("column_header")
        and len(str(cell["text"])) > 3
        and re.search(r"[a-zA-Z]{4}", str(cell["text"]))
        and int(cell["start_col_offset_idx"]) not in code_columns
    ]
    columns: dict[int, int] = defaultdict(int)
    for cell, _ in descriptions:
        columns[int(cell["start_col_offset_idx"])] += len(str(cell["text"]))
    if not columns:
        return {}
    description_column = max(columns, key=lambda col: columns[col])
    description_boxes = [
        box
        for cell, box in descriptions
        if int(cell["start_col_offset_idx"]) == description_column
    ]
    left = min(box[0] for box in description_boxes)
    right = max(box[2] for box in description_boxes)
    # Section cells may span the whole table. Do not let their width admit
    # neighboring prices, option codes, or model symbols into the prose.
    preceding = [
        box[2]
        for cell, box in boxed
        if box and int(cell["end_col_offset_idx"]) <= description_column
    ]
    following = [
        box[0]
        for cell, box in boxed
        if box and int(cell["start_col_offset_idx"]) > description_column
    ]
    if preceding:
        left = max(left, max(preceding) + 2)
    if following:
        right = min(right, min(following) - 2)
    if right <= left:
        return {}
    anchors = []
    for cell, box in codes:
        matches = [
            fragment
            for fragment in fragments
            if not fragment.get("uncertain")
            and str(fragment["text"]).strip() == str(cell["text"]).strip()
            and box[0] - 2 <= float(fragment["x"]) <= box[2] + 2
            and box[1] - 2 <= float(fragment["y"]) <= box[3] + 2
        ]
        if len(matches) != 1:
            return {}  # Never guess a missing or duplicated source code anchor.
        anchors.append((float(matches[0]["y"]), str(cell["text"]).strip(), cell))
    anchors.sort(key=lambda anchor: anchor[0])
    if any(second[0] - first[0] < 2 for first, second in zip(anchors, anchors[1:])):
        return {}
    sections = [
        box[1]
        for cell, box in descriptions
        if int(cell["start_col_offset_idx"]) == description_column
        and str(cell["text"]).strip().isupper()
    ]
    table_bottom = max(box[3] for _, box in boxed if box) + 2
    if any(
        fragment.get("uncertain")
        and left - 2 <= float(fragment["x"]) <= right + 2
        and anchors[0][0] - 0.8 <= float(fragment["y"]) <= table_bottom
        for fragment in fragments
    ):
        return {}
    recovered = []
    for index, (start, code, _) in enumerate(anchors):
        end = anchors[index + 1][0] if index + 1 < len(anchors) else table_bottom
        end = min([end] + [boundary for boundary in sections if boundary > start + 2])
        selected = sorted(
            [
                fragment
                for fragment in fragments
                if left - 2 <= float(fragment["x"]) <= right + 2
                and start - 0.8 <= float(fragment["y"]) < end - 0.8
            ],
            key=lambda fragment: (round(float(fragment["y"])), float(fragment["x"])),
        )
        lines: list[tuple[float, list[str]]] = []
        for fragment in selected:
            text = str(fragment["text"]).strip()
            if not text:
                continue
            y = float(fragment["y"])
            if not lines or abs(lines[-1][0] - y) > 0.8:
                lines.append((y, []))
            lines[-1][1].append(text)
        description = "\n".join(" ".join(parts) for _, parts in lines)
        if not description:
            return {}
        recovered.append((start, end, code, description))
    result = {}
    for row in {
        int(cell["start_row_offset_idx"])
        for cell in cells
        if not cell.get("column_header")
    }:
        own_codes = [
            anchor
            for anchor in anchors
            if int(anchor[2]["start_row_offset_idx"])
            <= row
            < int(anchor[2]["end_row_offset_idx"])
        ]
        if len(own_codes) == 1:
            y = own_codes[0][0]
        else:
            row_boxes = [
                box
                for cell, box in boxed
                if box
                and int(cell["start_row_offset_idx"]) == row
                and int(cell["start_col_offset_idx"]) != description_column
            ]
            if not row_boxes:
                continue
            y = min(box[1] for box in row_boxes) + 2
        row_matches = [
            (code, description)
            for start, end, code, description in recovered
            if start - 0.8 <= y < end - 0.8
        ]
        if len(row_matches) == 1:
            result[row] = row_matches[0]
    return result


def normalize_document(
    document: dict[str, Any],
    kind: PDFKind,
    *,
    context_passages: list[ParsedPassage] | None = None,
    positioned_text: dict[int, list[dict[str, Any]]] | None = None,
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
        source_descriptions = (
            _positioned_descriptions(
                document,
                cells,
                provenance[0],
                (positioned_text or {}).get(table_locator.page, []),
            )
            if kind == "equipment"
            else {}
        )
        rows: dict[int, list[dict[str, Any]]] = defaultdict(list)
        headers: dict[int, list[str]] = defaultdict(list)
        header_cells: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for cell in cells:
            row, col = (
                int(cell["start_row_offset_idx"]),
                int(cell["start_col_offset_idx"]),
            )
            rows[row].append(cell)
            # A body availability mark can be misclassified as a later header.
            # It cannot replace the genuine model name or establish one itself.
            if cell.get("column_header") and re.search(r"\w", str(cell["text"])):
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
            description_association_unknown = False
            if code_cells:
                code_box = _locator(
                    document,
                    {"page_no": table_locator.page, "bbox": code_cells[0].get("bbox")},
                ).bbox
                next_code_tops = [
                    other_box[1]
                    for other in cells
                    if int(other["start_row_offset_idx"]) > row
                    and not other.get("column_header")
                    and re.fullmatch(r"[A-Z0-9]{3}", str(other["text"]).strip())
                    and (
                        other_box := _locator(
                            document,
                            {"page_no": table_locator.page, "bbox": other.get("bbox")},
                        ).bbox
                    )
                ]
                description_association_unknown = code_box is not None and any(
                    (
                        box := _locator(
                            document,
                            {
                                "page_no": table_locator.page,
                                "bbox": candidate.get("bbox"),
                            },
                        ).bbox
                    )
                    and (
                        box[1] < code_box[1] - 3
                        or bool(next_code_tops)
                        and box[3] > min(next_code_tops) + 3
                    )
                    for candidate in description_cells
                )
            source_row = source_descriptions.get(row)
            if source_row:
                code, description = source_row
                description_association_unknown = False
            elif description_association_unknown:
                result.passages.append(
                    ParsedPassage(
                        source_kind=kind,
                        text=description,
                        locator=table_locator,
                        scope=scope,
                        attributes={
                            "claim_role": "context",
                            "condition_association": "unknown",
                        },
                        limitations=[
                            "Equipment description crosses a row boundary; condition association is unknown"
                        ],
                    )
                )
                description = ""
                result.coverage.append(
                    CoverageIssue(
                        code="unknown_condition_association",
                        message="Merged description cannot be associated with one equipment option",
                        locator=table_locator,
                    )
                )
            # Scan a copy: model labels and explicit page citations are prose,
            # even when their final digits resemble flattened note markers.
            reference_text = re.sub(
                r"\bi[1-9]\b|\b(?:Seiten?|pages?)\s+\d+(?:\s*[-–]\s*\d+)?\)?",
                "",
                description,
                flags=re.IGNORECASE,
            )
            condition_ids = re.findall(
                r"\b(\d+)\)|(?<!\d)([¹²³⁴⁵⁶⁷⁸⁹])", reference_text
            )
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
                    reference_text,
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
            condition_lines = description.splitlines()
            for index, line in enumerate(condition_lines):
                if not re.search(
                    r"in Verbindung|Hinweis:|nur mit", line, re.IGNORECASE
                ):
                    continue
                continuation = [line.strip()]
                for following_line in condition_lines[index + 1 :]:
                    if (
                        not following_line.strip()
                        or re.match(r"\s*[-–•]", following_line)
                        or re.search(
                            r"in Verbindung|Hinweis:|nur mit",
                            following_line,
                            re.IGNORECASE,
                        )
                    ):
                        break
                    continuation.append(following_line.strip())
                conditions.append("\n".join(continuation))
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
                    or description_association_unknown
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
                                "condition_association": "unknown"
                                if description_association_unknown
                                else "source_associated",
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
