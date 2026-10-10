from sqlalchemy import inspect, text

from app.db import engine


def test_migration_creates_relational_foundation():
    names = set(inspect(engine).get_table_names())
    assert {
        "workspaces",
        "memberships",
        "sources",
        "source_versions",
        "runs",
        "run_sources",
        "commands",
        "outbox",
        "events",
        "audit",
    } <= names
    with engine.connect() as connection:
        assert connection.scalar(text("select version()")).startswith("PostgreSQL 18.6")


def test_audit_cannot_be_changed_after_commit():
    import pytest
    from sqlalchemy.exc import DBAPIError

    with engine.begin() as connection:
        connection.execute(
            text(
                "insert into workspaces (id) values ('audit_test') on conflict do nothing"
            )
        )
        connection.execute(
            text(
                "insert into audit (id, workspace_id, actor_id, actor_type, action, resource_id) values ('audit_test', 'audit_test', 'pm_demo', 'pm', 'test', 'test') on conflict do nothing"
            )
        )
    with pytest.raises(DBAPIError), engine.begin() as connection:
        connection.execute(
            text("update audit set actor_id = 'forged' where id = 'audit_test'")
        )
