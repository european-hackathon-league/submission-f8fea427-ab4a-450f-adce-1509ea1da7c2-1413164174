from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.auth import Actor
from app.commands import command
from app.db import Audit, Command, Session


def test_command_retry_deduplicates_effect_and_its_audit_transaction(client):
    identity = Actor("pm_demo", "workspace_demo", "pm")
    key = str(uuid4())
    calls = []

    def effect(session, command_id):
        calls.append(command_id)
        return {"resource_id": command_id}

    first = command(identity, "synthetic.test", key, {"value": 1}, effect)
    assert command(identity, "synthetic.test", key, {"value": 1}, effect) == first
    assert len(calls) == 1
    with pytest.raises(HTTPException) as caught:
        command(identity, "synthetic.test", key, {"value": 2}, effect)
    assert caught.value.status_code == 409
    with Session() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(Audit)
                .where(Audit.resource_id == first["resource_id"])
            )
            == 1
        )


def test_failed_effect_rolls_back_command_and_audit(client):
    identity = Actor("pm_demo", "workspace_demo", "pm")
    key = str(uuid4())

    def fail(session, command_id):
        from app.commands import audit

        audit(session, identity, "synthetic.failed", key)
        raise ValueError("Synthetic failure")

    with pytest.raises(ValueError):
        command(identity, "synthetic.test", key, {}, fail)
    with Session() as session:
        assert (
            session.scalar(select(Command).where(Command.idempotency_key == key))
            is None
        )
        assert session.scalar(select(Audit).where(Audit.resource_id == key)) is None
