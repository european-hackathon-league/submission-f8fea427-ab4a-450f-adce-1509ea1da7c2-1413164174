import json

import httpx
from openai import OpenAI

from app import findings
from app.config import Settings


def test_extraction_uses_the_frozen_endpoint_and_disables_response_storage(monkeypatch):
    requests = []

    def respond(request):
        requests.append(request)
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
                                "annotations": [],
                                "text": json.dumps(
                                    {"accepted": True, "objections": []}
                                ),
                            }
                        ],
                    }
                ],
            },
        )

    monkeypatch.setattr(
        findings,
        "Settings",
        lambda: Settings(
            openai_api_key="synthetic-key", openai_base_url="https://changed.invalid/v1"
        ),
    )
    monkeypatch.setattr(
        findings,
        "OpenAI",
        lambda **kwargs: OpenAI(
            http_client=httpx.Client(transport=httpx.MockTransport(respond)), **kwargs
        ),
    )
    reviewed, _ = findings._call(
        findings.Review,
        "Synthetic review",
        {},
        {"model": "synthetic-model", "base_url": "https://frozen.invalid/v1"},
    )
    assert reviewed.accepted
    assert requests[0].url.host == "frozen.invalid"
    assert json.loads(requests[0].content)["store"] is False
