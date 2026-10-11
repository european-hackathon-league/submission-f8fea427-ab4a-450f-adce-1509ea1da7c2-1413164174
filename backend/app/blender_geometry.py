"""Run only with Blender --background --factory-startup --disable-autoexec.

Accepts trusted, bounded operations prepared by geometry_renderer, never model code.
"""

import hashlib
import json
import struct
import sys
from pathlib import Path
from typing import Any

import bpy  # type: ignore[import-not-found]
from mathutils import Vector  # type: ignore[import-not-found]


def bounds(obj: Any) -> list[float]:
    vertices = [vertex.co for vertex in obj.data.vertices]
    return [
        max(point[axis] for point in vertices) - min(point[axis] for point in vertices)
        for axis in range(3)
    ]


def fingerprint(obj: Any) -> str:
    return hashlib.sha256(
        b"".join(struct.pack("<3f", *vertex.co) for vertex in obj.data.vertices)
        + b"".join(
            struct.pack("<16f", *(value for row in obj.matrix_world for value in row))
            for _ in [0]
        )
    ).hexdigest()


def export(path: Path, identity: str, version: str) -> None:
    bpy.context.scene["asset_id"] = identity
    bpy.context.scene["part_catalog_version"] = version
    for obj in bpy.context.scene.objects:
        for key in ("asset_id", "part_catalog_version"):
            if key in obj:
                del obj[key]
    root = bpy.data.objects.new("VehicleIdentity", None)
    bpy.context.collection.objects.link(root)
    root["asset_id"], root["part_catalog_version"] = identity, version
    for obj in list(bpy.context.scene.objects):
        if obj != root and obj.parent is None and obj.type == "MESH":
            obj.parent = root
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_extras=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_normals=any(
            obj.data.has_custom_normals
            for obj in bpy.context.scene.objects
            if obj.type == "MESH"
        ),
    )
    for obj in list(root.children):
        obj.parent = None
    bpy.data.objects.remove(root, do_unlink=True)


def render(
    path: Path,
    position: tuple[float, float, float],
    target: tuple[float, float, float],
    labels: dict[str, Any],
    ortho_scale: float = 5,
) -> None:
    camera_data = bpy.data.cameras.new("ReviewCamera")
    camera = bpy.data.objects.new("ReviewCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = position
    camera.rotation_euler = (
        (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    )
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = ortho_scale
    scene = bpy.context.scene
    scene.camera = camera
    text_objects = []
    for part_id, mesh in labels.items():
        low, high = world_bounds(mesh)
        text_data = bpy.data.curves.new("PartLabel", "FONT")
        text_data.body, text_data.align_x, text_data.size = part_id, "CENTER", 0.14
        text = bpy.data.objects.new("PartLabel", text_data)
        bpy.context.collection.objects.link(text)
        text.location = ((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, high[2] + 0.12)
        text.rotation_euler = camera.rotation_euler
        text_objects.append(text)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x, scene.render.resolution_y = 768, 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    for text in text_objects:
        bpy.data.objects.remove(text, do_unlink=True)
    bpy.data.objects.remove(camera, do_unlink=True)


def world_bounds(obj: Any) -> tuple[list[float], list[float]]:
    points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    return (
        [min(point[axis] for point in points) for axis in range(3)],
        [max(point[axis] for point in points) for axis in range(3)],
    )


def intersects(
    first: tuple[list[float], list[float]], second: tuple[list[float], list[float]]
) -> bool:
    return all(
        min(first[1][axis], second[1][axis]) - max(first[0][axis], second[0][axis])
        > 0.001
        for axis in range(3)
    )


def run(request: dict[str, Any]) -> None:
    output = Path(request["output"])
    catalog = request["catalog"]
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=request["baseline"])
    meshes = {obj.name: obj for obj in bpy.context.scene.objects if obj.type == "MESH"}
    parts = {part["part_id"]: part for part in catalog["parts"]}
    for part in parts.values():
        if any(reference not in meshes for reference in part["mesh_refs"]):
            raise ValueError("Missing exact mesh reference")
        if len(part["mesh_refs"]) != 1 and part["operations"]:
            raise ValueError(
                "Multi-mesh local resizing requires separately verified mounting rules"
            )
        obj = meshes[part["mesh_refs"][0]]
        # Blender converts glTF Y-up coordinates to Z-up on import.
        expected = [
            part["dimensions_m"][0],
            part["dimensions_m"][2],
            part["dimensions_m"][1],
        ]
        if any(
            abs(actual - known) > 0.001
            for actual, known in zip(bounds(obj), expected, strict=True)
        ):
            raise ValueError("Catalog dimensions do not match imported mesh")
        if any(abs(value - 1) > 1e-6 for value in obj.scale) or obj.modifiers:
            raise ValueError(
                "Resize requires unit object scale and no unapplied modifiers"
            )
    original = {name: fingerprint(obj) for name, obj in meshes.items()}
    original_bounds = {name: world_bounds(obj) for name, obj in meshes.items()}
    export(
        output / "original.glb",
        catalog["baseline_asset_id"],
        catalog["part_catalog_version"],
    )
    cameras = [((4, -5, 3), (0, 0, 0.8)), ((-4, -5, 3), (0, 0, 0.8))]
    labels = {part_id: meshes[part["mesh_refs"][0]] for part_id, part in parts.items()}
    target_ids = request.get("target_part_ids", list(parts))
    target_parts = {
        part_id: part for part_id, part in parts.items() if part_id in target_ids
    }
    target_meshes = {
        reference: meshes[reference]
        for part in target_parts.values()
        for reference in part["mesh_refs"]
    }
    cutaway = None
    if target_meshes:
        target_bounds = [world_bounds(obj) for obj in target_meshes.values()]
        low = [min(box[0][axis] for box in target_bounds) for axis in range(3)]
        high = [max(box[1][axis] for box in target_bounds) for axis in range(3)]
        middle = [(low[axis] + high[axis]) / 2 for axis in range(3)]
        center = (middle[0], middle[1], middle[2])
        radius = max(max(high[axis] - low[axis] for axis in range(3)), 0.1)
        position = (
            center[0] + radius * 1.6,
            center[1] - radius * 1.8,
            center[2] + radius,
        )
        cutaway = (position, center, radius * 2.3)

    def render_cutaway(version: str) -> None:
        if cutaway is None:
            return
        visibility = {name: obj.hide_render for name, obj in meshes.items()}
        try:
            for name, obj in meshes.items():
                obj.hide_render = name not in target_meshes
            render(
                output / f"{version}-2-cutaway.png",
                cutaway[0],
                cutaway[1],
                {
                    part_id: meshes[part["mesh_refs"][0]]
                    for part_id, part in target_parts.items()
                },
                cutaway[2],
            )
        finally:
            for name, obj in meshes.items():
                obj.hide_render = visibility[name]

    for index, (position, target) in enumerate(cameras):
        render(output / f"original-{index}.png", position, target, labels)
    render_cutaway("original")
    if not request["operations"]:
        return
    measurements, changed_meshes = {}, set()
    for change_id, operation in request["operations"].items():
        part = parts[operation["part_id"]]
        obj = meshes[part["mesh_refs"][0]]
        before = bounds(obj)
        requested = operation["dimensions_m"]
        requested_blender = [requested[0], requested[2], requested[1]]
        anchor = part.get("edit_origin_local")
        if anchor is None:
            raise ValueError("Verified geometry edit origin required")
        pivot = Vector((anchor[0], -anchor[2], anchor[1]))
        factors = [
            new / old for new, old in zip(requested_blender, before, strict=True)
        ]
        obj.data = obj.data.copy()
        for vertex in obj.data.vertices:
            delta = vertex.co - pivot
            vertex.co = pivot + Vector(
                tuple(delta[axis] * factors[axis] for axis in range(3))
            )
        obj.data.update()
        after = bounds(obj)
        if any(
            abs(actual - expected) > 1e-5
            for actual, expected in zip(after, requested_blender, strict=True)
        ):
            raise ValueError("Dimension validation failed")
        if original[obj.name] == fingerprint(obj):
            raise ValueError("Requested edit did not alter geometry")
        part["dimensions_m"] = [after[0], after[2], after[1]]
        anchor_factors = [factors[0], factors[2], factors[1]]
        part["baseline_anchor_local"] = part.get("baseline_anchor_local") or list(
            part["anchor_local"]
        )
        part["anchor_local"] = [
            anchor[axis]
            + (part["anchor_local"][axis] - anchor[axis]) * anchor_factors[axis]
            for axis in range(3)
        ]
        measurements[change_id] = {
            "before_m": [before[0], before[2], before[1]],
            "after_m": part["dimensions_m"],
        }
        changed_meshes.add(obj.name)
    if any(
        fingerprint(obj) != original[name]
        for name, obj in meshes.items()
        if name not in changed_meshes
    ):
        raise ValueError("Unaffected geometry changed")
    clearance_warnings = []
    for changed in changed_meshes:
        for name, obj in meshes.items():
            if (
                name != changed
                and not intersects(original_bounds[changed], original_bounds[name])
                and intersects(world_bounds(meshes[changed]), world_bounds(obj))
            ):
                clearance_warnings.append(
                    f"New bounding-box overlap: {changed} / {name}; requires detailed clearance review"
                )
    export(output / "candidate.glb", "candidate", catalog["part_catalog_version"])
    for index, (position, target) in enumerate(cameras):
        render(output / f"candidate-{index}.png", position, target, labels)
    render_cutaway("candidate")
    scene_catalog = {
        key: catalog[key]
        for key in (
            "contract_version",
            "baseline_asset_id",
            "part_catalog_version",
            "units",
            "parts",
        )
    }
    scene_catalog["asset_id"] = "candidate"
    (output / "measurements.json").write_text(
        json.dumps(
            {
                "changes": measurements,
                "scene_catalog": scene_catalog,
                "unaffected_meshes_preserved": True,
                "clearance_warnings": clearance_warnings,
            }
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    run(json.loads(Path(sys.argv[sys.argv.index("--") + 1]).read_text()))
