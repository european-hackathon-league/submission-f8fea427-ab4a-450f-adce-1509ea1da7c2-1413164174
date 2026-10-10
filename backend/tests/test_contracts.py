import json
from pathlib import Path

from jsonschema import Draft202012Validator

from app import wire as w
from app.contracts import artifacts


def test_all_scenarios_validate_and_references_resolve():
    generated = artifacts()
    schemas = generated["schemas.json"]
    fixtures = generated["scenarios.json"]
    assert len(fixtures) == 10
    for name, scenario in fixtures.items():
        assert scenario["synthetic"] is True
        for kind, value in scenario["payloads"].items():
            Draft202012Validator(schemas[kind]).validate(value)
        payloads = scenario["payloads"]
        assert payloads["Snapshot"]["run_id"] == payloads["Event"]["run_id"]
        assert payloads["Proposals"]["run_id"] == payloads["Snapshot"]["run_id"]
        evidence_ids = {
            item["evidence_id"] for item in payloads["EvidenceList"]["items"]
        }
        for change in payloads["Proposals"]["changes"]:
            assert set(change["supporting_evidence_ids"]) <= evidence_ids, name
    assert w.Instruction.model_json_schema()["additionalProperties"] is False


def test_committed_contract_has_no_drift():
    root = Path(__file__).resolve().parents[2] / "contracts"
    for name, value in artifacts().items():
        assert json.loads((root / name).read_text()) == value
