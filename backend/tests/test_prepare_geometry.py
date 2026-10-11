import hashlib
import json
import os
import shutil
import struct
import subprocess
from pathlib import Path

import pytest


def test_preparation_uses_exact_reviewed_mapping_and_measured_dimensions():
    from app.prepare_geometry import prepare_catalog

    objects = [
        {
            "name": "Seat.001",
            "dimensions_gltf_m": [0.5, 1, 0.6],
            "scale": [1, 1, 1],
            "modifiers": [],
        }
    ]
    mapping = {
        "asset_id": "bmw-v1",
        "part_catalog_version": "parts-v1",
        "geometry_verified": True,
        "parts": [
            {
                "part_id": "seat",
                "mesh_refs": ["Seat.001"],
                "anchor_mesh_ref": "Seat.001",
                "anchor_local": [0, 0.2, 0],
                "edit_origin_local": [0, -0.5, 0],
                "axis_labels": ["length", "width", "height"],
                "operations": ["resize_local"],
            }
        ],
    }
    catalog = prepare_catalog(mapping, objects, "a" * 64)
    assert catalog["parts"][0]["dimensions_m"] == [0.5, 1, 0.6]
    assert catalog["parts"][0]["axis_labels"] == ["length", "width", "height"]
    assert catalog["sha256"] == "a" * 64
    mapping["parts"][0]["mesh_refs"] = ["Seat"]
    with pytest.raises(ValueError, match="exact"):
        prepare_catalog(mapping, objects, "a" * 64)


def test_preparation_rejects_unreviewed_or_unapplied_mapping():
    from app.prepare_geometry import prepare_catalog

    mapping = {
        "asset_id": "bmw-v1",
        "part_catalog_version": "parts-v1",
        "geometry_verified": False,
        "parts": [],
    }
    with pytest.raises(ValueError, match="verified"):
        prepare_catalog(mapping, [], "a" * 64)
    mapping.update(
        geometry_verified=True,
        parts=[
            {
                "part_id": "seat",
                "mesh_refs": ["Seat"],
                "anchor_mesh_ref": "Seat",
                "anchor_local": [0, 0, 0],
                "edit_origin_local": [0, -0.5, 0],
                "operations": ["resize_local"],
            }
        ],
    )
    with pytest.raises(ValueError, match="scale"):
        prepare_catalog(
            mapping,
            [
                {
                    "name": "Seat",
                    "dimensions_gltf_m": [1, 1, 1],
                    "scale": [2, 1, 1],
                    "modifiers": [],
                }
            ],
            "a" * 64,
        )


@pytest.mark.skipif(
    not (os.environ.get("BLENDER_EXE") or shutil.which("blender")),
    reason="Real Blender executable unavailable",
)
def test_preparation_cli_exports_matching_identity_and_inspection(tmp_path):
    blender = os.environ.get("BLENDER_EXE") or shutil.which("blender")
    source = tmp_path / "source.glb"
    splits = tmp_path / "splits.json"
    fixture = tmp_path / "fixture.py"
    fixture.write_text(
        "import bpy\n"
        "bpy.ops.object.select_all(action='SELECT')\n"
        "bpy.ops.object.delete(use_global=False)\n"
        "bpy.ops.mesh.primitive_cube_add()\n"
        "bpy.context.object.name='VerifiedBox'\n"
        "first=bpy.context.object\n"
        "bpy.ops.mesh.primitive_cube_add(location=(3,0,0))\n"
        "first.select_set(True)\n"
        "bpy.context.view_layer.objects.active=first\n"
        "bpy.ops.object.join()\n"
        f"bpy.ops.export_scene.gltf(filepath={str(source)!r},export_format='GLB')\n"
        "import json,hashlib\n"
        f"recipe={{'source_sha256':hashlib.sha256(open({str(source)!r},'rb').read()).hexdigest(),'blender_version':bpy.app.version_string,'splits':[{{'mesh_ref':'VerifiedBox','new_mesh_ref':'VerifiedComponent','vertex_indices':list(range(24))}}]}}\n"
        f"open({str(splits)!r},'w').write(json.dumps(recipe))\n"
    )
    subprocess.run(
        [
            blender,
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            "--python-exit-code",
            "1",
            "--python",
            str(fixture),
        ],
        check=True,
        timeout=60,
        capture_output=True,
    )
    mapping = tmp_path / "mapping.json"
    mapping.write_text(
        json.dumps(
            {
                "asset_id": "test-box",
                "part_catalog_version": "box-v1",
                "geometry_verified": True,
                "parts": [
                    {
                        "part_id": "box",
                        "mesh_refs": ["VerifiedComponent"],
                        "anchor_mesh_ref": "VerifiedComponent",
                        "anchor_local": [0, 0, 0],
                        "edit_origin_local": [0, -1, 0],
                        "operations": ["resize_local"],
                    }
                ],
            }
        )
    )
    output = tmp_path / "prepared"
    subprocess.run(
        [
            blender,
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            "--python-exit-code",
            "1",
            "--python",
            str(Path(__file__).resolve().parents[1] / "app" / "prepare_geometry.py"),
            "--",
            "--source",
            str(source),
            "--output",
            str(output),
            "--mapping",
            str(mapping),
            "--splits",
            str(splits),
        ],
        check=True,
        timeout=60,
        capture_output=True,
    )
    inspection = json.loads((output / "inspection.json").read_text())
    assert inspection["objects"][0]["dimensions_gltf_m"] == [2, 2, 2]
    catalog = json.loads((output / "catalog.json").read_text())
    raw = (output / "baseline.glb").read_bytes()
    assert catalog["sha256"] == hashlib.sha256(raw).hexdigest()
    size = struct.unpack_from("<I", raw, 12)[0]
    document = json.loads(raw[20 : 20 + size])
    assert document["scenes"][document["scene"]]["extras"] == {
        "asset_id": "test-box",
        "part_catalog_version": "box-v1",
    }
    assert {node.get("name") for node in document["nodes"]} >= {
        "VerifiedBox",
        "VerifiedComponent",
    }
    assert sum(obj["triangles"] for obj in inspection["objects"]) == 24
    assert (output / "baseline.blend").is_file()


def test_resize_preparation_requires_separate_verified_edit_origin():
    from app.prepare_geometry import prepare_catalog

    mapping = {
        "asset_id": "test",
        "part_catalog_version": "v1",
        "geometry_verified": True,
        "parts": [
            {
                "part_id": "seat",
                "mesh_refs": ["Seat"],
                "anchor_mesh_ref": "Seat",
                "anchor_local": [0, 0, 0],
                "operations": ["resize_local"],
            }
        ],
    }
    objects = [
        {
            "name": "Seat",
            "dimensions_gltf_m": [1, 1, 1],
            "scale": [1, 1, 1],
            "modifiers": [],
        }
    ]
    with pytest.raises(ValueError, match="origin"):
        prepare_catalog(mapping, objects, "a" * 64)


def test_component_ids_are_exact_minimum_vertex_indices():
    from app.prepare_geometry import connected_components

    assert connected_components(6, [(4, 3), (3, 5), (1, 0)]) == {
        0: [0, 1],
        2: [2],
        3: [3, 4, 5],
    }
