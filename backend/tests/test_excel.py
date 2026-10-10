from fixtures.excel import FEEDBACK_HEADERS, feedback_row, workbook

from app.excel import parse_excel


def test_feedback_annotations_preserve_exact_cells_original_values_and_cohort_sets():
    first = feedback_row()
    second = feedback_row()
    second[10] = "usability"
    result = parse_excel(
        workbook({"Feedback_Explorer": [FEEDBACK_HEADERS, first, second]}),
        dataset_namespace="survey-2025",
    )
    assert result.kind == "feedback"
    assert len(result.records) == 1
    record = result.records[0]
    assert (
        record.dataset_namespace,
        record.source_namespace,
        record.external_record_id,
    ) == ("survey-2025", "survey", "1")
    assert len(record.annotations) == 2
    assert record.annotations[0].text == "Synthetic comfort"
    assert record.annotations[0].locator.cells == [
        f"{letter}2" for letter in "ABCDEFGHIJKL"
    ]
    assert record.annotations[1].locator.row == 3
    assert record.annotations[0].classifications["Engine Type"] == "unknown-code"
    assert record.annotations[0].classifications["Feedback Type"] is None
    assert set(record.scope.cohort_ids) == {"DE", "EU"}


def test_identity_namespaces_equal_text_conflicts_and_overlapping_uploads():
    rows = [
        feedback_row(),
        feedback_row(record_id="2"),
        feedback_row(source="other"),
        feedback_row(text="Synthetic opposing text"),
    ]
    data = workbook({"Feedback_Explorer": [FEEDBACK_HEADERS, *rows]})
    first = parse_excel(data, dataset_namespace="dataset-one")
    repeat = parse_excel(data, dataset_namespace="dataset-one")
    unrelated = parse_excel(data, dataset_namespace="dataset-two")

    def identities(result):
        return {
            (r.dataset_namespace, r.source_namespace, r.external_record_id)
            for r in result.records
        }

    assert len(first.records) == 3
    assert identities(first) == identities(repeat)
    assert identities(first).isdisjoint(identities(unrelated))
    conflict = next(
        r
        for r in first.records
        if r.source_namespace == "survey" and r.external_record_id == "1"
    )
    assert conflict.text_variants == ["Synthetic comfort", "Synthetic opposing text"]
    assert len(conflict.annotations) == 2
    assert any(issue.code == "conflicting_feedback_text" for issue in first.coverage)


def test_alias_headers_and_missing_identity_produce_explicit_coverage():
    headers = FEEDBACK_HEADERS.copy()
    headers[5] = "Derivative"
    headers[8] = "Comment"
    result = parse_excel(
        workbook({"Feedback_Explorer": [headers, feedback_row(record_id=None)]}),
        dataset_namespace="dataset",
        header_aliases={"Derivative": "vehicle", "Comment": "text"},
    )
    assert result.status == "partial"
    assert result.records == []
    assert len(result.unresolved_annotations) == 1
    assert result.unresolved_annotations[0].text == "Synthetic comfort"
    assert any(issue.code == "missing_record_identity" for issue in result.coverage)


def test_changed_layout_is_a_mapping_outcome_and_formulas_never_execute():
    unknown = parse_excel(
        workbook({"Unknown": [["Unexpected", "Layout"], [1, 2]]}),
        dataset_namespace="dataset",
    )
    assert unknown.status == "unsupported"
    assert unknown.kind == "unknown"
    assert unknown.coverage[0].code == "mapping_required"
    row = feedback_row()
    row[8] = '=CONCAT("synthetic", "formula")'
    result = parse_excel(
        workbook({"Feedback_Explorer": [FEEDBACK_HEADERS, row]}),
        dataset_namespace="dataset",
    )
    assert not result.records
    assert any(issue.code == "missing_formula_cache" for issue in result.coverage)


def test_empty_feedback_sheet_reports_mapping_coverage():
    result = parse_excel(
        workbook({"Feedback_Explorer": []}), dataset_namespace="dataset"
    )
    assert result.status == "unsupported"
    assert result.records == []
    assert result.coverage[0].code == "mapping_required"
