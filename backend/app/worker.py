import asyncio
from concurrent.futures import ThreadPoolExecutor

from temporalio.client import Client
from temporalio.contrib.opentelemetry import TracingInterceptor
from temporalio.worker import Worker

from app.activities import complete_foundation, fail_analysis, source_check
from app.config import Settings
from app.control import refine_proposals
from app.dispatch import dispatch_once
from app.exports import export_build
from app.findings import establish_baselines, extract_findings
from app.ingestion import ingest_source, join_ingestion
from app.proposals import prepare_proposals, publish_proposals
from app.rendering import render_expire, render_poll, render_submit
from app.telemetry import configure
from app.workflows import AnalysisWorkflow, DeliveryWorkflow


async def main() -> None:
    settings = Settings()
    configure(settings)
    client = await asyncio.wait_for(
        Client.connect(
            settings.temporal_address,
            namespace=settings.temporal_namespace,
            interceptors=[TracingInterceptor()],
        ),
        10,
    )
    with ThreadPoolExecutor(max_workers=4) as executor:
        async with Worker(
            client,
            task_queue="vehicle-backend",
            workflows=[AnalysisWorkflow, DeliveryWorkflow],
            activities=[
                source_check,
                complete_foundation,
                fail_analysis,
                ingest_source,
                join_ingestion,
                extract_findings,
                establish_baselines,
                prepare_proposals,
                publish_proposals,
                refine_proposals,
                render_submit,
                render_poll,
                render_expire,
                export_build,
            ],
            activity_executor=executor,
            max_concurrent_activities=4,
        ):
            while True:
                try:
                    delivered = await dispatch_once(client)
                except Exception:
                    # Outbox remains durable; do not log request contents or service credentials.
                    delivered = False
                if not delivered:
                    await asyncio.sleep(1)


if __name__ == "__main__":
    asyncio.run(main())
