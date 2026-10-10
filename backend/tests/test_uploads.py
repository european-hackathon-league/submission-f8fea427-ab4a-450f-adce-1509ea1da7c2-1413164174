from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from uuid import uuid4

from openpyxl import Workbook
from sqlalchemy import func, select

from app.db import Audit, Session


def workbook():
    book = Workbook()
    book.active.append(["ID", "Customer Feedback"])
    book.active.append(["synthetic_1", "Synthetic seat comfort feedback"])
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def test_partial_package_upload_is_idempotent_and_original_download_is_scoped(client):
    key = str(uuid4())
    data = workbook()
    files = [
        ("files", ("sample.xlsx", data)),
        ("files", ("unsupported.txt", b"synthetic")),
    ]
    first = client.post(
        "/api/v1/uploads", files=files, headers={"Idempotency-Key": key}
    )
    assert first.status_code == 200
    assert [source["status"] for source in first.json()["sources"]] == [
        "ready",
        "rejected",
    ]
    second = client.post(
        "/api/v1/uploads", files=files, headers={"Idempotency-Key": key}
    )
    assert second.json() == first.json()
    changed = client.post(
        "/api/v1/uploads",
        files={"files": ("sample.xlsx", b"different")},
        headers={"Idempotency-Key": key},
    )
    assert changed.status_code == 409
    source_id = first.json()["sources"][0]["source_id"]
    response = client.get(f"/api/v1/sources/{source_id}/content")
    assert response.content == data
    response = client.get(
        f"/api/v1/sources/{source_id}/content",
        headers={
            "Authorization": "Bearer development:pm_other",
            "X-Workspace-ID": "workspace_other",
        },
    )
    assert response.status_code == 404
    with Session() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(Audit)
                .where(Audit.resource_id == source_id, Audit.action == "source.read")
            )
            == 1
        )


def test_simultaneous_repeated_upload_has_one_logical_result(client):
    key = str(uuid4())
    data = workbook()

    def submit():
        return client.post(
            "/api/v1/uploads",
            files={"files": ("same.xlsx", data)},
            headers={"Idempotency-Key": key},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: submit(), range(2)))
    assert all(response.status_code == 200 for response in responses)
    assert responses[0].json() == responses[1].json()


def test_misleading_or_corrupt_inputs_are_rejected(client):
    response = client.post(
        "/api/v1/uploads",
        files=[
            ("files", ("fake.pdf", workbook())),
            ("files", ("bad.xlsx", b"PK broken")),
        ],
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 200
    assert all(
        source["status"] == "rejected" and source["reason"]
        for source in response.json()["sources"]
    )
