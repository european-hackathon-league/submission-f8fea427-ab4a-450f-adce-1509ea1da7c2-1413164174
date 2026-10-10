"""Preserve source dataset identity and freeze parsing configuration."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sources", sa.Column("dataset_namespace", sa.String(200)))
    op.execute("UPDATE sources SET dataset_namespace = 'legacy-' || id")
    op.alter_column("sources", "dataset_namespace", nullable=False)
    op.add_column(
        "run_sources",
        sa.Column(
            "binding", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
    )
    op.alter_column("run_sources", "binding", server_default=None)


def downgrade() -> None:
    raise RuntimeError(
        "Namespace downgrade destroys evidence identity; restore a backup"
    )
