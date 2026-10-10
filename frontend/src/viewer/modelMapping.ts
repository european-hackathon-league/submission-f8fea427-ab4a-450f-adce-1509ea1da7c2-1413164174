import type { ComponentId, PartFeedback } from "../domain/contracts";

import catalog from "../../public/vehicles/scene-catalog-v1.json";

export interface CatalogPart {
  part_id: string;
  parent_part_id: string | null;
  mesh_refs: string[];
  anchor_ref: string | null;
  capabilities: string[];
  reference_photo_anchor?: number[];
}
export interface SceneCatalog {
  contract_version: "1";
  part_catalog_version: string;
  vehicle_id: string;
  baseline_asset_id: string;
  baseline_asset: { type: "sketchfab"; model_id: string; preview_url: string; capabilities: string[]; limitations: string[] };
  interior_reference: { asset_id: string; vehicle_id: string; type: "reference_photo"; url: string; limitations: string[] };
  parts: CatalogPart[];
}
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonempty);
const viewerComponents: ComponentId[] = ["body", "lighting", "charging", "steering", "dashboard", "seats"];

export function validateSceneCatalog(value: unknown): SceneCatalog {
  const scene = value as SceneCatalog;
  if (!scene || scene.contract_version !== "1" || ![scene.part_catalog_version, scene.vehicle_id, scene.baseline_asset_id].every(nonempty) || !Array.isArray(scene.parts))
    throw new Error("Invalid scene catalog identity/version.");
  const baseline = scene.baseline_asset;
  const interior = scene.interior_reference;
  if (!baseline || baseline.type !== "sketchfab" || !nonempty(baseline.model_id) || !nonempty(baseline.preview_url) || !stringList(baseline.capabilities) || !stringList(baseline.limitations) || baseline.capabilities.some(capability => !["navigation", "list_annotation"].includes(capability)))
    throw new Error("Invalid baseline asset/capabilities.");
  if (!interior || interior.type !== "reference_photo" || ![interior.asset_id, interior.vehicle_id, interior.url].every(nonempty) || !stringList(interior.limitations))
    throw new Error("Invalid interior reference asset.");
  const parts = new Map<string, CatalogPart>();
  const meshes = new Set<string>();
  for (const part of scene.parts) {
    if (!part || !nonempty(part.part_id) || (part.parent_part_id !== null && !nonempty(part.parent_part_id)) || !stringList(part.mesh_refs) || (part.anchor_ref !== null && !nonempty(part.anchor_ref)) || !stringList(part.capabilities))
      throw new Error("Invalid scene part/mapping.");
    if (parts.has(part.part_id)) throw new Error("Duplicate scene part ID.");
    parts.set(part.part_id, part);
    if (part.capabilities.some(capability => !["annotation", "list_annotation", "photo_annotation", "mesh_selection"].includes(capability)))
      throw new Error("Unsupported scene capability.");
    if (part.capabilities.includes("mesh_selection") && !part.mesh_refs.length)
      throw new Error("Mesh selection capability needs a verified mesh reference.");
    for (const mesh of part.mesh_refs) {
      if (meshes.has(mesh)) throw new Error("Ambiguous mesh reference.");
      meshes.add(mesh);
    }
    const photo = part.reference_photo_anchor;
    if ((photo !== undefined || part.capabilities.includes("photo_annotation")) && (!Array.isArray(photo) || photo.length !== 2 || !photo.every(coordinate => typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)))
      throw new Error("Photo annotation needs a bounded reference-photo anchor.");
  }
  for (const part of scene.parts) {
    const visited = new Set([part.part_id]);
    let parent = part.parent_part_id;
    while (parent !== null) {
      if (!parts.has(parent)) throw new Error("Missing scene parent part.");
      if (visited.has(parent)) throw new Error("Scene parent cycle.");
      visited.add(parent);
      parent = parts.get(parent)!.parent_part_id;
    }
  }
  return scene;
}
export const supportedSceneCatalog = validateSceneCatalog(catalog);

export function componentForNodeName(name: string, scene: SceneCatalog = supportedSceneCatalog): ComponentId | null {
  const part = scene.parts.find(part => part.capabilities.includes("mesh_selection") && part.mesh_refs.includes(name));
  return part && viewerComponents.includes(part.part_id as ComponentId) ? part.part_id as ComponentId : null;
}

export function componentHeatColor(finding: PartFeedback | undefined): string {
  if (!finding || !Number.isFinite(finding.counts.intensity_value))
    return "#8a909b";
  const intensity = Math.max(0, Math.min(1, finding.counts.intensity_value));
  return `color-mix(in srgb, #b62e3c ${intensity * 100}%, #e9dfe0)`;
}
