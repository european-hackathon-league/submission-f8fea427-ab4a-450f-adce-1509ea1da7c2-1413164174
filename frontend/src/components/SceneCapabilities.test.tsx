import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import SceneCapabilities from "./SceneCapabilities";
import { supportedSceneCatalog } from "../viewer/modelMapping";
import type { RunConfig, Vehicle } from "../api/contracts";
const config: Pick<
  RunConfig,
  "vehicle_id" | "baseline_asset_id" | "part_catalog_version"
> = {
  vehicle_id: supportedSceneCatalog.vehicle_id,
  baseline_asset_id: supportedSceneCatalog.baseline_asset_id,
  part_catalog_version: supportedSceneCatalog.part_catalog_version,
};
const vehicle: Vehicle = {
  ...config,
  title: "G60 i5 M60 reference",
  capabilities: ["baseline_navigation"],
};
afterEach(cleanup);
it("exposes independently addressable baseline references and the separate 520i cabin without claiming exact trim", async () => {
  const user = userEvent.setup();
  render(<SceneCapabilities config={config} vehicle={vehicle} />);
  expect(
    screen.getByRole("heading", { name: "Scene capabilities" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Open baseline preview" }),
  ).toHaveAttribute("href", "/vehicles/i5-m60-preview.jpg");
  expect(
    screen.getByRole("link", { name: "Open hosted baseline model" }),
  ).toHaveAttribute(
    "href",
    `https://sketchfab.com/models/${supportedSceneCatalog.baseline_asset.model_id}/embed`,
  );
  expect(
    screen.getByRole("link", { name: "Open separate cabin reference photo" }),
  ).toHaveAttribute("href", "/vehicles/g60-interior.jpg");
  expect(
    screen.getByText(
      /Separate G60 520i reference, not a verified i5 M60 cabin/,
    ),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Show part capabilities" }),
  );
  const table = screen.getByRole("table", {
    name: "Semantic part capabilities",
  });
  const body = within(table).getByRole("row", { name: /^body \/ vehicle/ });
  expect(body).toHaveTextContent("No mesh mapping");
  expect(body).toHaveTextContent("No geometry anchor");
  expect(body).toHaveTextContent("Component list annotation");
  expect(screen.getByRole("row", { name: /dashboard/ })).toHaveTextContent(
    "Separate photo annotation",
  );
  expect(
    screen.getByText(/Specific preservation verification unavailable/),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Geometry generation unsupported"),
  ).toBeInTheDocument();
});
it.each(["vehicle_id", "baseline_asset_id", "part_catalog_version"] as const)(
  "does not reuse a local scene when the selected %s differs",
  (field) => {
    render(
      <SceneCapabilities
        config={{ ...config, [field]: "unavailable" }}
        vehicle={{
          ...vehicle,
          vehicle_id: "unavailable",
          title: "Unsupported derivative",
        }}
      />,
    );
    expect(screen.getByText(/No compatible local scene/)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open baseline preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open hosted baseline model" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show part capabilities" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("unavailable")).toBeInTheDocument();
  },
);
it("retains unconfigured asset identities explicitly and ignores a foreign vehicle title", () => {
  render(
    <SceneCapabilities
      config={{
        vehicle_id: "g70",
        baseline_asset_id: "",
        part_catalog_version: "",
      }}
      vehicle={vehicle}
    />,
  );
  expect(screen.getByText("g70")).toBeInTheDocument();
  expect(screen.queryByText(vehicle.title)).not.toBeInTheDocument();
  expect(screen.getAllByText("Not supplied")).toHaveLength(2);
  expect(
    screen.getByText(/Vehicle-wide and unmapped findings remain accessible/),
  ).toBeInTheDocument();
});
it("opens and closes semantic capabilities using keyboard controls", async () => {
  const user = userEvent.setup();
  render(<SceneCapabilities config={config} />);
  const toggle = screen.getByRole("button", { name: "Show part capabilities" });
  toggle.focus();
  await user.keyboard("{Enter}");
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(
    screen.getByRole("table", { name: "Semantic part capabilities" }),
  ).toBeVisible();
  await user.keyboard(" ");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(
    screen.queryByRole("table", { name: "Semantic part capabilities" }),
  ).not.toBeInTheDocument();
});
it("rejects invalid catalog links before any asset reference is exposed", () => {
  const catalog = structuredClone(supportedSceneCatalog);
  catalog.baseline_asset.preview_url = "javascript:alert(1)";
  render(<SceneCapabilities config={config} catalog={catalog} />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Scene catalog unavailable",
  );
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
