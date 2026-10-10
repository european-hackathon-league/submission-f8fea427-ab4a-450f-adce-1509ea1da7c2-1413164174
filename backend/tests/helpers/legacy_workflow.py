from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy


@workflow.defn(name="AnalysisWorkflow")
class LegacyAnalysisWorkflow:
    @workflow.run
    async def run(self, manifest: dict[str, str | list[str]]) -> list[str]:
        run_id = str(manifest["run_id"])
        generation = str(manifest["generation_id"])
        versions = manifest["source_version_ids"]
        retry = RetryPolicy(maximum_attempts=3)
        outcomes = []
        for version in versions:
            outcomes.append(
                await workflow.execute_activity(
                    "source_check",
                    [run_id, generation, version],
                    start_to_close_timeout=timedelta(seconds=30),
                    heartbeat_timeout=timedelta(seconds=10),
                    retry_policy=retry,
                    result_type=str,
                )
            )
        await workflow.execute_activity(
            "complete_foundation",
            [run_id, generation],
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=retry,
        )
        return outcomes
