import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import WorkspaceGeometry from "./WorkspaceGeometry";
vi.mock("./GeometryViewer", () => ({ default: ({ attribution }: { attribution: React.ReactNode }) => <div>Verified model{attribution}</div> }));
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
  await waitFor(() => expect(screen.getByText("No verified 3D mapping for these findings:")).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "Larger screen — view evidence" }));
  expect(onFinding).toHaveBeenCalledWith("f-dashboard");
  expect(screen.getByRole("link", { name: "2023 BMW i5 M60 by Nazh Design" })).toBeVisible();
});
