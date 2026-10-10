"""Disposable Linux PDF inference process. All stdout is validated private output."""

import json
import logging
import resource
import socket
import sys
import time
from pathlib import Path
from typing import Any, Literal, NoReturn


def _deny_network(*args: Any, **kwargs: Any) -> NoReturn:
    raise OSError("PDF parser network access is disabled")


def extract(request: dict[str, Any]) -> dict[str, Any]:
    from docling.datamodel.accelerator_options import (  # type: ignore[import-not-found]
        AcceleratorDevice,
        AcceleratorOptions,
    )
    from docling.datamodel.base_models import InputFormat  # type: ignore[import-not-found]
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode  # type: ignore[import-not-found]
    from docling.datamodel.stage_model_specs import ObjectDetectionModelSpec  # type: ignore[import-not-found]
    from docling.document_converter import DocumentConverter, PdfFormatOption  # type: ignore[import-not-found]
    from pypdf import PdfReader, PdfWriter

    from app.ingest_types import CoverageIssue, ParseResult
    from app.parser_models import declarations
    from app.pdf import PARSER_REVISION, normalize_document

    options = PdfPipelineOptions(
        artifacts_path=Path(request["artifacts_path"]),
        do_ocr=False,
        enable_remote_services=False,
        allow_external_plugins=False,
        document_timeout=request["timeout_seconds"],
        accelerator_options=AcceleratorOptions(
            device=AcceleratorDevice.CPU, num_threads=2
        ),
    )
    layout = declarations()[0]
    options.layout_options.model_spec = ObjectDetectionModelSpec(
        name="layout_heron", repo_id=layout["repo_id"], revision=layout["revision"]
    )
    options.table_structure_options.mode = TableFormerMode.ACCURATE
    options.table_structure_options.do_cell_matching = True
    converter = DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)},
    )
    path = Path(request["path"])
    reader = PdfReader(path)
    if reader.is_encrypted:
        if not reader.decrypt(""):
            raise ValueError("PDF requires a password")
        decrypted = path.with_name("decrypted.pdf")
        writer = PdfWriter(clone_from=reader)
        writer.write(decrypted)
        path = decrypted
    total_pages = len(reader.pages)
    start, end = request.get("page_range") or (1, total_pages)
    if not 1 <= start <= end <= total_pages:
        raise ValueError("Invalid PDF page range")
    # Classification selects a source family; scope still comes only from content.
    filename = str(request["filename"]).lower()
    kind: Literal["equipment", "strategy"] = (
        "equipment" if "option" in filename or "equipment" in filename else "strategy"
    )
    result = ParseResult(
        kind=kind,
        parser_revision=PARSER_REVISION,
        parser_versions={"docling": "2.137.0"},
    )
    started = time.monotonic()
    for first in range(start, end + 1, 10):
        last = min(first + 9, end)
        if time.monotonic() - started >= request["timeout_seconds"] - 5:
            result.coverage.append(
                CoverageIssue(
                    code="pdf_batch_deadline",
                    message="Document parsing stopped at its bounded deadline",
                )
            )
            break
        converted = converter.convert(
            path,
            raises_on_error=False,
            page_range=(first, last),
            max_num_pages=500,
            max_file_size=32 * 1024 * 1024,
        )
        normalized = normalize_document(converted.document.export_to_dict(), kind)
        result.passages.extend(normalized.passages)
        result.coverage.extend(normalized.coverage)
        if str(converted.status.value) not in {"success", "partial_success"}:
            result.coverage.append(
                CoverageIssue(
                    code="pdf_batch_failed", message="A PDF page batch did not complete"
                )
            )
        del converted
    result.status = (
        "partial"
        if result.passages and result.coverage
        else "failed"
        if not result.passages
        else "ready"
    )
    return result.model_dump(mode="json")


def main() -> None:
    request = json.loads(sys.stdin.buffer.read())
    memory = int(request["memory_mb"]) * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
    cpu = int(request["timeout_seconds"])
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
    logging.disable(logging.CRITICAL)
    socket.socket.connect = _deny_network  # type: ignore[method-assign]
    socket.socket.connect_ex = _deny_network  # type: ignore[method-assign]
    socket.create_connection = _deny_network
    sys.stdout.write(json.dumps(extract(request)))


if __name__ == "__main__":
    main()
