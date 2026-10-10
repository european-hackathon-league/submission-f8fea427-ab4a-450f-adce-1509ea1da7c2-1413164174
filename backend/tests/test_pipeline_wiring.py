"""Exercise workflow orchestration without a Temporal server or live providers."""

import asyncio
from datetime import timedelta

import pytest

from app import workflows as module


def analysis_manifest():
    return {
        "run_id": "synthetic-run",
        "generation_id": "synthetic-generation",
        "source_version_ids": ["source-one", "source-two"],
        "pipeline_version": "analysis-v1",
    }


def analysis_activity(monkeypatch, overrides=None):
    calls = []
    overrides = overrides or {}

    async def execute(name, args, **kwargs):
        calls.append((name, args))
        if name in overrides:
            return overrides[name]
        if name in {"source_check", "ingest_source"}:
            return args[-1]
        if name in {"extract_findings", "establish_baselines"}:
            return "ready"
        if name == "prepare_proposals":
            return ""
        return None

    monkeypatch.setattr(module.workflow, "execute_activity", execute)
    monkeypatch.setattr(module.workflow, "patched", lambda name: True)
    return calls


def test_analysis_runs_all_dependent_stages_in_order(monkeypatch):
    calls = analysis_activity(monkeypatch)
    result = asyncio.run(module.AnalysisWorkflow().run(analysis_manifest()))
    assert result == ["source-one", "source-two"]
    assert [name for name, _ in calls] == [
        "source_check",
        "source_check",
        "complete_foundation",
        "ingest_source",
        "ingest_source",
        "join_ingestion",
        "extract_findings",
        "establish_baselines",
        "prepare_proposals",
        "publish_proposals",
    ]
    assert all(
        args[:2] == ["synthetic-run", "synthetic-generation"] for _, args in calls
    )


@pytest.mark.parametrize("extended", [False, True])
def test_document_ingestion_budget_preserves_existing_workflow_replay(
    monkeypatch, extended
):
    analysis_activity(monkeypatch)
    execute = module.workflow.execute_activity
    timeouts = []

    async def checked(name, args, **options):
        if name == "ingest_source":
            timeouts.append(options["start_to_close_timeout"])
        return await execute(name, args, **options)

    monkeypatch.setattr(module.workflow, "execute_activity", checked)
    monkeypatch.setattr(
        module.workflow, "patched", lambda name: name != "pdf-checkpoints-v2" or extended
    )
    asyncio.run(module.AnalysisWorkflow().run(analysis_manifest()))
    assert timeouts == [timedelta(hours=4 if extended else 1)] * 2


@pytest.mark.parametrize("failed_stage", ["extract_findings", "establish_baselines"])
@pytest.mark.parametrize("status", ["failed", "superseded"])
def test_failed_analysis_stops_later_stages_and_failure_is_visible(
    monkeypatch, failed_stage, status
):
    calls = analysis_activity(monkeypatch, {failed_stage: status})
    asyncio.run(module.AnalysisWorkflow().run(analysis_manifest()))
    names = [name for name, _ in calls]
    assert "prepare_proposals" not in names
    assert "publish_proposals" not in names
    assert names[-1] == ("fail_analysis" if status == "failed" else failed_stage)
    if failed_stage == "extract_findings":
        assert "establish_baselines" not in names


def test_guided_workflow_waits_for_matching_checkpoint_signal(monkeypatch):
    calls = analysis_activity(monkeypatch, {"prepare_proposals": "checkpoint-one"})
    analysis = module.AnalysisWorkflow()
    waited = []

    async def wait(predicate):
        assert not predicate()
        assert "publish_proposals" not in [name for name, _ in calls]
        analysis.continue_analysis(
            {"command_id": "wrong-command", "checkpoint_id": "different-checkpoint"}
        )
        assert not predicate()
        analysis.continue_analysis(
            {"command_id": "accepted-command", "checkpoint_id": "checkpoint-one"}
        )
        analysis.continue_analysis(
            {"command_id": "accepted-command", "checkpoint_id": "checkpoint-one"}
        )
        assert predicate()
        assert len(analysis.continuations) == 2
        waited.append(True)

    monkeypatch.setattr(module.workflow, "wait_condition", wait)
    asyncio.run(analysis.run(analysis_manifest()))
    assert waited == [True]
    assert calls[-1][0] == "publish_proposals"


@pytest.mark.parametrize("pipeline", [None, "ingestion-v1"])
def test_frozen_older_pipeline_does_not_launch_new_model_stages(monkeypatch, pipeline):
    calls = analysis_activity(monkeypatch)
    manifest = analysis_manifest()
    if pipeline is None:
        manifest.pop("pipeline_version")
    else:
        manifest["pipeline_version"] = pipeline
    asyncio.run(module.AnalysisWorkflow().run(manifest))
    names = [name for name, _ in calls]
    assert "extract_findings" not in names
    assert ("join_ingestion" in names) == (pipeline == "ingestion-v1")


def delivery_manifest(operation):
    return {
        "run_id": "synthetic-run",
        "generation_id": "synthetic-generation",
        "resource_id": "synthetic-resource",
        "operation": operation,
    }


def delivery_activity(monkeypatch, responses):
    calls, sleeps = [], []

    async def execute(name, args, **kwargs):
        calls.append((name, args))
        value = responses[name]
        return value.pop(0) if isinstance(value, list) else value

    async def sleep(duration):
        sleeps.append(duration)

    monkeypatch.setattr(module.workflow, "execute_activity", execute)
    monkeypatch.setattr(module.workflow, "sleep", sleep)
    return calls, sleeps


@pytest.mark.parametrize("status", ["succeeded", "partial", "failed", "superseded"])
def test_terminal_render_submission_finishes_without_polling(monkeypatch, status):
    calls, sleeps = delivery_activity(monkeypatch, {"render_submit": status})
    assert (
        asyncio.run(module.DeliveryWorkflow().run(delivery_manifest("render")))
        == status
    )
    assert [name for name, _ in calls] == ["render_submit"]
    assert sleeps == []


def test_render_polling_stops_at_success(monkeypatch):
    calls, sleeps = delivery_activity(
        monkeypatch,
        {"render_submit": "queued", "render_poll": ["rendering", "succeeded"]},
    )
    assert (
        asyncio.run(module.DeliveryWorkflow().run(delivery_manifest("render")))
        == "succeeded"
    )
    assert [name for name, _ in calls] == [
        "render_submit",
        "render_poll",
        "render_poll",
    ]
    assert sleeps == [timedelta(seconds=10)] * 2


def test_nonterminal_render_expires_after_bounded_polling(monkeypatch):
    calls, sleeps = delivery_activity(
        monkeypatch,
        {
            "render_submit": "queued",
            "render_poll": "rendering",
            "render_expire": "failed",
        },
    )
    assert (
        asyncio.run(module.DeliveryWorkflow().run(delivery_manifest("render")))
        == "failed"
    )
    assert [name for name, _ in calls].count("render_poll") == 120
    assert calls[-1][0] == "render_expire"
    assert len(sleeps) == 120


def test_last_permitted_render_poll_success_is_not_expired(monkeypatch):
    calls, _ = delivery_activity(
        monkeypatch,
        {
            "render_submit": "queued",
            "render_poll": ["rendering"] * 119 + ["succeeded"],
            "render_expire": "failed",
        },
    )
    assert (
        asyncio.run(module.DeliveryWorkflow().run(delivery_manifest("render")))
        == "succeeded"
    )
    assert "render_expire" not in [name for name, _ in calls]


@pytest.mark.parametrize(
    "operation, activity",
    [("export", "export_build"), ("instruction", "refine_proposals")],
)
def test_export_and_edit_delivery_invoke_only_the_bound_activity(
    monkeypatch, operation, activity
):
    calls, sleeps = delivery_activity(monkeypatch, {activity: "ready"})
    assert (
        asyncio.run(module.DeliveryWorkflow().run(delivery_manifest(operation)))
        == "ready"
    )
    assert calls == [
        (activity, ["synthetic-run", "synthetic-generation", "synthetic-resource"])
    ]
    assert sleeps == []
