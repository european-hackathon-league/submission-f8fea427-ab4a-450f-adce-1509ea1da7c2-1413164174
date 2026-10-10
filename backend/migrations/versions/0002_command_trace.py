"""Persist sanitized trace context across durable dispatch."""

from alembic import op
from sqlalchemy import Column, text
from sqlalchemy.dialects.postgresql import JSONB

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "commands",
        Column(
            "trace_context", JSONB, nullable=False, server_default=text("'{}'::jsonb")
        ),
    )
    op.alter_column("commands", "trace_context", server_default=None)


def downgrade() -> None:
    op.drop_column("commands", "trace_context")
