from uuid import uuid4

from fixtures.excel import FEEDBACK_HEADERS, feedback_row
from fixtures.excel import workbook as excel_workbook
from sqlalchemy import func, select
from test_uploads import workbook

from app.db import Audit, Command, RunSource, Session, Source


def upload(client, namespace=None, data=None, key=None):
    return client.post(
        "/api/v1/uploads",
        files={"files": ("synthetic.xlsx", workbook() if data is None else data)},
        data={} if namespace is None else {"dataset_namespace": namespace},
        headers={"Idempotency-Key": key or str(uuid4())},
    )


def test_upload_namespaces_preserve_proven_repeat_and_explicit_independence(client):
    data = excel_workbook(
        {
            "Feedback_Explorer": [
                FEEDBACK_HEADERS,
                feedback_row(text=f"Synthetic {uuid4()}"),
            ]
        }
    )
    first = upload(client, data=data).json()["sources"][0]["source_id"]
    repeated = upload(client, data=data).json()["sources"][0]["source_id"]
    separate = upload(client, "independent_dataset", data).json()["sources"][0][
        "source_id"
    ]
    with Session() as session:
        assert first != repeated
        assert (
            session.get(Source, first).dataset_namespace
            != session.get(Source, repeated).dataset_namespace
        )
        assert session.get(Source, separate).dataset_namespace == "independent_dataset"
        assert (
            session.get(Source, separate).dataset_namespace
            != session.get(Source, first).dataset_namespace
        )
    explicit = str(uuid4())
    key = str(uuid4())
    original_response = upload(client, explicit, data, key)
    assert upload(client, explicit, data, key).json() == original_response.json()
    declared_first = original_response.json()["sources"][0]["source_id"]
    declared_repeat = upload(client, explicit, data).json()["sources"][0]["source_id"]
    with Session() as session:
        assert declared_first != declared_repeat
        assert session.get(Source, declared_first).dataset_namespace == explicit
        assert session.get(Source, declared_repeat).dataset_namespace == explicit


def test_run_freezes_source_namespace_and_parser_configuration(client, monkeypatch):
    monkeypatch.setenv("REFERENCE_YEAR", "2026")
    monkeypatch.setenv(
        "FEEDBACK_HEADER_ALIASES", '{"legacy feedback":"Customer Feedback"}'
    )
    source_id = upload(client, "synthetic_dataset").json()["sources"][0]["source_id"]
    body = {
        "vehicle_id": "vehicle_demo",
        "baseline_asset_id": "asset_demo_v1",
        "part_catalog_version": "catalog_demo_v1",
        "source_ids": [source_id],
    }
    response = client.post(
        "/api/v1/runs",
        json=body,
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 202
    with Session() as session:
        member = session.scalar(
            select(RunSource).where(RunSource.run_id == response.json()["run_id"])
        )
        assert member.binding["dataset_namespace"] == "synthetic_dataset"
        assert member.binding["schema_revision"] == "ingest-v1"
        assert member.binding["reference_year"] == 2026
        assert member.binding["header_aliases"] == {
            "legacy feedback": "Customer Feedback"
        }
        original_binding = member.binding
    monkeypatch.setenv("REFERENCE_YEAR", "2030")
    monkeypatch.setenv(
        "FEEDBACK_HEADER_ALIASES", '{"new feedback":"Customer Feedback"}'
    )
    updated = client.post(
        "/api/v1/runs", json=body, headers={"Idempotency-Key": str(uuid4())}
    )
    assert updated.status_code == 202
    with Session() as session:
        original = session.scalar(
            select(RunSource).where(RunSource.run_id == response.json()["run_id"])
        )
        current = session.scalar(
            select(RunSource).where(RunSource.run_id == updated.json()["run_id"])
        )
        assert original.binding == original_binding
        assert original.binding["reference_year"] == 2026
        assert original.binding["header_aliases"] == {
            "legacy feedback": "Customer Feedback"
        }
        assert current.binding["reference_year"] == 2030
        assert current.binding["header_aliases"] == {
            "new feedback": "Customer Feedback"
        }


def test_upload_rejects_unsafe_namespace_without_writes(client):
    with Session() as session:
        before = [
            session.scalar(select(func.count()).select_from(model))
            for model in (Source, Command, Audit)
        ]
    response = upload(client, "../other_workspace")
    assert response.status_code == 422
    with Session() as session:
        assert [
            session.scalar(select(func.count()).select_from(model))
            for model in (Source, Command, Audit)
        ] == before


def test_omitted_namespace_does_not_choose_between_distinct_declared_datasets(client):
    data = excel_workbook(
        {
            "Feedback_Explorer": [
                FEEDBACK_HEADERS,
                feedback_row(text=f"Synthetic {uuid4()}"),
            ]
        }
    )
    first = str(uuid4())
    second = str(uuid4())
    upload(client, first, data)
    upload(client, second, data)
    source_id = upload(client, data=data).json()["sources"][0]["source_id"]
    with Session() as session:
        source = session.get(Source, source_id)
        assert source.dataset_namespace not in {first, second}
        assert source.namespace_warnings == ["generated_dataset_namespace"]
