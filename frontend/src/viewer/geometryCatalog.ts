export interface GeometryCatalog {
  contract_version: string;
  asset_id: string;
  baseline_asset_id: string;
  part_catalog_version: string;
  units: string;
  baseline_url?: string | null;
  parts: Array<{ part_id: string; mesh_refs: string[]; anchor_mesh_ref: string; anchor_local: number[]; baseline_anchor_local?: number[] | null }>;
}
export function originalGeometryCatalog(catalog: GeometryCatalog): GeometryCatalog {
  return { ...catalog, asset_id: catalog.baseline_asset_id, parts: catalog.parts.map(part => ({ ...part, anchor_local: part.baseline_anchor_local ?? part.anchor_local })) };
}
type Node = { name: string; isMesh?: boolean; children?: Node[] };
export function verifyGeometryMapping<T extends Node>(scene: { userData: Record<string, unknown>; traverse: (visit: (node: T) => void) => void }, value: unknown) {
  const catalog = value as GeometryCatalog;
  if (!catalog || catalog.contract_version !== "1" || catalog.units !== "m" || !catalog.asset_id || !catalog.baseline_asset_id || !catalog.part_catalog_version || !Array.isArray(catalog.parts) || scene.userData.asset_id !== catalog.asset_id || scene.userData.part_catalog_version !== catalog.part_catalog_version)
    throw new Error("Model/catalog identity mismatch. Tags withheld.");
  const nodes = new Map<string, T[]>();
  scene.traverse(node => { if (node.name) nodes.set(node.name, [...(nodes.get(node.name) ?? []), node]); });
  const mapping = new Map<string, { meshes: T[]; anchor: T; local: number[] }>();
  const claimed = new Set<string>();
  for (const part of catalog.parts) {
    if (!part.part_id || mapping.has(part.part_id) || !Array.isArray(part.mesh_refs) || !part.mesh_refs.length) throw new Error("Invalid part mesh mapping.");
    if (!Array.isArray(part.anchor_local) || part.anchor_local.length !== 3 || !part.anchor_local.every(Number.isFinite) || !part.mesh_refs.includes(part.anchor_mesh_ref)) throw new Error("Invalid part-local anchor.");
    const meshes = part.mesh_refs.flatMap(ref => {
      const matches = nodes.get(ref);
      if (!matches || matches.length !== 1 || claimed.has(ref)) throw new Error("Missing or ambiguous part mesh reference.");
      const root = matches[0];
      const primitives = root.isMesh ? [root] : (root.children ?? []).filter(node => node.isMesh) as T[];
      if (!primitives.length || primitives.some(node => claimed.has(node.name))) throw new Error("Missing or ambiguous part mesh reference.");
      claimed.add(ref);
      primitives.forEach(node => claimed.add(node.name));
      return primitives;
    });
    mapping.set(part.part_id, { meshes, anchor: nodes.get(part.anchor_mesh_ref)![0], local: part.anchor_local });
  }
  return mapping;
}
