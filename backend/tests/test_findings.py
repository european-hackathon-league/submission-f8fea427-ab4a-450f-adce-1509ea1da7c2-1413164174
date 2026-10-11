from threading import Barrier, Event, Lock

import httpx
import pytest
from openai import APITimeoutError

from app import findings as module
from app import wire as w
from app.config import Settings
from app.findings import (
    Disposition,
    Observation,
    aggregate,
    applicability,
    validate_extraction,
)


@pytest.mark.parametrize("failure", ["timeout", "invalid_quote"])
def test_failed_batches_split_and_resume_without_losing_evidence(monkeypatch, failure):
    evidence = [
        {
            "evidence_id": str(index),
            "record_id": str(index),
            "source_kind": "feedback",
            "excerpt": "Synthetic seat comfort",
            "scope": w.Scope(markets=["DE"], cohort_ids=["DE"]).model_dump(),
            "limitations": [],
        }
        for index in range(4)
    ]
    policy = {
        "model": "synthetic-model",
        "prompt_revision": module.PROMPT_REVISION,
        "schema_revision": module.PROMPT_REVISION,
        "ai_batch_size": 4,
        "catalog": {"parts": [{"part_id": "part_seat"}]},
    }
    stages = {}
    extraction_sizes = []
    monkeypatch.setattr(
        module, "Settings", lambda: Settings(openai_api_key="synthetic")
    )
    monkeypatch.setattr(module, "_current_generation", lambda *args: True)
    monkeypatch.setattr(module, "_inputs", lambda *args: (policy, evidence, {}))
    monkeypatch.setattr(
        module, "get_stage", lambda run, generation, key: stages.get(key)
    )
    monkeypatch.setattr(
        module,
        "put_stage",
        lambda run, generation, key, payload, **kw: stages.update({key: payload}),
    )

    def call(schema, instructions, data, frozen):
        if schema is module.Extraction:
            extraction_sizes.append(len(data["evidence"]))
            if len(data["evidence"]) > 1 and failure == "timeout":
                raise APITimeoutError(
                    request=httpx.Request("POST", "https://synthetic.invalid")
                )
            extracted = module.Extraction(
                observations=[
                    Observation.model_validate(
                        {
                            key: value
                            for key, value in observation(
                                data["evidence"][0]["evidence_id"], "record"
                            ).items()
                            if key not in {"record_id", "scope", "observation_id"}
                        }
                    )
                ],
                dispositions=[],
            )
            if len(data["evidence"]) > 1:
                extracted.observations[0].quote = "Fabricated quote"
            return extracted, {}
        if schema is module.Reconciliation:
            return module.Reconciliation(
                links=[
                    module.TopicLink(
                        topic_key="seat-comfort",
                        canonical_key="seat-comfort",
                        basis="Same task",
                    )
                ]
            ), {}
        return module.Review(accepted=True, objections=[]), {}

    monkeypatch.setattr(module, "_call", call)
    assert module.extract_findings(["run", "generation"]) == "ready"
    assert extraction_sizes == (
        [4, 2, 1, 1, 2, 1, 1]
        if failure == "timeout"
        else [4, 4, 2, 2, 1, 1, 2, 2, 1, 1]
    )
    assert stages["findings"]["counts"]["total_records"] == 4
    del stages["findings"]
    extraction_sizes.clear()
    assert module.extract_findings(["run", "generation"]) == "ready"
    assert extraction_sizes == []
    assert stages["findings"]["counts"]["total_records"] == 4


def observation(evidence, record, sentiment="negative", parts=None, cohorts=None):
    return {
        **Observation(
            evidence_id=evidence,
            quote="Synthetic seat comfort",
            topic_key="seat-comfort",
            title="Seat comfort",
            customer_need="Sit comfortably",
            sentiment=sentiment,
            need_kind="usability",
            part_ids=parts or ["part_seat"],
            mapping_kind="physical",
            mapping_rationale="The comment directly mentions a seat",
        ).model_dump(),
        "observation_id": evidence + "-observation",
        "record_id": record,
        "scope": w.Scope(cohort_ids=cohorts or ["DE", "EU"]).model_dump(),
    }


@pytest.mark.parametrize("collision", [False, True])
def test_topic_collision_repairs_grouping_without_reextracting_valid_feedback(
    monkeypatch,
    collision,
):
    evidence = [
        {
            "evidence_id": str(i),
            "record_id": str(i),
            "source_kind": "feedback",
            "excerpt": "Synthetic seat comfort",
            "scope": w.Scope().model_dump(),
            "limitations": [],
        }
        for i in range(2)
    ]
    policy = {
        "model": "synthetic",
        "prompt_revision": module.PROMPT_REVISION,
        "schema_revision": module.PROMPT_REVISION,
        "ai_batch_size": 1,
        "catalog": {"parts": [{"part_id": "part_seat"}]},
    }
    stages, extractions, merges = {}, [], []
    needs = (
        ["Smaller sedan driving feel", "Light driving feel"]
        if collision
        else ["Comfortable seat for long trips", "Seat comfort on long journeys"]
    )
    monkeypatch.setattr(
        module, "Settings", lambda: Settings(openai_api_key="synthetic")
    )
    monkeypatch.setattr(module, "_current_generation", lambda *args: True)
    monkeypatch.setattr(module, "_inputs", lambda *args: (policy, evidence, {}))
    monkeypatch.setattr(module, "get_stage", lambda r, g, k: stages.get(k))
    monkeypatch.setattr(
        module, "put_stage", lambda r, g, k, p, **kw: stages.update({k: p})
    )

    def call(schema, instructions, data, frozen):
        if schema is module.Extraction:
            eid = data["evidence"][0]["evidence_id"]
            extractions.append(eid)
            row = observation(eid, eid)
            row["customer_need"] = needs[int(eid)]
            return module.Extraction(
                observations=[
                    Observation.model_validate(
                        {
                            k: v
                            for k, v in row.items()
                            if k not in {"record_id", "scope", "observation_id"}
                        }
                    )
                ],
                dispositions=[],
            ), {}
        if schema is module.Reconciliation:
            merges.append(data)
            target = (
                "light-driving-feel"
                if data.get("previous_objections")
                else "seat-comfort"
            )
            return module.Reconciliation(
                links=[
                    module.TopicLink(
                        topic_key="seat-comfort",
                        canonical_key=target,
                        basis="Preserve distinct needs",
                    )
                ]
            ), {}
        rejected = (
            "links" in data
            and data["existing"]
            and collision
            and data["links"]["links"][0]["canonical_key"] == "seat-comfort"
        )
        if "links" in data:
            assert data["candidate"][0]["quote"] in data["evidence"][0]["excerpt"]
            assert data["candidate"][0]["canonical_need"]["customer_need"]
        return module.Review(
            accepted=not rejected,
            objections=["Keep different needs separate"] if rejected else [],
        ), {}

    monkeypatch.setattr(module, "_call", call)
    assert module.extract_findings(["run", "generation"]) == "ready"
    assert stages["findings"]["counts"]["total_records"] == 2
    assert extractions == ["0", "1"]
    assert len(merges) == (3 if collision else 2)
    assert stages["findings:batch:1"]["observations"][0]["customer_need"] == needs[1]
    assert len(stages["findings"]["findings"]) == (2 if collision else 1)


def test_annotation_overlap_counts_distinct_records_and_preserves_opposition():
    rows = [
        observation("one", "respondent-one", parts=["part_seat", "part_interior"]),
        observation("repeat", "respondent-one"),
        observation("positive", "respondent-two", "positive"),
    ]
    result = aggregate(rows, [], "run")
    assert result["counts"]["total_records"] == 2
    assert result["counts"]["negative_records"] == 1
    assert result["counts"]["negative_share"] == 0.5
    finding = w.Finding.model_validate(result["findings"][0])
    assert finding.opposing_evidence_ids == ["positive"]
    assert finding.counts.record_ids == ["respondent-one", "respondent-two"]
    filtered = aggregate(rows, [], "run", part_id="part_interior", cohort_id="EU")
    assert filtered["counts"]["total_records"] == 1
    assert (
        filtered["parts"][0]["intensity_scale_id"]
        == result["parts"][0]["intensity_scale_id"]
    )


def test_external_and_unresolved_feedback_never_increase_comment_counts():
    row = observation("unresolved", None)
    result = aggregate([row], ["unresolved_record_identity"], "run")
    assert result["counts"]["total_records"] == 0
    assert result["counts"]["negative_share"] is None
    assert result["findings"][0]["provisional"]


def test_fabricated_quote_or_catalog_part_is_rejected_before_publication():
    row = Observation.model_validate(
        {
            key: value
            for key, value in observation("one", "record").items()
            if key not in {"record_id", "scope", "observation_id"}
        }
    )
    evidence = [{"evidence_id": "one", "excerpt": "Synthetic seat comfort"}]
    validate_extraction([row], [], evidence, {"part_seat"})
    with pytest.raises(ValueError, match="one/seat-comfort.*exact substring"):
        validate_extraction(
            [row.model_copy(update={"quote": "fabricated"})],
            [],
            evidence,
            {"part_seat"},
        )
    with pytest.raises(ValueError):
        validate_extraction(
            [row.model_copy(update={"part_ids": ["fabricated"]})],
            [],
            evidence,
            {"part_seat"},
        )


def test_invalid_empty_mapping_identifies_the_observation_and_safe_repair():
    row = Observation.model_validate(
        {
            key: value
            for key, value in observation("one", "record").items()
            if key not in {"record_id", "scope", "observation_id"}
        }
    ).model_copy(update={"part_ids": [], "mapping_kind": "digital"})
    evidence = [{"evidence_id": "one", "excerpt": "Synthetic seat comfort"}]
    with pytest.raises(ValueError) as caught:
        validate_extraction([row], [], evidence, {"part_seat"})
    message = str(caught.value)
    assert "one/seat-comfort" in message
    assert "unmapped" in message
    assert "vehicle_wide" in message
    validate_extraction(
        [row.model_copy(update={"mapping_kind": "unmapped"})],
        [],
        evidence,
        {"part_seat"},
    )


def test_german_baseline_cannot_establish_us_availability_or_unknown_scope_absence():
    scope = w.Scope(vehicle_ids=["G60"], markets=["DE"], year=2026)
    assert (
        applicability(scope, {"vehicle_id": "G60", "market_context": ["US"]}, 2026)[0]
        == "mismatch"
    )
    assert (
        applicability(w.Scope(), {"vehicle_id": "G60", "market_context": ["US"]}, 2026)[
            0
        ]
        == "unknown"
    )


def test_empty_or_omitted_observation_cannot_silently_remove_source_coverage():
    evidence = [{"evidence_id": "one", "excerpt": "Synthetic seat comfort"}]
    with pytest.raises(ValueError):
        validate_extraction([], [], evidence, {"part_seat"})
    validate_extraction(
        [],
        [Disposition(evidence_id="one", reason="out_of_scope")],
        evidence,
        {"part_seat"},
    )


def test_multiple_topics_and_cohorts_keep_independent_membership_without_double_count():
    first = observation("one", "respondent-one")
    second = observation(
        "two", "respondent-one", parts=["part_digital"], cohorts=["US"]
    )
    second["topic_key"] = "digital-access"
    second["title"] = "Digital access"
    result = aggregate([first, second], [], "run")
    assert len(result["findings"]) == 2
    assert result["counts"]["total_records"] == 1
    assert len(result["membership"]) == 2
    assert (
        aggregate([first, second], [], "run", cohort_id="DE")["parts"][0]["part_id"]
        == "part_seat"
    )
    assert (
        aggregate([first, second], [], "run", cohort_id="US")["parts"][0]["part_id"]
        == "part_digital"
    )


def test_baseline_equipment_software_and_date_conditions_remain_visible():
    state, gaps = applicability(
        w.Scope(
            vehicle_ids=["G60"],
            markets=["US"],
            year=2025,
            equipment=["optional_package"],
            software="v1",
        ),
        {"vehicle_id": "G60", "market_context": ["US"]},
        2026,
    )
    assert state == "mismatch"
    assert set(gaps) == {
        "baseline_date_mismatch",
        "equipment_conditions_unverified",
        "software_version_unverified",
    }


def test_baseline_inference_accepts_complete_scoped_context_but_remains_bounded():
    summary = (
        "One fictional customer praises existing physical controls while describing complex electronics. "
        "This may suggest a tentative usability need for understandable access to vehicle functions and "
        "preservation of appreciated controls. Praise does not establish an explicit retention request, "
        "and the hypothetical removal of controls is not an actual failure or a measured distraction effect. "
        "The source provides one experience despite three duplicate annotations; these must not be counted "
        "as three respondents or interpreted as independent corroboration. The individual electronics "
        "complaint does not establish a population-wide capability gap, offering issue, service issue, "
        "or confirmed defect, and it must remain separate from unrelated praise for ride quality and space. "
        "Scoped fictional vehicle-A study context has seven control-usability categories: I Hate It 4%, "
        "A Failure 1%, Unsatisfactory 4%, Satisfactory 22%, Excellent 26%, Delightful 23%, and I Love It 20%. "
        "These mixed ratings describe broad control usability, not manual controls or entertainment alone. "
        "The favorable and unfavorable categories qualify any generalization while neither confirming "
        "nor disproving this individual's experience. Their respondent denominator and sample size are "
        "unknown, so fractions must not become feedback-record counts or a quantified defect rate. "
        "Study evidence for vehicle B is outside this assessment and is not pooled with vehicle A. "
        "No relevant supplied equipment claim establishes physical-control availability for the target "
        "configuration. Foreign-market option listings cannot confirm the customer's equipment, software, "
        "model year, or local availability. Missing documentation remains unknown rather than absent. "
        "A future preservation priority would be a planning assumption requiring vehicle-specific usability "
        "research and engineering validation; this evidence alone establishes no required redesign."
    )
    assert 1500 < len(summary) <= 3000
    payload = {
        "finding_id": "synthetic-finding",
        "need_kind": "usability",
        "baseline_claims": [],
        "preserve_strengths": ["Appreciated existing physical controls"],
        "inference": summary,
        "basis_evidence_ids": ["synthetic-feedback", "synthetic-study"],
        "uncertainty": ["Sample size and target applicability unknown"],
        "future_assumptions": [],
    }
    assessed = module.NeedAssessment.model_validate(payload)
    assert assessed.inference == summary
    with pytest.raises(ValueError):
        module.NeedAssessment.model_validate({**payload, "inference": "x" * 3001})


@pytest.mark.parametrize(
    "topic, quote, sentiment",
    [
        (
            "cornering-observation",
            "There is a difference in cornering; comparison unclear.",
            "neutral",
        ),
        (
            "digital-key-status",
            "The customer confirmed Digital Key was already configured.",
            "neutral",
        ),
        (
            "wheel-controls",
            "Thankfully there are still manual push buttons and wheel controls.",
            "positive",
        ),
        (
            "roof-opening",
            "I wish the roof would open fully.",
            "negative",
        ),
    ],
)
def test_topic_index_preserves_unknown_needs_and_source_ambiguity(
    monkeypatch, topic, quote, sentiment
):
    observation = Observation(
        evidence_id="neutral-source",
        quote=quote,
        topic_key=topic,
        title="Neutral product observation",
        customer_need="No customer need or desired change is established by this source."
        if sentiment == "neutral"
        else "Praise may suggest preserving wheel controls; their type and location are unknown."
        if sentiment == "positive"
        else "The desired outcome is full roof opening; current opening behavior is unknown.",
        sentiment=sentiment,
        need_kind="capability",
        part_ids=[],
        mapping_kind="unmapped",
        mapping_rationale="The subject is retained as context without an established need or catalog part.",
    )
    descriptor = {
        "title": observation.title,
        "customer_need": observation.customer_need,
        "need_kind": observation.need_kind,
    }
    registry = {
        "established-capability": {
            "title": "Specific requested capability",
            "customer_need": "An explicitly requested improvement",
            "need_kind": "capability",
        }
    }
    attempts = []

    def call(schema, instructions, data, policy):
        if schema is module.Reconciliation:
            assert data["new"][topic] == descriptor
            return module.Reconciliation(
                links=[
                    module.TopicLink(
                        topic_key=topic,
                        canonical_key=topic,
                        basis="Retain a distinct neutral observation index; no need is established.",
                    )
                ]
            ), {}
        assert data["candidate"][0]["customer_need"] == observation.customer_need
        assert data["candidate"][0]["canonical_need"] == descriptor
        assert data["candidate"][0]["topic_key"] == topic
        accepted = (
            "mandatory topic index" in instructions and "must not merge" in instructions
        )
        if sentiment == "positive":
            accepted = (
                accepted
                and "ambiguous" in instructions
                and "steering-wheel" in instructions
            )
        if topic == "roof-opening":
            accepted = accepted and "current partial opening" in instructions
        return module.Review(
            accepted=accepted,
            objections=[]
            if accepted
            else [
                "Remove the neutral canonical link and mandatory need_kind classification."
            ],
        ), {}

    monkeypatch.setattr(module, "_call", call)
    assert module.reconcile_topics(
        {topic: descriptor},
        registry,
        [observation],
        [{"evidence_id": "neutral-source", "excerpt": quote}],
        {},
        attempts,
        1,
    ) == {topic: topic}
    assert observation.customer_need == descriptor["customer_need"]
    assert (
        registry["established-capability"]["customer_need"]
        == "An explicitly requested improvement"
    )
    assert [a["phase"] for a in attempts] == ["reconciliation", "reconciliation_review"]


def test_missing_provider_credentials_publish_explicit_failure_without_fake_findings(
    monkeypatch,
):
    captured = {}
    policy = {
        "model": "synthetic-model",
        "prompt_revision": module.PROMPT_REVISION,
        "schema_revision": module.PROMPT_REVISION,
        "catalog": {"parts": [{"part_id": "part_seat"}]},
    }
    monkeypatch.setattr(module, "Settings", lambda: Settings(openai_api_key=""))
    monkeypatch.setattr(module, "_current_generation", lambda *args: True)
    monkeypatch.setattr(
        module, "get_stage", lambda run, generation, key: captured.get(key)
    )
    monkeypatch.setattr(module, "_inputs", lambda *args: (policy, [], {}))
    monkeypatch.setattr(
        module,
        "put_stage",
        lambda run, generation, key, payload, **kwargs: captured.update({key: payload}),
    )
    assert (
        module.extract_findings(["synthetic-run", "synthetic-generation"]) == "failed"
    )
    assert captured["findings"]["status"] == "failed"
    assert captured["findings"]["findings"] == []
    assert "ai_credentials_unavailable" in captured["findings"]["coverage"]


@pytest.mark.parametrize("stage", [module.extract_findings, module.establish_baselines])
def test_existing_stage_returns_persisted_status_and_stale_generation_stops(
    stage, monkeypatch
):
    monkeypatch.setattr(module, "_current_generation", lambda *args: True)
    monkeypatch.setattr(module, "get_stage", lambda *args: {"status": "partial"})
    assert stage(["synthetic-run", "synthetic-generation"]) == "partial"
    monkeypatch.setattr(module, "_current_generation", lambda *args: False)
    assert stage(["synthetic-run", "synthetic-generation"]) == "superseded"


@pytest.mark.parametrize(
    "failure", [None, "source_kind", "quote", "availability", "basis", "provider"]
)
@pytest.mark.parametrize("sentiment", ["negative", "positive"])
def test_baseline_review_sees_operator_target_and_repairs_invalid_claims(
    monkeypatch, failure, sentiment
):
    row = observation("one", "respondent", cohorts=["GB"])
    row["sentiment"] = sentiment
    row["scope"] = w.Scope(markets=["GB"], cohort_ids=["GB"]).model_dump()
    findings = aggregate([row], [], "synthetic-run")
    config = {"vehicle_id": "vehicle_demo", "market_context": ["DE"]}
    evidence = [
        {
            "evidence_id": "one",
            "source_kind": "feedback",
            "excerpt": row["quote"],
            "scope": row["scope"],
        },
        {
            "evidence_id": "equipment",
            "source_kind": "equipment",
            "excerpt": "Seat comfort package",
            "scope": w.Scope(
                vehicle_ids=["vehicle_demo"], markets=["GB"], year=2026
            ).model_dump(),
            "details": {"availability": "optional"},
            "limitations": [],
        },
    ]
    if failure == "provider":
        evidence.extend(
            {"evidence_id": str(index), "source_kind": "study", "excerpt": "x" * 40001}
            for index in range(2)
        )
    stages = {"findings": findings}
    calls = []
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-controlled-test")
    monkeypatch.setattr(module, "_current_generation", lambda *args: True)
    monkeypatch.setattr(
        module,
        "_inputs",
        lambda *args: (
            {"reference_year": 2026, "planning_horizon": 2030},
            evidence,
            config,
        ),
    )
    monkeypatch.setattr(
        module, "get_stage", lambda run, generation, key: stages.get(key)
    )
    monkeypatch.setattr(
        module,
        "put_stage",
        lambda run, generation, key, payload, **kw: stages.update({key: payload}),
    )

    def call(schema, instructions, data, policy):
        calls.append(schema)
        assert data["target_scope"] == config
        assert data["finding"]["cohort_ids"] == ["GB"]
        if schema is module.NeedAssessment:
            if sentiment == "positive":
                assert "inference itself" in instructions
                assert "all supplied relevant rating categories" in instructions
                assert "unrelated strengths" in instructions
            if failure == "provider":
                raise ValueError("Provider validation could not be repaired")
            invalid = failure and calls.count(schema) == 1
            if failure and not invalid:
                assert data["previous_objections"]
                objection = " ".join(data["previous_objections"])
                assert findings["findings"][0]["finding_id"] in objection
                assert (
                    "one" in objection
                    if failure == "source_kind"
                    else "equipment" in objection
                )
                assert data["claim_evidence_ids"] == ["equipment"]
                assert data["previous_assessment"]
            return module.NeedAssessment(
                finding_id=findings["findings"][0]["finding_id"],
                need_kind="usability",
                baseline_claims=[
                    module.BaselineClaim(
                        evidence_id="one"
                        if invalid and failure == "source_kind"
                        else "equipment",
                        quote="Fabricated"
                        if invalid and failure == "quote"
                        else "Seat comfort",
                        availability="standard"
                        if invalid and failure == "availability"
                        else "optional",
                        behavior="Seat comfort package availability",
                    )
                ]
                if failure
                else [],
                preserve_strengths=[],
                inference="Feedback may suggest a need for seat comfort.",
                basis_evidence_ids=["equipment-outside-input"]
                if invalid and failure == "basis"
                else ["one"],
                uncertainty=["GB feedback does not establish DE applicability"],
                future_assumptions=[],
            ), {}
        if sentiment == "positive":
            assert data["finding"]["supporting_evidence_ids"] == []
            assert data["finding"]["opposing_evidence_ids"] == ["one"]
            assert "immutable" in instructions
            assert "positive feedback opposes" in instructions
        return module.Review(accepted=True, objections=[]), {}

    monkeypatch.setattr(module, "_call", call)
    assert (
        module.establish_baselines(["synthetic-run", "synthetic-generation"])
        == "partial"
    )
    assert calls == (
        [module.NeedAssessment, module.NeedAssessment]
        if failure == "provider"
        else [module.NeedAssessment, module.NeedAssessment, module.Review]
        if failure
        else [module.NeedAssessment, module.Review]
    )
    baseline = next(iter(stages["baselines"]["items"].values()))
    assert baseline["state"] == "unknown"
    assert len(baseline["uncertainty"]) == len(set(baseline["uncertainty"]))
    if failure == "provider":
        assert "baseline_provider_validation_failed" in baseline["uncertainty"]
        assert baseline["uncertainty"].count("baseline_evidence_budget_limited") == 1
    else:
        assert (
            "GB feedback does not establish DE applicability" in baseline["uncertainty"]
        )
    if failure and failure != "provider":
        assert "baseline_provider_validation_failed" not in baseline["uncertainty"]
        assert baseline["claims"][0]["applicability"] == "mismatch"
        assert "market_mismatch" in baseline["claims"][0]["limitations"]


@pytest.mark.parametrize("interrupted", [False, True])
def test_baselines_run_four_at_a_time_preserving_order_and_completed_checkpoints(
    monkeypatch,
    interrupted,
):
    findings = [
        {
            "finding_id": str(index),
            "title": "Seat comfort",
            "customer_need": "Comfortable seats",
            "supporting_evidence_ids": ["feedback"],
            "opposing_evidence_ids": [],
            "cohort_ids": ["GB"],
            "counts": {"total_records": 1},
        }
        for index in range(6)
    ]
    stages = {
        "findings": {"findings": findings},
        "baselines:0": {"finding_id": "0", "state": "unknown"},
    }
    barrier = Barrier(4, timeout=2)
    lock = Lock()
    later_checkpoint = Event()
    active = 0
    peak = 0
    called = []
    completed = []
    resuming = False
    monkeypatch.setattr(
        module, "Settings", lambda: Settings(openai_api_key="synthetic")
    )
    monkeypatch.setattr(module, "_current_generation", lambda *args: True)
    monkeypatch.setattr(
        module,
        "_inputs",
        lambda *args: (
            {"reference_year": 2026, "planning_horizon": 2030},
            [{"evidence_id": "feedback", "source_kind": "feedback", "excerpt": "Seat"}],
            {},
        ),
    )
    monkeypatch.setattr(
        module, "get_stage", lambda run, generation, key: stages.get(key)
    )

    def put_stage(run, generation, key, payload, **kwargs):
        with lock:
            stages[key] = payload
            if key.startswith("baselines:"):
                completed.append(payload["finding_id"])
                if payload["finding_id"] != "1":
                    later_checkpoint.set()

    monkeypatch.setattr(module, "put_stage", put_stage)

    def call(schema, instructions, data, policy):
        nonlocal active, peak
        identifier = data["finding"]["finding_id"]
        if schema is module.NeedAssessment:
            with lock:
                active += 1
                peak = max(peak, active)
                called.append(identifier)
            if identifier != "5" and not resuming:
                barrier.wait()
            return module.NeedAssessment(
                finding_id=identifier,
                need_kind="usability",
                baseline_claims=[],
                preserve_strengths=[],
                inference="Seat comfort may need validation.",
                basis_evidence_ids=["feedback"],
                uncertainty=["One respondent does not establish population need"],
                future_assumptions=[],
            ), {}
        if identifier == "1":
            assert later_checkpoint.wait(2)
        with lock:
            active -= 1
        if identifier == "1" and interrupted and not resuming:
            raise RuntimeError("Interrupted assessment activity")
        return module.Review(accepted=True, objections=[]), {}

    monkeypatch.setattr(module, "_call", call)
    if interrupted:
        with pytest.raises(RuntimeError, match="Interrupted assessment activity"):
            module.establish_baselines(["run", "generation"])
        assert "baselines" not in stages
        assert "baselines:1" not in stages
        assert all("baselines:" + str(index) in stages for index in [0, 2, 3, 4])
        remaining = {
            str(index) for index in range(6) if "baselines:" + str(index) not in stages
        }
        resuming = True
        before_resume = list(called)
        assert module.establish_baselines(["run", "generation"]) == "partial"
        assert set(called[len(before_resume) :]) == remaining
    else:
        assert module.establish_baselines(["run", "generation"]) == "partial"
    assert peak == 4
    assert sorted(set(called)) == ["1", "2", "3", "4", "5"]
    assert completed[0] != "1"
    assert list(stages["baselines"]["items"]) == [str(index) for index in range(6)]
    stages.pop("baselines")
    called.clear()
    assert module.establish_baselines(["run", "generation"]) == "partial"
    assert called == []
