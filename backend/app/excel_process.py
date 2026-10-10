"""Disposable, bounded Excel normalization with frozen policy and typed output."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from app.excel import REVISION, parse_excel
from app.ingest_types import CoverageIssue, ParseResult

CPU_SECONDS = 15
WALL_SECONDS = 30
MEMORY_BYTES = 512 * 1024 * 1024
MAX_OUTPUT_BYTES = 256 * 1024 * 1024


def parse_excel_bounded(data: bytes, binding: dict[str, Any]) -> ParseResult:
    with tempfile.TemporaryDirectory(prefix="excel-parse-") as directory:
        root = Path(directory)
        source, policy, output = (
            root / "source.xlsx",
            root / "policy.json",
            root / "result.json",
        )
        source.write_bytes(data)
        policy.write_text(json.dumps(binding), encoding="utf-8")
        try:
            subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "app.excel_process",
                    str(source),
                    str(policy),
                    str(output),
                ],
                check=True,
                timeout=WALL_SECONDS,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if output.stat().st_size > MAX_OUTPUT_BYTES:
                raise ValueError("Output limit exceeded")
            return ParseResult.model_validate_json(output.read_bytes())
        except subprocess.SubprocessError, OSError, ValueError:
            return ParseResult(
                kind="unknown",
                parser_revision=REVISION,
                status="failed",
                coverage=[
                    CoverageIssue(
                        code="excel_parser_resource_limit",
                        message="Excel normalization failed within isolated resource limits",
                        severity="error",
                    )
                ],
            )


def main() -> None:
    import resource

    resource.setrlimit(resource.RLIMIT_AS, (MEMORY_BYTES, MEMORY_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_SECONDS, CPU_SECONDS))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))
    source, policy, output = (Path(value) for value in sys.argv[1:])
    binding = json.loads(policy.read_text(encoding="utf-8"))
    result = parse_excel(
        source.read_bytes(),
        dataset_namespace=binding["dataset_namespace"],
        reference_year=binding["reference_year"],
        header_aliases=binding["header_aliases"],
        max_rows=binding.get("excel_max_rows", 10000),
        max_columns=binding.get("excel_max_columns", 64),
        max_cells=binding.get("excel_max_cells", 1000000),
    )
    output.write_text(result.model_dump_json(), encoding="utf-8")


if __name__ == "__main__":
    main()
