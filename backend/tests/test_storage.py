from io import BytesIO
from zipfile import ZipFile

import boto3
import pytest
from botocore.response import StreamingBody
from botocore.stub import Stubber
from pypdf import PdfWriter

from app.config import Settings
from app.storage import LocalStorage, S3Storage, inspect_upload


def test_chunked_request_limit_is_enforced_before_upload_write(client):
    from fastapi.testclient import TestClient

    from app.limits import BodyLimit
    from app.main import app

    bounded = TestClient(BodyLimit(app, limit=100), headers=client.headers)
    response = bounded.post(
        "/api/v1/uploads",
        content=iter([b"x" * 75, b"x" * 75]),
        headers={
            "Content-Type": "multipart/form-data; boundary=synthetic",
            "Idempotency-Key": "limit-synthetic",
        },
    )
    assert response.status_code == 413
    assert response.json()["code"] == "request_size_limit"


def test_local_objects_are_immutable_and_cannot_escape_directory(tmp_path):
    objects = LocalStorage(tmp_path)
    objects.put("workspace/version", b"original")
    with pytest.raises(FileExistsError):
        objects.put("workspace/version", b"replacement")
    assert objects.read("workspace/version") == b"original"
    with pytest.raises(ValueError):
        objects.read("../escape")


def test_upload_preflight_enforces_limits_and_rejects_encrypted_and_image_pdfs():
    settings = Settings(_env_file=None, max_upload_bytes=100)
    assert inspect_upload("large.pdf", b"x" * 101, settings)[1] == "file_size_limit"
    pdf = PdfWriter()
    pdf.add_blank_page(width=100, height=100)
    buffer = BytesIO()
    pdf.write(buffer)
    assert (
        inspect_upload("scan.pdf", buffer.getvalue(), Settings(_env_file=None))[1]
        == "image_only_pdf"
    )
    pdf.encrypt("synthetic-password")
    buffer = BytesIO()
    pdf.write(buffer)
    assert (
        inspect_upload("locked.pdf", buffer.getvalue(), Settings(_env_file=None))[1]
        == "password_required"
    )
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("large", b"x" * 1024)
    assert (
        inspect_upload(
            "bomb.xlsx",
            buffer.getvalue(),
            Settings(_env_file=None, max_archive_bytes=100),
        )[1]
        == "archive_size_limit"
    )


@pytest.mark.parametrize(
    ("password", "text", "reason"),
    [
        ("", True, None),
        ("synthetic-password", True, "password_required"),
        ("", False, "image_only_pdf"),
    ],
)
def test_pdf_permissions_encryption_only_rejects_required_passwords(
    password, text, reason
):
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    page = writer.add_blank_page(width=100, height=100)
    if text:
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
        )
        stream = DecodedStreamObject()
        stream.set_data(b"BT /F1 12 Tf 10 50 Td (Synthetic option text) Tj ET")
        page[NameObject("/Contents")] = writer._add_object(stream)
    writer.encrypt(password, owner_password="synthetic-owner-password")
    buffer = BytesIO()
    writer.write(buffer)
    assert inspect_upload(
        "permissions.pdf", buffer.getvalue(), Settings(_env_file=None)
    ) == ("pdf", reason)


def test_s3_adapter_uses_private_encrypted_immutable_write_and_exact_read(monkeypatch):
    client = boto3.client(
        "s3",
        region_name="us-east-1",
        aws_access_key_id="synthetic",
        aws_secret_access_key="synthetic",
    )
    monkeypatch.setattr(boto3, "client", lambda name: client)
    with Stubber(client) as stub:
        stub.add_response(
            "put_object",
            {},
            {
                "Bucket": "synthetic-private",
                "Key": "workspace/version",
                "Body": b"original",
                "IfNoneMatch": "*",
                "ServerSideEncryption": "AES256",
            },
        )
        stub.add_response(
            "get_object",
            {"Body": StreamingBody(BytesIO(b"original"), 8)},
            {"Bucket": "synthetic-private", "Key": "workspace/version"},
        )
        objects = S3Storage("synthetic-private")
        objects.put("workspace/version", b"original")
        assert objects.read("workspace/version") == b"original"
        stub.assert_no_pending_responses()


def test_compressed_pdf_stream_cannot_bypass_expansion_limit():
    from pypdf.generic import DecodedStreamObject, NameObject

    writer = PdfWriter()
    page = writer.add_blank_page(width=100, height=100)
    stream = DecodedStreamObject()
    stream.set_data(b" " * (1024 * 1024))
    page[NameObject("/Contents")] = writer._add_object(stream.flate_encode())
    buffer = BytesIO()
    writer.write(buffer)
    assert len(buffer.getvalue()) < 10000
    result = inspect_upload(
        "compressed.pdf",
        buffer.getvalue(),
        Settings(_env_file=None, max_pdf_stream_bytes=1024),
    )
    assert result == ("pdf", "parser_resource_limit")
