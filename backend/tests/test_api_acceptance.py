import json
from uuid import uuid4

from test_control_delivery import ready_run

from app.control import refine_proposals
from app.db import Run, Session
from app.exports import export_build
from app.rendering import render_submit


def test_versioned_edit_decision_render_export_and_reconnect_use_actual_endpoints(
    client,
    monkeypatch,
):
    # Synthetic proposals isolate delivery acceptance from live AI availability.
    run_id, generation = ready_run(client)
    root = f"/api/v1/runs/{run_id}"

    def post(path, body, key=None):
        return client.post(
            root + path, json=body, headers={"Idempotency-Key": key or str(uuid4())}
        )

    initial = client.get(root + "/proposals").json()
    exported = post(
        "/exports",
        {"proposal_set_version": 1, "variant_ids": ["variant_a"], "format": "json"},
    ).json()
    decision = {
        "proposal_set_version": 1,
        "variant_id": "variant_a",
        "change_ids": ["change_a"],
        "action": "approve",
        "rationale": "Synthetic PM checked the requirement",
    }
    key = str(uuid4())
    first = post("/decisions", decision, key)
    assert first.status_code == 202
    assert post("/decisions", decision, key).json() == first.json()
    assert (
        client.get(root + "/proposals").json()["changes"][0]["decision_state"]
        == "approved"
    )
    assert export_build([run_id, generation, exported["command_id"]]) == "ready"
    download = client.get(root + f"/exports/{exported['resource_id']}/download")
    assert download.status_code == 200
    assert download.json()["proposals"]["changes"][0]["decision_state"] == "proposed"

    rendered = post(
        "/renders",
        {
            "proposal_set_version": 1,
            "variant_ids": ["variant_a"],
            "baseline_asset_id": "asset_demo_v1",
        },
    ).json()
    instruction = {
        "operation": "edit_change",
        "base_proposal_set_version": 1,
        "target_ids": ["change_a"],
        "changed_fields": {"after": "Synthetic PM revision"},
    }
    key = str(uuid4())
    edited = post("/instructions", instruction, key)
    assert edited.status_code == 202
    assert post("/instructions", instruction, key).json() == edited.json()
    assert post("/instructions", instruction).status_code == 409
    with Session() as session:
        newer_generation = session.get(Run, run_id).generation_id
    assert (
        refine_proposals([run_id, newer_generation, edited.json()["command_id"]])
        == "ready"
    )
    assert client.get(root + "/proposals").json()["proposal_set_version"] == 2
    assert (
        client.get(root + "/proposals?proposal_set_version=1").json()["changes"][0][
            "after"
        ]
        == initial["changes"][0]["after"]
    )

    def renderer(method, path, key, body=None):
        return {
            "render_request_id": body["render_request_id"],
            "proposal_set_version": 1,
            "variant_ids": body["variant_ids"],
            "baseline_asset_id": body["baseline_asset_id"],
            "part_catalog_version": body["part_catalog_version"],
            "status": "partial",
            "assets": [],
            "outcomes": [
                {
                    "change_id": "change_a",
                    "outcome": "unsupported",
                    "reason": "Synthetic renderer supports no geometry",
                    "asset_ids": [],
                }
            ],
        }

    monkeypatch.setattr("app.rendering.renderer_call", renderer)
    assert render_submit([run_id, generation, rendered["resource_id"]]) == "failed"
    result = client.get(root + f"/renders/{rendered['resource_id']}").json()
    assert result["stale"] and result["proposal_set_version"] == 1
    assert (
        client.get(root + "/proposals").json()["changes"][0]["after"]
        == "Synthetic PM revision"
    )

    snapshot = client.get(root).json()
    replay = client.get(root + "/events?follow=false&after_sequence=0")
    assert replay.status_code == 200
    events = [
        json.loads(line.removeprefix("data: "))
        for line in replay.text.splitlines()
        if line.startswith("data: ")
    ]
    assert events[-1]["sequence"] == snapshot["last_event_sequence"]
    assert (
        client.get(
            root
            + f"/events?follow=false&after_sequence={snapshot['last_event_sequence']}"
        ).text
        == ""
    )
    assert client.get(root + "/history").json()["items"]
    foreign = {
        "Authorization": "Bearer development:pm_other",
        "X-Workspace-ID": "workspace_other",
    }
    for path in [
        "",
        "/proposals",
        "/history",
        f"/renders/{rendered['resource_id']}",
        f"/exports/{exported['resource_id']}",
        f"/exports/{exported['resource_id']}/download",
    ]:
        assert client.get(root + path, headers=foreign).status_code == 404
