"""Frozen parsing policy and generation-scoped evidence publication."""

import hashlib
import json
from typing import Any

from app.config import Settings
from app.db import Source
from app.excel import REVISION
from app.parser_models import MANIFEST, declarations
from app.pdf import PARSER_REVISION


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
        "namespace_warnings": source.namespace_warnings,
        "schema_revision": "ingest-v1",
        "parser_revision": REVISION
        if source.detected_type == "xlsx"
        else PARSER_REVISION,
        "reference_year": settings.reference_year,
        "header_aliases": settings.feedback_header_aliases,
        "model_revision": model_revision,
        "model_versions": model_versions,
        "pdf_timeout_seconds": settings.pdf_timeout_seconds,
        "pdf_memory_mb": settings.pdf_memory_mb,
    }
