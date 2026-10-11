import json
from types import SimpleNamespace as NS

from test_findings import observation
from test_ingestion_cache import frozen_run

from app import research
from app import wire as w
from app.artifacts import get_stage
from app.db import Run, Session
from app.findings import aggregate


def test_research_retains_opposition_rejects_unsupported_claims_and_reuses_result(
    client, monkeypatch
):
    run_id, generation, _, _ = frozen_run(client)
    with Session.begin() as session:
        run = session.get(Run, run_id)
        run.config = {**run.config, "deep_dive": {"enabled": True}}
    findings = [
        w.Finding.model_validate(item)
        for item in aggregate([observation("feedback", "respondent")], [], run_id)[
            "findings"
        ]
    ]
    findings[0].customer_need = "Improve seat comfort"
    before = findings[0].counts.model_dump()
    calls = []
    fetch_timeouts = []

    def search(**kwargs):
        calls.append("search")
        assert kwargs["store"] is False
        return NS(
            output=[
                NS(
                    type="message",
                    content=[
                        NS(
                            type="output_text",
                            annotations=[
                                NS(type="url_citation", url="https://example.com/seat")
                            ],
                        )
                    ],
                )
            ]
        )

    def assess(**kwargs):
        calls.append("assess")
        assert kwargs["store"] is False
        source = json.loads(kwargs["input"][1]["content"])["sources"][0]
        assert "prefer firm seats" in source["excerpt"]
        base = dict(
            type="opinion",
            text="Some owners prefer firmness",
            evidence_id=source["evidence_id"],
            quote="I prefer firm seats for comfort.",
            supported=True,
            applicability="unknown",
            counterevidence=True,
        )
        return NS(
            output_parsed=research.Assessment(
                claims=[
                    research.Candidate(**base),
                    research.Candidate(
                        **(base | {"text": "Invented quotation", "quote": "fabricated"})
                    ),
                    research.Candidate(
                        **(base | {"text": "Wrong scope", "applicability": "mismatch"})
                    ),
                    research.Candidate(
                        **(base | {"text": "Unsupported", "supported": False})
                    ),
                ],
                approaches=["Evaluate firmness alternatives"],
                recommendation=None,
                gaps=[],
            )
        )

    provider = NS(responses=NS(create=search, parse=assess))
    provider.with_options = lambda **kwargs: provider
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-controlled-test")
    monkeypatch.setattr(research, "OpenAI", lambda **kwargs: provider)
    monkeypatch.setattr(
        research,
        "retrieve",
        lambda url, **kwargs: (
            fetch_timeouts.append(kwargs["timeout"])
            or (
                url,
                "Navigation " * 100 + "I prefer firm seats for comfort.",
            )
        ),
    )
    research.investigate(run_id, generation, findings)
    research.investigate(run_id, generation, findings)
    bundle = get_stage(run_id, generation, "research")["bundles"][0]
    assert calls == ["search", "assess"]
    assert len(bundle["claims"]) == 1
    assert bundle["claims"][0]["type"] == "opinion"
    assert bundle["counterevidence_ids"] == bundle["claims"][0]["evidence_ids"]
    assert "Applicability remains unknown" in bundle["claims"][0]["limitations"]
    assert len(bundle["gaps"]) == 3
    assert findings[0].counts.model_dump() == before
    assert 0 < fetch_timeouts[0] <= 15
    diagnostics = get_stage(
        run_id, generation, "research:step:" + findings[0].finding_id
    )["diagnostics"]
    assert [item["phase"] for item in diagnostics] == ["search", "fetch", "assess"]
