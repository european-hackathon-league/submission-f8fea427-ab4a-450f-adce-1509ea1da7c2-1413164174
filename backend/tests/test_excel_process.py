import subprocess

from fixtures.excel import FEEDBACK_HEADERS, feedback_row, workbook

from app.excel import REVISION
from app.excel_process import parse_excel_bounded


def policy():
    return {
        "dataset_namespace": "synthetic_dataset",
        "reference_year": 2026,
        "header_aliases": {},
    }


def test_isolated_excel_parser_returns_typed_records_with_frozen_identity():
    result = parse_excel_bounded(
        workbook({"Feedback_Explorer": [FEEDBACK_HEADERS, feedback_row()]}), policy()
    )
    assert result.parser_revision == REVISION
    assert result.status == "ready"
    assert len(result.records) == 1
    assert result.records[0].dataset_namespace == "synthetic_dataset"


def test_excel_deadline_or_child_termination_returns_explicit_coverage(monkeypatch):
    for error in (
        subprocess.TimeoutExpired("synthetic-parser", 30),
        subprocess.CalledProcessError(-9, "synthetic-parser"),
    ):

        def fail(*args, **kwargs):
            raise error

        monkeypatch.setattr(subprocess, "run", fail)
        result = parse_excel_bounded(b"synthetic", policy())
        assert result.status == "failed"
        assert result.records == []
        assert result.coverage[0].code == "excel_parser_resource_limit"
