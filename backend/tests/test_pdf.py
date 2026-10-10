import hashlib
import json

import pytest


def test_missing_and_changed_model_artifacts_fail_closed_without_network(tmp_path):
    from app.parser_models import ModelArtifactsUnavailable, verify_artifacts

    manifest = {
        "models": [
            {
                "repo_id": "synthetic/layout",
                "revision": "a" * 40,
                "files": [
                    {
                        "path": "weights.bin",
                        "sha256": hashlib.sha256(b"synthetic").hexdigest(),
                        "size": 9,
                    }
                ],
            }
        ]
    }
    declaration = tmp_path / "manifest.json"
    declaration.write_text(json.dumps(manifest))
    with pytest.raises(ModelArtifactsUnavailable):
        verify_artifacts(tmp_path, declaration)
    (tmp_path / "synthetic--layout").mkdir()
    weights = tmp_path / "synthetic--layout/weights.bin"
    weights.write_bytes(b"synthetic")
    assert verify_artifacts(tmp_path, declaration) == {"synthetic/layout": "a" * 40}
    weights.write_bytes(b"different")
    with pytest.raises(ModelArtifactsUnavailable):
        verify_artifacts(tmp_path, declaration)


def test_manifest_rejects_unpinned_revision_and_path_escape(tmp_path):
    from app.parser_models import ModelArtifactsUnavailable, verify_artifacts

    manifest = tmp_path / "manifest.json"
    for revision, path in [("main", "weights.bin"), ("a" * 40, "../escape")]:
        manifest.write_text(
            json.dumps(
                {
                    "models": [
                        {
                            "repo_id": "synthetic/layout",
                            "revision": revision,
                            "files": [{"path": path, "sha256": "a" * 64, "size": 9}],
                        }
                    ]
                }
            )
        )
        with pytest.raises(ModelArtifactsUnavailable):
            verify_artifacts(tmp_path, manifest)


def test_equipment_keeps_column_identity_legend_conditions_and_german_scope():
    from app.pdf import normalize_document
    from tests.fixtures.pdf import equipment_document

    result = normalize_document(equipment_document(), "equipment")
    options = [p for p in result.passages if p.attributes.get("option_code") == "4ZZ"]
    assert {
        (p.attributes["model_column"], p.attributes["availability"]) for p in options
    } == {("520i", "standard"), ("530e", "optional")}
    assert all(p.scope.markets == ["DE"] and p.scope.year == 2026 for p in options)
    assert all(p.attributes["edition"] == "2026-07" for p in options)
    assert all(
        "1) Nur in Verbindung mit Paket 9AA" in p.attributes["conditions"]
        for p in options
    )
    assert all(p.locator.page == 1 and p.locator.bbox for p in options)
    assert all("Sitzkomfort" in p.text for p in options)
    unknown = [p for p in result.passages if p.attributes.get("option_code") == "6XX"]
    assert unknown and all(p.attributes["availability"] == "unknown" for p in unknown)
    assert any(issue.code == "ambiguous_table_cell" for issue in result.coverage)


def test_pdf_missing_models_and_wrong_formats_produce_explicit_coverage(tmp_path):
    from app.pdf import parse_pdf

    assert (
        parse_pdf(b"not-pdf", "doc.txt", artifacts_path=tmp_path).status
        == "unsupported"
    )
    result = parse_pdf(b"%PDF-1.4\n", "doc.pdf", artifacts_path=tmp_path)
    assert result.status == "failed"
    assert result.coverage[0].code == "pdf_models_unavailable"


def test_bottom_origin_regions_are_converted_to_top_left_and_pages_preserved():
    from app.pdf import normalize_document

    document = {
        "pages": {"12": {"size": {"width": 600, "height": 800}}},
        "texts": [
            {
                "label": "section_header",
                "text": "Strategy context",
                "prov": [
                    {
                        "page_no": 12,
                        "bbox": {
                            "l": 10,
                            "t": 700,
                            "r": 500,
                            "b": 650,
                            "coord_origin": "BOTTOMLEFT",
                        },
                    }
                ],
            }
        ],
    }
    result = normalize_document(document, "strategy")
    assert result.passages[0].locator.page == 12
    assert result.passages[0].locator.bbox == (10, 100, 500, 150)
    assert result.passages[0].locator.section == "Strategy context"
    assert result.passages[0].attributes["claim_role"] == "context"


def test_model_setup_does_not_write_through_a_directory_symlink(tmp_path, monkeypatch):
    import httpx

    import app.parser_models as models
    from app.parser_models import ModelArtifactsUnavailable, download_artifacts

    root, outside = tmp_path / "models", tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (root / "synthetic--layout").symlink_to(outside, target_is_directory=True)
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "models": [
                    {
                        "repo_id": "synthetic/layout",
                        "revision": "a" * 40,
                        "files": [
                            {"path": "weights.bin", "sha256": "a" * 64, "size": 9}
                        ],
                    }
                ]
            }
        )
    )
    real_client = httpx.Client
    monkeypatch.setattr(
        models.httpx,
        "Client",
        lambda **kwargs: real_client(
            transport=httpx.MockTransport(
                lambda request: pytest.fail(
                    "Unsafe artifact destination must reject before HTTP"
                )
            )
        ),
    )
    with pytest.raises(ModelArtifactsUnavailable):
        download_artifacts(root, manifest)
    assert list(outside.iterdir()) == []


@pytest.mark.parametrize(
    "models",
    [
        [],
        [{}],
        [{"repo_id": "synthetic/layout", "revision": "a" * 40, "files": []}],
        [
            {
                "repo_id": "synthetic/layout",
                "revision": "a" * 40,
                "files": [{"path": "weights", "sha256": "a" * 64, "size": "invalid"}],
            }
        ],
    ],
)
def test_empty_or_malformed_model_declarations_fail_closed(tmp_path, models):
    from app.parser_models import ModelArtifactsUnavailable, verify_artifacts

    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"models": models}))
    with pytest.raises(ModelArtifactsUnavailable):
        verify_artifacts(tmp_path, manifest)


@pytest.mark.parametrize("failure", ["exit", "timeout", "malformed_output"])
def test_isolated_parser_failure_has_source_specific_coverage(
    tmp_path, monkeypatch, failure
):
    import subprocess

    import app.pdf as pdf

    monkeypatch.setattr(pdf, "verify_artifacts", lambda root: {"synthetic": "pinned"})

    def execute(args, **kwargs):
        assert kwargs["env"]["HF_HUB_OFFLINE"] == "1"
        assert "OPENAI_API_KEY" not in kwargs["env"]
        if failure == "timeout":
            raise subprocess.TimeoutExpired(args, 1)
        return subprocess.CompletedProcess(
            args,
            137 if failure == "exit" else 0,
            stdout=b"not-a-parse-result",
            stderr=b"synthetic private failure",
        )

    monkeypatch.setattr(pdf.subprocess, "run", execute)
    result = pdf.parse_pdf(b"%PDF-1.4", "equipment.pdf", artifacts_path=tmp_path)
    assert result.status == "failed"
    assert result.coverage[0].code == "pdf_parser_limit"
    assert "private" not in result.model_dump_json()
