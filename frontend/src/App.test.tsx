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

afterEach(() => { cleanup(); sessionStorage.clear(); });

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
    new File(["feedback"], "regional-feedback.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
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
      new File(["x"], "good.xlsx"),
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
    await user.selectOptions(screen.getByLabelText("Resolution for checkpoint-comfort"), "continue");
    await user.click(screen.getByRole("button", { name: "Continue checkpoint checkpoint-comfort" }));
    await screen.findByText("proposals_ready");
    expect(
      screen.queryByRole("button", { name: "Continue checkpoint checkpoint-comfort" }),
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
  await user.click(screen.getByRole("button", { name: "Create run" }));
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
  await user.click(screen.getByRole("button", { name: "Create run" }));
  await screen.findByText("Workspace access denied");
  await user.click(screen.getByRole("button", { name: "Reconnect" }));
  await screen.findByText("Stream resumed");
  expect(streams).toBe(2);
});

it("starts an independent second synthetic run after New run", async () => {
  const user = await createRun();
  await user.click(screen.getByRole("button", { name: "New run" }));
  await user.upload(screen.getByLabelText("Upload files"), new File(["second"], "second.xlsx"));
  await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Create run" }));
  await screen.findByText("proposals_ready");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("creates server-supported configurations even when local visual asset is unavailable", async () => {
  const base = createMockApi();
  const api = { ...base, vehicles: undefined, request: async <T,>(path: string, body?: unknown, key?: string): Promise<T> => {
    if (path === "/vehicles") return { items: [{ vehicle_id: "server-vehicle", title: "Server vehicle", baseline_asset_id: "server-asset", part_catalog_version: "server-catalog", capabilities: [] }], next_cursor: null } as T;
    if (path === "/runs") return { run_id: "server-run" } as T;
    return base.request<T>(path, body, key);
  }, workspace: async () => { throw new Error("Snapshot temporarily interrupted"); } };
  const user = userEvent.setup();
  render(<App api={api} />);
  await screen.findByRole("option", { name: "Server vehicle" });
  await user.selectOptions(screen.getByLabelText("Vehicle"), "server-vehicle");
  await user.upload(screen.getByLabelText("Upload files"), new File(["s"], "s.pdf"));
  await screen.findByText("ready");
  expect(screen.getByRole("button", { name: "Create run" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Create run" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Vehicle")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Create run" })).not.toBeInTheDocument();
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
  await user.click(screen.getByRole("button", { name: "Create run" }));
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
  await screen.findByText("ready"); await user.click(screen.getByRole("button", { name: "Create run" }));
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
  await screen.findByText("ready"); await user.click(screen.getByRole("button", { name: "Create run" }));
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
  await user.click(screen.getByRole("button", { name: "Create run" })); await screen.findByText("proposals_ready");
  expect(screen.queryByRole("region", { name: "BMW i5 M60 vehicle viewer" })).not.toBeInTheDocument();
  expect(screen.getByText("No verified baseline asset for this model.")).toBeInTheDocument();
});

it("keeps catalog hierarchy-only IDs out of spatial part selection", async () => {
  const base = createMockApi(); const api = { ...base, workspace: async (id: string) => {
    const w = await base.workspace(id); w.findings[0].part_ids = ["cabin" as never]; return w;
  } };
  const user = userEvent.setup(); render(<App api={api} />);
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf")); await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Create run" })); await screen.findByText("proposals_ready");
  const group = screen.getByRole("region", { name: "Unmapped or non-geometric findings" });
  await user.click(within(group).getByRole("button", { name: /Comfort controls/ }));
  expect(screen.getAllByText(/No spatial part selected/).length).toBeGreaterThan(0);
});


it("treats finding IDs as opaque even when resembling old UI sentinel IDs", async () => {
  const base = createMockApi(); const api = { ...base, workspace: async (id: string) => { const w = await base.workspace(id); w.findings[0].finding_id = "unreported-real-finding"; return w; } };
  const user = userEvent.setup(); render(<App api={api} />);
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf")); await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Create run" })); await screen.findByText("proposals_ready");
  await user.click(screen.getByRole("button", { name: /Comfort controls.*172 of 400/ }));
  expect(screen.getByRole("heading", { name: "Comfort controls" })).toBeInTheDocument();
});


it("preserves selected finding when several findings map to one component", async () => {
  const base = createMockApi(); const api = { ...base, workspace: async (id: string) => {
    const w = await base.workspace(id); w.findings.push({ ...w.findings[1], finding_id: "body-other", title: "Chosen body finding" }); return w;
  } };
  const user = userEvent.setup(); render(<App api={api} />);
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf")); await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Create run" })); await screen.findByText("proposals_ready");
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
  await user.click(screen.getByRole("button", { name: "Create run" })); await screen.findByText("proposals_ready");
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

it("keeps findings usable during research failure and retries retrieval without changing uploaded counts", async () => {
  const base = createMockApi(); let failed = true;
  const api = { ...base, workspace: async (id: string) => { const w = await base.workspace(id); if (failed) { w.research = []; return { ...w, resourceErrors: { research: "Research temporarily unavailable" } }; } return w; } };
  const user = userEvent.setup(); render(<App api={api} />);
  await user.click(screen.getByRole("checkbox", { name: "Deep Dive" }));
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf")); await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Create run" })); await screen.findByText("proposals_ready");
  await user.click(screen.getByRole("button", { name: /Comfort controls.*172 of 400/ }));
  expect(screen.getByText("Research temporarily unavailable")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Comfort controls" })).toBeInTheDocument();
  failed = false; await user.click(screen.getByRole("button", { name: /Retry research/ }));
  await screen.findByText(/Owner sample unavailable/);
  expect(screen.getAllByText(/172 of 400 negative feedback records/).length).toBeGreaterThan(0);
});

it("never asks autonomous runs to continue unexpected backend checkpoints", async () => {
  const base = createMockApi();
  const api = { ...base, workspace: async (id: string) => {
    const w = await base.workspace(id); return { ...w, checkpoint: { checkpoint_id: "unexpected", version: 7, question: "Unexpected PM request", alternatives: [{ id: "continue", title: "Continue", tradeoff: "Server issue" }] }, conflicts: { conflicts: [], checkpoints: [{ checkpoint_id: "unexpected", version: 7, allowed_actions: ["continue"], conflict_ids: [], wait_state: "waiting" as const }] } };
  } };
  const user = userEvent.setup(); render(<App api={api} />);
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf")); await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Create run" })); await screen.findByText("proposals_ready");
  expect(screen.queryByRole("button", { name: /Choose approach|Continue checkpoint|Submit checkpoint/ })).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Autonomous" })).toBeChecked();
});


it("discards late research refresh after New run", async () => {
  const base = createMockApi(); let paused = false; let release!: () => void; let started = false;
  const api = { ...base, workspace: async (id: string) => {
    const w = await base.workspace(id);
    if (paused) { started = true; await new Promise<void>(resolve => { release = resolve; }); }
    return { ...w, research: [], resourceErrors: { research: "Research offline" } };
  } };
  const user = userEvent.setup(); render(<App api={api} />);
  await user.click(screen.getByRole("checkbox", { name: "Deep Dive" }));
  await user.upload(screen.getByLabelText("Upload files"), new File(["f"], "f.pdf")); await screen.findByText("ready");
  await user.click(screen.getByRole("button", { name: "Create run" })); await screen.findByText("proposals_ready");
  await user.click(screen.getByRole("button", { name: /Comfort controls.*172 of 400/ }));
  paused = true; await user.click(screen.getByRole("button", { name: /Retry research/ })); await waitFor(() => expect(started).toBe(true));
  await user.click(screen.getByRole("button", { name: "New run" }));
  release(); await waitFor(() => expect(screen.queryByText("proposals_ready")).not.toBeInTheDocument());
  expect(screen.getByRole("heading", { name: "New analysis run" })).toBeInTheDocument();
  expect(screen.getByText("No analysis run yet.")).toBeInTheDocument();
});
