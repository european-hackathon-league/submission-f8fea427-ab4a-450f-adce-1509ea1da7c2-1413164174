"""Versioned parse cache, source lineage and immutable generation evidence."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "parse_cache",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False
        ),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("binding", JSONB, nullable=False),
        sa.Column("payload", JSONB, nullable=False),
    )
    op.create_table(
        "source_parses",
        sa.Column(
            "source_version_id",
            sa.String(),
            sa.ForeignKey("source_versions.id"),
            primary_key=True,
        ),
        sa.Column(
            "cache_id", sa.String(), sa.ForeignKey("parse_cache.id"), primary_key=True
        ),
    )
    op.create_table(
        "logical_records",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False
        ),
        sa.Column("dataset_namespace", sa.String(200), nullable=False),
        sa.Column("source_namespace", sa.String(200), nullable=False),
        sa.Column("external_record_id", sa.String(200), nullable=False),
        sa.UniqueConstraint(
            "workspace_id",
            "dataset_namespace",
            "source_namespace",
            "external_record_id",
        ),
    )
    op.create_table(
        "evidence_artifacts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "source_version_id",
            sa.String(),
            sa.ForeignKey("source_versions.id"),
            nullable=False,
        ),
        sa.Column(
            "cache_id", sa.String(), sa.ForeignKey("parse_cache.id"), nullable=False
        ),
        sa.Column(
            "record_id", sa.String(), sa.ForeignKey("logical_records.id"), nullable=True
        ),
        sa.Column("source_kind", sa.String(), nullable=False),
        sa.Column("locator", JSONB, nullable=False),
        sa.Column("scope", JSONB, nullable=False),
        sa.Column("excerpt", sa.String(), nullable=False),
        sa.Column("details", JSONB, nullable=False),
        sa.Column("limitations", JSONB, nullable=False),
    )
    op.create_table(
        "run_evidence",
        sa.Column("run_id", sa.String(), sa.ForeignKey("runs.id"), primary_key=True),
        sa.Column("generation_id", sa.String(), primary_key=True),
        sa.Column(
            "evidence_id",
            sa.String(),
            sa.ForeignKey("evidence_artifacts.id"),
            primary_key=True,
        ),
    )


def downgrade() -> None:
    raise RuntimeError("Evidence downgrade destroys provenance; restore a backup")
