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
