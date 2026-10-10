import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { createMockApi } from "./api/client";

afterEach(cleanup);

async function createRun(
  options: { deepDive?: boolean; guided?: boolean; scenario?: string } = {},
) {
  const user = userEvent.setup();
  render(<App api={createMockApi(options.scenario)} />);
  if (options.deepDive)
    await user.click(screen.getByRole("checkbox", { name: "Deep Dive" }));
  if (options.guided)
    await user.click(screen.getByRole("radio", { name: "Guided" }));
  await user.upload(
    screen.getByLabelText("Upload files"),
    new File(["feedback"], "regional-feedback.csv", { type: "text/csv" }),
  );
  await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Create run" }));
  await screen.findByText(
    options.guided ? "waiting_for_pm" : "proposals_ready",
  );
  return user;
}

describe("frontend plan workspace", () => {
  it("starts with autonomous setup and Deep Dive off, without separate pitch destinations", () => {
    render(<App />);
    expect(screen.getByRole("radio", { name: "Autonomous" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Deep Dive" }),
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Create run" })).toBeDisabled();
    for (const name of [
      "Overview",
      "Compare",
      "Present",
      "Print report",
      "Export CSV",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("keeps unavailable vehicles honest and blocks mismatched asset creation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("option", { name: "BMW 1 Series / F70" });
    await user.selectOptions(screen.getByLabelText("Vehicle"), "f70");
    expect(screen.getByText("Baseline asset unavailable")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "BMW i5 M60 vehicle viewer" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create run" })).toBeDisabled();
  });

  it("allows partial uploads, freezes saved settings and exposes findings without PM approval", async () => {
    const user = await createRun();
    expect(screen.getByText("Saved configuration")).toBeInTheDocument();
    expect(screen.getByLabelText("Vehicle")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Deep Dive" })).toBeDisabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Findings" }));
    expect(
      screen.getByRole("button", { name: /Comfort controls.*172 of 400/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Vehicle-wide and unmapped/ }),
    ).toBeInTheDocument();
  });

  it("rejects unsupported files while retaining a usable partial package", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.upload(screen.getByLabelText("Upload files"), [
      new File(["x"], "bad.exe"),
      new File(["x"], "good.csv"),
    ]);
    expect(await screen.findByText(/Unsupported file/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create run" })).toBeEnabled(),
    );
  });

  it("keeps Deep Dive evidence inside finding panels and exposes partial gaps", async () => {
    const user = await createRun({ deepDive: true });
    await user.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(
      screen.getByRole("heading", { name: "Deep Dive" }),
    ).toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();
    expect(screen.getByText(/Owner sample unavailable/)).toBeInTheDocument();
    expect(
      screen.getByText(/172 of 400 negative feedback records/),
    ).toBeInTheDocument();
  });

  it("opens source references and keeps customer records separate from proposal edits", async () => {
    const user = await createRun();
    await user.click(screen.getByRole("tab", { name: "Evidence" }));
    await user.click(
      await screen.findByRole("button", { name: "Open source dashboard-E1" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Source reference",
    });
    expect(within(dialog).getByText(/row 12/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("button", { name: "Open source dashboard-E1" }),
    ).toHaveFocus();
  });

  it("submits version-bound edits and keeps original evidence inspectable", async () => {
    const user = await createRun();
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    await user.clear(screen.getByLabelText("Proposal text"));
    await user.type(
      screen.getByLabelText("Proposal text"),
      "Keep climate controls visible.",
    );
    await user.click(screen.getByRole("button", { name: "Save edit" }));
    expect(await screen.findByText("Proposal version 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Proposal text")).toHaveValue(
      "Keep climate controls visible.",
    );
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText(/PM instruction accepted/)).toBeInTheDocument();
  });

  it("renders exact proposal versions and shows per-change limits without implying approval", async () => {
    const user = await createRun();
    await user.click(screen.getByRole("button", { name: "Reimagine" }));
    expect(
      await screen.findByText(/Render proposal version 1/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Digital change: annotation only/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Not validated or approved/)).toBeInTheDocument();
  });

  it("retains an unsaved proposal when inspecting evidence and returning", async () => {
    const user = await createRun();
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    await user.clear(screen.getByLabelText("Proposal text"));
    await user.type(
      screen.getByLabelText("Proposal text"),
      "My unsaved proposal",
    );
    await user.click(screen.getByRole("button", { name: "View evidence" }));
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    expect(screen.getByLabelText("Proposal text")).toHaveValue(
      "My unsaved proposal",
    );
  });

  it("retains stale drafts and requires explicit reconciliation before resubmitting", async () => {
    const user = await createRun({ scenario: "pm_edit_stale" });
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    await user.clear(screen.getByLabelText("Proposal text"));
    await user.type(
      screen.getByLabelText("Proposal text"),
      "Retain my proposed edit",
    );
    await user.click(screen.getByRole("button", { name: "Save edit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Your draft is retained/,
    );
    expect(screen.getByLabelText("Proposal text")).toHaveValue(
      "Retain my proposed edit",
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Use current version with my draft",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save edit" }));
    expect(await screen.findByText("Proposal version 3")).toBeInTheDocument();
  });

  it("continues a guided checkpoint in a panel and records the PM selection", async () => {
    const user = await createRun({ guided: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(
      screen.getAllByRole("button", { name: "Choose approach" })[0],
    );
    await screen.findByText("proposals_ready");
    expect(
      screen.queryByRole("button", { name: "Choose approach" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText("PM selected variant-digital")).toBeInTheDocument();
  });

  it("keeps an older render labeled after proposal edits", async () => {
    const user = await createRun();
    await user.click(screen.getByRole("button", { name: "Reimagine" }));
    await screen.findByText("Render proposal version 1");
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save edit" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Save edit" }));
    await screen.findByText("Proposal version 2");
    expect(
      screen.getByText(/Older render. Current proposal version 2/),
    ).toBeInTheDocument();
    expect(screen.getByText("Render proposal version 1")).toBeInTheDocument();
  });
});
