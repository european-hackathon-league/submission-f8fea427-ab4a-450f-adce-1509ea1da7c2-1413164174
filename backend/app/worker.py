import asyncio
from concurrent.futures import ThreadPoolExecutor

from temporalio.client import Client
from temporalio.contrib.opentelemetry import TracingInterceptor
from temporalio.worker import Worker

from app.activities import complete_foundation, fail_analysis, source_check
from app.config import Settings
from app.dispatch import dispatch_once
from app.telemetry import configure
from app.workflows import AnalysisWorkflow


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
            workflows=[AnalysisWorkflow],
            activities=[source_check, complete_foundation, fail_analysis],
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
