import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { createApi } from "./api/client";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

it("uses the authenticated backend unless mock mode is explicitly requested", () => {
  vi.stubEnv("VITE_API_MODE", undefined);
  expect(createApi().mode).toBe("real");
  render(<App />);
  expect(screen.getByRole("heading", { name: "Connect to application API" })).toBeInTheDocument();
});

it("keeps synthetic development available explicitly", () => {
  vi.stubEnv("VITE_API_MODE", "mock");
  const api = createApi();
  expect(api.mode).toBe("mock");
  api.dispose?.();
});
