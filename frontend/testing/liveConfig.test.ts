// @vitest-environment node
import { expect, it } from "vitest";
import { resolveConfig } from "vite";
import catalog from "../public/vehicles/scene-catalog-v1.json";

it("routes application API requests to the backend in normal development", async () => {
  const config = await resolveConfig({}, "serve", "development");
  expect(config.server.proxy?.["/api"]).toMatchObject({ target: "http://127.0.0.1:8000" });
});

it("keeps the synthetic HTTP harness isolated from the backend", async () => {
  const config = await resolveConfig({ mode: "harness" }, "serve");
  expect(config.server.proxy?.["/api"]).toBeUndefined();
});

it("provides backend vehicle provenance in the shared scene catalog", () => {
  expect(catalog).toHaveProperty("synthetic", false);
});
