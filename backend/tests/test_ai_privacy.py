import json

import httpx
import pytest
from openai import APIStatusError, OpenAI
from test_control_delivery import ready_run
from test_findings import aggregate, observation

from app import proposals, research, wire as w
from app.config import Settings
from app.db import Run, Session


@pytest.mark.parametrize("stage", ["proposals", "research"])
def test_provider_requests_do_not_store_customer_data(client, monkeypatch, stage):
    run_id, generation = ready_run(client)
    finding = w.Finding.model_validate(
        aggregate([observation("synthetic-evidence", "synthetic-record")], [], run_id)[
            "findings"
        ][0]
    )
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        if stage == "research" and len(requests) == 1:
            return httpx.Response(
                200,
                json={
                    "id": "synthetic-response",
                    "created_at": 0,
                    "model": "synthetic-model",
                    "object": "response",
                    "status": "completed",
                    "output": [
                        {
                            "id": "synthetic-message",
                            "type": "message",
                            "role": "assistant",
                            "status": "completed",
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": "Synthetic source",
                                    "annotations": [
                                        {
                                            "type": "url_citation",
                                            "url": "https://public.example/source",
                                            "title": "Synthetic source",
                                            "start_index": 0,
                                            "end_index": 16,
                                        }
                                    ],
                                }
                            ],
                        }
                    ],
                },
            )
        return httpx.Response(503, json={"error": {"message": "synthetic failure"}})

    module = proposals if stage == "proposals" else research
    monkeypatch.setattr(
        module,
        "Settings",
        lambda: Settings(
            openai_api_key="synthetic-key",
            openai_base_url="https://synthetic.invalid/v1",
        ),
    )
    monkeypatch.setattr(
        module,
        "OpenAI",
        lambda **kwargs: OpenAI(
            http_client=httpx.Client(transport=httpx.MockTransport(respond)), **kwargs
        ),
    )
    if stage == "proposals":
        with pytest.raises(APIStatusError):
            proposals.draft_changes(run_id, generation, [finding], [])
    else:
        with Session.begin() as session:
            run = session.get(Run, run_id)
            run.config = {**run.config, "deep_dive": {"enabled": True}}
        monkeypatch.setattr(
            research,
            "retrieve",
            lambda url, **kwargs: (url, "Synthetic source passage"),
        )
        research.investigate(run_id, generation, [finding])
        assert len(requests) == 2
    assert requests
    assert all(request.get("store") is False for request in requests)
