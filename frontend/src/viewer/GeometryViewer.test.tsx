import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import GeometryViewer from "./GeometryViewer";
const scene = vi.hoisted(() => ({
  focus: vi.fn(), action: vi.fn(), setMarkers: vi.fn(), inspect: vi.fn(), dispose: vi.fn(),
  camera: vi.fn(() => ({ position: [3, 2, 1], target: [0, 0, 0] })),
  mount: vi.fn(), parse: vi.fn(async () => ({ scene: {} })),
}));
vi.mock("./geometryScene.js", () => ({
  parseGeometry: scene.parse,
  mountGeometry: scene.mount.mockImplementation(() => scene),
  disposeGeometry: vi.fn(),
}));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });
const catalog = { contract_version: "1", units: "m", asset_id: "baseline", baseline_asset_id: "baseline", part_catalog_version: "v2", parts: [{ part_id: "seats", mesh_refs: ["Seat"], anchor_mesh_ref: "Seat", anchor_local: [0, 0, 0] }] };
const api = { mode: "real", sessionNamespace: "test", canReadAsset: () => true, readAsset: async () => ({ size: 0, arrayBuffer: async () => new ArrayBuffer(0) }) };
const markers = [{ id: "finding-seats", partId: "seats", label: "Wider seats", counts: { negative_records: 3, total_records: 10, negative_share: 0.3, provisional: true }, cohortIds: ["DE"] }];
it("withholds an unbound model and keeps evidence controls accessible", () => {
  render(<GeometryViewer api={{ mode: "real" } as never} url="/model.glb" catalog={null} markers={[{ id: "change-1", partId: "seats", label: "Wider seats", number: 1 }]} onMarker={() => {}} />);
  expect(screen.getByRole("alert")).toHaveTextContent("verified part catalog");
  expect(screen.getByRole("button", { name: "1. Wider seats" })).toBeEnabled();
});
it("synchronizes panel selection and model part selection", async () => {
  const onSelectPart = vi.fn();
  const props = { api: api as never, url: "/model.glb", catalog, markers, baseline: true, onMarker: vi.fn(), selectedPart: "seats", onSelectPart };
  const { rerender } = render(<GeometryViewer {...props} />);
  await waitFor(() => expect(scene.focus).toHaveBeenCalledWith("seats"));
  fireEvent.click(screen.getByRole("button", { name: "Select Seats" }));
  expect(onSelectPart).toHaveBeenCalledWith("seats");
  rerender(<GeometryViewer {...props} selectedPart={null as never} />);
  await waitFor(() => expect(scene.focus).toHaveBeenCalledWith(null));
});
it("keeps backend feedback counts and scope without inventing totals", async () => {
  render(<GeometryViewer api={api as never} url="/model.glb" catalog={catalog} markers={markers} onMarker={() => {}} />);
  const feedback = await screen.findByRole("button", { name: /Wider seats.*3 of 10.*DE.*Provisional/ });
  expect(feedback).toHaveTextContent("3/10 negative");
});
it("restores the reference when an authorized model download fails", async () => {
  render(<GeometryViewer api={{ ...api, readAsset: async () => { throw new Error("Offline"); } } as never} url="/model.glb" catalog={catalog} markers={[]} onMarker={() => {}} fallback={<div>Reference viewer</div>} />);
  expect(await screen.findByText("Reference viewer")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("Offline");
  expect(screen.getByRole("button", { name: "Retry model" })).toBeEnabled();
});
it("mounts the model into a live host after retrying from the reference fallback", async () => {
  const readAsset = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockImplementation(api.readAsset);
  render(<GeometryViewer api={{ ...api, readAsset } as never} url="/model.glb" catalog={catalog} markers={[]} onMarker={() => {}} fallback={<div>Reference viewer</div>} />);
  await screen.findByText("Reference viewer");
  fireEvent.click(screen.getByRole("button", { name: "Retry model" }));
  await screen.findByText("Reimagined model loaded.");
  expect(scene.mount.mock.calls.at(-1)?.[0]).toBeInstanceOf(HTMLDivElement);
});
it("keeps overlapping findings separate instead of presenting an invented part total", async () => {
  render(<GeometryViewer api={api as never} url="/model.glb" catalog={catalog} baseline markers={[markers[0], { ...markers[0], id: "other", label: "Seat adjustment", cohortIds: ["US"] }]} onMarker={() => {}} />);
  await screen.findByText("Original model loaded.");
  const projected = scene.mount.mock.calls.at(-1)?.[2];
  expect(projected).toHaveLength(1);
  expect(projected[0].counts).toBeUndefined();
  fireEvent.click(screen.getByText("Feedback by finding (2)"));
  expect(screen.getAllByText(/3\/10 negative/)).toHaveLength(2);
});
it("remembers the camera across reloads without sharing it across API sessions", async () => {
  const props = { api: api as never, url: "/model.glb", catalog, markers: [], onMarker: vi.fn() };
  const first = render(<GeometryViewer {...props} />);
  await screen.findByText("Reimagined model loaded.");
  first.unmount();
  const second = render(<GeometryViewer {...props} />);
  await screen.findByText("Reimagined model loaded.");
  expect(scene.mount.mock.calls.at(-1)?.[5]).toEqual(scene.camera());
  expect(scene.focus).toHaveBeenCalledWith(null, false);
  second.unmount();
  render(<GeometryViewer {...props} api={{ ...api, sessionNamespace: "another-workspace" } as never} />);
  await screen.findByText("Reimagined model loaded.");
  expect(scene.mount.mock.calls.at(-1)?.[5]).toBeNull();
});
