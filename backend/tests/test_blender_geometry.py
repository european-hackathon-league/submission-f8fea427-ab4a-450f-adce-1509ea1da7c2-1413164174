"""Real Blender integration on labelled test boxes, never a vehicle substitute."""

import json
import os
import shutil
import struct
import subprocess
from pathlib import Path

import pytest


def glb_geometry(path):
    content = path.read_bytes()
    assert content[:4] == b"glTF"
    assert struct.unpack_from("<II", content, 4) == (2, len(content))
    json_size, kind = struct.unpack_from("<II", content, 12)
    assert kind == 0x4E4F534A
    document = json.loads(content[20 : 20 + json_size])
    bin_start = 20 + json_size
    bin_size, kind = struct.unpack_from("<II", content, bin_start)
    assert kind == 0x004E4942
    binary = content[bin_start + 8 : bin_start + 8 + bin_size]
    meshes = {}
    for node in document["nodes"]:
        if "mesh" not in node:
            continue
        positions = []
        for primitive in document["meshes"][node["mesh"]]["primitives"]:
            accessor = document["accessors"][primitive["attributes"]["POSITION"]]
            assert accessor["componentType"] == 5126 and accessor["type"] == "VEC3"
            view = document["bufferViews"][accessor["bufferView"]]
            start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
            positions.extend(
                struct.unpack_from(
                    "<3f", binary, start + index * view.get("byteStride", 12)
                )
                for index in range(accessor["count"])
            )
        meshes[node["name"]] = positions
    return document, meshes


@pytest.mark.skipif(
    not (os.environ.get("BLENDER_EXE") or shutil.which("blender")),
    reason="Real Blender executable unavailable",
)
@pytest.mark.parametrize("multiple", [False, True])
def test_blender_exports_measured_targeted_geometry_and_preserves_other_meshes(
    tmp_path,
    multiple,
):
    blender = os.environ.get("BLENDER_EXE") or shutil.which("blender")
    fixture = tmp_path / "fixture.py"
    baseline = tmp_path / "baseline.glb"
    fixture.write_text(
        f"""import bpy
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for name, loc, scale in [("Seat", (0,0,0), (0.25,0.25,0.5)), ("Body", (2,0,0), (0.2,0.2,0.2)), ("Display", (-2,0,0), (0.15,0.05,0.1))]:
    bpy.ops.mesh.primitive_cube_add(location=loc)
    obj=bpy.context.object
    obj.name=name
    obj.scale=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
root=bpy.data.objects.new("VehicleIdentity",None)
bpy.context.collection.objects.link(root)
root["asset_id"]="fixture-car"
root["part_catalog_version"]="fixture-parts"
bpy.context.scene["asset_id"]="fixture-car"
bpy.context.scene["part_catalog_version"]="fixture-parts"
for obj in list(bpy.context.scene.objects):
    if obj != root: obj.parent=root
bpy.ops.export_scene.gltf(filepath={str(baseline)!r}, export_format="GLB", export_extras=True)
""",
        encoding="utf-8",
    )
    subprocess.run(
        [blender, "--background", "--factory-startup", "--python", str(fixture)],
        check=True,
        timeout=120,
        stdout=subprocess.DEVNULL,
    )
    source = baseline.read_bytes()
    request = {
        "baseline": str(baseline),
        "output": str(tmp_path),
        "catalog": {
            "contract_version": "1",
            "baseline_asset_id": "fixture-car",
            "asset_id": "fixture-car",
            "part_catalog_version": "fixture-parts",
            "units": "m",
            "parts": [
                {
                    "part_id": "seat",
                    "mesh_refs": ["Seat"],
                    "anchor_mesh_ref": "Seat",
                    "anchor_local": [0.1, 0.4, 0],
                    "dimensions_m": [0.5, 1, 0.5],
                    "edit_origin_local": [0, -0.5, 0],
                    "operations": ["resize_local"],
                },
                {
                    "part_id": "body",
                    "mesh_refs": ["Body"],
                    "anchor_mesh_ref": "Body",
                    "anchor_local": [0, 0, 0],
                    "dimensions_m": [0.4, 0.4, 0.4],
                    "operations": [],
                },
            ],
        },
        "operations": {
            "wider-seat": {
                "operation": "resize_local",
                "part_id": "seat",
                "dimensions_m": [0.6, 1, 0.5],
            }
        },
    }
    request_path = tmp_path / "request.json"
    request["catalog"]["parts"].append(
        {
            "part_id": "display",
            "mesh_refs": ["Display"],
            "anchor_mesh_ref": "Display",
            "anchor_local": [0, 0, 0],
            "dimensions_m": [0.3, 0.2, 0.1],
            "edit_origin_local": [0, 0, 0],
            "operations": ["resize_local"],
        }
    )
    if multiple:
        request["operations"]["larger-display"] = {
            "operation": "resize_local",
            "part_id": "display",
            "dimensions_m": [0.36, 0.2, 0.1],
        }
    request["target_part_ids"] = ["seat", "display"] if multiple else ["seat"]
    request_path.write_text(json.dumps(request))
    script = Path(__file__).parents[1] / "app/blender_geometry.py"
    subprocess.run(
        [
            blender,
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            "--python-exit-code",
            "1",
            "--python",
            str(script),
            "--",
            str(request_path),
        ],
        check=True,
        timeout=180,
    )
    assert baseline.read_bytes() == source
    report = json.loads((tmp_path / "measurements.json").read_text())
    assert report["changes"]["wider-seat"]["after_m"] == pytest.approx([0.6, 1, 0.5])
    seat = next(
        part for part in report["scene_catalog"]["parts"] if part["part_id"] == "seat"
    )
    assert seat["baseline_anchor_local"] == [0.1, 0.4, 0]
    assert seat["anchor_local"] == pytest.approx([0.12, 0.4, 0])
    _, original = glb_geometry(tmp_path / "original.glb")
    document, changed = glb_geometry(tmp_path / "candidate.glb")
    assert changed["Body"] == original["Body"]
    assert changed["Seat"] != original["Seat"]
    if multiple:
        assert changed["Display"] != original["Display"]
        assert report["changes"]["larger-display"]["after_m"] == pytest.approx(
            [0.36, 0.2, 0.1]
        )
    else:
        assert changed["Display"] == original["Display"]
    dimensions = [
        max(point[axis] for point in changed["Seat"])
        - min(point[axis] for point in changed["Seat"])
        for axis in range(3)
    ]
    assert dimensions == pytest.approx([0.6, 1, 0.5])
    assert any(
        node.get("extras", {}).get("asset_id") == "candidate"
        for node in document["nodes"]
    )
    assert (
        document["scenes"][document.get("scene", 0)]["extras"]["asset_id"]
        == "candidate"
    )
    assert len(list(tmp_path.glob("*-*.png"))) == 6
