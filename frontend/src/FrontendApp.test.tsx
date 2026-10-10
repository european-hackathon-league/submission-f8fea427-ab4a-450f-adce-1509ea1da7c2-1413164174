import { cleanup, render, screen } from "@testing-library/react";
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
it("opens existing workshop with supported model and starts analysis", async () => {
  const user = userEvent.setup();
  render(<FrontendApp api={createMockApi()} />);
  expect(screen.getAllByRole("button", { name: /^Explore BMW/ })).toHaveLength(
    24,
  );
  await user.click(
    screen.getByRole("button", { name: "Explore BMW i5 M60 xDrive" }),
  );
  expect(window.location.hash).toBe("#workspace");
  await screen.findByRole("heading", { name: "Workshop" });
  expect(screen.getByLabelText("Vehicle")).toHaveValue("g60-i5-m60");
  await user.upload(
    screen.getByLabelText("Upload files"),
    new File(["feedback"], "feedback.pdf"),
  );
  await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Start analysis" }));
  await screen.findByText("proposals ready");
  expect(
    screen.getByRole("combobox", { name: "More review views" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Suggestions" })).toBeInTheDocument();
});
it("keeps unsupported trim explicit instead of analyzing i5 baseline", async () => {
  const user = userEvent.setup();
  render(<FrontendApp api={createMockApi()} />);
  await user.click(screen.getByRole("button", { name: "Explore BMW 520i" }));
  await screen.findByText(/No baseline asset for this vehicle/);
  expect(screen.getByLabelText("Vehicle")).not.toHaveValue("g60-i5-m60");
  expect(screen.getByRole("button", { name: "Add files" })).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Back to the BMW journey" }),
  );
  expect(screen.getAllByRole("button", { name: /^Explore BMW/ })).toHaveLength(
    24,
  );
});
it("reopens workshop without losing uploaded files", async () => {
  const user = userEvent.setup();
  render(<FrontendApp api={createMockApi()} />);
  await user.click(screen.getByRole("button", { name: "Open workspace" }));
  await screen.findByRole("heading", { name: "Workshop" });
  await user.upload(
    screen.getByLabelText("Upload files"),
    new File(["feedback"], "kept.pdf"),
  );
  await screen.findByText("ready");
  await user.click(
    screen.getByRole("button", { name: "Back to the BMW journey" }),
  );
  await user.click(screen.getByRole("button", { name: "Open workspace" }));
  expect(await screen.findByText("kept.pdf")).toBeInTheDocument();
});
it("changes collection model without discarding uploaded workshop files", async () => {
  const user = userEvent.setup();
  render(<FrontendApp api={createMockApi()} />);
  await user.click(
    screen.getByRole("button", { name: "Explore BMW i5 M60 xDrive" }),
  );
  await user.upload(
    screen.getByLabelText("Upload files"),
    new File(["feedback"], "retained.pdf"),
  );
  await screen.findByText("ready");
  await user.click(
    screen.getByRole("button", { name: "Back to the BMW journey" }),
  );
  await user.click(screen.getByRole("button", { name: "Explore BMW 520i" }));
  expect(await screen.findByText("retained.pdf")).toBeInTheDocument();
  await screen.findByText(/No baseline asset for this vehicle/);
});

async function chooseView(
  user: ReturnType<typeof userEvent.setup>,
  view: string,
) {
  if (view === "Proposals" || view === "Findings")
    await user.click(
      screen.getByRole("tab", {
        name: view === "Proposals" ? "Suggestions" : "Customer feedback",
      }),
    );
  else
    await user.selectOptions(
      screen.getByRole("combobox", { name: "More review views" }),
      view,
    );
  const selector =
    view === "Proposals"
      ? ".proposal-tools"
      : view === "History"
        ? ".history-tools"
        : null;
  if (selector) {
    const details = document.querySelector(selector) as HTMLDetailsElement;
    if (details && !details.open)
      await user.click(details.querySelector("summary")!);
  }
}
