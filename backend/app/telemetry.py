import logging

from opentelemetry import metrics, trace
from opentelemetry.context import Context
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import Span, SpanProcessor, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from app.config import Settings


class PrivateRequestFields(SpanProcessor):
    def on_start(self, span: Span, parent_context: Context | None = None) -> None:
        # Native HTTP spans capture arbitrary URL/Host values before routing.
        for field in (
            "url.path",
            "url.query",
            "server.address",
            "http.request.method_original",
        ):
            if field in (span.attributes or {}):
                span.set_attribute(field, "REDACTED")


def configure(settings: Settings) -> None:
    resource = Resource.create({"service.name": "vehicle-requirements-backend"})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(PrivateRequestFields())
    readers = []
    if settings.otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import (
            OTLPMetricExporter,
        )
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )

        provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(
                    endpoint=settings.otlp_endpoint + "/v1/traces", timeout=2
                )
            )
        )
        readers.append(
            PeriodicExportingMetricReader(
                OTLPMetricExporter(
                    endpoint=settings.otlp_endpoint + "/v1/metrics", timeout=2
                )
            )
        )
    trace.set_tracer_provider(provider)
    metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=readers))
    logging.getLogger("uvicorn.access").disabled = True
    logger = logging.getLogger("backend")
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


tracer = trace.get_tracer("backend")
requests = metrics.get_meter("backend").create_counter("backend.requests")
latency = metrics.get_meter("backend").create_histogram(
    "backend.request.duration", unit="s"
)
