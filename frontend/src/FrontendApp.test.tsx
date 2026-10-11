import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import FrontendApp from "./FrontendApp";
import { createMockApi } from "./api/client";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("makes every family and all 24 variants reachable through the picker", async () => {
  const user = userEvent.setup();
  render(<FrontendApp api={createMockApi()} />);
  await user.click(screen.getByRole("button", { name: "5 Series" }));
  const variants = () => within(screen.getByRole("combobox", { name: "Variant" })).getAllByRole("option");
  expect(variants()).toHaveLength(10);
  expect(variants().map(option => option.textContent)).toContain("BMW i5 M60 xDrive");
  await user.click(screen.getByRole("button", { name: "1 Series" }));
  expect(variants()).toHaveLength(6);
  expect(variants()[0]).toHaveTextContent("BMW 116");
  await user.click(screen.getByRole("button", { name: "5 Series Long Wheelbase" }));
  expect(variants()).toHaveLength(1);
  expect(variants()[0]).toHaveTextContent("BMW 5 Series Long Wheelbase");
  await user.click(screen.getByRole("button", { name: "7 Series" }));
  expect(variants()).toHaveLength(7);
  expect(variants()[6]).toHaveTextContent("BMW i7 M70 xDrive");
});

it("opens the selected workshop directly and starts analysis", async () => {
  const user = userEvent.setup();
  render(<FrontendApp api={createMockApi()} />);
  await user.click(screen.getByRole("button", { name: "5 Series" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Variant" }), "G60-i5-M60-xDrive");
  await user.click(screen.getByRole("button", { name: "Explore G60" }));
  expect(window.location.hash).toBe("#workspace");
  await screen.findByRole("heading", { name: "Workshop" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Vehicle")).toHaveValue("g60-i5-m60");
  await user.upload(screen.getByLabelText("Upload files"), new File(["feedback"], "feedback.pdf"));
  await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Start analysis" }));
  await screen.findByText("proposals ready");
  expect(screen.getByRole("tab", { name: "Suggestions" })).toBeInTheDocument();
});

it("keeps unsupported trim explicit instead of analyzing the i5 baseline", async () => {
  const user = userEvent.setup();
  render(<FrontendApp api={createMockApi()} />);
  await user.click(screen.getByRole("button", { name: "5 Series" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Variant" }), "G60-520i");
  await user.click(screen.getByRole("button", { name: "Explore G60" }));
  await screen.findByText(/No baseline asset for this vehicle/);
  expect(screen.getByLabelText("Vehicle")).not.toHaveValue("g60-i5-m60");
  expect(screen.getByRole("button", { name: "Add files" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Back to the BMW journey" }));
  expect(screen.getByRole("combobox", { name: "Variant" })).toHaveValue("G60-520i");
});

it("retains the variant when browsing away and returning to its family", async () => {
  const user = userEvent.setup();
  render(<FrontendApp api={createMockApi()} />);
  await user.click(screen.getByRole("button", { name: "5 Series" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Variant" }), "G60-530e-xDrive");
  await user.click(screen.getByRole("button", { name: "1 Series" }));
  await user.click(screen.getByRole("button", { name: "5 Series" }));
  expect(screen.getByRole("combobox", { name: "Variant" })).toHaveValue("G60-530e-xDrive");
});

it("changes the car image when the picker changes from 116 to M135", async () => {
  const user = userEvent.setup();
  render(<FrontendApp api={createMockApi()} />);
  const before = screen.getByRole("img").getAttribute("src");
  await user.selectOptions(screen.getByRole("combobox", { name: "Variant" }), "F70-M135-xDrive");
  expect(screen.getByRole("img")).not.toHaveAttribute("src", before);
  expect(screen.getByRole("img")).toHaveAttribute("src", "/images/bmw/exterior/21GE/04.webp");
});

it("reopens the selected workshop without losing uploaded files", async () => {
  const user = userEvent.setup();
  render(<FrontendApp api={createMockApi()} />);
  await user.click(screen.getByRole("button", { name: "5 Series" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Variant" }), "G60-i5-M60-xDrive");
  await user.click(screen.getByRole("button", { name: "Explore G60" }));
  await user.upload(screen.getByLabelText("Upload files"), new File(["feedback"], "kept.pdf"));
  await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Back to the BMW journey" }));
  expect(screen.getByRole("combobox", { name: "Variant" })).toHaveValue("G60-i5-M60-xDrive");
  await user.click(screen.getByRole("button", { name: "Explore G60" }));
  expect(await screen.findByText("kept.pdf")).toBeInTheDocument();
});

it("changes collection model without discarding uploaded workshop files", async () => {
  const user = userEvent.setup();
  render(<FrontendApp api={createMockApi()} />);
  await user.click(screen.getByRole("button", { name: "5 Series" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Variant" }), "G60-i5-M60-xDrive");
  await user.click(screen.getByRole("button", { name: "Explore G60" }));
  await user.upload(screen.getByLabelText("Upload files"), new File(["feedback"], "retained.pdf"));
  await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Back to the BMW journey" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Variant" }), "G60-520i");
  await user.click(screen.getByRole("button", { name: "Explore G60" }));
  expect(await screen.findByText("retained.pdf")).toBeInTheDocument();
  await screen.findByText(/No baseline asset for this vehicle/);
});

it("restores the last opened model on a fresh visit", () => {
  window.sessionStorage.setItem("collection-model", "G70-i7-M70-xDrive");
  render(<FrontendApp api={createMockApi()} />);
  expect(screen.getByRole("combobox", { name: "Variant" })).toHaveValue("G70-i7-M70-xDrive");
});


it.each([
  ["1 Series", "F70", "f70"],
  ["5 Series", "G60", "g60-520i"],
  ["5 Series Long Wheelbase", "G68", "g68"],
  ["7 Series", "G70", "g70"],
])("Explore %s opens that family's workshop directly", async (name, family, vehicle) => {
  const user = userEvent.setup();
  render(<FrontendApp api={createMockApi()} />);
  await user.click(screen.getByRole("button", { name }));
  await user.click(screen.getByRole("button", { name: `Explore ${family}` }));
  expect(window.location.hash).toBe("#workspace");
  await screen.findByRole("heading", { name: "Workshop" });
  expect(screen.getByLabelText("Vehicle")).toHaveValue(vehicle);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
