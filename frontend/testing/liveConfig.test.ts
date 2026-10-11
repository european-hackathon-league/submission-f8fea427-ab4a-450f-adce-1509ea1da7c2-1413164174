// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { resolveConfig } from "vite";
import catalog from "../public/vehicles/scene-catalog-v1.json";
afterEach(() => vi.unstubAllEnvs());

it("routes application API requests to the backend in normal development", async () => {
  vi.stubEnv("VITE_API_PROXY_TARGET", "");
  const config = await resolveConfig({}, "serve", "development");
  expect(config.server.proxy?.["/api"]).toMatchObject({ target: "http://127.0.0.1:8000" });
});

it("uses an explicitly configured local backend proxy", async () => {
  vi.stubEnv("VITE_API_PROXY_TARGET", "http://127.0.0.1:8123");
  const config = await resolveConfig({}, "serve", "development");
  expect(config.server.proxy?.["/api"]).toMatchObject({ target: "http://127.0.0.1:8123" });
});

it("keeps the synthetic HTTP harness isolated from the backend", async () => {
  const config = await resolveConfig({ mode: "harness" }, "serve");
  expect(config.server.proxy?.["/api"]).toBeUndefined();
});

it("provides backend vehicle provenance in the shared scene catalog", () => {
  expect(catalog).toHaveProperty("synthetic", false);
});
