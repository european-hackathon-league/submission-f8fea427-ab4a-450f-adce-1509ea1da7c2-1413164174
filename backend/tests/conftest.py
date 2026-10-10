import pytest
from fastapi.testclient import TestClient

from app.db import Membership, Session, Workspace
from app.main import app


@pytest.fixture
def client():
    with Session.begin() as session:
        for workspace, actor_id in (
            ("workspace_demo", "pm_demo"),
            ("workspace_other", "pm_other"),
        ):
            session.merge(Workspace(id=workspace))
            session.flush()
            session.merge(
                Membership(workspace_id=workspace, actor_id=actor_id, role="pm")
            )
    return TestClient(
        app,
        headers={
            "Authorization": "Bearer development:pm_demo",
            "X-Workspace-ID": "workspace_demo",
        },
    )
