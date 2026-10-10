import asyncio
from datetime import timedelta
from typing import cast

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError


@workflow.defn
class AnalysisWorkflow:
    def __init__(self) -> None:
        self.continuations: dict[str, str] = {}

    @workflow.signal
    def continue_analysis(self, message: dict[str, str]) -> None:
        self.continuations.setdefault(message["command_id"], message["checkpoint_id"])

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
            if manifest.get("pipeline_version") in {"ingestion-v1", "analysis-v1"}:
                semaphore = asyncio.Semaphore(2)
                ingestion_hours = 4 if workflow.patched("pdf-checkpoints-v2") else 1

                async def ingest(version: str) -> str:
                    async with semaphore:
                        return cast(
                            str,
                            await workflow.execute_activity(
                                "ingest_source",
                                [run_id, generation, version],
                                start_to_close_timeout=timedelta(hours=ingestion_hours),
                                heartbeat_timeout=timedelta(minutes=15),
                                retry_policy=retry,
                                result_type=str,
                            ),
                        )

                await asyncio.gather(*(ingest(version) for version in versions))
                await workflow.execute_activity(
                    "join_ingestion",
                    [run_id, generation],
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=retry,
                )
            if manifest.get("pipeline_version") == "analysis-v1":
                for stage in ("extract_findings", "establish_baselines"):
                    status = await workflow.execute_activity(
                        stage,
                        [run_id, generation],
                        start_to_close_timeout=timedelta(hours=1),
                        retry_policy=retry,
                        result_type=str,
                    )
                    if status in {"failed", "superseded"}:
                        if status == "failed":
                            await workflow.execute_activity(
                                "fail_analysis",
                                [run_id, generation],
                                start_to_close_timeout=timedelta(seconds=30),
                                retry_policy=retry,
                            )
                        return outcomes
                checkpoint = await workflow.execute_activity(
                    "prepare_proposals",
                    [run_id, generation],
                    start_to_close_timeout=timedelta(hours=1),
                    retry_policy=retry,
                    result_type=str,
                )
                if checkpoint:
                    await workflow.wait_condition(
                        lambda: checkpoint in self.continuations.values()
                    )
                await workflow.execute_activity(
                    "publish_proposals",
                    [run_id, generation],
                    start_to_close_timeout=timedelta(minutes=5),
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


@workflow.defn
class DeliveryWorkflow:
    @workflow.run
    async def run(self, manifest: dict[str, str | list[str]]) -> str:
        args = [
            str(manifest["run_id"]),
            str(manifest["generation_id"]),
            str(manifest["resource_id"]),
        ]
        operation = str(manifest["operation"])
        retry = RetryPolicy(maximum_attempts=3)

        async def execute(name: str) -> str:
            return cast(
                str,
                await workflow.execute_activity(
                    name,
                    args,
                    start_to_close_timeout=timedelta(minutes=5),
                    retry_policy=retry,
                    result_type=str,
                ),
            )

        if operation == "instruction":
            return await execute("refine_proposals")
        if operation == "export":
            return await execute("export_build")
        if operation != "render":
            raise ValueError("Unsupported delivery operation")
        status = await execute("render_submit")
        for _ in range(120):
            if status in {"succeeded", "partial", "failed", "superseded"}:
                return status
            await workflow.sleep(timedelta(seconds=10))
            status = await execute("render_poll")
        if status in {"succeeded", "partial", "failed", "superseded"}:
            return status
        return await execute("render_expire")
