"""Verified local geometry catalog and operation validation, independent of AI."""

import math
from typing import Self

from pydantic import Field, model_validator

from app.wire import GeometryOperation, GeometrySceneCatalog, RenderManifest


class GeometryCatalog(GeometrySceneCatalog):
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def verified_mapping(self) -> Self:
        parts, meshes = set(), set()
        for part in self.parts:
            if part.part_id in parts or not part.part_id:
                raise ValueError("duplicate or empty part identity")
            parts.add(part.part_id)
            if part.anchor_mesh_ref not in part.mesh_refs:
                raise ValueError("anchor mesh is not part of the mapping")
            for mesh in part.mesh_refs:
                if not mesh or mesh in meshes:
                    raise ValueError("duplicate or empty mesh identity")
                meshes.add(mesh)
            if (
                not all(
                    math.isfinite(v) for v in (*part.anchor_local, *part.dimensions_m)
                )
                or min(part.dimensions_m) <= 0
            ):
                raise ValueError("nonfinite anchor or invalid dimensions")
            if part.edit_origin_local is not None and not all(
                math.isfinite(value) for value in part.edit_origin_local
            ):
                raise ValueError("nonfinite edit origin")
            if part.baseline_anchor_local is not None and not all(
                math.isfinite(value) for value in part.baseline_anchor_local
            ):
                raise ValueError("nonfinite baseline anchor")
        return self


def validate_plan(
    manifest: RenderManifest,
    catalog: GeometryCatalog,
    plan: dict[str, GeometryOperation],
    *,
    validate_dependencies: bool = True,
) -> None:
    if (manifest.baseline_asset_id, manifest.part_catalog_version) != (
        catalog.baseline_asset_id,
        catalog.part_catalog_version,
    ):
        raise ValueError("baseline/catalog identity mismatch")
    changes = {change.change_id: change for change in manifest.changes}
    if len(changes) != len(manifest.changes) or set(plan) - changes.keys():
        raise ValueError("invalid change identity")
    parts = {part.part_id: part for part in catalog.parts}
    targets = set()
    for change_id, operation in plan.items():
        change = changes[change_id]
        part = parts.get(operation.part_id)
        if part is None or operation.part_id not in change.part_ids:
            raise ValueError("invalid operation target")
        if operation.operation not in part.operations:
            raise ValueError("unsupported operation")
        if part.edit_origin_local is None:
            raise ValueError(
                "unsupported resize without a verified geometry edit origin"
            )
        if operation.part_id in targets:
            raise ValueError(
                "conflicting operations target the same part; combine them explicitly"
            )
        targets.add(operation.part_id)
        if (validate_dependencies and set(change.dependencies) - plan.keys()) or set(
            change.conflicts
        ) & plan.keys():
            raise ValueError("unresolved dependency or conflicting changes")
        if any(
            not math.isfinite(new) or not 0.5 <= new / old <= 1.5
            for old, new in zip(part.dimensions_m, operation.dimensions_m, strict=True)
        ):
            raise ValueError("resize exceeds verified bounds (0.5-1.5 times original)")
