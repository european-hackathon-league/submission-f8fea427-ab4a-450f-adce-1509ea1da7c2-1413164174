import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import ConflictPanel from "./ConflictPanel";
import { ApiError } from "../api/client";
import type { Api, Workspace } from "../api/contracts";
import type * as Wire from "../api/wire";
import * as normalize from "../api/normalize";
import scenarios from "../../fixtures/scenarios.json";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
function workspace(): Workspace {
  const payloads = structuredClone(scenarios.guided_conflict.payloads);
  const proposals = normalize.proposals(
    payloads.Proposals as unknown as Wire.Proposals,
  );
  proposals.variants = [
    {
      ...proposals.variants[0],
      variant_id: "variant_us",
      title: "US approach",
      cohort_scope: ["cohort_us"],
      wire: {
        ...proposals.variants[0].wire!,
        variant_id: "variant_us",
        cohort_ids: ["cohort_us"],
        related_variant_ids: ["variant_de"],
      },
    },
    {
      ...proposals.variants[0],
      variant_id: "variant_de",
      title: "DE approach",
      cohort_scope: ["cohort_de"],
      wire: {
        ...proposals.variants[0].wire!,
        variant_id: "variant_de",
        cohort_ids: ["cohort_de"],
        related_variant_ids: ["variant_us"],
      },
    },
  ];
  return {
    snapshot: normalize.snapshot(payloads.Snapshot as Wire.Snapshot),
    conflicts: payloads.Conflicts as Wire.Conflicts,
    checkpoint: null,
    proposals,
    findings: payloads.FindingsPage.items.map((item) =>
      normalize.finding(item as unknown as Wire.Finding),
    ),
    graph: { nodes: [], edges: [] },
    research: [],
    history: [],
  };
}
function api(request: (...args: any[]) => Promise<any>): Api {
  return { mode: "real", request } as Api;
}

it("shows authoritative alternatives, unresolved conflicts and scope in autonomous mode without decisions", () => {
  const w = workspace();
  w.snapshot.config.participation_mode = "autonomous";
  render(
    <ConflictPanel
      api={api(vi.fn())}
      workspace={w}
      onRefresh={async () => w}
    />,
  );
  expect(
    screen.getByRole("region", { name: "Conflicts and alternatives" }),
  ).toHaveTextContent("Preserve opposing customer cohort needs");
  expect(screen.getByText(/US.*cohort_us/)).toBeInTheDocument();
  expect(screen.getByText(/Related variants: variant_de/)).toBeInTheDocument();
  expect(screen.getByText(/may overlap/)).toBeInTheDocument();
  expect(screen.getByText(/Variant limit not supplied/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Continue checkpoint/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});
it("submits known variant/cohort assignments against exact opaque checkpoint ID and version", async () => {
  const user = userEvent.setup();
  const w = workspace();
  w.conflicts!.checkpoints[0].checkpoint_id = "cp/opaque?1";
  const sent = vi.fn(async (_path: string, _body?: unknown, _key?: string) => ({
    command_id: "command",
    resource_id: "cp/opaque?1",
    resource_url: "/accepted",
  }));
  render(
    <ConflictPanel api={api(sent)} workspace={w} onRefresh={async () => w} />,
  );
  await user.selectOptions(
    screen.getByLabelText("Resolution for cp/opaque?1"),
    "regroup_variants",
  );
  const de = screen.getByRole("group", { name: "Cohorts for variant_de" });
  await user.click(within(de).getByRole("checkbox", { name: "cohort_us" }));
  await user.click(
    screen.getByRole("button", { name: "Continue checkpoint cp/opaque?1" }),
  );
  expect(sent).toHaveBeenCalledWith(
    "/runs/run_demo/checkpoints/cp%2Fopaque%3F1/continue",
    {
      checkpoint_version: 1,
      resolution: "regroup_variants",
      cohort_assignments: {
        variant_us: ["cohort_us"],
        variant_de: ["cohort_de", "cohort_us"],
      },
    },
    expect.any(String),
  );
  expect(screen.getByRole("status")).toHaveTextContent(/Continuation accepted/);
  expect(
    screen.getByRole("button", { name: "Continue checkpoint cp/opaque?1" }),
  ).toBeDisabled();
});
it("retains stale draft and requires explicit reconciliation with refreshed checkpoint", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const next = structuredClone(w);
  next.conflicts!.checkpoints[0].version = 2;
  let calls = 0;
  const sent = vi.fn(async (_path: string, _body?: unknown, _key?: string) => {
    if (++calls === 1)
      throw new ApiError("stale_checkpoint", "Question changed", 2, 409);
    return { command_id: "accepted" };
  });
  const refresh = vi.fn(async () => next);
  const props = { api: api(sent), onRefresh: refresh };
  const { rerender } = render(<ConflictPanel {...props} workspace={w} />);
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  await user.click(
    within(
      screen.getByRole("group", { name: "Cohorts for variant_de" }),
    ).getByRole("checkbox", { name: "cohort_us" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  );
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  rerender(<ConflictPanel {...props} workspace={next} />);
  expect(screen.getByLabelText("Resolution for checkpoint_demo")).toHaveValue(
    "regroup_variants",
  );
  expect(
    within(
      screen.getByRole("group", { name: "Cohorts for variant_de" }),
    ).getByRole("checkbox", { name: "cohort_us" }),
  ).toBeChecked();
  expect(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Reconcile with checkpoint version 2" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  );
  expect(sent.mock.calls[1][1]).toMatchObject({ checkpoint_version: 2 });
});
it("shows every actual checkpoint, waits for backend continued state and honors action gates", async () => {
  const user = userEvent.setup();
  const w = workspace();
  w.conflicts!.checkpoints.push({
    ...w.conflicts!.checkpoints[0],
    checkpoint_id: "second",
    wait_state: "continued",
  });
  w.snapshot.available_actions = [];
  const { rerender } = render(
    <ConflictPanel
      api={api(vi.fn())}
      workspace={w}
      onRefresh={async () => w}
    />,
  );
  expect(
    screen.getByRole("region", { name: "Checkpoint second" }),
  ).toHaveTextContent("continued");
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  expect(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  ).toBeDisabled();
  const changed = structuredClone(w);
  changed.snapshot.available_actions = ["continue_checkpoint"];
  changed.conflicts!.checkpoints[1].wait_state = "waiting";
  rerender(
    <ConflictPanel
      api={api(vi.fn())}
      workspace={changed}
      onRefresh={async () => changed}
    />,
  );
  expect(
    screen.getAllByRole("button", { name: /Continue checkpoint/ }),
  ).toHaveLength(2);
});
it("blocks duplicate submission and retries an interrupted command with the same idempotency key", async () => {
  const user = userEvent.setup();
  const w = workspace();
  let fail!: (reason: unknown) => void;
  const sent = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    )
    .mockResolvedValue({ command_id: "ok" });
  render(
    <ConflictPanel api={api(sent)} workspace={w} onRefresh={async () => w} />,
  );
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  const button = screen.getByRole("button", {
    name: "Continue checkpoint checkpoint_demo",
  });
  await user.dblClick(button);
  expect(sent).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  await act(async () => fail(new TypeError("Connection interrupted")));
  expect(screen.getByRole("alert")).toHaveTextContent("Connection interrupted");
  expect(
    screen.getByLabelText("Resolution for checkpoint_demo"),
  ).toBeDisabled();
  await user.click(button);
  expect(sent.mock.calls[1]).toEqual(sent.mock.calls[0]);
});
it("keeps accepted continuation locked when refresh fails and retries only refresh", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const sent = vi.fn(async (_path: string, _body?: unknown, _key?: string) => ({
    command_id: "ok",
  }));
  const refresh = vi
    .fn()
    .mockRejectedValueOnce(new Error("Snapshot offline"))
    .mockResolvedValue(w);
  render(<ConflictPanel api={api(sent)} workspace={w} onRefresh={refresh} />);
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  await user.click(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Snapshot offline",
  );
  await user.click(
    screen.getByRole("button", { name: "Refresh checkpoint checkpoint_demo" }),
  );
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(sent).toHaveBeenCalledTimes(1);
});

it("retains a draft for a removed checkpoint while preventing submission to a different question", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const sent = vi.fn(async () => ({ command_id: "ok" }));
  const props = { api: api(sent), onRefresh: async () => w };
  const { rerender } = render(<ConflictPanel {...props} workspace={w} />);
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  const next = structuredClone(w);
  next.conflicts!.checkpoints = [
    { ...next.conflicts!.checkpoints[0], checkpoint_id: "replacement" },
  ];
  rerender(<ConflictPanel {...props} workspace={next} />);
  const previous = screen.getByRole("region", {
    name: "Checkpoint checkpoint_demo",
  });
  expect(previous).toHaveTextContent("Draft resolution: regroup_variants");
  expect(previous).toHaveTextContent(/absent from current backend snapshot/);
  expect(
    within(previous).getByRole("button", {
      name: "Continue checkpoint checkpoint_demo",
    }),
  ).toBeDisabled();
  expect(screen.getByLabelText("Resolution for replacement")).toHaveValue("");
  expect(sent).not.toHaveBeenCalled();
});
it("exposes retained unknown cohort IDs until explicit reconciliation removes them", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const props = { api: api(vi.fn()), onRefresh: async () => w };
  const { rerender } = render(<ConflictPanel {...props} workspace={w} />);
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  const next = structuredClone(w);
  next.conflicts!.checkpoints[0].version = 2;
  next.conflicts!.conflicts[0].alternatives = [];
  next.findings = [];
  next.proposals.variants[0].cohort_scope = [];
  rerender(<ConflictPanel {...props} workspace={next} />);
  expect(
    screen.getByText(/Draft cohort assignments:.*cohort_us/),
  ).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    /absent from current results/,
  );
  await user.click(
    screen.getByRole("button", { name: "Reconcile with checkpoint version 2" }),
  );
  expect(screen.getByText(/Draft cohort assignments:/)).not.toHaveTextContent(
    "cohort_us",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("does not refresh or notify a replacement workspace after the panel unmounts during continuation", async () => {
  const user = userEvent.setup();
  const w = workspace();
  let finish!: (value: unknown) => void;
  const refresh = vi.fn(async () => w);
  const changed = vi.fn();
  const { unmount } = render(
    <ConflictPanel
      api={api(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )}
      workspace={w}
      onRefresh={refresh}
      onChanged={changed}
    />,
  );
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  await user.click(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  );
  unmount();
  await act(async () => finish({ command_id: "ok" }));
  expect(refresh).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});
it("moves focus to checkpoint status when accepted continuation removes its controls", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const props = {
    api: api(async () => ({ command_id: "ok" })),
    onRefresh: async () => w,
  };
  const { rerender } = render(<ConflictPanel {...props} workspace={w} />);
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  await user.click(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  );
  const next = structuredClone(w);
  next.conflicts!.checkpoints[0].wait_state = "continued";
  rerender(<ConflictPanel {...props} workspace={next} />);
  expect(
    screen.getByRole("heading", { name: "Checkpoint checkpoint_demo" }),
  ).toHaveFocus();
});
it("retains editable draft on definitive rejection and shows structured field failures", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const failure = new ApiError(
    "invalid_assignment",
    "Review cohorts",
    null,
    422,
    false,
    [
      {
        field: "cohort_assignments.variant_us",
        message: "Scope not permitted",
      },
    ],
  );
  render(
    <ConflictPanel
      api={api(async () => {
        throw failure;
      })}
      workspace={w}
      onRefresh={async () => w}
    />,
  );
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  await user.click(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "cohort_assignments.variant_us",
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Scope not permitted");
  expect(screen.getByLabelText("Resolution for checkpoint_demo")).toBeEnabled();
  expect(screen.getByLabelText("Resolution for checkpoint_demo")).toHaveValue(
    "regroup_variants",
  );
});
it("allows plain continuation when obsolete cohort assignments are irrelevant to that resolution", async () => {
  const user = userEvent.setup();
  const w = workspace();
  w.conflicts!.checkpoints[0].allowed_actions = [
    "continue",
    "regroup_variants",
  ];
  const sent = vi.fn(async (_path: string, _body?: unknown, _key?: string) => ({
    command_id: "ok",
  }));
  const props = { api: api(sent), onRefresh: async () => w };
  const { rerender } = render(<ConflictPanel {...props} workspace={w} />);
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  const next = structuredClone(w);
  next.proposals.variants = next.proposals.variants.slice(1);
  next.findings = [];
  next.conflicts!.conflicts[0].alternatives = [];
  rerender(<ConflictPanel {...props} workspace={next} />);
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "continue",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  );
  expect(sent).toHaveBeenCalledWith(
    "/runs/run_demo/checkpoints/checkpoint_demo/continue",
    { checkpoint_version: 1, resolution: "continue" },
    expect.any(String),
  );
});

it("restores a real-mode draft after reload and requires reconciliation with a newer actual checkpoint", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const props = {
    api: api(async () => ({ command_id: "ok" })),
    onRefresh: async () => w,
  };
  const { unmount } = render(<ConflictPanel {...props} workspace={w} />);
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  await user.click(
    within(
      screen.getByRole("group", { name: "Cohorts for variant_de" }),
    ).getByRole("checkbox", { name: "cohort_us" }),
  );
  unmount();
  const next = structuredClone(w);
  next.conflicts!.checkpoints[0].version = 2;
  render(<ConflictPanel {...props} workspace={next} />);
  expect(screen.getByLabelText("Resolution for checkpoint_demo")).toHaveValue(
    "regroup_variants",
  );
  expect(
    within(
      screen.getByRole("group", { name: "Cohorts for variant_de" }),
    ).getByRole("checkbox", { name: "cohort_us" }),
  ).toBeChecked();
  expect(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Reconcile with checkpoint version 2" }),
  ).toBeEnabled();
});
it("restores the same uncertain command key and body after real-mode reload", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const sent = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Interrupted"))
    .mockResolvedValue({ command_id: "ok" });
  const props = { api: api(sent), workspace: w, onRefresh: async () => w };
  const { unmount } = render(<ConflictPanel {...props} />);
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  await user.click(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  );
  await screen.findByRole("alert");
  unmount();
  render(<ConflictPanel {...props} />);
  expect(
    screen.getByLabelText("Resolution for checkpoint_demo"),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  );
  expect(sent.mock.calls[1]).toEqual(sent.mock.calls[0]);
});
it("keeps an accepted continuation locked across reload until backend updates its state", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const sent = vi.fn(async () => ({ command_id: "ok" }));
  const props = { api: api(sent), workspace: w, onRefresh: async () => w };
  const { unmount } = render(<ConflictPanel {...props} />);
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  await user.click(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  );
  unmount();
  render(<ConflictPanel {...props} />);
  expect(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  ).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(/Waiting for backend/);
  expect(sent).toHaveBeenCalledTimes(1);
});
it("isolates drafts by API namespace, run and checkpoint identity", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const a = { ...api(vi.fn()), sessionNamespace: "tenant-a" };
  const { unmount } = render(
    <ConflictPanel api={a} workspace={w} onRefresh={async () => w} />,
  );
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  unmount();
  const other = structuredClone(w);
  other.snapshot.run_id = "other-run";
  const { unmount: second } = render(
    <ConflictPanel api={a} workspace={other} onRefresh={async () => other} />,
  );
  expect(screen.getByLabelText("Resolution for checkpoint_demo")).toHaveValue(
    "",
  );
  second();
  render(
    <ConflictPanel
      api={{ ...a, sessionNamespace: "tenant-b" }}
      workspace={w}
      onRefresh={async () => w}
    />,
  );
  expect(screen.getByLabelText("Resolution for checkpoint_demo")).toHaveValue(
    "",
  );
});
it("ignores malformed stored checkpoint state and works when session storage is unavailable", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const props = { api: api(vi.fn()), workspace: w, onRefresh: async () => w };
  const { unmount } = render(<ConflictPanel {...props} />);
  unmount();
  expect(sessionStorage.length).toBeGreaterThan(0);
  const key = sessionStorage.key(0)!;
  sessionStorage.setItem(
    key,
    JSON.stringify({
      draft: { version: "1", resolution: "continue", assignments: {} },
      command: {
        key: "wrong",
        body: { checkpoint_version: 99, resolution: "other" },
      },
    }),
  );
  const { unmount: second } = render(<ConflictPanel {...props} />);
  expect(screen.getByLabelText("Resolution for checkpoint_demo")).toHaveValue(
    "",
  );
  second();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage disabled");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage disabled");
  });
  render(<ConflictPanel {...props} />);
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  expect(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  ).toBeEnabled();
});
it("never persists mock-mode checkpoint drafts as real session data", async () => {
  const user = userEvent.setup();
  const w = workspace();
  render(
    <ConflictPanel
      api={{ ...api(vi.fn()), mode: "mock" }}
      workspace={w}
      onRefresh={async () => w}
    />,
  );
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  expect(sessionStorage.length).toBe(0);
});
it("allows clearing all existing cohort scopes without inventing an all-cohorts assignment", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const sent = vi.fn(async (_path: string, _body?: unknown, _key?: string) => ({
    command_id: "ok",
  }));
  render(
    <ConflictPanel api={api(sent)} workspace={w} onRefresh={async () => w} />,
  );
  await user.selectOptions(
    screen.getByLabelText("Resolution for checkpoint_demo"),
    "regroup_variants",
  );
  await user.click(
    within(
      screen.getByRole("group", { name: "Cohorts for variant_us" }),
    ).getByRole("checkbox", { name: "cohort_us" }),
  );
  await user.click(
    within(
      screen.getByRole("group", { name: "Cohorts for variant_de" }),
    ).getByRole("checkbox", { name: "cohort_de" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Continue checkpoint checkpoint_demo" }),
  );
  expect(sent).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Draft cohort assignments:/)).toHaveTextContent(
    "No cohorts assigned",
  );
  expect(sent).toHaveBeenCalledWith(
    "/runs/run_demo/checkpoints/checkpoint_demo/continue",
    {
      checkpoint_version: 1,
      resolution: "regroup_variants",
      cohort_assignments: { variant_us: [], variant_de: [] },
    },
    expect.any(String),
  );
});
