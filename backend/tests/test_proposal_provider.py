from openai.lib._pydantic import to_strict_json_schema

from app.proposals import Draft


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
