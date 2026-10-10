"""Parser outputs preserve raw facts; persistence supplies source-version identity."""

from typing import Annotated, Literal, Self

from pydantic import Field, FiniteFloat, JsonValue, model_validator

from app.wire import CellLocator, PDFLocator, Scope, Wire

Namespace = Annotated[str, Field(min_length=1, max_length=200)]


class FeedbackAnnotation(Wire):
    text: str
    locator: CellLocator
    classifications: dict[str, str | None] = Field(default_factory=dict)
    scope: Scope = Field(default_factory=Scope)


class FeedbackRecord(Wire):
    dataset_namespace: Namespace
    source_namespace: Namespace
    external_record_id: Namespace
    text: str
    scope: Scope = Field(default_factory=Scope)
    annotations: list[FeedbackAnnotation]
    text_variants: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class ContextMetric(Wire):
    source_kind: Literal["study", "sales"]
    topic: str
    metric: str
    value: FiniteFloat | None
    unit: str | None
    denominator: Annotated[FiniteFloat, Field(ge=0)] | None
    proportion_base: Annotated[FiniteFloat, Field(gt=0)] | None = None
    raw_cells: dict[str, JsonValue] = Field(default_factory=dict)
    locator: CellLocator
    scope: Scope = Field(default_factory=Scope)
    limitations: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_fraction(self) -> Self:
        maximum = {"fraction": 1, "percentage": 100}.get(self.metric)
        if (
            maximum is not None
            and self.value is not None
            and not 0 <= self.value <= maximum
        ):
            raise ValueError("Metric value is outside its declared range")
        return self


class ParsedPassage(Wire):
    source_kind: Literal["equipment", "strategy"]
    text: str
    locator: PDFLocator
    scope: Scope = Field(default_factory=Scope)
    attributes: dict[str, JsonValue] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)


class CoverageIssue(Wire):
    code: str
    message: str
    locator: CellLocator | PDFLocator | None = None
    severity: Literal["warning", "error"] = "warning"


class ParseResult(Wire):
    kind: Literal["feedback", "study", "sales", "equipment", "strategy", "unknown"]
    parser_revision: Namespace
    status: Literal["ready", "partial", "unsupported", "failed"] = "ready"
    parser_versions: dict[str, str] = Field(default_factory=dict)
    records: list[FeedbackRecord] = Field(default_factory=list)
    unresolved_annotations: list[FeedbackAnnotation] = Field(default_factory=list)
    metrics: list[ContextMetric] = Field(default_factory=list)
    passages: list[ParsedPassage] = Field(default_factory=list)
    coverage: list[CoverageIssue] = Field(default_factory=list)
