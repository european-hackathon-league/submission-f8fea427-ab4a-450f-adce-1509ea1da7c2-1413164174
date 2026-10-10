"""Workspace-scoped foundation and append-only audit."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("workspaces", sa.Column("id", sa.String(), primary_key=True))
    op.create_table(
        "memberships",
        sa.Column(
            "workspace_id",
            sa.String(),
            sa.ForeignKey("workspaces.id"),
            primary_key=True,
        ),
        sa.Column("actor_id", sa.String(), primary_key=True),
        sa.Column("role", sa.String(), nullable=False),
    )
    op.create_table(
        "sources",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False
        ),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("detected_type", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("reason", sa.String()),
    )
    op.create_index("ix_sources_workspace_id", "sources", ["workspace_id"])
    op.create_table(
        "source_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "source_id",
            sa.String(),
            sa.ForeignKey("sources.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("object_key", sa.String(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
    )
    op.create_index("ix_source_versions_sha256", "source_versions", ["sha256"])
    op.create_table(
        "runs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False
        ),
        sa.Column("config", JSONB, nullable=False),
        sa.Column("generation_id", sa.String(), nullable=False),
        sa.Column("analysis_status", sa.String(), nullable=False),
        sa.Column("stage", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("event_sequence", sa.Integer(), nullable=False),
        sa.Column("current_proposal_set_version", sa.Integer()),
        sa.Column("warnings", JSONB, nullable=False),
    )
    op.create_index("ix_runs_workspace_id", "runs", ["workspace_id"])
    op.create_table(
        "run_sources",
        sa.Column("run_id", sa.String(), sa.ForeignKey("runs.id"), primary_key=True),
        sa.Column(
            "source_version_id",
            sa.String(),
            sa.ForeignKey("source_versions.id"),
            primary_key=True,
        ),
    )
    op.create_table(
        "commands",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False
        ),
        sa.Column("actor_id", sa.String(), nullable=False),
        sa.Column("operation", sa.String(), nullable=False),
        sa.Column("idempotency_key", sa.String(), nullable=False),
        sa.Column("body_hash", sa.String(), nullable=False),
        sa.Column("run_id", sa.String(), sa.ForeignKey("runs.id")),
        sa.Column("body", JSONB, nullable=False),
        sa.Column("result", JSONB, nullable=False),
        sa.UniqueConstraint("workspace_id", "actor_id", "operation", "idempotency_key"),
    )
    op.create_table(
        "outbox",
        sa.Column(
            "command_id", sa.String(), sa.ForeignKey("commands.id"), primary_key=True
        ),
        sa.Column("delivered", sa.Boolean(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
    )
    op.create_table(
        "events",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("run_id", sa.String(), sa.ForeignKey("runs.id"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.UniqueConstraint("run_id", "sequence"),
    )
    op.create_index("ix_events_run_id", "events", ["run_id"])
    op.create_table(
        "audit",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False
        ),
        sa.Column("run_id", sa.String(), sa.ForeignKey("runs.id")),
        sa.Column("actor_id", sa.String(), nullable=False),
        sa.Column("actor_type", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("resource_id", sa.String(), nullable=False),
        sa.Column("rationale", sa.String()),
        sa.Column("proposal_set_version", sa.Integer()),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_audit_workspace_id", "audit", ["workspace_id"])
    op.create_table(
        "stage_outputs",
        sa.Column("run_id", sa.String(), sa.ForeignKey("runs.id"), primary_key=True),
        sa.Column("generation_id", sa.String(), primary_key=True),
        sa.Column("stage_key", sa.String(), primary_key=True),
        sa.Column("payload", JSONB, nullable=False),
    )
    op.execute(
        "CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit is append-only'; END $$"
    )
    op.execute(
        "CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation()"
    )


def downgrade():
    raise RuntimeError(
        "Foundation downgrade deletes private data; restore a backup instead"
    )
