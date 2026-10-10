import hashlib
import json
import os
import subprocess
import sys
from io import BytesIO
from pathlib import Path
from xml.etree.ElementTree import iterparse
from zipfile import BadZipFile, ZipFile

import boto3
from openpyxl import load_workbook
from pypdf import PdfReader, overwrite_configuration
from pypdf.errors import LimitReachedError, PdfReadError

from app.config import Settings


def _inspect_upload(
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
                for item in items:
                    if item.filename.endswith(".xml"):
                        with archive.open(item) as xml:
                            for _, element in iterparse(xml, events=("end",)):
                                element.clear()
            workbook = load_workbook(
                BytesIO(data), read_only=True, data_only=True, keep_links=False
            )
            workbook.close()
        else:
            if not data.startswith(b"%PDF-"):
                return kind, "invalid_signature"
            overwrite_configuration(
                maximum_declared_stream_length=settings.max_pdf_stream_bytes,
                zlib_maximum_output_length=settings.max_pdf_stream_bytes,
                array_based_stream_maximum_output_length=settings.max_pdf_stream_bytes,
                lzw_maximum_output_length=settings.max_pdf_stream_bytes,
                run_length_maximum_output_length=settings.max_pdf_stream_bytes,
                stream_decoding_work_maximum_length=settings.max_archive_bytes,
            )
            pdf = PdfReader(BytesIO(data))
            if pdf.is_encrypted and not pdf.decrypt(""):
                return kind, "password_required"
            if len(pdf.pages) > settings.max_pdf_pages:
                return kind, "page_limit"
            decoded_bytes = 0
            for page in pdf.pages:
                content = page.get_contents()
                if content is not None:
                    page_bytes = len(content.get_data())
                    decoded_bytes += page_bytes
                    if (
                        page_bytes > settings.max_pdf_stream_bytes
                        or decoded_bytes > settings.max_archive_bytes
                    ):
                        return kind, "parser_resource_limit"
            if not any((page.extract_text() or "").strip() for page in pdf.pages):
                return kind, "image_only_pdf"
    except LimitReachedError, MemoryError:
        return kind, "parser_resource_limit"
    except BadZipFile, PdfReadError, KeyError, ValueError, OSError, SyntaxError:
        return kind, "corrupt_file"
    return kind, None


def inspect_upload(
    filename: str, data: bytes, settings: Settings
) -> tuple[str, str | None]:
    kind = {".xlsx": "xlsx", ".pdf": "pdf"}.get(
        Path(filename).suffix.lower(), "unsupported"
    )
    if kind == "unsupported":
        return kind, "unsupported_format"
    if len(data) > settings.max_upload_bytes:
        return kind, "file_size_limit"
    options = {
        name: getattr(settings, name)
        for name in (
            "max_upload_bytes",
            "max_archive_bytes",
            "max_pdf_pages",
            "max_pdf_stream_bytes",
        )
    }
    request = (
        json.dumps({"filename": filename, "limits": options}).encode() + b"\n" + data
    )
    try:
        process = subprocess.run(
            [sys.executable, "-m", "app.preflight"],
            input=request,
            capture_output=True,
            timeout=30 if kind == "pdf" else 10,
            env={
                **{
                    key: value
                    for key, value in os.environ.items()
                    if key in {"PATH", "PYTHONPATH", "SYSTEMROOT", "TEMP", "TMP"}
                },
                "OPENBLAS_NUM_THREADS": "1",
                "OMP_NUM_THREADS": "1",
            },
        )
        if process.returncode:
            return kind, "parser_resource_limit"
        result = json.loads(process.stdout)
        return str(result[0]), result[1]
    except subprocess.TimeoutExpired:
        return kind, "parser_timeout"


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
