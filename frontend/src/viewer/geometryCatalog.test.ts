import { describe, expect, it } from "vitest";
import { originalGeometryCatalog, verifyGeometryMapping } from "./geometryCatalog";
const catalog = { contract_version: "1", asset_id: "candidate", baseline_asset_id: "baseline", part_catalog_version: "v2", units: "m", parts: [{ part_id: "seats", mesh_refs: ["Seat"], anchor_mesh_ref: "Seat", anchor_local: [0, 0.4, 0] }] };
describe("verified geometry mapping", () => {
  it("restores baseline identity and original local anchors for comparison", () => {
    const candidate = { ...catalog, parts: [{ ...catalog.parts[0], anchor_local: [0, 0.8, 0], baseline_anchor_local: [0, 0.4, 0] }] };
    const original = originalGeometryCatalog(candidate);
    expect(original.asset_id).toBe("baseline");
    expect(original.parts[0].anchor_local).toEqual([0, 0.4, 0]);
    expect(candidate.parts[0].anchor_local).toEqual([0, 0.8, 0]);
  });
  it("maps a GLB node with multiple material primitives to its actual meshes", () => {
    const primitive = { name: "Seat_primitive", isMesh: true };
    const group = { name: "Seat", children: [primitive] };
    const scene = { userData: { asset_id: "candidate", part_catalog_version: "v2" }, traverse: (visit: (node: typeof group | typeof primitive) => void) => { visit(group); visit(primitive); } };
    expect(verifyGeometryMapping(scene, catalog).get("seats")?.meshes).toEqual([primitive]);
    expect(verifyGeometryMapping(scene, catalog).get("seats")?.anchor).toBe(group);
  });
  it("binds exact nodes and rejects incompatible identity or ambiguous nodes", () => {
    const scene = { userData: { asset_id: "candidate", part_catalog_version: "v2" }, traverse: (visit: (node: { name: string; isMesh: boolean }) => void) => visit({ name: "Seat", isMesh: true }) };
    expect(verifyGeometryMapping(scene, catalog).get("seats")?.anchor.name).toBe("Seat");
    expect(() => verifyGeometryMapping(scene, { ...catalog, asset_id: "other" })).toThrow(/identity/);
    expect(() => verifyGeometryMapping(scene, { ...catalog, parts: [{ ...catalog.parts[0], mesh_refs: ["seat"], anchor_mesh_ref: "seat" }] })).toThrow(/mesh/);
    expect(() => verifyGeometryMapping({ ...scene, traverse: (visit: (node: { name: string; isMesh: boolean }) => void) => { visit({ name: "Seat", isMesh: true }); visit({ name: "Seat", isMesh: true }); } }, catalog)).toThrow(/ambiguous/);
    expect(() => verifyGeometryMapping(scene, { ...catalog, parts: [{ ...catalog.parts[0], anchor_local: [NaN, 0, 0] }] })).toThrow(/anchor/);
  });
});
