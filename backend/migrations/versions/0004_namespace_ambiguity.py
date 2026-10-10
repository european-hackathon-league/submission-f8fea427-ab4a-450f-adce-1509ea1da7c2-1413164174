"""Preserve explicit coverage for generated dataset identities."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sources",
        sa.Column(
            "namespace_warnings",
            JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.alter_column("sources", "namespace_warnings", server_default=None)


def downgrade() -> None:
    raise RuntimeError(
        "Namespace downgrade removes identity coverage; restore a backup"
    )
