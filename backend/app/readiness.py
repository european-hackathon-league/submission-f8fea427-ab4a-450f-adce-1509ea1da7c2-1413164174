"""Bounded dependency readiness; configuration flags never contain credentials."""

import asyncio
from datetime import timedelta
from typing import Any

import psycopg
from temporalio.api.workflowservice.v1 import DescribeNamespaceRequest
from temporalio.client import Client

from app.config import Settings


def database_ready(settings: Settings) -> bool:
    try:
        dsn = settings.database_url.get_secret_value().replace(
            "postgresql+psycopg://", "postgresql://", 1
        )
        with psycopg.connect(
            dsn,
            connect_timeout=2,
            options="-c statement_timeout=1500 -c lock_timeout=1500",
        ) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                return cursor.fetchone() == (1,)
    except Exception:
        return False


async def temporal_ready(settings: Settings) -> bool:
    try:
        async with asyncio.timeout(3):
            client = await Client.connect(
                settings.temporal_address, namespace=settings.temporal_namespace
            )
            await client.workflow_service.describe_namespace(
                DescribeNamespaceRequest(namespace=settings.temporal_namespace),
                timeout=timedelta(seconds=2),
            )
            return True
    except Exception:
        return False


async def check_readiness() -> tuple[dict[str, Any], int]:
    settings = Settings()

    async def check_database() -> bool:
        try:
            async with asyncio.timeout(3):
                return await asyncio.to_thread(database_ready, settings)
        except Exception:
            return False

    database, temporal = await asyncio.gather(
        check_database(), temporal_ready(settings)
    )
    configured = {
        "ai": bool(settings.openai_api_key.get_secret_value()),
        "research": bool(settings.openai_api_key.get_secret_value()),
        "renderer": bool(
            settings.renderer_url and settings.renderer_token.get_secret_value()
        ),
        "identity_oidc": settings.auth_mode == "oidc",
        "storage_s3": settings.storage_backend == "s3" and bool(settings.s3_bucket),
        "telemetry": bool(settings.otlp_endpoint),
    }
    ready = database and temporal
    return {
        "status": "ready" if ready else "unhealthy",
        "dependencies": {"database": database, "temporal": temporal},
        "configured_capabilities": configured,
    }, 200 if ready else 503
