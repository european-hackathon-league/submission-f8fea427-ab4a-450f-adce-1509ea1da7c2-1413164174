"""Offline Blender inspection and export; semantic mappings require human review.

blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python
app/prepare_geometry.py -- --source downloaded.glb --output inspection
"""

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any


def connected_components(
    count: int, edges: list[tuple[int, int]]
) -> dict[int, list[int]]:
    parents = list(range(count))

    def root(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    for first, second in edges:
        a, b = root(first), root(second)
        parents[max(a, b)] = min(a, b)
    groups: dict[int, list[int]] = {}
    for index in range(count):
        groups.setdefault(root(index), []).append(index)
    return groups


def prepare_catalog(
    mapping: dict[str, Any], objects: list[dict[str, Any]], sha256: str
) -> dict[str, Any]:
    if mapping.get("geometry_verified") is not True:
        raise ValueError("Semantic mapping and metre units must be geometry verified")
    if not mapping.get("asset_id") or not mapping.get("part_catalog_version"):
        raise ValueError("Asset and catalog identities are required")
    meshes = {obj["name"]: obj for obj in objects}
    used_meshes, used_parts, parts = set(), set(), []
    for part in mapping["parts"]:
        refs = part["mesh_refs"]
        if not refs or any(ref not in meshes for ref in refs):
            raise ValueError("Missing exact mesh reference; fuzzy mapping is forbidden")
        if (
            not part["part_id"]
            or part["part_id"] in used_parts
            or any(ref in used_meshes for ref in refs)
            or len(set(refs)) != len(refs)
        ):
            raise ValueError("Duplicate semantic or mesh identity")
        if part["anchor_mesh_ref"] not in refs:
            raise ValueError("Anchor must reference an exact mapped mesh")
        anchor = part["anchor_local"]
        if len(anchor) != 3 or not all(math.isfinite(v) for v in anchor):
            raise ValueError("Anchor must contain three finite metre coordinates")
        operations = part.get("operations", [])
        if set(operations) - {"resize_local"}:
            raise ValueError("Unsupported geometry operation")
        mount = part.get("edit_origin_local")
        if mount is not None and (
            len(mount) != 3 or not all(math.isfinite(value) for value in mount)
        ):
            raise ValueError("Edit origin must contain three finite metre coordinates")
        if operations and mount is None:
            raise ValueError(
                "Resize requires a separately verified geometric edit origin"
            )
        obj = meshes[part["anchor_mesh_ref"]]
        if operations and (
            len(refs) != 1
            or any(abs(value - 1) > 1e-6 for value in obj["scale"])
            or obj["modifiers"]
        ):
            raise ValueError("Resize requires a single mesh with applied unit scale")
        dimensions = obj["dimensions_gltf_m"]
        if len(dimensions) != 3 or any(
            not math.isfinite(value) or value <= 0 for value in dimensions
        ):
            raise ValueError("Invalid measured dimensions")
        labels = part.get("axis_labels")
        if labels is not None and (
            len(labels) != 3
            or any(not isinstance(label, str) or not label.strip() for label in labels)
        ):
            raise ValueError("Axis labels must name three verified local directions")
        parts.append(
            {
                "part_id": part["part_id"],
                "mesh_refs": refs,
                "anchor_mesh_ref": part["anchor_mesh_ref"],
                "anchor_local": anchor,
                "edit_origin_local": mount,
                "dimensions_m": dimensions,
                "axis_labels": labels,
                "operations": operations,
            }
        )
        used_parts.add(part["part_id"])
        used_meshes.update(refs)
    return {
        "contract_version": "1",
        "baseline_asset_id": mapping["asset_id"],
        "asset_id": mapping["asset_id"],
        "part_catalog_version": mapping["part_catalog_version"],
        "units": "m",
        "sha256": sha256,
        "parts": parts,
    }


def inspect_objects(objects: Any) -> list[dict[str, Any]]:
    result = []
    for obj in objects:
        if obj.type != "MESH" or not obj.data.vertices:
            continue
        # Blender imports glTF Y-up as Z-up; reports use browser glTF coordinates.
        local = [[v.co.x, v.co.z, -v.co.y] for v in obj.data.vertices]
        world = [obj.matrix_world @ v.co for v in obj.data.vertices]
        world = [[v.x, v.z, -v.y] for v in world]
        bounds = {}
        for label, points in (("local", local), ("world", world)):
            bounds[label] = {
                "min": [min(p[i] for p in points) for i in range(3)],
                "max": [max(p[i] for p in points) for i in range(3)],
            }
        obj.data.calc_loop_triangles()
        result.append(
            {
                "name": obj.name,
                "parent": obj.parent.name if obj.parent else None,
                "mesh_data": obj.data.name,
                "vertices": len(local),
                "triangles": len(obj.data.loop_triangles),
                "bounds_gltf_m": bounds,
                "dimensions_gltf_m": [
                    bounds["local"]["max"][i] - bounds["local"]["min"][i]
                    for i in range(3)
                ],
                "world_dimensions_gltf_m": [
                    bounds["world"]["max"][i] - bounds["world"]["min"][i]
                    for i in range(3)
                ],
                "scale": list(obj.scale),
                "modifiers": [m.type for m in obj.modifiers],
                "matrix_world_blender": [list(row) for row in obj.matrix_world],
                "materials": [m.name if m else None for m in obj.data.materials],
            }
        )
    return result


def main() -> None:
    import bpy  # type: ignore[import-not-found]

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--mapping", type=Path)
    parser.add_argument("--splits", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    source, output = args.source.resolve(), args.output.resolve()
    if source.suffix.lower() not in {".glb", ".gltf"} or not source.is_file():
        raise ValueError("Source must be a legitimately downloaded GLB/glTF file")
    if output == source.parent or (output.exists() and any(output.iterdir())):
        raise ValueError("Output must be a separate empty directory")
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source))
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    if args.splits:
        recipe = json.loads(args.splits.read_text(encoding="utf-8"))
        if recipe["source_sha256"] != source_hash:
            raise ValueError("Split recipe source identity mismatch")
        if recipe["blender_version"] != bpy.app.version_string:
            raise ValueError("Split recipe Blender version mismatch")
        for split in recipe["splits"]:
            obj = bpy.data.objects.get(split["mesh_ref"])
            if obj is None or obj.type != "MESH":
                raise ValueError("Split requires an exact existing mesh")
            if bpy.data.objects.get(split["new_mesh_ref"]) is not None:
                raise ValueError("Split would overwrite an existing mesh identity")
            if "component_ids" in split:
                components = connected_components(
                    len(obj.data.vertices),
                    [tuple(edge.vertices) for edge in obj.data.edges],
                )
                if set(split["component_ids"]) - components.keys():
                    raise ValueError("Unknown exact connected component identity")
                indices = {
                    index
                    for identity in split["component_ids"]
                    for index in components[identity]
                }
            else:
                indices = set(split["vertex_indices"])
            if not indices or any(
                index < 0 or index >= len(obj.data.vertices) for index in indices
            ):
                raise ValueError("Split contains invalid exact vertex indices")
            # Reject cuts through connected geometry; split only entire components.
            if any(
                (edge.vertices[0] in indices) != (edge.vertices[1] in indices)
                for edge in obj.data.edges
            ):
                raise ValueError("Split would cut connected geometry")
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="DESELECT")
            bpy.ops.object.mode_set(mode="OBJECT")
            for vertex in obj.data.vertices:
                vertex.select = vertex.index in indices
            before = set(bpy.data.objects)
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.separate(type="SELECTED")
            bpy.ops.object.mode_set(mode="OBJECT")
            created = set(bpy.data.objects) - before
            if len(created) != 1:
                raise ValueError("Split did not produce exactly one independent mesh")
            created.pop().name = split["new_mesh_ref"]
    objects = inspect_objects(bpy.context.scene.objects)
    inspection = {
        "source_sha256": source_hash,
        "blender_version": bpy.app.version_string,
        "coordinate_system": "glTF Y-up; metres assumed until source scale verified",
        "objects": objects,
        "images": [
            {
                "name": image.name,
                "size": list(image.size),
                "packed": bool(image.packed_file),
            }
            for image in bpy.data.images
        ],
    }
    (output / "inspection.json").write_text(
        json.dumps(inspection, indent=2), encoding="utf-8"
    )
    if args.mapping:
        mapping = json.loads(args.mapping.read_text(encoding="utf-8"))
        catalog = prepare_catalog(mapping, objects, "0" * 64)
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from app.blender_geometry import export

        baseline = output / "baseline.glb"
        export(baseline, catalog["asset_id"], catalog["part_catalog_version"])
        catalog["sha256"] = hashlib.sha256(baseline.read_bytes()).hexdigest()
        (output / "catalog.json").write_text(
            json.dumps(catalog, indent=2), encoding="utf-8"
        )
        bpy.ops.wm.save_as_mainfile(filepath=str(output / "baseline.blend"))


if __name__ == "__main__":
    main()
