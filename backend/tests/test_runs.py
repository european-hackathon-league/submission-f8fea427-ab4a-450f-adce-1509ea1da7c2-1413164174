from uuid import uuid4

from sqlalchemy import func, select
from test_uploads import workbook

from app.db import Command, Outbox, Session


def create_run(client):
    upload = client.post(
        "/api/v1/uploads",
        files={"files": ("synthetic.xlsx", workbook())},
        headers={"Idempotency-Key": str(uuid4())},
    )
    body = {
        "vehicle_id": "vehicle_demo",
        "baseline_asset_id": "asset_demo_v1",
        "part_catalog_version": "catalog_demo_v1",
        "source_ids": [upload.json()["sources"][0]["source_id"]],
        "market_context": ["US"],
    }
    response = client.post(
        "/api/v1/runs", json=body, headers={"Idempotency-Key": str(uuid4())}
    )
    assert response.status_code == 202
    return response.json()["run_id"], body


def test_frozen_run_command_outbox_and_snapshot_are_atomic_and_idempotent(client):
    run_id, body = create_run(client)
    key = str(uuid4())
    first = client.post("/api/v1/runs", json=body, headers={"Idempotency-Key": key})
    second = client.post("/api/v1/runs", json=body, headers={"Idempotency-Key": key})
    assert first.json() == second.json()
    with Session() as session:
        accepted = session.scalar(select(Command).where(Command.idempotency_key == key))
        assert accepted is not None
        assert session.get(Outbox, accepted.id) is not None
        assert (
            session.scalar(
                select(func.count())
                .select_from(Command)
                .where(Command.idempotency_key == key)
            )
            == 1
        )
    response = client.get(f"/api/v1/runs/{run_id}")
    assert response.status_code == 200
    assert response.json()["config"]["source_ids"] == body["source_ids"]
    assert response.json()["analysis_status"] == "queued"
    assert response.json()["current_proposal_set_version"] is None
    assert (
        client.get(
            f"/api/v1/runs/{run_id}",
            headers={
                "Authorization": "Bearer development:pm_other",
                "X-Workspace-ID": "workspace_other",
            },
        ).status_code
        == 404
    )


def test_run_rejects_foreign_source_and_asset_mismatch(client):
    _, body = create_run(client)
    assert (
        client.post(
            "/api/v1/runs",
            json=body | {"baseline_asset_id": "wrong"},
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/runs",
            json=body,
            headers={
                "Idempotency-Key": str(uuid4()),
                "Authorization": "Bearer development:pm_other",
                "X-Workspace-ID": "workspace_other",
            },
        ).status_code
        == 404
    )


def test_replay_cursor_recovery_and_duplicate_resume(client):
    run_id, _ = create_run(client)
    response = client.get(f"/api/v1/runs/{run_id}/events?follow=false")
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    assert "analysis.updated" in response.text
    event_id = next(
        line[4:].strip()
        for line in response.text.splitlines()
        if line.startswith("id:")
    )
    assert (
        "analysis.updated"
        not in client.get(
            f"/api/v1/runs/{run_id}/events?follow=false",
            headers={"Last-Event-ID": event_id},
        ).text
    )
    response = client.get(
        f"/api/v1/runs/{run_id}/events", headers={"Last-Event-ID": "expired"}
    )
    assert response.status_code == 410
    assert response.json()["code"] == "replay_expired"
    watermark = client.get(f"/api/v1/runs/{run_id}").json()["last_event_sequence"]
    response = client.get(
        f"/api/v1/runs/{run_id}/events?follow=false&after_sequence={watermark}"
    )
    assert response.status_code == 200
    assert "analysis.updated" not in response.text


def test_concurrent_writers_preserve_coherent_monotonic_event_watermark(client):
    from concurrent.futures import ThreadPoolExecutor

    from app.commands import emit
    from app.db import Event, Run

    run_id, _ = create_run(client)

    def update(_):
        with Session.begin() as session:
            run = session.scalar(select(Run).where(Run.id == run_id).with_for_update())
            emit(session, run, "analysis.updated", "analysis", run_id)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(update, range(12)))
    snapshot = client.get(f"/api/v1/runs/{run_id}").json()
    with Session() as session:
        sequences = list(
            session.scalars(
                select(Event.sequence)
                .where(Event.run_id == run_id)
                .order_by(Event.sequence)
            )
        )
    assert sequences == list(range(1, 14))
    assert snapshot["last_event_sequence"] == sequences[-1]


def test_replay_checks_current_membership_after_the_stream_was_authenticated(client):
    import pytest
    from fastapi import HTTPException

    from app.auth import Actor
    from app.db import Membership
    from app.runs import backlog

    run_id, _ = create_run(client)
    identity = Actor("pm_demo", "workspace_demo", "pm")
    assert backlog(identity, run_id, 0)
    with Session.begin() as session:
        session.delete(session.get(Membership, ("workspace_demo", "pm_demo")))
    try:
        with pytest.raises(HTTPException) as caught:
            backlog(identity, run_id, 0)
        assert caught.value.status_code == 403
    finally:
        with Session.begin() as session:
            session.add(
                Membership(workspace_id="workspace_demo", actor_id="pm_demo", role="pm")
            )
