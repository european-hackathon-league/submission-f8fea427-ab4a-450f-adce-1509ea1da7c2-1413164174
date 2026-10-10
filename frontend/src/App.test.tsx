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
import type { Api } from "./api/contracts";

afterEach(() => { cleanup(); sessionStorage.clear(); });

async function createRun(
  options: {
    deepDive?: boolean;
    guided?: boolean;
    scenario?: string;
    api?: Api;
  } = {},
) {
  const user = userEvent.setup();
  render(<App api={options.api ?? createMockApi(options.scenario)} />);
  if (options.deepDive)
    await user.click(screen.getByRole("checkbox", { name: "Deep Dive" }));
  if (options.guided)
    await user.click(screen.getByRole("radio", { name: "Guided" }));
  await user.upload(
    screen.getByLabelText("Upload files"),
    new File(["feedback"], "regional-feedback.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  );
  await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Start run" }));
  await screen.findByText(
    options.guided ? "waiting_for_pm" : "proposals_ready",
  );
  return user;
}

describe("frontend plan workspace", () => {
  it("recovers vehicle loading locally without losing uploaded files", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    const vehicles = api.vehicles!;
    let fail = true;
    api.vehicles = () => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error("Vehicle service offline"));
      }
      return vehicles();
    };
    render(<App api={api} />);
    await screen.findByText("Vehicle service offline");
    await user.upload(
      screen.getByLabelText("Upload files"),
      new File(["feedback"], "keep.xlsx"),
    );
    await screen.findByText("ready");
    expect(
      screen.getByRole("button", { name: "Start run" }),
    ).toHaveAccessibleDescription(
      "Vehicle options unavailable. Retry loading vehicles to continue.",
    );
    await user.click(
      screen.getByRole("button", { name: "Retry loading vehicles" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start run" })).toBeEnabled(),
    );
    expect(screen.getByText("keep.xlsx")).toBeInTheDocument();
  });

  it("retries an uncertain start with the same command identity", async () => {
    const api = createMockApi();
    const request = api.request;
    const keys: (string | undefined)[] = [];
    api.request = async <T,>(path: string, body?: unknown, key?: string) => {
      const result = await request<T>(path, body, key);
      if (path === "/runs") {
        keys.push(key);
        if (keys.length === 1) throw new Error("Start response interrupted");
      }
      return result;
    };
    const user = userEvent.setup();
    render(<App api={api} />);
    await user.upload(
      screen.getByLabelText("Upload files"),
      new File(["feedback"], "source.xlsx"),
    );
    await screen.findByText("ready");
    await user.click(screen.getByRole("button", { name: "Start run" }));
    await screen.findByText("Start response interrupted");
    await user.click(screen.getByRole("button", { name: "Retry run creation" }));
    await screen.findByText("proposals_ready");
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("reconnects to a created run instead of creating another after workspace loading fails", async () => {
    const api = createMockApi();
    const request = api.request;
    const workspace = api.workspace;
    let created = 0;
    let reconnect = false;
    api.request = (path, body, key) => {
      if (path === "/runs") created++;
      return request(path, body, key);
    };
    api.workspace = (id) =>
      reconnect
        ? workspace(id)
        : Promise.reject(new Error("Workspace offline"));
    const user = userEvent.setup();
    render(<App api={api} />);
    await user.upload(
      screen.getByLabelText("Upload files"),
      new File(["feedback"], "source.xlsx"),
    );
    await screen.findByText("ready");
    await user.click(screen.getByRole("button", { name: "Start run" }));
    await screen.findByText("Workspace offline");
    expect(screen.getByLabelText("Vehicle")).toBeDisabled();
    expect(screen.getByLabelText("Upload files")).toBeDisabled();
    reconnect = true;
    await user.click(screen.getByRole("button", { name: "Reconnect to run" }));
    await screen.findByText("proposals_ready");
    expect(created).toBe(1);
    await user.click(screen.getByRole("button", { name: "Review proposals" }));
    expect(screen.getByRole("tab", { name: "Proposals" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("guides first-run setup and explains readiness as files are added and removed", async () => {
    const user = userEvent.setup();
    render(<App api={createMockApi()} />);
    expect(
      screen.getByText(
        "Demo mode: uploaded contents are not analyzed. Runs use synthetic findings and proposals.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "XLSX or PDF. Add one or more files; partial packages are welcome.",
      ),
    ).toBeInTheDocument();
    const start = screen.getByRole("button", { name: "Start run" });
    expect(start).toBeDisabled();
    await waitFor(() =>
      expect(start).toHaveAccessibleDescription(
        "Add at least one source file to start.",
      ),
    );
    await user.upload(
      screen.getByLabelText("Upload files"),
      new File(["feedback"], "regional-feedback.xlsx"),
    );
    await waitFor(() => expect(start).toBeEnabled());
    expect(start).toHaveAccessibleDescription(
      "1 file ready. Only ready files will be included.",
    );
    await user.click(
      screen.getByRole("button", { name: "Remove regional-feedback.xlsx" }),
    );
    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(
      "Add at least one source file to start.",
    );
  });

  it("explains upload failures and preserves ready files for starting a run", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    const upload = api.upload;
    api.upload = (file) =>
      file.name === "failed.xlsx"
        ? Promise.reject(new Error("Network unavailable"))
        : upload(file);
    render(<App api={api} />);
    await user.upload(screen.getByLabelText("Upload files"), [
      new File(["a"], "failed.xlsx"),
      new File(["b"], "ready.xlsx"),
    ]);
    await screen.findByText("Network unavailable");
    const start = screen.getByRole("button", { name: "Start run" });
    await waitFor(() => expect(start).toBeEnabled());
    expect(start).toHaveAccessibleDescription(
      "1 file ready. Only ready files will be included.",
    );
    expect(
      screen.getByText(
        "Remove failed or rejected files and choose them again to retry. They will not be included in the run.",
      ),
    ).toBeInTheDocument();
  });

  it("explains why an unsupported vehicle cannot start", async () => {
    const user = userEvent.setup();
    render(<App api={createMockApi()} />);
    await screen.findByRole("option", { name: "BMW 1 Series / F70" });
    await user.selectOptions(screen.getByLabelText("Vehicle"), "f70");
    expect(
      screen.getByRole("button", { name: "Start run" }),
    ).toHaveAccessibleDescription(
      "No baseline asset for this vehicle. Choose a vehicle with an available baseline.",
    );
  });

  it("keeps supporting and opposing evidence beside a draft while opening exact sources", async () => {
    const user = await createRun();
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    const evidence = screen.getByRole("region", {
      name: "Evidence for proposal 1",
    });
    expect(within(evidence).getByText("Comfort controls")).toBeInTheDocument();
    expect(
      within(evidence).getByText(/172 of 400 negative feedback records/),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Proposal text"));
    await user.type(
      screen.getByLabelText("Proposal text"),
      "Review with evidence visible",
    );
    await user.click(
      await within(evidence).findByRole("button", {
        name: "Open source dashboard-E2",
      }),
    );
    expect(
      within(
        screen.getByRole("dialog", { name: "Source reference" }),
      ).getByText(/row 19/),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("tab", { name: "Proposals" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("Proposal text")).toHaveValue(
      "Review with evidence visible",
    );
    expect(
      within(evidence).getByRole("button", {
        name: "Open source dashboard-E2",
      }),
    ).toHaveFocus();
  });

  it("keeps Reimagine bound to the visible variant and proposal version across tabs", async () => {
    const user = await createRun();
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    await user.selectOptions(
      screen.getByLabelText("Variant"),
      "variant-physical",
    );
    await user.click(screen.getByRole("button", { name: "Save edit" }));
    await screen.findByText("Proposal version 2");
    await user.click(screen.getByRole("tab", { name: "History" }));
    const target = screen.getByRole("group", { name: "Reimagine target" });
    expect(
      within(target).getByText("Dedicated comfort control"),
    ).toBeInTheDocument();
    expect(
      within(target).getByText("Saved proposal version 2"),
    ).toBeInTheDocument();
    await user.click(within(target).getByRole("button", { name: "Reimagine" }));
    expect(
      await screen.findByText("Render proposal version 2"),
    ).toBeInTheDocument();
    expect(screen.getByText(/change-physical:/)).toBeInTheDocument();
  });

  it("does not attribute customer evidence to a PM idea without linked evidence", async () => {
    const user = await createRun();
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    await user.type(
      screen.getByLabelText("PM instruction"),
      "Investigate cabin lighting",
    );
    await user.click(screen.getByRole("button", { name: "Add proposal" }));
    await screen.findByText("Proposal version 2");
    const evidence = screen.getByRole("region", {
      name: "Evidence for proposal 2",
    });
    expect(
      within(evidence).getByText("No evidence linked to this PM idea."),
    ).toBeInTheDocument();
    expect(
      within(evidence).queryByRole("button", { name: /Open source/ }),
    ).not.toBeInTheDocument();
  });

  it("retries unavailable proposal evidence without leaving or clearing the editor", async () => {
    const api = createMockApi();
    const request = api.request;
    let unavailable = true;
    api.request = async (path, body, key) => {
      if (path.endsWith("/evidence/dashboard-E1") && unavailable) {
        unavailable = false;
        throw new Error("Evidence temporarily unavailable");
      }
      return request(path, body, key);
    };
    const user = await createRun({ api });
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    const evidence = screen.getByRole("region", {
      name: "Evidence for proposal 1",
    });
    await within(evidence).findByText(/dashboard-E1: Evidence temporarily unavailable/);
    expect(within(evidence).getByRole("button", { name: "Open source dashboard-E2" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Proposal text"));
    await user.type(screen.getByLabelText("Proposal text"), "Keep draft");
    await user.click(
      within(evidence).getByRole("button", {
        name: "Retry source dashboard-E1",
      }),
    );
    expect(
      await within(evidence).findByRole("button", {
        name: "Open source dashboard-E1",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Proposal text")).toHaveValue("Keep draft");
  });

  it("keeps proposal drafts when New run is canceled and resets only after confirmation", async () => {
    const user = await createRun();
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    await user.clear(screen.getByLabelText("Proposal text"));
    await user.type(screen.getByLabelText("Proposal text"), "Keep my draft");
    await user.click(screen.getByRole("button", { name: "New run" }));
    const dialog = screen.getByRole("dialog", { name: "Start a new run?" });
    await user.click(
      within(dialog).getByRole("button", { name: "Keep working" }),
    );
    expect(screen.getByLabelText("Proposal text")).toHaveValue("Keep my draft");
    expect(screen.getByRole("button", { name: "New run" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "New run" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Start new run",
      }),
    );
    expect(screen.getByRole("button", { name: "Start run" })).toBeDisabled();
    expect(screen.queryByText("Proposal version 1")).not.toBeInTheDocument();
  });

  it("requires confirmation before removing a proposal and retains its draft on cancel", async () => {
    const user = await createRun();
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    await user.type(screen.getByLabelText("Proposal text"), " Extra detail");
    const draft = (
      screen.getByLabelText("Proposal text") as HTMLTextAreaElement
    ).value;
    await user.click(screen.getByRole("button", { name: "Remove change 1" }));
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Proposal text")).toHaveValue(draft);
    expect(
      screen.getByRole("button", { name: "Remove change 1" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Remove change 1" }));
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Remove proposal?" }),
      ).getByRole("button", { name: "Remove proposal" }),
    );
    await screen.findByText("Proposal version 2");
    expect(screen.queryByLabelText("Proposal text")).not.toBeInTheDocument();
  });

  it("warns on browser exit for drafts across tabs, then clears warning after saving", async () => {
    const user = await createRun();
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    await user.type(screen.getByLabelText("Proposal text"), " Unsaved detail");
    await user.click(screen.getByRole("tab", { name: "Evidence" }));
    const unsavedExit = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unsavedExit);
    expect(unsavedExit.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    await user.click(screen.getByRole("button", { name: "Save edit" }));
    await screen.findByText("Proposal version 2");
    await waitFor(() => {
      const savedExit = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(savedExit);
      expect(savedExit.defaultPrevented).toBe(false);
    });
  });

  it("retains unsaved grouping while inspecting evidence and warns before browser exit", async () => {
    const user = await createRun();
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    await user.clear(screen.getByLabelText("Cohort scope"));
    await user.type(screen.getByLabelText("Cohort scope"), "Germany");
    await user.click(screen.getByRole("tab", { name: "Evidence" }));
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    expect(screen.getByLabelText("Cohort scope")).toHaveValue("Germany");
    const exit = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(exit);
    expect(exit.defaultPrevented).toBe(true);
  });

  it("retains a draft when removal is rejected for a stale version", async () => {
    const user = await createRun({ scenario: "pm_edit_stale" });
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    await user.type(screen.getByLabelText("Proposal text"), " Keep this edit");
    const draft = (
      screen.getByLabelText("Proposal text") as HTMLTextAreaElement
    ).value;
    await user.click(screen.getByRole("button", { name: "Remove change 1" }));
    const dialog = screen.getByRole("dialog", { name: "Remove proposal?" });
    await user.click(
      within(dialog).getByRole("button", { name: "Remove proposal" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Proposal and draft kept",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Keep working" }),
    );
    expect(screen.getByLabelText("Proposal text")).toHaveValue(draft);
    expect(
      screen.getByText(/Draft based on version 1; current version 2/),
    ).toBeInTheDocument();
  });

  it("starts with autonomous setup and Deep Dive off, without separate pitch destinations", () => {
    render(<App />);
    expect(screen.getByRole("radio", { name: "Autonomous" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Deep Dive" }),
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Start run" })).toBeDisabled();
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
    expect(
      screen.getByText(
        "No baseline asset for this vehicle. Choose a vehicle with an available baseline.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "BMW i5 M60 vehicle viewer" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start run" })).toBeDisabled();
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
    // Exercise server-side rejection even when a file picker filters unsupported extensions.
    const user = userEvent.setup({applyAccept:false});
    render(<App />);
    await user.upload(screen.getByLabelText("Upload files"), [
      new File(["x"], "bad.exe"),
      new File(["x"], "good.xlsx"),
    ]);
    expect(await screen.findByText(/Unsupported file/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start run" })).toBeEnabled(),
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
      screen.getAllByText(/172 of 400 negative feedback records/)[0],
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
      screen.getByText(/Annotation only/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Not validated or approved/)).toBeInTheDocument();
  });

  it("retains an unsaved proposal when hiding and reopening evidence", async () => {
    const user = await createRun();
    await user.click(screen.getByRole("tab", { name: "Proposals" }));
    await user.clear(screen.getByLabelText("Proposal text"));
    await user.type(
      screen.getByLabelText("Proposal text"),
      "My unsaved proposal",
    );
    await user.click(screen.getByRole("button", { name: "Hide evidence" }));
    expect(
      screen.queryByRole("region", { name: "Evidence for proposal 1" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View evidence" }));
    expect(
      screen.getByRole("region", { name: "Evidence for proposal 1" }),
    ).toBeInTheDocument();
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
    expect(screen.getByText("PM selected continue")).toBeInTheDocument();
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

it("restores real-mode run identity, selected panel and unsaved versioned proposal after remount", async () => {
  const api = { ...createMockApi(), mode: "real" as const };
  const user = userEvent.setup();
  const first = render(<App api={api} />);
  await user.upload(screen.getByLabelText("Upload files"), new File(["feedback"], "regional.pdf"));
  await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Start run" }));
  await screen.findByText("proposals_ready");
  await user.click(screen.getByRole("tab", { name: "Proposals" }));
  await user.clear(screen.getByLabelText("Proposal text"));
  await user.type(screen.getByLabelText("Proposal text"), "Retain across reload");
  first.unmount();
  render(<App api={api} />);
  await screen.findByText("Saved configuration");
  expect(await screen.findByLabelText("Proposal text")).toHaveValue("Retain across reload");
  expect(screen.getByText("run-synthetic")).toBeInTheDocument();
  sessionStorage.clear();
});

it("restarts event recovery after restored access and Reconnect", async () => {
  const mock = createMockApi();
  let streams = 0;
  const api = {
    ...mock, mode: "real" as const, sessionNamespace: "access-recovery-test",
    workspace: async (id: string) => {
      const w = await mock.workspace(id);
      if (streams > 1) { w.snapshot.stage = "Stream resumed"; w.snapshot.revision += 1; w.snapshot.last_event_sequence += 1; }
      return w;
    },
    events: async (id: string, sequence: number) => {
      if (++streams === 1) return new Response(JSON.stringify({ code: "forbidden", message: "Workspace access denied" }), { status: 403 });
      const event = { contract_version: "1", event_id: `e${sequence+1}`, sequence: sequence+1, run_id: id, type: "analysis.updated", resource: { type: "run", id, revision: 3 } };
      return new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    },
  };
  const user = userEvent.setup();
  render(<App api={api} />);
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf"));
  await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Start run" }));
  await screen.findByText("Workspace access denied");
  await user.click(screen.getByRole("button", { name: "Reconnect" }));
  await screen.findByText("Stream resumed");
  expect(streams).toBe(2);
});

it("starts an independent second synthetic run after New run", async () => {
  const user = await createRun();
  await user.click(screen.getByRole("button", { name: "New run" }));
  await user.click(within(screen.getByRole("dialog", {name:"Start a new run?"})).getByRole("button",{name:"Start new run"}));
  await user.upload(screen.getByLabelText("Upload files"), new File(["second"], "second.xlsx"));
  await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Start run" }));
  await screen.findByText("proposals_ready");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("creates server-supported configurations even when local visual asset is unavailable", async () => {
  const base = createMockApi();
  const api = { ...base, vehicles: undefined, request: async <T,>(path: string, body?: unknown, key?: string): Promise<T> => {
    if (path === "/vehicles") return {items:[{vehicle_id:"server-vehicle",title:"Server vehicle",baseline_asset_id:"server-asset",part_catalog_version:"server-catalog",capabilities:[],wire:{vehicle_id:"server-vehicle",baseline_asset_ids:["server-asset"],part_catalog_versions:["server-catalog"],capabilities:[]}}],next_cursor:null} as T;
    if (path === "/runs") return { run_id: "server-run",snapshot_url:"/api/v1/runs/server-run",events_url:"/api/v1/runs/server-run/events" } as T;
    return base.request<T>(path, body, key);
  }, workspace: async () => { throw new Error("Snapshot temporarily interrupted"); } };
  const user = userEvent.setup();
  render(<App api={api} />);
  await screen.findByRole("option", { name: "Server vehicle" });
  await user.selectOptions(screen.getByLabelText("Vehicle"), "server-vehicle");
  await user.upload(screen.getByLabelText("Upload files"), new File(["s"], "s.pdf"));
  await screen.findByText("ready");
  expect(screen.getByRole("button", { name: "Start run" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Start run" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Vehicle")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Start run" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New run" })).toBeEnabled();
});

it("retries an uncertain accepted run with original frozen command and key", async () => {
  const base = createMockApi();
  const commands: Array<{ key?: string; body: unknown }> = [];
  const api = { ...base, mode: "real" as const, sessionNamespace: "uncertain-create", request: async <T,>(path: string, body?: unknown, key?: string): Promise<T> => {
    const result = await base.request<T>(path, body, key);
    if (path === "/runs") {
      commands.push({ key, body });
      if (commands.length === 1) throw new TypeError("Response interrupted");
    }
    return result;
  } };
  const user = userEvent.setup();
  const first = render(<App api={api} />);
  await user.click(screen.getByRole("radio", { name: "Guided" }));
  await user.click(screen.getByRole("checkbox", { name: "Deep Dive" }));
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf"));
  await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Start run" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Vehicle")).toBeDisabled();
  first.unmount();
  render(<App api={api} />);
  expect(screen.getByLabelText("Vehicle")).toBeDisabled();
  expect(screen.getByRole("radio", { name: "Guided" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Deep Dive" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Retry run creation" }));
  await screen.findByText("waiting_for_pm");
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});


it("keeps unknown semantic parts accessible without selecting an unrelated spatial part", async () => {
  const base = createMockApi();
  const api = { ...base, workspace: async (id: string) => {
    const w = await base.workspace(id);
    w.findings.push({ ...w.findings[0], finding_id: "unknown-part", title: "Non-geometric subscription", part_ids: ["subscription" as never] });
    return w;
  } };
  const user = userEvent.setup(); render(<App api={api} />);
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf"));
  await screen.findByText("ready"); await user.click(screen.getByRole("button", { name: "Start run" }));
  await screen.findByText("proposals_ready");
  expect(screen.getByRole("heading", { name: "Unmapped or non-geometric findings" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Non-geometric subscription/ }));
  expect(screen.getByRole("heading", { name: "Non-geometric subscription" })).toBeInTheDocument();
  expect(screen.getAllByText(/No spatial part selected/)[0]).toBeInTheDocument();
});

it("does not replace an explicit finding selection when refreshed findings remove it", async () => {
  const base = createMockApi(); let removed = false;
  const api = { ...base, workspace: async (id: string) => {
    const w = await base.workspace(id);
    if (removed) w.findings = w.findings.filter(f => f.finding_id !== "finding-dashboard");
    return w;
  } };
  const user = userEvent.setup(); render(<App api={api} />);
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf"));
  await screen.findByText("ready"); await user.click(screen.getByRole("button", { name: "Start run" }));
  await screen.findByText("proposals_ready");
  await user.click(screen.getByRole("button", { name: /Comfort controls.*172 of 400/ }));
  removed = true; await user.click(screen.getByRole("button", { name: "Reimagine" }));
  expect(await screen.findByText(/Selected finding is unavailable in this snapshot/)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Vehicle-wide and unmapped" })).not.toBeInTheDocument();
});

it("moves focus with analysis tab keyboard navigation", async () => {
  const user = await createRun(); screen.getByRole("tab", { name: "Findings" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Graph" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "Graph" })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{End}"); expect(screen.getByRole("tab", { name: "History" })).toHaveFocus();
});


it("uses saved run asset and catalog identity before exposing local spatial mappings", async () => {
  const base = createMockApi(); const api = { ...base, workspace: async (id: string) => {
    const w = await base.workspace(id); w.snapshot.config = { ...w.snapshot.config, baseline_asset_id: "other-version", part_catalog_version: "other-parts" }; return w;
  } };
  const user = userEvent.setup(); render(<App api={api} />);
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf")); await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Start run" })); await screen.findByText("proposals_ready");
  expect(screen.queryByRole("region", { name: "BMW i5 M60 vehicle viewer" })).not.toBeInTheDocument();
  expect(screen.getByText("No verified baseline asset for this model.")).toBeInTheDocument();
});

it("keeps catalog hierarchy-only IDs out of spatial part selection", async () => {
  const base = createMockApi(); const api = { ...base, workspace: async (id: string) => {
    const w = await base.workspace(id); w.findings[0].part_ids = ["cabin" as never]; return w;
  } };
  const user = userEvent.setup(); render(<App api={api} />);
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf")); await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Start run" })); await screen.findByText("proposals_ready");
  const group = screen.getByRole("region", { name: "Unmapped or non-geometric findings" });
  await user.click(within(group).getByRole("button", { name: /Comfort controls/ }));
  expect(screen.getAllByText(/No spatial part selected/).length).toBeGreaterThan(0);
});


it("treats finding IDs as opaque even when resembling old UI sentinel IDs", async () => {
  const base = createMockApi(); const api = { ...base, workspace: async (id: string) => { const w = await base.workspace(id); w.findings[0].finding_id = "unreported-real-finding"; return w; } };
  const user = userEvent.setup(); render(<App api={api} />);
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf")); await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Start run" })); await screen.findByText("proposals_ready");
  await user.click(screen.getByRole("button", { name: /Comfort controls.*172 of 400/ }));
  expect(screen.getByRole("heading", { name: "Comfort controls" })).toBeInTheDocument();
});


it("preserves selected finding when several findings map to one component", async () => {
  const base = createMockApi(); const api = { ...base, workspace: async (id: string) => {
    const w = await base.workspace(id); w.findings.push({ ...w.findings[1], finding_id: "body-other", title: "Chosen body finding" }); return w;
  } };
  const user = userEvent.setup(); render(<App api={api} />);
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf")); await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Start run" })); await screen.findByText("proposals_ready");
  await user.click(screen.getByRole("button", { name: /Chosen body finding/ }));
  await user.click(screen.getByRole("button", { name: /^Body.*Cohorts/ }));
  expect(screen.getByRole("heading", { name: "Chosen body finding" })).toBeInTheDocument();
});


it("moves keyboard focus into evidence after choosing a finding", async () => {
  const user = await createRun(); const choice = screen.getByRole("button", { name: /Comfort controls.*172 of 400/ });
  choice.focus(); await user.keyboard("{Enter}");
  expect(screen.getByRole("tabpanel", { name: "Evidence" })).toHaveFocus();
});


it("clears obsolete spatial selection when current finding mapping changes on refresh", async () => {
  const base = createMockApi(); let unmapped = false;
  const api = { ...base, workspace: async (id: string) => { const w = await base.workspace(id); if (unmapped) w.findings[1].part_ids = []; return w; } };
  const user = userEvent.setup(); render(<App api={api} />);
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf")); await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Start run" })); await screen.findByText("proposals_ready");
  await user.click(screen.getByRole("button", { name: /Trunk gesture reliability.*88 of 400/ }));
  expect(screen.getByRole("button", { name: /^Body.*Cohorts/ })).toHaveAttribute("aria-pressed", "true");
  unmapped = true; await user.click(screen.getByRole("button", { name: "Reimagine" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /^Body.*Cohorts/ })).toHaveAttribute("aria-pressed", "false"));
  expect(screen.getByRole("heading", { name: "Trunk gesture reliability" })).toBeInTheDocument();
});


it("opens mapped evidence from a keyboard component tag", async () => {
  const user = await createRun(); await screen.findByRole("button", { name: /^Body.*Cohorts/ });
  await user.click(screen.getByRole("button", { name: /^Body.*Cohorts/ }));
  expect(screen.getByRole("tabpanel", { name: "Evidence" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Trunk gesture reliability" })).toBeInTheDocument();
});
