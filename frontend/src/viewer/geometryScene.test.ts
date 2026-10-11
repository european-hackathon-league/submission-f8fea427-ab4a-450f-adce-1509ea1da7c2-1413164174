import { expect, it } from "vitest";
import { parseGeometry, disposeGeometry } from "./geometryScene.js";
function glb(external = false, name = "Seat") {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0], extras: { asset_id: "candidate", part_catalog_version: "v2" } }], nodes: [{ name, mesh: 0, translation: [1, 0, 0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: 36, ...(external ? { uri: "https://external.invalid/secret" } : {}) }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }] }));
  const jsonLength = Math.ceil(json.length / 4) * 4, bytes = new ArrayBuffer(20 + jsonLength + 8 + 36), header = new DataView(bytes);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, bytes.byteLength, true); header.setUint32(12, jsonLength, true); header.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(bytes, 20, jsonLength).fill(32); new Uint8Array(bytes, 20, json.length).set(json);
  header.setUint32(20 + jsonLength, 36, true); header.setUint32(24 + jsonLength, 0x004e4942, true);
  new Float32Array(bytes, 28 + jsonLength, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]); return bytes;
}
const catalog = { contract_version: "1", asset_id: "candidate", baseline_asset_id: "baseline", part_catalog_version: "v2", units: "m", parts: [{ part_id: "seats", mesh_refs: ["Seat"], anchor_mesh_ref: "Seat", anchor_local: [0, 0.4, 0] }] };
it("parses exported GLB geometry and binds its exact mesh and local anchor", async () => {
  const model = await parseGeometry(glb(), catalog);
  const part = model.mapping.get("seats")!;
  const anchor = part.anchor as typeof part.anchor & { geometry: { attributes: { position: { count: number } } }; position: { x: number } };
  expect(anchor.geometry.attributes.position.count).toBe(3);
  expect(anchor.position.x).toBe(1);
  expect(part.local).toEqual([0, .4, 0]);
  disposeGeometry(model.scene);
});
it("rejects remote GLB resources before loader can fetch them", async () => {
  await expect(parseGeometry(glb(true), catalog)).rejects.toThrow("External GLB resources");
});
it("preserves exact catalog node identity when Three sanitizes animation names", async () => {
  const model = await parseGeometry(glb(false, "Seat.001"), { ...catalog, parts: [{ ...catalog.parts[0], mesh_refs: ["Seat.001"], anchor_mesh_ref: "Seat.001" }] });
  expect(model.mapping.get("seats")?.anchor.name).toBe("Seat.001");
  disposeGeometry(model.scene);
});
