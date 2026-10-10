import re

from fixtures.excel import FEEDBACK_HEADERS, feedback_row, workbook, worksheet_xml

from app.excel import parse_excel


def feedback_book():
    return workbook({"Feedback_Explorer": [FEEDBACK_HEADERS, feedback_row()]})


def test_huge_declared_dimensions_fail_before_openpyxl_load(monkeypatch):
    data = worksheet_xml(
        feedback_book(),
        lambda xml: re.sub(
            r'<dimension ref="[^"]+"', '<dimension ref="A1:XFD1048576"', xml
        ),
    )

    def forbidden(*args, **kwargs):
        raise AssertionError("oversized dimensions reached workbook allocation")

    monkeypatch.setattr("app.excel.load_workbook", forbidden)
    result = parse_excel(data, dataset_namespace="bounded")
    assert result.status == "failed"
    assert result.records == []
    assert [issue.code for issue in result.coverage] == ["parser_resource_limit"]


def test_missing_or_forged_small_dimensions_do_not_truncate_valid_evidence():
    for transform in (
        lambda xml: re.sub(r"<dimension[^>]*/>", "", xml),
        lambda xml: re.sub(r'<dimension ref="[^"]+"', '<dimension ref="A1:A1"', xml),
    ):
        result = parse_excel(
            worksheet_xml(feedback_book(), transform), dataset_namespace="bounded"
        )
        assert len(result.records) == 1
        assert result.records[0].annotations[0].locator.cells[-1] == "L2"


def test_missing_dimensions_actual_coordinate_and_cell_budgets_fail_boundedly():
    data = worksheet_xml(
        feedback_book(),
        lambda xml: (
            re.sub(r"<dimension[^>]*/>", "", xml)
            .replace('r="2"', 'r="10001"')
            .replace('r="A2"', 'r="A10001"')
        ),
    )
    result = parse_excel(data, dataset_namespace="bounded")
    assert result.status == "failed"
    assert result.coverage[0].code == "parser_resource_limit"
    for limit in ({"max_rows": 1}, {"max_columns": 11}, {"max_cells": 23}):
        result = parse_excel(feedback_book(), dataset_namespace="bounded", **limit)
        assert result.status == "failed"
        assert result.coverage[0].code == "parser_resource_limit"


def test_actual_wide_coordinates_and_combined_sheet_budget_are_bounded():
    wide = worksheet_xml(
        feedback_book(),
        lambda xml: re.sub(r"<dimension[^>]*/>", "", xml).replace('r="A2"', 'r="ZZ2"'),
    )
    assert parse_excel(wide, dataset_namespace="bounded").status == "failed"
    data = workbook({"One": [[1, 2]], "Two": [[3, 4]]})
    result = parse_excel(data, dataset_namespace="bounded", max_cells=3)
    assert result.status == "failed"
    assert result.coverage[0].code == "parser_resource_limit"
