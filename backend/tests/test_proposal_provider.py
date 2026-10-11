import pytest
from openai.lib._pydantic import to_strict_json_schema
from test_control_delivery import ready_run, sample
from test_findings import aggregate, observation

from app import wire as w
from app.findings import Review
from app.proposals import Draft, validated_draft


def accepted_review():
    from types import SimpleNamespace

    return SimpleNamespace(
        output_parsed=Review(accepted=True, objections=[]),
        model="synthetic",
        usage=None,
        id="synthetic-review",
    )


@pytest.mark.parametrize("role", ["claim", "context"])
def test_assessed_documents_supplement_customer_citations_without_expanding_scope(
    client, monkeypatch, role
):
    import json
    from types import SimpleNamespace

    from sqlalchemy import select
    from test_ingestion_cache import feedback, frozen_run

    from app import proposals
    from app.artifacts import put_stage
    from app.config import Settings
    from app.db import EvidenceArtifact, RunEvidence, Session
    from app.ingest_types import ParsedPassage, ParseResult
    from app.ingestion import publish_batch

    run_id, generation, version, binding = frozen_run(client)
    publish_batch(run_id, generation, version, feedback(binding), batch="feedback")
    publish_batch(
        run_id,
        generation,
        version,
        ParseResult(
            kind="equipment",
            parser_revision=binding["parser_revision"],
            passages=[
                ParsedPassage(
                    source_kind="equipment" if role == "claim" else "strategy",
                    text="Synthetic document context",
                    locator=w.PDFLocator(page=1),
                    scope=w.Scope(markets=["CN"]),
                ),
                ParsedPassage(
                    source_kind="equipment",
                    text="Unassessed document passage",
                    locator=w.PDFLocator(page=2),
                ),
            ],
        ),
        batch="document",
    )
    with Session() as session:
        artifacts = session.scalars(
            select(EvidenceArtifact)
            .join(RunEvidence, RunEvidence.evidence_id == EvidenceArtifact.id)
            .where(RunEvidence.run_id == run_id)
        ).all()
        customer = next(item for item in artifacts if item.source_kind == "feedback")
        document = next(
            item for item in artifacts if item.excerpt == "Synthetic document context"
        )
        row = observation(customer.id, customer.record_id)
        row.update(quote=customer.excerpt, scope=customer.scope)
        document_id = document.id
    finding = w.Finding.model_validate(aggregate([row], [], run_id)["findings"][0])
    assessment = {
        "claims": [{"evidence_id": document_id}] if role == "claim" else [],
        "context_evidence_ids": [document_id] if role == "context" else [],
    }
    put_stage(
        run_id, generation, "baselines", {"items": {finding.finding_id: assessment}}
    )
    change = sample().changes[0].model_dump()
    change.update(
        finding_ids=[finding.finding_id],
        supporting_evidence_ids=[row["evidence_id"], document_id],
        scope=w.Scope(markets=["DE"]).model_dump(),
    )

    def validate(**updates):
        return validated_draft(
            Draft.model_validate({"changes": [change | updates], "gaps": []}),
            [finding],
            [],
            run_id,
            generation,
        )

    assert (
        validate().changes[0].supporting_evidence_ids
        == change["supporting_evidence_ids"]
    )
    with pytest.raises(ValueError, match="supporting evidence"):
        validate(supporting_evidence_ids=[document_id])
    with pytest.raises(ValueError, match="outside supported finding evidence"):
        validate(supporting_evidence_ids=[row["evidence_id"], "unassessed-document"])
    with pytest.raises(ValueError, match="scope is not established"):
        validate(scope=w.Scope(markets=["CN"]).model_dump())
    calls = []

    def parse(**options):
        if options["text_format"] is Review:
            return accepted_review()
        calls.append(options)
        return SimpleNamespace(
            output_parsed=Draft.model_validate({"changes": [change], "gaps": []}),
            model="synthetic",
            usage=None,
        )

    monkeypatch.setattr(
        proposals, "Settings", lambda: Settings(openai_api_key="synthetic")
    )
    monkeypatch.setattr(
        proposals,
        "OpenAI",
        lambda **kw: SimpleNamespace(responses=SimpleNamespace(parse=parse)),
    )
    assert proposals.draft_changes(run_id, generation, [finding], []).changes
    payload = json.loads(calls[0]["input"][1]["content"])
    assert payload["source_scopes_by_finding"][finding.finding_id]["markets"] == ["DE"]
    assert {item["evidence_id"] for item in payload["evidence"]} == set(
        change["supporting_evidence_ids"]
    )
    assert (
        "Each conflict finding must itself have opposing_evidence_ids"
        in calls[0]["input"][0]["content"]
    )
    assert (
        "Generic praise is not opposition to a specific need"
        in calls[0]["input"][0]["content"]
    )


def test_proposal_repair_uses_source_vehicle_scope_without_copying_configured_trim(
    client,
    monkeypatch,
):
    import json
    from types import SimpleNamespace

    from sqlalchemy import select
    from test_ingestion_cache import feedback, frozen_run

    from app import proposals
    from app.config import Settings
    from app.db import EvidenceArtifact, Run, RunEvidence, Session
    from app.ingestion import publish_batch

    run_id, generation, version, binding = frozen_run(client)
    publish_batch(run_id, generation, version, feedback(binding), batch="feedback")
    with Session.begin() as session:
        run = session.get(Run, run_id)
        run.config = {**run.config, "vehicle_id": "g60-i5-m60"}
        customer = session.scalar(
            select(EvidenceArtifact)
            .join(RunEvidence, RunEvidence.evidence_id == EvidenceArtifact.id)
            .where(
                RunEvidence.run_id == run_id, EvidenceArtifact.source_kind == "feedback"
            )
        )
        customer.scope = {**customer.scope, "vehicle_ids": ["G60"], "markets": ["CN"]}
        row = observation(customer.id, customer.record_id)
        row.update(quote=customer.excerpt, scope=customer.scope)
    finding = w.Finding.model_validate(aggregate([row], [], run_id)["findings"][0])
    calls = []

    def parse(**options):
        if options["text_format"] is Review:
            return accepted_review()
        calls.append(options)
        if len(calls) == 2:
            message = options["input"][-1]["content"]
            assert "change_demo" in message
            assert "vehicle_ids" in message
            assert "g60-i5-m60" in message
            assert "G60" in message
            assert "Check every change" in message
        change = sample().changes[0].model_dump()
        change.update(
            change_id="change_demo",
            finding_ids=[finding.finding_id],
            supporting_evidence_ids=[row["evidence_id"]],
            scope=w.Scope(
                markets=["CN"], vehicle_ids=["g60-i5-m60" if len(calls) == 1 else "G60"]
            ).model_dump(),
        )
        return SimpleNamespace(
            output_parsed=Draft.model_validate({"changes": [change], "gaps": []}),
            model="synthetic",
            usage=None,
        )

    monkeypatch.setattr(
        proposals, "Settings", lambda: Settings(openai_api_key="synthetic")
    )
    monkeypatch.setattr(
        proposals,
        "OpenAI",
        lambda **kw: SimpleNamespace(responses=SimpleNamespace(parse=parse)),
    )
    result = proposals.draft_changes(run_id, generation, [finding], [])
    assert result.changes[0].scope.vehicle_ids == ["G60"]
    assert result.changes[0].scope.markets == ["CN"]
    assert len(calls) == 2
    payload = json.loads(calls[0]["input"][1]["content"])
    allowed = payload["source_scopes_by_finding"][finding.finding_id]
    assert allowed == {"vehicle_ids": ["G60"], "markets": ["CN"], "equipment": []}
    assert "g60-i5-m60" not in allowed["vehicle_ids"]
    with pytest.raises(ValueError, match="scope is not established"):
        result.changes[0].scope.markets = ["DE"]
        validated_draft(result, [finding], [], run_id, generation)


def test_proposal_schema_only_contains_closed_objects_with_required_properties():
    def check(value):
        if isinstance(value, dict):
            if value.get("type") == "object":
                assert value.get("additionalProperties") is False
                assert set(value.get("required", [])) == set(
                    value.get("properties", {})
                )
            for child in value.values():
                check(child)
        elif isinstance(value, list):
            for child in value:
                check(child)

    check(to_strict_json_schema(Draft))


def test_positive_strength_can_support_a_preservation_requirement(client):
    run_id, generation = ready_run(client)
    projection = aggregate([observation("positive", "record", "positive")], [], run_id)
    finding = w.Finding.model_validate(projection["findings"][0])
    change = sample().changes[0].model_dump()
    change.update(
        outcome="Preserve the comfortable seat",
        after="Retain the reported seating comfort",
        finding_ids=[finding.finding_id],
        supporting_evidence_ids=["positive"],
        scope=w.Scope().model_dump(),
    )
    draft = Draft.model_validate({"changes": [change], "gaps": []})
    result = validated_draft(draft, [finding], [], run_id, generation)
    assert result.changes[0].supporting_evidence_ids == ["positive"]
    assert finding.counts.negative_records == 0
    result.changes[0].supporting_evidence_ids = ["unrelated"]
    with pytest.raises(
        ValueError, match="outside supported finding evidence"
    ) as rejected:
        validated_draft(result, [finding], [], run_id, generation)
    assert "unrelated" in str(rejected.value)
    assert "positive" in str(rejected.value)
    result.changes[0].supporting_evidence_ids = []
    result.changes[0].opposing_evidence_ids = ["positive"]
    with pytest.raises(ValueError, match="supporting evidence.*preservation"):
        validated_draft(result, [finding], [], run_id, generation)


@pytest.mark.parametrize("repaired", [False, True])
@pytest.mark.parametrize("malformed", [False, True])
def test_proposal_validation_repair_is_bounded_and_reuses_returned_drafts(
    client, monkeypatch, repaired, malformed
):
    from types import SimpleNamespace

    from app import proposals
    from app.config import Settings

    run_id, generation = ready_run(client)
    finding = w.Finding.model_validate(
        aggregate([observation("evidence", "record")], [], run_id)["findings"][0]
    )
    calls = []

    def parse(**options):
        if options["text_format"] is Review:
            return accepted_review()
        calls.append(options)
        if malformed and (not repaired or len(calls) == 1):
            return Draft.model_validate_json('{"changes": [')
        change = sample().changes[0].model_dump()
        change.update(
            finding_ids=[finding.finding_id],
            supporting_evidence_ids=["evidence"],
            scope=w.Scope(markets=["unsupported"]).model_dump(),
        )
        if repaired and len(calls) == 2:
            change["scope"] = w.Scope().model_dump()
        return SimpleNamespace(
            output_parsed=Draft.model_validate({"changes": [change], "gaps": []}),
            model="synthetic",
            usage=None,
        )

    monkeypatch.setattr(
        proposals, "Settings", lambda: Settings(openai_api_key="synthetic")
    )
    monkeypatch.setattr(
        proposals,
        "OpenAI",
        lambda **options: SimpleNamespace(responses=SimpleNamespace(parse=parse)),
    )
    for _ in range(2):
        if repaired:
            assert proposals.draft_changes(run_id, generation, [finding], []).changes
        else:
            with pytest.raises(
                ValueError, match="structured draft|scope is not established"
            ):
                proposals.draft_changes(run_id, generation, [finding], [])
    assert len(calls) == 2
    assert ("structured draft" if malformed else "scope is not established") in str(
        calls[1]["input"]
    )


def test_uncertain_proposal_timeout_is_not_automatically_repeated(client, monkeypatch):
    from types import SimpleNamespace

    import httpx
    from openai import APITimeoutError

    from app import proposals
    from app.config import Settings

    run_id, generation = ready_run(client)
    calls = []

    def parse(**options):
        calls.append(options)
        raise APITimeoutError(
            request=httpx.Request("POST", "https://synthetic.invalid")
        )

    monkeypatch.setattr(
        proposals, "Settings", lambda: Settings(openai_api_key="synthetic")
    )
    monkeypatch.setattr(
        proposals,
        "OpenAI",
        lambda **options: SimpleNamespace(responses=SimpleNamespace(parse=parse)),
    )
    with pytest.raises(APITimeoutError):
        proposals.draft_changes(run_id, generation, [], [])
    with pytest.raises(ValueError, match="uncertain outcome"):
        proposals.draft_changes(run_id, generation, [], [])
    assert len(calls) == 1


@pytest.mark.parametrize(
    "outcome",
    ["repaired", "rejected", "malformed", "interrupted", "uncertain", "oversize"],
)
def test_semantic_proposal_review_repairs_false_opposition_and_checkpoints_each_call(
    client,
    monkeypatch,
    outcome,
):
    import json
    from types import SimpleNamespace

    import httpx
    from openai import APITimeoutError
    from sqlalchemy import select
    from test_ingestion_cache import feedback, frozen_run

    from app import proposals
    from app.artifacts import get_stage
    from app.config import Settings
    from app.db import EvidenceArtifact, RunEvidence, Session
    from app.ingest_types import ContextMetric, ParseResult
    from app.ingestion import publish_batch

    run_id, generation, version, binding = frozen_run(client)
    for index, text in enumerate(
        ["The center console obstructs my knee.", "I like the overall cabin layout."]
    ):
        parsed = feedback(binding, text)
        parsed.records[0].external_record_id = str(index)
        publish_batch(run_id, generation, version, parsed, batch=str(index))
    publish_batch(
        run_id,
        generation,
        version,
        ParseResult(
            kind="study",
            parser_revision=binding["parser_revision"],
            metrics=[
                ContextMetric(
                    source_kind="study",
                    topic="Console ergonomics",
                    metric="fraction",
                    value=0.3,
                    unit=None,
                    denominator=None,
                    raw_cells={
                        "topic": "Console ergonomics",
                        "rating": "uncomfortable",
                        "fraction": 0.3,
                    },
                    locator=w.CellLocator(sheet="Study", row=2, cells=["A2"]),
                    scope=w.Scope(markets=["DE"]),
                    limitations=["Unknown sample size"],
                )
            ],
        ),
        batch="study",
    )
    with Session() as session:
        artifacts = session.scalars(
            select(EvidenceArtifact)
            .join(RunEvidence, RunEvidence.evidence_id == EvidenceArtifact.id)
            .where(RunEvidence.run_id == run_id)
        ).all()
        rows = []
        for item in artifacts:
            if item.source_kind == "study":
                study_id = item.id
                continue
            positive = item.excerpt.startswith("I like")
            row = observation(
                item.id, item.record_id, "positive" if positive else "negative"
            )
            row.update(
                quote=item.excerpt,
                scope=item.scope,
                topic_key="layout" if positive else "console",
            )
            rows.append(row)
    findings = [
        w.Finding.model_validate(f) for f in aggregate(rows, [], run_id)["findings"]
    ]
    negative_id = next(
        row["evidence_id"] for row in rows if row["sentiment"] == "negative"
    )
    positive_id = next(
        row["evidence_id"] for row in rows if row["sentiment"] == "positive"
    )
    from app.artifacts import put_stage as save_stage

    save_stage(
        run_id,
        generation,
        "baselines",
        {
            "items": {
                findings[0].finding_id: {
                    "claims": [],
                    "context_evidence_ids": [study_id],
                },
            }
        },
    )
    calls = []
    review_count = 0

    def parse(**options):
        nonlocal review_count
        calls.append(options["text_format"])
        assert options["store"] is False
        if options["text_format"] is Review:
            review_count += 1
            data = json.loads(options["input"][1]["content"])
            assert {e["evidence_id"] for e in data["evidence"]} == {
                negative_id,
                positive_id,
                study_id,
            }
            study = next(e for e in data["evidence"] if e["evidence_id"] == study_id)
            assert study["details"]["value"] == 0.3
            assert study["limitations"] == ["Unknown sample size"]
            assert all(e["scope"]["markets"] == ["DE"] for e in data["evidence"])
            if outcome == "uncertain":
                raise APITimeoutError(
                    request=httpx.Request("POST", "https://synthetic.invalid")
                )
            if outcome == "malformed" and review_count == 1:
                return Review.model_validate_json('{"accepted":')
            accepted = outcome == "interrupted" or (
                review_count == 2 and outcome != "rejected"
            )
            return SimpleNamespace(
                output_parsed=Review(
                    accepted=accepted,
                    objections=[]
                    if accepted
                    else [
                        "Remove generic cabin-layout praise from this console change's opposing_evidence_ids; it does not oppose the specific knee-clearance outcome."
                    ],
                ),
                model="synthetic",
                usage=None,
                id="review-response",
            )
        draft_count = calls.count(Draft)
        if draft_count == 2:
            assert (
                "opposing_evidence_ids" in options["input"][-1]["content"]
                or "structured" in options["input"][-1]["content"]
                or "input budget exhausted" in options["input"][-1]["content"]
            )
        change = sample().changes[0].model_dump()
        change.update(
            outcome="Improve center-console knee clearance",
            after="Validate a layout that accommodates the customer's knee",
            finding_ids=[f.finding_id for f in findings],
            supporting_evidence_ids=[negative_id],
            opposing_evidence_ids=[positive_id]
            if draft_count == 1 and outcome != "interrupted"
            else [],
            scope=w.Scope(markets=["DE"]).model_dump(),
            metric=None,
            unit=None,
            target=None,
            target_basis=None,
        )
        if outcome == "oversize":
            change["after"] = "x" * 160001
        return SimpleNamespace(
            output_parsed=Draft.model_validate({"changes": [change], "gaps": []}),
            model="synthetic",
            usage=None,
        )

    monkeypatch.setattr(
        proposals, "Settings", lambda: Settings(openai_api_key="synthetic")
    )
    monkeypatch.setattr(
        proposals,
        "OpenAI",
        lambda **kw: SimpleNamespace(responses=SimpleNamespace(parse=parse)),
    )
    put_stage = proposals.put_stage
    interrupted = False

    def publish(rid, gen, key, payload, **kwargs):
        nonlocal interrupted
        if key == "proposal_draft" and outcome == "interrupted" and not interrupted:
            interrupted = True
            raise RuntimeError("Process stopped before final publication")
        return put_stage(rid, gen, key, payload, **kwargs)

    monkeypatch.setattr(proposals, "put_stage", publish)
    if outcome == "oversize":
        for _ in range(2):
            with pytest.raises(ValueError, match="input budget exhausted"):
                proposals.draft_changes(run_id, generation, findings, [])
        assert calls == [Draft, Draft]
        assert (
            get_stage(run_id, generation, "proposal_semantic_review:0:attempt") is None
        )
        return
    if outcome == "uncertain":
        with pytest.raises(APITimeoutError):
            proposals.draft_changes(run_id, generation, findings, [])
        with pytest.raises(RuntimeError, match="uncertain"):
            proposals.draft_changes(run_id, generation, findings, [])
        assert calls == [Draft, Review]
        return
    if outcome == "interrupted":
        with pytest.raises(RuntimeError, match="Process stopped"):
            proposals.draft_changes(run_id, generation, findings, [])
    for _ in range(2):
        if outcome == "rejected":
            with pytest.raises(ValueError, match="generic cabin-layout praise"):
                proposals.draft_changes(run_id, generation, findings, [])
        else:
            result = proposals.draft_changes(run_id, generation, findings, [])
            assert result.changes[0].opposing_evidence_ids == []
    assert calls == (
        [Draft, Review] if outcome == "interrupted" else [Draft, Review, Draft, Review]
    )
    reviewed = get_stage(run_id, generation, "proposal_semantic_review:0")
    assert reviewed is not None
    assert reviewed["policy"]["prompt_revision"] == "proposal-review-v1"
    assert reviewed["policy"]["model"] == (
        None if outcome == "malformed" else "synthetic"
    )
