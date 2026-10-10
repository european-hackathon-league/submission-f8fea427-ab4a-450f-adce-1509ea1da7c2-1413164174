def test_private_validation_input_is_not_returned_or_logged(client, caplog):
    response = client.post(
        "/api/v1/runs",
        json={"private_extra": "synthetic-private-text"},
        headers={"Idempotency-Key": "validation-private"},
    )
    assert response.status_code == 422
    assert "synthetic-private-text" not in response.text + caplog.text
    assert response.headers["X-Request-ID"]


def test_unexpected_error_is_sanitized_and_has_request_id(client, monkeypatch, caplog):
    import app.main as main

    def fail():
        raise RuntimeError("synthetic-private-text")

    monkeypatch.setattr(main, "pending", fail)
    response = client.get("/api/v1/runs/synthetic/proposals")
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert "synthetic-private-text" not in response.text + caplog.text
    assert response.headers["X-Request-ID"]


def test_failing_trace_export_does_not_fail_a_business_request(client, monkeypatch):
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import (
        SimpleSpanProcessor,
        SpanExporter,
        SpanExportResult,
    )

    import app.main as main

    class FailingExporter(SpanExporter):
        def export(self, spans):
            assert all(
                "synthetic-private-text" not in str(span.attributes) for span in spans
            )
            return SpanExportResult.FAILURE

        def shutdown(self):
            pass

    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(FailingExporter()))
    monkeypatch.setattr(main, "tracer", provider.get_tracer("test.failed.export"))
    response = client.get("/health")
    assert response.status_code == 200
    provider.shutdown()
