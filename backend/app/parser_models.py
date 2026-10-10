"""Verify pinned PDF weights offline; downloads are an explicit setup command."""

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import httpx

MANIFEST = Path(__file__).resolve().parents[1] / "parser_models.json"


class ModelArtifactsUnavailable(ValueError):
    pass


def declarations(manifest: Path = MANIFEST) -> list[dict[str, Any]]:
    try:
        models: list[dict[str, Any]] = json.loads(manifest.read_text())["models"]
        if not isinstance(models, list) or not models:
            raise ValueError("Missing models")
        for model in models:
            if not re.fullmatch(r"[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+", model["repo_id"]):
                raise ValueError("Invalid repository")
            if not re.fullmatch(r"[0-9a-f]{40}", model["revision"]):
                raise ValueError("Model revision is not immutable")
            if not isinstance(model["files"], list) or not model["files"]:
                raise ValueError("Missing artifact files")
            for entry in model["files"]:
                path = Path(entry["path"])
                if path.is_absolute() or ".." in path.parts or not path.parts:
                    raise ValueError("Invalid artifact path")
                if not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]):
                    raise ValueError("Invalid artifact checksum")
                if type(entry["size"]) is not int or entry["size"] <= 0:
                    raise ValueError("Invalid artifact size")
        if manifest == MANIFEST and {model["repo_id"] for model in models} != {
            "docling-project/docling-layout-heron",
            "docling-project/docling-models",
        }:
            raise ValueError("Required layout and table models are not declared")
        return models
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise ModelArtifactsUnavailable("Invalid model artifact declaration") from error


def verify_artifacts(root: Path, manifest: Path = MANIFEST) -> dict[str, str]:
    versions = {}
    for model in declarations(manifest):
        directory = root / model["repo_id"].replace("/", "--")
        for entry in model["files"]:
            path = directory / entry["path"]
            if not path.resolve().is_relative_to(root.resolve()):
                raise ModelArtifactsUnavailable("Artifact escapes configured directory")
            try:
                with path.open("rb") as stream:
                    checksum = hashlib.file_digest(stream, "sha256").hexdigest()
                if path.stat().st_size != entry["size"] or checksum != entry["sha256"]:
                    raise ModelArtifactsUnavailable("Model artifact checksum mismatch")
            except OSError as error:
                raise ModelArtifactsUnavailable(
                    "Required PDF model artifacts missing"
                ) from error
        versions[model["repo_id"]] = model["revision"]
    return versions


def download_artifacts(root: Path, manifest: Path = MANIFEST) -> None:
    """Public, credential-free setup; never invoked by parsing or an API route."""
    with httpx.Client(follow_redirects=True, timeout=30) as client:
        for model in declarations(manifest):
            for entry in model["files"]:
                target = root / model["repo_id"].replace("/", "--") / entry["path"]
                if not target.resolve().is_relative_to(root.resolve()):
                    raise ModelArtifactsUnavailable(
                        "Artifact escapes configured directory"
                    )
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    with target.open("rb") as stream:
                        if (
                            hashlib.file_digest(stream, "sha256").hexdigest()
                            == entry["sha256"]
                        ):
                            continue
                temporary = target.with_suffix(target.suffix + ".download")
                if not temporary.resolve().is_relative_to(root.resolve()):
                    raise ModelArtifactsUnavailable(
                        "Temporary artifact escapes configured directory"
                    )
                try:
                    with client.stream(
                        "GET",
                        f"https://huggingface.co/{model['repo_id']}/resolve/{model['revision']}/{entry['path']}",
                    ) as response:
                        response.raise_for_status()
                        received = 0
                        with temporary.open("xb") as stream:
                            for chunk in response.iter_bytes():
                                received += len(chunk)
                                if received > entry["size"]:
                                    raise ModelArtifactsUnavailable(
                                        "Artifact exceeds declared size"
                                    )
                                stream.write(chunk)
                    with temporary.open("rb") as stream:
                        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
                    if received != entry["size"] or checksum != entry["sha256"]:
                        raise ModelArtifactsUnavailable(
                            "Downloaded artifact checksum mismatch"
                        )
                    temporary.replace(target)
                finally:
                    temporary.unlink(missing_ok=True)
    verify_artifacts(root, manifest)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    if args.download:
        download_artifacts(args.directory)
    versions = verify_artifacts(args.directory)
    print(json.dumps({"status": "verified", "revisions": versions}))


if __name__ == "__main__":
    main()
