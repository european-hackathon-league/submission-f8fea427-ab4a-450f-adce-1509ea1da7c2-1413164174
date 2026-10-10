from fixtures.excel import workbook

from app.excel import parse_excel


def test_sparse_study_headers_means_and_us_fraction_blocks_keep_scope_and_cells():
    data = workbook(
        {
            "CN_EU_2025": [
                [None, "Synthetic scale"],
                [None, "China", None, "EU"],
                [
                    "Synthetic comfort",
                    "Model G68 ",
                    "Model G70",
                    "Model F70",
                    "Model G60 ",
                ],
                ["Mean", 8, 9, 7, 6],
                [],
                ["Synthetic usability"],
                ["Mean", 5, 4, 3, 2],
            ],
            "US_2025": [
                ["Synthetic comfort", None, "Model G60 ", "Model G70"],
                ["Sample total", "Synthetic comfort", 1, 1],
                ["Satisfied", "Synthetic comfort", 0.6, 0.5],
                ["Dissatisfied", "Synthetic comfort", 0.4, 0.5],
                [],
                ["Synthetic usability"],
                ["Sample total", "Synthetic usability", 1, 1],
                ["Satisfied", "Synthetic usability", 1, 1],
            ],
        }
    )
    result = parse_excel(data, dataset_namespace="studies")
    assert result.kind == "study"
    assert result.records == []
    means = [metric for metric in result.metrics if metric.metric == "mean"]
    fractions = [metric for metric in result.metrics if metric.metric == "fraction"]
    assert len(means) == 8
    assert len(fractions) == 6
    assert means[0].value == 8
    assert means[0].unit is None
    assert means[0].scope.vehicle_ids == ["G68"]
    assert means[0].scope.markets == ["CN"]
    assert means[2].scope.markets == ["EU"]
    assert means[0].locator.cells == ["B4", "A3", "B3", "B2"]
    assert all(metric.scope.year == 2025 for metric in result.metrics)
    assert all(metric.denominator is None for metric in result.metrics)
    assert all(metric.proportion_base == 1 for metric in fractions)
    assert fractions[0].locator.cells == ["C3", "A3", "A1", "C1", "C2"]
    assert fractions[0].unit != means[0].unit


def test_fraction_ranges_totals_and_missing_values_are_gaps_not_normalized():
    data = workbook(
        {
            "US_2025": [
                ["Synthetic topic", None, "Model G60"],
                ["Sample total", "Synthetic topic", 1],
                ["One rating", "Synthetic topic", 1.5],
                ["Other rating", "Synthetic topic", 0.4],
            ]
        }
    )
    result = parse_excel(data, dataset_namespace="study")
    assert result.status == "partial"
    assert [metric.value for metric in result.metrics] == [None, 0.4]
    assert result.metrics[0].raw_cells["C3"] == 1.5
    assert any(issue.code == "fraction_out_of_range" for issue in result.coverage)
    assert any(issue.code == "fraction_total_anomaly" for issue in result.coverage)


def test_changed_study_headers_do_not_guess_a_vehicle_or_market():
    result = parse_excel(
        workbook(
            {
                "US_2025": [
                    ["Synthetic topic", None, "Unmapped derivative"],
                    ["Sample total", "Synthetic topic", 1],
                    ["Satisfied", "Synthetic topic", 1],
                ]
            }
        ),
        dataset_namespace="study",
    )
    assert result.status == "unsupported"
    assert result.metrics == []
    assert any(issue.code == "mapping_required" for issue in result.coverage)


def test_explicit_participant_counts_are_separate_from_proportion_bases():
    result = parse_excel(
        workbook(
            {
                "US_2025": [
                    ["Synthetic topic", None, "Model G60"],
                    ["Number of respondents", "Synthetic topic", 100],
                    ["Sample total", "Synthetic topic", 1],
                    ["Satisfied", "Synthetic topic", 0.6],
                    ["Dissatisfied", "Synthetic topic", 0.4],
                ]
            }
        ),
        dataset_namespace="study",
    )
    assert result.status == "ready"
    assert len(result.metrics) == 2
    assert all(metric.denominator == 100 for metric in result.metrics)
    assert all(metric.proportion_base == 1 for metric in result.metrics)
    assert result.metrics[0].locator.cells[-1] == "C2"
    assert result.metrics[0].raw_cells["C2"] == 100
    assert result.records == []


def test_mean_sample_size_is_scoped_to_its_topic_and_not_inherited():
    result = parse_excel(
        workbook(
            {
                "CN_EU_2025": [
                    [],
                    [None, "China"],
                    ["Synthetic comfort", "Model G68"],
                    ["Sample size", 50],
                    ["Mean", 8],
                    ["Synthetic usability"],
                    ["Mean", 9],
                ]
            }
        ),
        dataset_namespace="study",
    )
    assert result.metrics[0].topic == "Synthetic comfort"
    assert result.metrics[0].denominator == 50
    assert result.metrics[0].locator.cells[-1] == "B4"
    assert result.metrics[1].denominator is None


def test_invalid_participant_count_retains_valid_fraction_and_original_count():
    result = parse_excel(
        workbook(
            {
                "US_2025": [
                    ["Synthetic topic", None, "Model G60"],
                    ["Number of respondents", "Synthetic topic", 3.5],
                    ["Sample total", "Synthetic topic", 1],
                    ["Satisfied", "Synthetic topic", 1],
                ]
            }
        ),
        dataset_namespace="study",
    )
    assert result.status == "partial"
    assert result.metrics[0].value == 1
    assert result.metrics[0].denominator is None
    assert result.metrics[0].raw_cells["C2"] == 3.5
    assert "unknown_sample_size" in result.metrics[0].limitations
    assert any(issue.code == "invalid_sample_size" for issue in result.coverage)
