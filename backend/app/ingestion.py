"""Frozen parsing policy and generation-scoped evidence publication."""

import hashlib
import json
from collections import deque
from io import BytesIO
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession
from temporalio import activity

from app.auth import Actor
from app.commands import audit, emit
from app.config import Settings
from app.db import (
    EvidenceArtifact,
    LogicalRecord,
    ParseCache,
    Run,
    RunEvidence,
    RunSource,
    Session,
    Source,
    SourceParse,
    SourceVersion,
    StageOutput,
    Workspace,
)
from app.excel import REVISION
from app.excel_process import parse_excel_bounded
from app.ingest_types import ParsedPassage, ParseResult
from app.parser_models import MANIFEST, declarations
from app.pdf import PARSER_REVISION, parse_pdf
from app.storage import storage


def parser_binding(source: Source) -> dict[str, Any]:
    settings = Settings()
    model_revision = None
    model_versions = {}
    if source.detected_type == "pdf":
        manifest = json.loads(MANIFEST.read_text())
        model_revision = hashlib.sha256(
            json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        model_versions = {
            model["repo_id"]: model["revision"] for model in declarations()
        }
    return {
        "dataset_namespace": source.dataset_namespace,
        "workflow_revision": "analysis-v1",
        "pdf_kind": (
            "equipment"
            if "option" in source.filename.lower()
            or "equipment" in source.filename.lower()
            else "strategy"
        )
        if source.detected_type == "pdf"
        else None,
        "namespace_warnings": source.namespace_warnings,
        "schema_revision": "ingest-v1",
        "parser_revision": REVISION
        if source.detected_type == "xlsx"
        else PARSER_REVISION,
        "reference_year": settings.reference_year,
        "header_aliases": settings.feedback_header_aliases,
        "excel_max_rows": settings.excel_max_rows,
        "excel_max_columns": settings.excel_max_columns,
        "excel_max_cells": settings.excel_max_cells,
        "model_revision": model_revision,
        "model_versions": model_versions,
        "pdf_timeout_seconds": settings.pdf_timeout_seconds,
        "pdf_memory_mb": settings.pdf_memory_mb,
        "pdf_batch_pages": 2,
        "pdf_single_page_fallback": True,
    }


def stable_id(parts: Any) -> str:
    return str(
        uuid5(NAMESPACE_URL, json.dumps(parts, sort_keys=True, separators=(",", ":")))
    )


def locked_run(session: DBSession, run_id: str, generation: str) -> Run:
    run = session.get(Run, run_id)
    if run is None:
        raise ValueError("Run not found")
    session.scalar(
        select(Workspace).where(Workspace.id == run.workspace_id).with_for_update()
    )
    run = session.scalar(
        select(Run)
        .where(Run.id == run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if run is None or run.generation_id != generation:
        raise ValueError("Superseded run generation")
    return run


def cache_identity(
    workspace: str, sha256: str, binding: dict[str, Any], batch: str, context_hash: str
) -> tuple[str, dict[str, Any]]:
    policy = {
        key: value
        for key, value in binding.items()
        if key
        not in {
            "dataset_namespace",
            "namespace_warnings",
            "workflow_revision",
            "pdf_single_page_fallback",
        }
    }
    policy.update(batch=batch, context_hash=context_hash)
    return stable_id([workspace, sha256, policy]), policy


def publish_batch(
    run_id: str,
    generation: str,
    source_version_id: str,
    result: ParseResult,
    *,
    batch: str = "all",
    context_hash: str = "",
) -> str:
    # Parse outside this transaction; one workspace/run lock order serializes publication races.
    result = ParseResult.model_validate(result.model_dump())
    with Session.begin() as session:
        run = locked_run(session, run_id, generation)
        member = session.get(RunSource, (run_id, source_version_id))
        version = session.get(SourceVersion, source_version_id)
        if member is None or version is None:
            raise ValueError("Source outside frozen manifest")
        source = session.get(Source, version.source_id)
        if source is None or source.workspace_id != run.workspace_id:
            raise ValueError("Source outside workspace")
        if result.parser_revision != member.binding["parser_revision"]:
            raise ValueError("Parser revision differs from frozen binding")
        if result.status in {"ready", "partial"} and any(
            result.parser_versions.get(model) != revision
            for model, revision in member.binding["model_versions"].items()
        ):
            raise ValueError("Model revision differs from frozen binding")
        if any(
            record.dataset_namespace != member.binding["dataset_namespace"]
            for record in result.records
        ):
            raise ValueError("Record namespace differs from frozen binding")
        cache_id, policy = cache_identity(
            run.workspace_id, version.sha256, member.binding, batch, context_hash
        )
        if result.status not in {"ready", "partial"}:
            # Failed attempts retain lineage without poisoning another run's reusable cache.
            cache_id = stable_id([cache_id, run_id, generation, source_version_id])
        cache = session.get(ParseCache, cache_id)
        if cache is None:
            template = result.model_copy(deep=True)
            for record in template.records:
                record.dataset_namespace = "unbound-cache-template"
            cache = ParseCache(
                id=cache_id,
                workspace_id=run.workspace_id,
                source_sha256=version.sha256,
                binding=policy,
                payload=template.model_dump(mode="json"),
            )
            session.add(cache)
            session.flush()
        if session.get(SourceParse, (source_version_id, cache_id)) is None:
            session.add(
                SourceParse(source_version_id=source_version_id, cache_id=cache_id)
            )
        checkpoint = (run_id, generation, f"parse:{source_version_id}:{batch}")
        if session.get(StageOutput, checkpoint) is not None:
            return cache_id
        parsed = ParseResult.model_validate(cache.payload)
        ordinal = 0

        def add_evidence(
            kind: str,
            locator: dict[str, Any],
            scope: dict[str, Any],
            text: str,
            details: dict[str, Any],
            limitations: list[str],
            record_id: str | None = None,
        ) -> None:
            nonlocal ordinal
            evidence_id = stable_id([source_version_id, cache_id, ordinal])
            ordinal += 1
            if session.get(EvidenceArtifact, evidence_id) is None:
                session.add(
                    EvidenceArtifact(
                        id=evidence_id,
                        source_version_id=source_version_id,
                        cache_id=cache_id,
                        record_id=record_id,
                        source_kind=kind,
                        locator=locator,
                        scope=scope,
                        excerpt=text,
                        details=details,
                        limitations=limitations,
                    )
                )
                session.flush()
            if session.get(RunEvidence, (run_id, generation, evidence_id)) is None:
                session.add(
                    RunEvidence(
                        run_id=run_id, generation_id=generation, evidence_id=evidence_id
                    )
                )

        for record in parsed.records:
            record_id = stable_id(
                [
                    run.workspace_id,
                    member.binding["dataset_namespace"],
                    record.source_namespace,
                    record.external_record_id,
                ]
            )
            if session.get(LogicalRecord, record_id) is None:
                session.add(
                    LogicalRecord(
                        id=record_id,
                        workspace_id=run.workspace_id,
                        dataset_namespace=member.binding["dataset_namespace"],
                        source_namespace=record.source_namespace,
                        external_record_id=record.external_record_id,
                    )
                )
                session.flush()
            for annotation in record.annotations:
                add_evidence(
                    "feedback",
                    annotation.locator.model_dump(mode="json"),
                    annotation.scope.model_dump(mode="json"),
                    annotation.text,
                    {
                        "classifications": annotation.classifications,
                        "text_variants": record.text_variants,
                    },
                    record.limitations,
                    record_id,
                )
        for annotation in parsed.unresolved_annotations:
            add_evidence(
                "feedback",
                annotation.locator.model_dump(mode="json"),
                annotation.scope.model_dump(mode="json"),
                annotation.text,
                {"classifications": annotation.classifications},
                ["unresolved_record_identity"],
            )
        for metric in parsed.metrics:
            add_evidence(
                metric.source_kind,
                metric.locator.model_dump(mode="json"),
                metric.scope.model_dump(mode="json"),
                json.dumps(metric.raw_cells, ensure_ascii=False),
                metric.model_dump(mode="json"),
                metric.limitations,
            )
        for passage in parsed.passages:
            add_evidence(
                passage.source_kind,
                passage.locator.model_dump(mode="json"),
                passage.scope.model_dump(mode="json"),
                passage.text,
                passage.attributes,
                passage.limitations,
            )
        session.add(
            StageOutput(
                run_id=run_id,
                generation_id=generation,
                stage_key=checkpoint[2],
                payload={
                    "source_version_id": source_version_id,
                    "cache_id": cache_id,
                    "batch": batch,
                    "status": parsed.status,
                    "coverage": [
                        issue.model_dump(mode="json") for issue in parsed.coverage
                    ],
                },
            )
        )
        emit(session, run, "analysis.updated", "analysis", run.id)
        return cache_id


def finalize_source(run_id: str, generation: str, version_id: str) -> None:
    with Session.begin() as session:
        locked_run(session, run_id, generation)
        if session.get(RunSource, (run_id, version_id)) is None:
            raise ValueError("Source outside frozen manifest")
        outputs = session.scalars(
            select(StageOutput).where(
                StageOutput.run_id == run_id,
                StageOutput.generation_id == generation,
                StageOutput.stage_key.like(f"parse:{version_id}:%"),
            )
        ).all()
        if not outputs:
            raise ValueError("Cannot finalize source without parse outcomes")
        key = (run_id, generation, f"ingest:{version_id}")
        if session.get(StageOutput, key) is None:
            session.add(
                StageOutput(
                    run_id=run_id,
                    generation_id=generation,
                    stage_key=key[2],
                    payload={
                        "source_version_id": version_id,
                        "batches": [output.payload for output in outputs],
                    },
                )
            )


def complete_ingestion(run_id: str, generation: str) -> None:
    with Session.begin() as session:
        run = locked_run(session, run_id, generation)
        key = (run_id, generation, "ingestion")
        if session.get(StageOutput, key) is not None:
            return
        members = session.scalars(
            select(RunSource).where(RunSource.run_id == run_id)
        ).all()
        outcomes = [
            session.get(
                StageOutput, (run_id, generation, f"ingest:{member.source_version_id}")
            )
            for member in members
        ]
        if not members or any(outcome is None for outcome in outcomes):
            raise ValueError("Cannot publish an incomplete ingestion join")
        warnings = [
            warning
            for warning in run.warnings
            if warning != "Source ingestion is pending implementation"
        ]
        for outcome in outcomes:
            if outcome is not None:
                for batch in outcome.payload["batches"]:
                    warnings.extend(
                        f"Source {outcome.payload['source_version_id']}: {issue['code']}"
                        for issue in batch["coverage"]
                    )
        evidence = session.scalars(
            select(EvidenceArtifact)
            .join(RunEvidence, RunEvidence.evidence_id == EvidenceArtifact.id)
            .where(
                RunEvidence.run_id == run_id, RunEvidence.generation_id == generation
            )
        ).all()
        texts: dict[str, set[str]] = {}
        for artifact in evidence:
            if artifact.record_id:
                texts.setdefault(artifact.record_id, set()).add(artifact.excerpt)
        if any(len(values) > 1 for values in texts.values()):
            warnings.append(
                "conflicting_record_text: original annotation variants retained"
            )
        run.warnings = list(dict.fromkeys(warnings))
        run.analysis_status = "processing" if evidence else "failed"
        run.stage = "ingestion_ready" if evidence else "failed"
        if not evidence:
            run.warnings = [
                *run.warnings,
                "No valid evidence; source outcomes retained",
            ]
        session.add(
            StageOutput(
                run_id=run_id,
                generation_id=generation,
                stage_key="ingestion",
                payload={
                    "source_version_ids": [
                        member.source_version_id for member in members
                    ],
                    "evidence_ids": [artifact.id for artifact in evidence],
                    "logical_record_ids": sorted(texts),
                },
            )
        )
        emit(session, run, "analysis.updated", "analysis", run.id)


@activity.defn
def ingest_source(args: list[str]) -> str:
    run_id, generation, version_id = args
    settings = Settings()
    with Session() as session:
        run = session.get(Run, run_id)
        member = session.get(RunSource, (run_id, version_id))
        version = session.get(SourceVersion, version_id)
        if (
            run is None
            or run.generation_id != generation
            or member is None
            or version is None
        ):
            raise ValueError("Source outside current frozen manifest")
        source = session.get(Source, version.source_id)
        if source is None or source.workspace_id != run.workspace_id:
            raise ValueError("Source outside workspace")
        if session.get(StageOutput, (run_id, generation, f"ingest:{version_id}")):
            return version_id
        binding, kind, filename, object_key = (
            member.binding,
            source.detected_type,
            source.filename,
            version.object_key,
        )
        audit(
            session,
            Actor("ingestion", run.workspace_id, "service"),
            "source.read",
            source.id,
            run_id,
        )
        session.commit()
        data = storage(settings).read(object_key)
        if hashlib.sha256(data).hexdigest() != version.sha256:
            raise ValueError("Original source integrity mismatch")
        if kind == "pdf":
            reader = PdfReader(BytesIO(data))
            if reader.is_encrypted and not reader.decrypt(""):
                raise ValueError("Original source requires a password")
            batch_pages = binding.get("pdf_batch_pages", 10)
            batches = [
                (first, min(first + batch_pages - 1, len(reader.pages)))
                for first in range(1, len(reader.pages) + 1, batch_pages)
            ]
        else:
            batches = [(0, 0)]
    context: list[ParsedPassage] = []
    pending_batches = deque(batches)
    while pending_batches:
        first, last = pending_batches.popleft()
        if activity.in_activity():
            activity.heartbeat(version_id, first)
        batch = f"{first}:{last}" if first else "all"
        context_hash = (
            hashlib.sha256(
                json.dumps(
                    [passage.model_dump(mode="json") for passage in context],
                    sort_keys=True,
                ).encode()
            ).hexdigest()
            if context
            else ""
        )
        cache_id, _ = cache_identity(
            run.workspace_id, version.sha256, binding, batch, context_hash
        )
        with Session() as session:
            cache = session.get(ParseCache, cache_id)
            result = ParseResult.model_validate(cache.payload) if cache else None
            if result is not None and result.status not in {"ready", "partial"}:
                result = None
        if result is None:
            result = (
                parse_excel_bounded(data, binding)
                if kind == "xlsx"
                else parse_pdf(
                    data,
                    filename,
                    artifacts_path=settings.pdf_artifacts_path,
                    page_range=(first, last),
                    timeout_seconds=binding["pdf_timeout_seconds"],
                    memory_mb=binding["pdf_memory_mb"],
                    context_passages=context,
                )
            )
        if (
            first < last
            and binding.get("pdf_single_page_fallback", False)
            and result.status == "failed"
            and any(issue.code == "pdf_parser_limit" for issue in result.coverage)
        ):
            middle = (first + last) // 2
            pending_batches.appendleft((middle + 1, last))
            pending_batches.appendleft((first, middle))
            continue
        for record in result.records:
            record.dataset_namespace = binding["dataset_namespace"]
        publish_batch(
            run_id,
            generation,
            version_id,
            result,
            batch=batch,
            context_hash=context_hash,
        )
        context.extend(
            passage
            for passage in result.passages
            if passage.attributes.get("label") != "table_row"
            and "option_code" not in passage.attributes
        )
    finalize_source(run_id, generation, version_id)
    return version_id


@activity.defn
def join_ingestion(args: list[str]) -> None:
    complete_ingestion(*args)
