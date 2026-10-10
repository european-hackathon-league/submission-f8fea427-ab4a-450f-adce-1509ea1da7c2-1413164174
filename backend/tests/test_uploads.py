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


def test_corrupt_xml_is_a_source_rejection_and_failed_storage_writes_roll_back(
    client, monkeypatch
):
    from zipfile import ZipFile

    original = ZipFile(BytesIO(workbook()))
    buffer = BytesIO()
    with ZipFile(buffer, "w") as corrupt:
        for name in original.namelist():
            corrupt.writestr(
                name, b"<broken" if name == "xl/workbook.xml" else original.read(name)
            )
    response = client.post(
        "/api/v1/uploads",
        files={"files": ("corrupt.xlsx", buffer.getvalue())},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 200
    assert response.json()["sources"][0]["status"] == "rejected"
    from app.db import Command
    from app.storage import LocalStorage

    key = str(uuid4())

    def fail(self, object_key, data):
        raise OSError("Synthetic storage failure")

    monkeypatch.setattr(LocalStorage, "put", fail)
    response = client.post(
        "/api/v1/uploads",
        files={"files": ("valid.xlsx", workbook())},
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 500
    with Session() as session:
        assert (
            session.scalar(select(Command).where(Command.idempotency_key == key))
            is None
        )


def test_trailing_worksheet_corruption_rejects_only_the_damaged_companion(client):
    from zipfile import ZipFile

    data = workbook()
    buffer = BytesIO()
    with ZipFile(BytesIO(data)) as original, ZipFile(buffer, "w") as damaged:
        for name in original.namelist():
            content = original.read(name)
            if name == "xl/worksheets/sheet1.xml":
                content = content.replace(b"</worksheet>", b"<broken")
            damaged.writestr(name, content)
    response = client.post(
        "/api/v1/uploads",
        files=[
            ("files", ("damaged.xlsx", buffer.getvalue())),
            ("files", ("valid.xlsx", data)),
        ],
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 200
    assert [
        (item["status"], item["reason"]) for item in response.json()["sources"]
    ] == [("rejected", "corrupt_file"), ("ready", None)]
