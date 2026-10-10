import re

from fixtures.excel import workbook, worksheet_xml

from app.excel import parse_excel


def test_sales_zero_unknown_combined_vehicle_and_future_year_are_context_only():
    result = parse_excel(
        workbook(
            {
                "G60_G68": [
                    ["market", "market_code", "Sales 2024", "Sales 2025", "Sales 2030"],
                    ["USA", "US", 0, None, 500],
                    ["Europe", "EU", 10, 20, 30],
                ]
            }
        ),
        dataset_namespace="sales",
        reference_year=2026,
    )
    assert result.kind == "sales"
    assert result.records == []
    assert len(result.metrics) == 6
    assert result.metrics[0].value == 0
    assert result.metrics[0].unit == "vehicles"
    assert result.metrics[0].limitations == []
    assert result.metrics[1].value is None
    assert result.metrics[2].value == 500
    assert result.metrics[0].scope.vehicle_ids == ["G60", "G68"]
    assert result.metrics[0].scope.markets == ["US"]
    assert result.metrics[2].scope.year == 2030
    assert "future_year_context" in result.metrics[2].limitations
    assert result.metrics[0].locator.cells == ["C2", "A2", "B2", "C1"]


def test_sales_unknown_markets_invalid_values_and_uncached_formulas_are_explicit():
    result = parse_excel(
        workbook(
            {
                "G60": [
                    ["market", "market_code", "Sales 2024", "Sales 2025"],
                    ["Unmapped country", "XX", "unknown", "=1+1"],
                    ["USA", "US", -10, 4],
                ]
            }
        ),
        dataset_namespace="sales",
    )
    assert result.kind == "sales"
    assert result.status == "partial"
    assert result.records == []
    assert [metric.value for metric in result.metrics] == [None, None, None, 4]
    assert result.metrics[0].scope.markets == []
    assert result.metrics[1].raw_cells["D2"] == "=1+1"
    assert {issue.code for issue in result.coverage} >= {
        "unknown_country_mapping",
        "invalid_numeric_value",
        "missing_formula_cache",
        "negative_sales_value",
    }


def test_changed_sales_header_year_is_not_guessed():
    result = parse_excel(
        workbook(
            {
                "G60": [
                    ["market", "market_code", "Sales recent"],
                    ["USA", "US", 10],
                ]
            }
        ),
        dataset_namespace="sales",
    )
    assert result.status == "unsupported"
    assert result.metrics == []
    assert any(issue.code == "mapping_required" for issue in result.coverage)


def test_fractional_vehicle_counts_and_conflicting_market_metadata_are_gaps():
    result = parse_excel(
        workbook(
            {
                "G60": [
                    ["market", "market_code", "Sales 2025"],
                    ["USA", "DE", 0.5],
                    ["Germany", "DEU", 10],
                ]
            }
        ),
        dataset_namespace="sales",
    )
    assert result.status == "partial"
    assert result.metrics[0].value is None
    assert result.metrics[0].raw_cells["C2"] == 0.5
    assert result.metrics[0].scope.markets == []
    assert result.metrics[1].scope.markets == ["DE"]
    assert result.metrics[1].value == 10
    assert {issue.code for issue in result.coverage} >= {
        "noninteger_sales_value",
        "conflicting_country_mapping",
    }


def test_invalid_cached_formula_value_is_not_reported_as_missing_formula_cache():
    data = worksheet_xml(
        workbook(
            {"G60": [["market", "market_code", "Sales 2025"], ["USA", "US", "=-1"]]}
        ),
        lambda xml: re.sub(r"<v(?:\s*/>|></v>)", "<v>-1</v>", xml),
    )
    result = parse_excel(data, dataset_namespace="sales")
    assert result.metrics[0].value is None
    assert result.metrics[0].raw_cells["C2"] == "=-1"
    assert "negative_sales_value" in result.metrics[0].limitations
    assert not any(issue.code == "missing_formula_cache" for issue in result.coverage)
