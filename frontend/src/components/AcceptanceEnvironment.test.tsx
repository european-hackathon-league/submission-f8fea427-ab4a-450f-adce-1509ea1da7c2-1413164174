import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AcceptanceEnvironment from "./AcceptanceEnvironment";
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
it.each([undefined, "false", "1", "TRUE"])(
  "does not label ordinary application sessions as harness acceptance (%s)",
  (flag) => {
    vi.stubEnv("VITE_CONTRACT_HARNESS", flag);
    render(<AcceptanceEnvironment />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/harness-token/)).not.toBeInTheDocument();
  },
);
it("labels explicitly enabled network fixtures and supplies only public fixture access guidance", () => {
  vi.stubEnv("VITE_CONTRACT_HARNESS", "true");
  vi.stubEnv("VITE_API_MODE", "real");
  render(<AcceptanceEnvironment />);
  const note = screen.getByRole("note", { name: "Synthetic contract harness" });
  expect(note).toHaveTextContent("Synthetic HTTP fixtures");
  expect(note).toHaveTextContent("harness-token");
  expect(note).toHaveTextContent("standard_autonomous");
  expect(note).toHaveTextContent("No live backend acceptance");
  expect(note).toHaveTextContent("not real authentication");
  expect(note).toHaveTextContent(
    "No uploaded source analysis, external research or generation",
  );
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
it("honors explicit disabled prop even when harness environment flag is enabled", () => {
  vi.stubEnv("VITE_CONTRACT_HARNESS", "true");
  render(<AcceptanceEnvironment enabled={false} />);
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
});
it("identifies mock transport as insufficient network acceptance when harness flag is misconfigured", () => {
  vi.stubEnv("VITE_API_MODE", "mock");
  render(<AcceptanceEnvironment enabled />);
  expect(screen.getByRole("note")).toHaveTextContent(
    "Mock transport does not establish network integration",
  );
});
