import pytest
from openai.lib._pydantic import to_strict_json_schema
from test_control_delivery import ready_run, sample
from test_findings import aggregate, observation

from app import wire as w
from app.proposals import Draft, validated_draft


def test_proposal_schema_only_contains_closed_objects_with_required_properties():
    def check(value):
        if isinstance(value, dict):
            if value.get("type") == "object":
                assert value.get("additionalProperties") is False
                assert set(value.get("required", [])) == set(
                    value.get("properties", {})
                )
            for child in value.values():
                check(child)
        elif isinstance(value, list):
            for child in value:
                check(child)

    check(to_strict_json_schema(Draft))


def test_positive_strength_can_support_a_preservation_requirement(client):
    run_id, generation = ready_run(client)
    projection = aggregate([observation("positive", "record", "positive")], [], run_id)
    finding = w.Finding.model_validate(projection["findings"][0])
    change = sample().changes[0].model_dump()
    change.update(
        outcome="Preserve the comfortable seat",
        after="Retain the reported seating comfort",
        finding_ids=[finding.finding_id],
        supporting_evidence_ids=["positive"],
        scope=w.Scope().model_dump(),
    )
    draft = Draft.model_validate({"changes": [change], "gaps": []})
    result = validated_draft(draft, [finding], [], run_id, generation)
    assert result.changes[0].supporting_evidence_ids == ["positive"]
    assert finding.counts.negative_records == 0
    result.changes[0].supporting_evidence_ids = ["unrelated"]
    with pytest.raises(ValueError, match="outside supported finding evidence"):
        validated_draft(result, [finding], [], run_id, generation)
    result.changes[0].supporting_evidence_ids = []
    result.changes[0].opposing_evidence_ids = ["positive"]
    with pytest.raises(ValueError, match="supporting evidence.*preservation"):
        validated_draft(result, [finding], [], run_id, generation)


@pytest.mark.parametrize("repaired", [False, True])
@pytest.mark.parametrize("malformed", [False, True])
def test_proposal_validation_repair_is_bounded_and_reuses_returned_drafts(
    client, monkeypatch, repaired, malformed
):
    from types import SimpleNamespace

    from app import proposals
    from app.config import Settings

    run_id, generation = ready_run(client)
    finding = w.Finding.model_validate(
        aggregate([observation("evidence", "record")], [], run_id)["findings"][0]
    )
    calls = []

    def parse(**options):
        calls.append(options)
        if malformed and (not repaired or len(calls) == 1):
            return Draft.model_validate_json('{"changes": [')
        change = sample().changes[0].model_dump()
        change.update(
            finding_ids=[finding.finding_id],
            supporting_evidence_ids=["evidence"],
            scope=w.Scope(markets=["unsupported"]).model_dump(),
        )
        if repaired and len(calls) == 2:
            change["scope"] = w.Scope().model_dump()
        return SimpleNamespace(
            output_parsed=Draft.model_validate({"changes": [change], "gaps": []}),
            model="synthetic",
            usage=None,
        )

    monkeypatch.setattr(
        proposals, "Settings", lambda: Settings(openai_api_key="synthetic")
    )
    monkeypatch.setattr(
        proposals,
        "OpenAI",
        lambda **options: SimpleNamespace(responses=SimpleNamespace(parse=parse)),
    )
    for _ in range(2):
        if repaired:
            assert proposals.draft_changes(run_id, generation, [finding], []).changes
        else:
            with pytest.raises(
                ValueError, match="structured draft|scope is not established"
            ):
                proposals.draft_changes(run_id, generation, [finding], [])
    assert len(calls) == 2
    assert ("structured draft" if malformed else "scope is not established") in str(
        calls[1]["input"]
    )


def test_uncertain_proposal_timeout_is_not_automatically_repeated(client, monkeypatch):
    from types import SimpleNamespace

    import httpx
    from openai import APITimeoutError

    from app import proposals
    from app.config import Settings

    run_id, generation = ready_run(client)
    calls = []

    def parse(**options):
        calls.append(options)
        raise APITimeoutError(
            request=httpx.Request("POST", "https://synthetic.invalid")
        )

    monkeypatch.setattr(
        proposals, "Settings", lambda: Settings(openai_api_key="synthetic")
    )
    monkeypatch.setattr(
        proposals,
        "OpenAI",
        lambda **options: SimpleNamespace(responses=SimpleNamespace(parse=parse)),
    )
    with pytest.raises(APITimeoutError):
        proposals.draft_changes(run_id, generation, [], [])
    with pytest.raises(ValueError, match="uncertain outcome"):
        proposals.draft_changes(run_id, generation, [], [])
    assert len(calls) == 1
