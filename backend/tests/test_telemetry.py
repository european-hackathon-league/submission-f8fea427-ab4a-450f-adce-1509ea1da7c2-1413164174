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

    def fail(*args, **kwargs):
        raise RuntimeError("synthetic-private-text")

    monkeypatch.setattr(main.control, "get_proposals", fail)
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


def test_native_traces_exclude_private_urls_inputs_and_exception_messages(
    client, monkeypatch
):
    from opentelemetry import trace
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
        InMemorySpanExporter,
    )

    import app.main as main

    exporter = InMemorySpanExporter()
    trace.get_tracer_provider().add_span_processor(SimpleSpanProcessor(exporter))
    private = "synthetic-private-text-secret"

    def fail(*args, **kwargs):
        raise RuntimeError(private)

    monkeypatch.setattr(main.control, "get_proposals", fail)
    assert client.get(f"/health?private={private}").status_code == 200
    assert (
        client.post(
            "/api/v1/runs",
            json={"private_extra": private},
            headers={"Idempotency-Key": "private-validation-trace"},
        ).status_code
        == 422
    )
    assert client.get(f"/api/v1/runs/{private}/proposals").status_code == 500
    spans = exporter.get_finished_spans()
    assert any(span.name == "fastapi.endpoint" for span in spans)
    assert any(
        span.attributes.get("http.response.status_code") == 500 for span in spans
    )
    assert all(private not in span.to_json() for span in spans)


def test_sse_closes_cleanly_after_membership_is_revoked(monkeypatch):
    import asyncio

    from fastapi import HTTPException
    from fastapi.sse import ServerSentEvent

    import app.main as main
    from app.auth import Actor

    def backlog(identity, run_id, sequence):
        if sequence:
            raise HTTPException(403, "Workspace membership is no longer active")
        return [ServerSentEvent(data={"sequence": 1})]

    async def no_wait(seconds):
        pass

    monkeypatch.setattr(main.runs, "backlog", backlog)
    monkeypatch.setattr(main.asyncio, "sleep", no_wait)

    async def scenario():
        stream = main.events("run", Actor("pm", "workspace", "pm"), 0)
        received = [event async for event in stream]
        assert len(received) == 1

    asyncio.run(scenario())
