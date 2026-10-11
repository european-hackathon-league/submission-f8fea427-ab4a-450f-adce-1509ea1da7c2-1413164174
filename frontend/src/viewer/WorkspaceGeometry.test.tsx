import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WorkspaceGeometry from "./WorkspaceGeometry";
afterEach(cleanup);
const viewer = vi.hoisted(() => ({ props: vi.fn() }));
vi.mock("./GeometryViewer", () => ({ default: (props: { attribution: React.ReactNode }) => { viewer.props(props); return <div>Verified model{props.attribution}</div>; } }));
it("loads the selected vehicle's verified model before a run is created", async () => {
  const request = vi.fn().mockResolvedValue({ contract_version: "1", units: "m", asset_id: "i5-m60-exterior-v1", baseline_asset_id: "i5-m60-exterior-v1", part_catalog_version: "v2", baseline_url: "/api/v1/vehicles/g60-i5-m60/geometry/asset", parts: [] });
  const vehicle = { vehicle_id: "g60-i5-m60", baseline_asset_id: "i5-m60-exterior-v1", part_catalog_version: "v2" };
  render(<WorkspaceGeometry api={{ request } as never} vehicle={vehicle as never} workspace={null} tags onSelect={() => {}}>Hosted reference</WorkspaceGeometry>);
  await waitFor(() => expect(screen.getByText(/Verified model/)).toBeVisible());
  expect(request).toHaveBeenCalledWith("/vehicles/g60-i5-m60/geometry", undefined, undefined, expect.any(AbortSignal));
  expect(screen.queryByText("Hosted reference")).not.toBeInTheDocument();
});
it("keeps the reference visible when no editable geometry is configured", async () => {
  const request = vi.fn().mockRejectedValue(new Error("Not configured"));
  render(<WorkspaceGeometry api={{ request } as never} workspace={{ snapshot: { run_id: "run", config: { baseline_asset_id: "baseline", part_catalog_version: "v2" }, resource_links: { geometry: "/runs/run/geometry" } }, findings: [] } as never} tags onSelect={() => {}}>Vehicle reference</WorkspaceGeometry>);
  await waitFor(() => expect(screen.getByText(/Editable 3D model unavailable/)).toBeVisible());
  expect(screen.getByText("Vehicle reference")).toBeVisible();
  expect(request).toHaveBeenCalledWith("/runs/run/geometry", undefined, undefined, expect.any(AbortSignal));
});
it("keeps unmapped findings accessible and attributes the actual BMW geometry", async () => {
  const onFinding = vi.fn();
  const request = vi.fn().mockResolvedValue({ contract_version: "1", units: "m", asset_id: "i5-m60-exterior-v1", baseline_asset_id: "i5-m60-exterior-v1", part_catalog_version: "v2", baseline_url: "/runs/run/geometry/asset", parts: [{ part_id: "seats", mesh_refs: ["SeatDriver"], anchor_local: [0, 0, 0] }] });
  render(<WorkspaceGeometry api={{ request } as never} workspace={{ snapshot: { run_id: "run", config: { baseline_asset_id: "i5-m60-exterior-v1", part_catalog_version: "v2" }, resource_links: { geometry: "/runs/run/geometry" } }, findings: [{ finding_id: "f-dashboard", title: "Larger screen", part_ids: ["dashboard"] }] } as never} tags onSelect={() => {}} onFinding={onFinding}>Reference</WorkspaceGeometry>);
  await screen.findByText("Unmapped feedback (1)");
  fireEvent.click(screen.getByText("Unmapped feedback (1)"));
  fireEvent.click(screen.getByRole("button", { name: "Larger screen — view evidence" }));
  expect(onFinding).toHaveBeenCalledWith("f-dashboard");
  expect(screen.getByRole("link", { name: "2023 BMW i5 M60 by Nazh Design" })).toBeVisible();
});
it("connects selected parts and forwards exact scoped feedback to the model", async () => {
  const counts = { negative_records: 3, total_records: 10, negative_share: 0.3, provisional: true };
  const request = vi.fn().mockResolvedValue({ contract_version: "1", units: "m", asset_id: "baseline", baseline_asset_id: "baseline", part_catalog_version: "v2", baseline_url: "/runs/run/geometry/asset", parts: [{ part_id: "seats", mesh_refs: ["Seat"], anchor_local: [0, 0, 0] }] });
  const onSelect = vi.fn(), onFinding = vi.fn();
  render(<WorkspaceGeometry api={{ request } as never} workspace={{ snapshot: { run_id: "run", config: { baseline_asset_id: "baseline", part_catalog_version: "v2" }, resource_links: { geometry: "/runs/run/geometry" } }, findings: [{ finding_id: "f-seats", title: "Comfort", part_ids: ["seats"], counts, cohort_ids: ["DE"] }] } as never} selectedPart="seats" tags onSelect={onSelect} onFinding={onFinding}>Reference</WorkspaceGeometry>);
  await screen.findByText("Verified model");
  const props = viewer.props.mock.calls.at(-1)![0];
  expect(props.selectedPart).toBe("seats");
  expect(props.markers[0]).toMatchObject({ counts, cohortIds: ["DE"] });
  props.onSelectPart("seats");
  expect(onSelect).toHaveBeenCalledWith("seats");
  props.onMarker(props.markers[0].id);
  expect(onFinding).toHaveBeenCalledWith("f-seats");
});
