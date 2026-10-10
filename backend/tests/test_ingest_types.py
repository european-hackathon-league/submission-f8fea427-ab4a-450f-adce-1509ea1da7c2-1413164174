import pytest
from pydantic import ValidationError

from app.ingest_types import (
    ContextMetric,
    FeedbackAnnotation,
    FeedbackRecord,
    ParseResult,
)
from app.wire import CellLocator, Scope


def test_ingestion_boundary_preserves_identity_annotations_and_unknown_metrics():
    annotation = FeedbackAnnotation(
        text="Synthetic feedback",
        locator=CellLocator(sheet="Feedback", row=2, cells=["A2", "L2"]),
        classifications={"engine": None, "topic": "Comfort"},
        scope=Scope(markets=["DE"], cohort_ids=["DE", "EU"]),
    )
    record = FeedbackRecord(
        dataset_namespace="dataset_one",
        source_namespace="survey_one",
        external_record_id="17",
        text=annotation.text,
        annotations=[annotation],
        scope=annotation.scope,
    )
    metric = ContextMetric(
        source_kind="study",
        topic="Comfort",
        metric="mean",
        value=None,
        unit=None,
        denominator=None,
        locator=annotation.locator,
        scope=annotation.scope,
    )
    result = ParseResult(
        kind="feedback", parser_revision="excel_v1", records=[record], metrics=[metric]
    )
    restored = ParseResult.model_validate_json(result.model_dump_json())
    assert restored.records[0].annotations == [annotation]
    assert restored.records[0].dataset_namespace == "dataset_one"
    assert restored.metrics[0].value is None
    assert restored.metrics[0].denominator is None
    with pytest.raises(ValidationError):
        FeedbackRecord.model_validate(record.model_dump() | {"external_record_id": ""})


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -0.1, 1.1])
def test_fraction_values_reject_nonfinite_and_out_of_range_values(value):
    with pytest.raises(ValidationError):
        ContextMetric(
            source_kind="study",
            topic="Synthetic satisfaction",
            metric="fraction",
            value=value,
            unit="fraction",
            denominator=None,
            locator=CellLocator(sheet="Study", row=2, cells=["C2"]),
        )
