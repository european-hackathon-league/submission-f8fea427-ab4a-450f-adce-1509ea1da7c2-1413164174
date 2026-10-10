import asyncio
from datetime import timedelta
from typing import cast

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError


@workflow.defn
class AnalysisWorkflow:
    @workflow.run
    async def run(self, manifest: dict[str, str | list[str]]) -> list[str]:
        run_id = str(manifest["run_id"])
        generation = str(manifest["generation_id"])
        versions = manifest["source_version_ids"]
        if not isinstance(versions, list):
            raise ValueError("Invalid frozen source manifest")
        retry = RetryPolicy(maximum_attempts=3)

        async def check(version: str) -> str:
            return cast(
                str,
                await workflow.execute_activity(
                    "source_check",
                    [run_id, generation, version],
                    start_to_close_timeout=timedelta(seconds=30),
                    heartbeat_timeout=timedelta(seconds=10),
                    retry_policy=retry,
                    result_type=str,
                ),
            )

        try:
            if workflow.patched("foundation-concurrent-v1"):
                semaphore = asyncio.Semaphore(2)

                async def bounded(version: str) -> str:
                    async with semaphore:
                        return await check(version)

                outcomes = await asyncio.gather(
                    *(bounded(version) for version in versions)
                )
            else:
                outcomes = [await check(version) for version in versions]
            await workflow.execute_activity(
                "complete_foundation",
                [run_id, generation],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
        except ActivityError:
            await workflow.execute_activity(
                "fail_analysis",
                [run_id, generation],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            raise
        return outcomes
