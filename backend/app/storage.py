import hashlib
import os
from io import BytesIO
from pathlib import Path
from zipfile import BadZipFile, ZipFile

import boto3
from openpyxl import load_workbook
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.config import Settings


def inspect_upload(
    filename: str, data: bytes, settings: Settings
) -> tuple[str, str | None]:
    extension = Path(filename).suffix.lower()
    kind = {".xlsx": "xlsx", ".pdf": "pdf"}.get(extension, "unsupported")
    if kind == "unsupported":
        return kind, "unsupported_format"
    if len(data) > settings.max_upload_bytes:
        return kind, "file_size_limit"
    try:
        if kind == "xlsx":
            if not data.startswith(b"PK"):
                return kind, "invalid_signature"
            with ZipFile(BytesIO(data)) as archive:
                items = archive.infolist()
                if (
                    len(items) > 10000
                    or sum(item.file_size for item in items)
                    > settings.max_archive_bytes
                ):
                    return kind, "archive_size_limit"
                if any(item.flag_bits & 1 for item in items):
                    return kind, "password_required"
                if any("vbaproject" in item.filename.lower() for item in items):
                    return kind, "macros_unsupported"
                if any(
                    item.file_size > max(item.compress_size, 1) * 1000 for item in items
                ):
                    return kind, "archive_ratio_limit"
            workbook = load_workbook(
                BytesIO(data), read_only=True, data_only=True, keep_links=False
            )
            workbook.close()
        else:
            if not data.startswith(b"%PDF-"):
                return kind, "invalid_signature"
            pdf = PdfReader(BytesIO(data))
            if pdf.is_encrypted:
                return kind, "password_required"
            if len(pdf.pages) > settings.max_pdf_pages:
                return kind, "page_limit"
            if not any((page.extract_text() or "").strip() for page in pdf.pages):
                return kind, "image_only_pdf"
    except BadZipFile, PdfReadError, KeyError, ValueError, OSError, SyntaxError:
        return kind, "corrupt_file"
    return kind, None


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root) or path == self.root:
            raise ValueError("Invalid object key")
        return path

    def put(self, key: str, data: bytes) -> None:
        path = self.path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        stream = path.open("xb")
        try:
            with stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    def read(self, key: str) -> bytes:
        return self.path(key).read_bytes()

    def delete(self, key: str) -> None:
        self.path(key).unlink(missing_ok=True)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class S3Storage:
    def __init__(self, bucket: str):
        self.bucket = bucket
        self.client = boto3.client("s3")

    def put(self, key: str, data: bytes) -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            IfNoneMatch="*",
            ServerSideEncryption="AES256",
        )

    def read(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


def storage(settings: Settings) -> LocalStorage | S3Storage:
    return (
        S3Storage(settings.s3_bucket)
        if settings.storage_backend == "s3"
        else LocalStorage(settings.storage_path)
    )
