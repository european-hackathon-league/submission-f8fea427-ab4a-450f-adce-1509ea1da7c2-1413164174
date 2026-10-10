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


def test_public_limit_and_internal_errors_have_typed_openapi_responses():
    paths = artifacts()["openapi.json"]["paths"]
    for path in ("/api/v1/uploads", "/api/v1/runs"):
        for status in ("413", "500"):
            assert paths[path]["post"]["responses"][status]["content"][
                "application/json"
            ]["schema"] == {"$ref": "#/components/schemas/Error"}


def test_scenarios_exercise_their_named_contract_behaviors():
    fixtures = artifacts()["scenarios.json"]
    success = fixtures["deep_dive_success"]["payloads"]
    assert success["ResearchPage"]["items"][0]["status"] == "ready"
    assert success["FindingsPage"]["counts"]["total_records"] == 1
    assert any(
        item["source_kind"] == "external" for item in success["EvidenceList"]["items"]
    )
    partial = fixtures["deep_dive_partial"]["payloads"]
    assert partial["ResearchPage"]["items"][0]["status"] == "partial"
    assert partial["ResearchPage"]["items"][0]["gaps"]
    assert {
        item["outcome"]
        for item in fixtures["render_partial"]["payloads"]["RenderResult"]["outcomes"]
    } == {"rendered", "unsupported"}
    assert (
        fixtures["guided_conflict"]["payloads"]["Conflicts"]["checkpoints"][0][
            "wait_state"
        ]
        == "waiting"
    )
    exported = fixtures["versioned_export"]["payloads"]
    assert exported["ExportResult"]["status"] == "ready"
    assert (
        exported["ExportResult"]["manifest"]["proposal_set_version"]
        == exported["Proposals"]["proposal_set_version"]
    )
    stale = fixtures["pm_edit_stale"]["payloads"]
    assert (
        stale["Instruction"]["base_proposal_set_version"]
        < stale["Error"]["current_version"]
    )
    assert fixtures["reconnect"]["payloads"]["Error"]["code"] == "replay_expired"
