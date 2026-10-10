from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    create_engine,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from app.config import Settings

engine = create_engine(Settings().database_url.get_secret_value(), pool_pre_ping=True)
Session = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(primary_key=True)


class Membership(Base):
    __tablename__ = "memberships"
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id"), primary_key=True
    )
    actor_id: Mapped[str] = mapped_column(primary_key=True)
    role: Mapped[str] = mapped_column(default="pm")


class Source(Base):
    __tablename__ = "sources"
    id: Mapped[str] = mapped_column(primary_key=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    dataset_namespace: Mapped[str] = mapped_column(String(200))
    namespace_warnings: Mapped[list[str]] = mapped_column(JSONB, default=list)
    filename: Mapped[str]
    detected_type: Mapped[str]
    status: Mapped[str]
    reason: Mapped[str | None]


class SourceVersion(Base):
    __tablename__ = "source_versions"
    id: Mapped[str] = mapped_column(primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id"), unique=True)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    object_key: Mapped[str]
    byte_size: Mapped[int]


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(primary_key=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB)
    generation_id: Mapped[str]
    analysis_status: Mapped[str] = mapped_column(default="queued")
    stage: Mapped[str] = mapped_column(default="queued")
    revision: Mapped[int] = mapped_column(default=1)
    event_sequence: Mapped[int] = mapped_column(default=0)
    current_proposal_set_version: Mapped[int | None]
    warnings: Mapped[list[str]] = mapped_column(JSONB, default=list)


class RunSource(Base):
    __tablename__ = "run_sources"
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), primary_key=True)
    source_version_id: Mapped[str] = mapped_column(
        ForeignKey("source_versions.id"), primary_key=True
    )
    binding: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class Command(Base):
    __tablename__ = "commands"
    __table_args__ = (
        UniqueConstraint("workspace_id", "actor_id", "operation", "idempotency_key"),
    )
    id: Mapped[str] = mapped_column(primary_key=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"))
    actor_id: Mapped[str]
    operation: Mapped[str]
    idempotency_key: Mapped[str]
    body_hash: Mapped[str]
    run_id: Mapped[str | None] = mapped_column(ForeignKey("runs.id"))
    body: Mapped[dict[str, Any]] = mapped_column(JSONB)
    result: Mapped[dict[str, Any]] = mapped_column(JSONB)
    trace_context: Mapped[dict[str, str]] = mapped_column(JSONB, default=dict)


class Outbox(Base):
    __tablename__ = "outbox"
    command_id: Mapped[str] = mapped_column(ForeignKey("commands.id"), primary_key=True)
    delivered: Mapped[bool] = mapped_column(default=False)
    attempts: Mapped[int] = mapped_column(default=0)


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (UniqueConstraint("run_id", "sequence"),)
    id: Mapped[str] = mapped_column(primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)


class Audit(Base):
    __tablename__ = "audit"
    id: Mapped[str] = mapped_column(primary_key=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    run_id: Mapped[str | None] = mapped_column(ForeignKey("runs.id"))
    actor_id: Mapped[str]
    actor_type: Mapped[str]
    action: Mapped[str]
    resource_id: Mapped[str]
    rationale: Mapped[str | None]
    proposal_set_version: Mapped[int | None]
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class StageOutput(Base):
    __tablename__ = "stage_outputs"
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), primary_key=True)
    generation_id: Mapped[str] = mapped_column(primary_key=True)
    stage_key: Mapped[str] = mapped_column(primary_key=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)


class ParseCache(Base):
    __tablename__ = "parse_cache"
    id: Mapped[str] = mapped_column(primary_key=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"))
    source_sha256: Mapped[str] = mapped_column(String(64))
    binding: Mapped[dict[str, Any]] = mapped_column(JSONB)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)


class SourceParse(Base):
    __tablename__ = "source_parses"
    source_version_id: Mapped[str] = mapped_column(
        ForeignKey("source_versions.id"), primary_key=True
    )
    cache_id: Mapped[str] = mapped_column(
        ForeignKey("parse_cache.id"), primary_key=True
    )


class LogicalRecord(Base):
    __tablename__ = "logical_records"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "dataset_namespace",
            "source_namespace",
            "external_record_id",
        ),
    )
    id: Mapped[str] = mapped_column(primary_key=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"))
    dataset_namespace: Mapped[str] = mapped_column(String(200))
    source_namespace: Mapped[str] = mapped_column(String(200))
    external_record_id: Mapped[str] = mapped_column(String(200))


class EvidenceArtifact(Base):
    __tablename__ = "evidence_artifacts"
    id: Mapped[str] = mapped_column(primary_key=True)
    source_version_id: Mapped[str] = mapped_column(ForeignKey("source_versions.id"))
    cache_id: Mapped[str] = mapped_column(ForeignKey("parse_cache.id"))
    record_id: Mapped[str | None] = mapped_column(ForeignKey("logical_records.id"))
    source_kind: Mapped[str]
    locator: Mapped[dict[str, Any]] = mapped_column(JSONB)
    scope: Mapped[dict[str, Any]] = mapped_column(JSONB)
    excerpt: Mapped[str]
    details: Mapped[dict[str, Any]] = mapped_column(JSONB)
    limitations: Mapped[list[str]] = mapped_column(JSONB)


class RunEvidence(Base):
    __tablename__ = "run_evidence"
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), primary_key=True)
    generation_id: Mapped[str] = mapped_column(primary_key=True)
    evidence_id: Mapped[str] = mapped_column(
        ForeignKey("evidence_artifacts.id"), primary_key=True
    )
