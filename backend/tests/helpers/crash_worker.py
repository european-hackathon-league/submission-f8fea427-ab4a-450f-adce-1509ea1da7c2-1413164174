"""Test-only worker that dies after a committed Activity output, before its ACK."""

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor

from temporalio import activity
from temporalio.client import Client
from temporalio.worker import Worker

from app.activities import complete_foundation, source_check
from app.config import Settings
from app.workflows import AnalysisWorkflow


@activity.defn(name="source_check")
def crash_after_commit(args: list[str]) -> str:
    source_check(args)
    os._exit(23)


async def main():
    client = await Client.connect(Settings().temporal_address)
    with ThreadPoolExecutor(max_workers=2) as executor:
        async with Worker(
            client,
            task_queue=os.environ["TEST_TASK_QUEUE"],
            workflows=[AnalysisWorkflow],
            activities=[crash_after_commit, complete_foundation],
            activity_executor=executor,
        ):
            await asyncio.Future()


asyncio.run(main())
