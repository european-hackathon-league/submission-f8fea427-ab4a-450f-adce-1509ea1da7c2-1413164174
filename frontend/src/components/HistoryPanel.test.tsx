import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HistoryPanel from "./HistoryPanel";
import { ApiError } from "../api/client";
import * as normalize from "../api/normalize";
import type { Api, Workspace, ProposalSet } from "../api/contracts";
import type * as Wire from "../api/wire";
import scenarios from "../../fixtures/scenarios.json";
const data = scenarios.versioned_export.payloads;
function proposal(version = 1): ProposalSet {
  return normalize.proposals({
    ...structuredClone(data.Proposals),
    proposal_set_version: version,
  } as Wire.Proposals);
}
function workspace(): Workspace {
  return {
    snapshot: normalize.snapshot(data.Snapshot as Wire.Snapshot),
    proposals: proposal(),
    findings: [],
    graph: { nodes: [], edges: [] },
    research: [],
    checkpoint: null,
    history: [],
  };
}
function api(
  request: ReturnType<typeof vi.fn>,
  mode: "mock" | "real" = "mock",
): Api {
  return {
    mode,
    sessionNamespace: "api/workspace",
    request: request as Api["request"],
    upload: vi.fn(),
    workspace: vi.fn(),
  };
}
const jobResult = (
  status: Wire.ExportResult["status"] = "ready",
): Wire.ExportResult => ({
  ...structuredClone(data.ExportResult),
  export_id: "export/opaque",
  status,
  download_url:
    status === "ready" ? "https://cdn.example.test/authorized" : null,
});
const props = (request: ReturnType<typeof vi.fn>, w = workspace()) => ({
  api: api(request),
  workspace: w,
  variantId: "variant_demo",
  onRefresh: async () => w,
  onOpen: vi.fn(),
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
});
it("loads exact immutable server versions identified by audit rather than browser-owned history", async () => {
  const w = workspace();
  w.snapshot.current_proposal_set_version = 2;
  w.proposals = proposal(2);
  w.history = [
    {
      event_id: "a",
      actor: "pm",
      description: "PM selection, no approval",
      occurred_at: "2026-10-10T10:00:00Z",
      proposal_set_version: 1,
    },
  ];
  const request = vi.fn(async (path: string) =>
    proposal(
      Number(
        new URL(path, "http://app").searchParams.get("proposal_set_version"),
      ),
    ),
  );
  render(<HistoryPanel {...props(request, w)} />);
  await screen.findByText("Immutable proposal version 2");
  fireEvent.change(screen.getByLabelText("Inspect proposal version"), {
    target: { value: "1" },
  });
  await screen.findByText("Immutable proposal version 1");
  expect(request).toHaveBeenCalledWith(
    "/runs/run_demo/proposals?proposal_set_version=1",
    undefined,
    undefined,
    expect.any(AbortSignal),
  );
  expect(screen.getByText(/PM selection, no approval/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Proposal text")).not.toBeInTheDocument();
});
it("includes published revisions without decision audit entries", async () => {
  const w = workspace();
  w.snapshot.current_proposal_set_version = 7;
  w.proposals = proposal(7);
  w.history = [
    {
      event_id: "decision",
      actor: "pm",
      description: "Approved proposal version 4",
      occurred_at: "2026-10-10T10:00:00Z",
      proposal_set_version: 4,
    },
  ];
  const request = vi.fn(async (path: string) =>
    proposal(Number(new URL(path, "http://app").searchParams.get("proposal_set_version"))),
  );
  render(<HistoryPanel {...props(request, w)} />);
  await screen.findByText("Immutable proposal version 7");
  const selector = screen.getByLabelText("Inspect proposal version") as HTMLSelectElement;
  expect([...selector.options].map(option => option.value)).toEqual(["7", "6", "5", "4", "3", "2", "1"]);
  fireEvent.change(selector, { target: { value: "6" } });
  await screen.findByText("Immutable proposal version 6");
  expect(request).toHaveBeenCalledWith(
    "/runs/run_demo/proposals?proposal_set_version=6",
    undefined,
    undefined,
    expect.any(AbortSignal),
  );
});
it("withholds inspection and export when response run or version mismatches selection", async () => {
  const wrong = proposal(9);
  const request = vi.fn(async () => wrong);
  render(<HistoryPanel {...props(request)} />);
  await screen.findByRole("alert");
  expect(
    screen.getByRole("button", { name: "Request exact-version export" }),
  ).toBeDisabled();
  expect(
    screen.queryByText(/Immutable proposal version/),
  ).not.toBeInTheDocument();
});
it("requests authoritative exact-version export and polls queued/processing/ready without duplicate POST", async () => {
  vi.useFakeTimers();
  let reads = 0;
  const request = vi.fn(async (path: string, body?: unknown, _key?: string) => {
    if (path.includes("/proposals")) return proposal();
    if (body)
      return {
        command_id: "c",
        resource_id: "export/opaque",
        resource_url: "/api/v1/runs/run_demo/exports/export%2Fopaque",
      };
    const result = jobResult(
      (["queued", "processing", "ready"] as const)[Math.min(reads++, 2)],
    );
    result.manifest.format = "xlsx";
    return result;
  });
  render(<HistoryPanel {...props(request)} />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Export format"), {
    target: { value: "xlsx" },
  });
  const button = screen.getByRole("button", {
    name: "Request exact-version export",
  });
  fireEvent.click(button);
  fireEvent.click(button);
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(request.mock.calls.filter((c) => c[1] !== undefined)).toHaveLength(1);
  expect(request).toHaveBeenCalledWith(
    "/runs/run_demo/exports",
    { proposal_set_version: 1, variant_ids: ["variant_demo"], format: "xlsx" },
    expect.any(String),
  );
  expect(
    screen.getByRole("link", { name: "Download authorized export" }),
  ).toHaveAttribute("href", "https://cdn.example.test/authorized");
});
it("retains accepted export identity after GET failure and retries GET without another POST", async () => {
  const request = vi.fn(async (path: string, body?: unknown, _key?: string) => {
    if (path.includes("/proposals")) return proposal();
    if (body)
      return {
        command_id: "c",
        resource_id: "export/opaque",
        resource_url: "/api/v1/runs/run_demo/exports/export%2Fopaque",
      };
    throw new ApiError(
      "network_error",
      "Export resource interrupted",
      null,
      null,
      true,
    );
  });
  render(<HistoryPanel {...props(request)} />);
  await screen.findByText("Immutable proposal version 1");
  fireEvent.click(
    screen.getByRole("button", { name: "Request exact-version export" }),
  );
  await screen.findByText("Export resource interrupted");
  fireEvent.click(
    screen.getByRole("button", { name: "Retry export retrieval" }),
  );
  await waitFor(() =>
    expect(
      request.mock.calls.filter(
        (c) => c[0].includes("/exports/") && c[1] === undefined,
      ),
    ).toHaveLength(2),
  );
  expect(request.mock.calls.filter((c) => c[1] !== undefined)).toHaveLength(1);
});
it.each([null, 500])(
  "retries uncertain submission using same key/body and freezes inputs (status %s)",
  async (status) => {
    const request = vi.fn(
      async (path: string, body?: unknown, _key?: string) => {
        if (path.includes("/proposals")) return proposal();
        if (body)
          throw new ApiError(
            "network_error",
            "Outcome uncertain",
            null,
            status,
            status === null,
          );
        return jobResult();
      },
    );
    render(<HistoryPanel {...props(request)} />);
    await screen.findByText("Immutable proposal version 1");
    fireEvent.click(
      screen.getByRole("button", { name: "Request exact-version export" }),
    );
    await screen.findByText("Outcome uncertain");
    expect(screen.getByLabelText("Export format")).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry original export request" }),
    );
    await waitFor(() =>
      expect(request.mock.calls.filter((c) => c[1] !== undefined)).toHaveLength(
        2,
      ),
    );
    const commands = request.mock.calls.filter((c) => c[1] !== undefined);
    expect(commands[0]).toEqual(commands[1]);
  },
);
it("withholds download on mismatched manifest and offers retrieval recovery", async () => {
  const request = vi.fn(async (path: string, body?: unknown, _key?: string) =>
    path.includes("/proposals")
      ? proposal()
      : body
        ? {
            command_id: "c",
            resource_id: "export/opaque",
            resource_url: "unused",
          }
        : {
            ...jobResult(),
            manifest: { ...jobResult().manifest, proposal_set_version: 3 },
          },
  );
  render(<HistoryPanel {...props(request)} />);
  await screen.findByText("Immutable proposal version 1");
  fireEvent.click(
    screen.getByRole("button", { name: "Request exact-version export" }),
  );
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("link", { name: "Download authorized export" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Retry export retrieval" }),
  ).toBeInTheDocument();
});
it("resumes accepted real-mode job after remount through GET only", async () => {
  const request = vi.fn(async (path: string, body?: unknown, _key?: string) =>
    path.includes("/proposals")
      ? proposal()
      : body
        ? {
            command_id: "c",
            resource_id: "export/opaque",
            resource_url: "unused",
          }
        : jobResult("processing"),
  );
  const p = { ...props(request), api: api(request, "real") };
  const mounted = render(<HistoryPanel {...p} />);
  await screen.findByText("Immutable proposal version 1");
  fireEvent.click(
    screen.getByRole("button", { name: "Request exact-version export" }),
  );
  await screen.findByText(/Export processing/);
  mounted.unmount();
  request.mockClear();
  render(<HistoryPanel {...p} />);
  await screen.findByText(/Export processing/);
  expect(request.mock.calls.every((c) => c[1] === undefined)).toBe(true);
});
it("ignores stale version responses and focuses the newly selected immutable inspection", async () => {
  let resolveOld!: (value: ProposalSet) => void;
  const old = new Promise<ProposalSet>((resolve) => {
    resolveOld = resolve;
  });
  const w = workspace();
  w.history = [
    {
      event_id: "a",
      actor: "service",
      description: "Version published",
      occurred_at: "2026-10-10T10:00:00Z",
      proposal_set_version: 2,
    },
  ];
  const request = vi.fn((path: string) =>
    path.endsWith("=1") ? old : Promise.resolve(proposal(2)),
  );
  render(<HistoryPanel {...props(request, w)} />);
  fireEvent.change(screen.getByLabelText("Inspect proposal version"), {
    target: { value: "2" },
  });
  const heading = await screen.findByText("Immutable proposal version 2");
  expect(heading).toHaveFocus();
  await act(async () => resolveOld(proposal(1)));
  expect(
    screen.queryByText("Immutable proposal version 1"),
  ).not.toBeInTheDocument();
});
it("aborts polling cleanup and ignores late old-job completion", async () => {
  vi.useFakeTimers();
  let resolveJob!: (value: Wire.ExportResult) => void;
  const request = vi.fn((path: string, body?: unknown) =>
    Promise.resolve(
      path.includes("/proposals")
        ? proposal()
        : body
          ? {
              command_id: "c",
              resource_id: "export/opaque",
              resource_url: "unused",
            }
          : new Promise<Wire.ExportResult>((resolve) => {
              resolveJob = resolve;
            }),
    ),
  );
  const view = render(<HistoryPanel {...props(request)} />);
  await act(async () => {});
  fireEvent.click(
    screen.getByRole("button", { name: "Request exact-version export" }),
  );
  await act(async () => {});
  const read = request.mock.calls.find((c) => c[0].includes("/exports/"));
  expect(read).toBeDefined();
  view.unmount();
  expect(
    (read as unknown as [string, unknown, unknown, AbortSignal])[3].aborted,
  ).toBe(true);
  await act(async () => resolveJob(jobResult()));
  await vi.advanceTimersByTimeAsync(5000);
  expect(
    request.mock.calls.filter((c) => c[0].includes("/exports/")),
  ).toHaveLength(1);
});
it("shows failed export and permits a distinct new command while never inventing a retry endpoint", async () => {
  const request = vi.fn(async (path: string, body?: unknown, _key?: string) =>
    path.includes("/proposals")
      ? proposal()
      : body
        ? {
            command_id: "c",
            resource_id: "export/opaque",
            resource_url: "unused",
          }
        : jobResult("failed"),
  );
  render(<HistoryPanel {...props(request)} />);
  await screen.findByText("Immutable proposal version 1");
  fireEvent.click(
    screen.getByRole("button", { name: "Request exact-version export" }),
  );
  await screen.findByText(/Export failed/);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare another export" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Request exact-version export" }),
  );
  await waitFor(() =>
    expect(request.mock.calls.filter((c) => c[1] !== undefined)).toHaveLength(
      2,
    ),
  );
  const commands = request.mock.calls.filter((c) => c[1] !== undefined);
  expect(commands[0][2]).not.toBe(commands[1][2]);
  expect(commands.every((c) => !c[0].includes("/retry"))).toBe(true);
});
it.each([false, true])(
  "retains unknown and accepted export jobs through same-API remount without storage (accepted: %s)",
  async (accepted) => {
    const request = vi.fn(
      async (path: string, body?: unknown, _key?: string) => {
        if (path.includes("/proposals")) return proposal();
        if (body) {
          if (accepted)
            return {
              command_id: "c",
              resource_id: "export/opaque",
              resource_url: "unused",
            };
          throw new ApiError("network_error", "Uncertain", null, null, true);
        }
        return jobResult("processing");
      },
    );
    const p = props(request);
    const view = render(<HistoryPanel {...p} />);
    await screen.findByText("Immutable proposal version 1");
    fireEvent.click(
      screen.getByRole("button", { name: "Request exact-version export" }),
    );
    await screen.findByText(accepted ? /Export processing/ : "Uncertain");
    const first = request.mock.calls.find((c) => c[1] !== undefined);
    view.unmount();
    request.mockClear();
    render(<HistoryPanel {...p} />);
    if (accepted) {
      await screen.findByText(/Export processing/);
      expect(request.mock.calls.every((c) => c[1] === undefined)).toBe(true);
    } else {
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Retry original export request",
        }),
      );
      await waitFor(() =>
        expect(request.mock.calls.some((c) => c[1] !== undefined)).toBe(true),
      );
      expect(request.mock.calls.find((c) => c[1] !== undefined)).toEqual(first);
    }
  },
);
it("retrieves protected API-returned export bytes after exact manifest verification and retries without resubmitting", async () => {
  const returned = "/api/v1/runs/run_demo/exports/export%2Fopaque/download";
  const request = vi.fn(async (path: string, body?: unknown) =>
    path.includes("/proposals")
      ? proposal()
      : body
        ? {
            command_id: "c",
            resource_id: "export/opaque",
            resource_url: "unused",
          }
        : { ...jobResult(), download_url: returned },
  );
  const p = props(request);
  p.api.mode = "real";
  p.api.canReadAsset = (link) => link === returned;
  const bytes = new Blob(["authoritative immutable JSON"]);
  const read = vi
    .fn()
    .mockRejectedValueOnce(
      new ApiError("forbidden", "Download access denied", null, 403),
    )
    .mockResolvedValueOnce(bytes);
  p.api.readAsset = read;
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:exact-export");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const view = render(<HistoryPanel {...p} />);
  try {
    await screen.findByText("Immutable proposal version 1");
    fireEvent.click(
      screen.getByRole("button", { name: "Request exact-version export" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Download access denied",
    );
    expect(
      screen.queryByRole("link", { name: "Download authorized export" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry authorized export download" }),
    );
    const link = await screen.findByRole("link", {
      name: "Download authorized export",
    });
    expect(link).toHaveAttribute("href", "blob:exact-export");
    expect(create).toHaveBeenCalledWith(bytes);
    expect(read).toHaveBeenLastCalledWith(returned, expect.any(AbortSignal));
    expect(
      request.mock.calls.filter((call) => call[1] !== undefined),
    ).toHaveLength(1);
    view.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:exact-export");
  } finally {
    view.unmount();
    create.mockRestore();
    revoke.mockRestore();
  }
});
