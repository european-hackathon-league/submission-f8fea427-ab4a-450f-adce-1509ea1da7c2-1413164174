import json

import pytest

from app.ingest_types import ParsedPassage, ParseResult
from app.wire import PDFLocator


def test_reference_evaluation_separates_missing_wrong_and_unknown_claims():
    from app.pdf_evaluation import evaluate_reference

    result = ParseResult(
        kind="equipment",
        parser_revision="synthetic",
        passages=[
            ParsedPassage(
                source_kind="equipment",
                text="synthetic",
                locator=PDFLocator(page=2, bbox=(10, 20, 30, 40)),
                attributes={
                    "option_code": "4ZZ",
                    "model_column": "model-a",
                    "availability": "standard",
                },
            ),
            ParsedPassage(
                source_kind="equipment",
                text="synthetic",
                locator=PDFLocator(page=2),
                attributes={
                    "option_code": "6YY",
                    "model_column": "model-a",
                    "availability": "unknown",
                },
            ),
        ],
    )
    references = [
        {
            "page": 2,
            "option_code": "4ZZ",
            "model_column": "model-a",
            "availability": "standard",
            "anchor": [20, 30],
        },
        {
            "page": 2,
            "option_code": "6YY",
            "model_column": "model-a",
            "availability": "optional",
        },
        {
            "page": 3,
            "option_code": "4ZZ",
            "model_column": "model-a",
            "availability": "optional",
        },
    ]
    report = evaluate_reference(result, references)
    assert report["reference_cases"] == 3
    assert report["correct_availability"] == 1
    assert report["unknown_availability"] == 1
    assert report["missing_or_ambiguous"] == 1
    assert report["locator_checks"] == report["correct_locators"] == 1
    assert not report["release_gate_passed"]


def test_reference_evaluation_does_not_accept_correct_words_on_the_wrong_page():
    from app.pdf_evaluation import evaluate_reference

    result = ParseResult(
        kind="strategy",
        parser_revision="synthetic",
        passages=[
            ParsedPassage(
                source_kind="strategy",
                text="Synthetic corporate strategy",
                locator=PDFLocator(page=7, bbox=(0, 0, 50, 50)),
            )
        ],
    )
    report = evaluate_reference(
        result, [{"page": 8, "text_contains": "corporate strategy"}]
    )
    assert report["missing_or_ambiguous"] == 1
    assert report["correct_text"] == 0
    assert not report["release_gate_passed"]


def test_missing_references_still_count_against_locator_and_condition_thresholds():
    from app.pdf_evaluation import evaluate_reference

    result = ParseResult(
        kind="strategy",
        parser_revision="synthetic",
        passages=[
            ParsedPassage(
                source_kind="strategy",
                text=f"Synthetic passage {index}",
                locator=PDFLocator(page=index + 1, bbox=(0, 0, 50, 50)),
            )
            for index in range(9)
        ],
    )
    references = [
        {
            "page": index + 1,
            "text_contains": f"Synthetic passage {index}",
            "anchor": [20, 30],
        }
        for index in range(10)
    ]
    references[-1]["condition_contains"] = "Synthetic missing condition"
    report = evaluate_reference(result, references)
    assert report["locator_checks"] == 10
    assert report["correct_locators"] == 9
    assert report["condition_checks"] == 1
    assert report["correct_conditions"] == 0
    assert not report["release_gate_passed"]


def test_reference_text_matching_ignores_pdf_line_wrapping():
    from app.pdf_evaluation import evaluate_reference

    result = ParseResult(
        kind="strategy",
        parser_revision="synthetic",
        passages=[
            ParsedPassage(
                source_kind="strategy",
                text="Synthetic customer\nsatisfaction  studies",
                locator=PDFLocator(page=14, bbox=(0, 0, 50, 50)),
            )
        ],
    )
    report = evaluate_reference(
        result,
        [
            {
                "page": 14,
                "text_contains": "customer satisfaction studies",
                "anchor": [20, 30],
            }
        ],
    )
    assert report["matched"] == 1
    assert report["release_gate_passed"]


def test_reference_anchor_disambiguates_repeated_passages_on_the_same_page():
    from app.pdf_evaluation import evaluate_reference

    result = ParseResult(
        kind="strategy",
        parser_revision="synthetic",
        passages=[
            ParsedPassage(
                source_kind="strategy",
                text="Synthetic strategy",
                locator=PDFLocator(page=14, bbox=box),
            )
            for box in [(0, 0, 50, 50), (0, 100, 50, 150)]
        ],
    )
    report = evaluate_reference(
        result,
        [
            {
                "page": 14,
                "text_contains": "Synthetic strategy",
                "anchor": [20, 30],
            }
        ],
    )
    assert report["matched"] == 1
    assert report["correct_locators"] == 1
    assert report["release_gate_passed"]


def test_cli_exits_nonzero_when_the_reference_gate_fails(tmp_path, monkeypatch, capsys):
    from app import pdf_evaluation as module

    source = tmp_path / "synthetic.pdf"
    source.write_bytes(b"synthetic")
    reference = tmp_path / "reference.json"
    reference.write_text(
        json.dumps(
            {"cases": [{"page": 1, "text_contains": "missing", "anchor": [0, 0]}]}
        )
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "pdf_evaluation",
            "--source",
            str(source),
            "--reference",
            str(reference),
            "--artifacts",
            str(tmp_path),
            "--pages",
            "1",
            "1",
        ],
    )
    monkeypatch.setattr(
        module,
        "parse_pdf",
        lambda *args, **kwargs: ParseResult(
            kind="strategy", parser_revision="synthetic", status="failed"
        ),
    )
    with pytest.raises(SystemExit) as error:
        module.main()
    assert error.value.code == 1
    assert not json.loads(capsys.readouterr().out)["evaluation"]["release_gate_passed"]
