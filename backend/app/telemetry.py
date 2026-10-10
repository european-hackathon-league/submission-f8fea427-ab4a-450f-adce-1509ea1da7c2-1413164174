import logging

from opentelemetry import metrics, trace
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from app.config import Settings


def configure(settings: Settings) -> None:
    resource = Resource.create({"service.name": "vehicle-requirements-backend"})
    provider = TracerProvider(resource=resource)
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
