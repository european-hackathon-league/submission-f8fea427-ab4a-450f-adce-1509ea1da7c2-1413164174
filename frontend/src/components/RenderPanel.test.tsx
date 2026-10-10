import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import RenderPanel from "./RenderPanel";
import type { Api, Workspace } from "../api/contracts";
import type * as Wire from "../api/wire";
import * as normalize from "../api/normalize";
import { proposals, findings, research, evidence } from "../api/fixtures";
import scenarios from "../../fixtures/scenarios.json";
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function workspace(version = 1): Workspace {
  const snapshot = normalize.snapshot(
    scenarios.standard_autonomous.payloads.Snapshot as unknown as Wire.Snapshot,
  );
  snapshot.run_id = "run-synthetic";
  snapshot.config.baseline_asset_id = "baseline";
  snapshot.config.part_catalog_version = "catalog";
  snapshot.available_actions = ["reimagine"];
  snapshot.current_proposal_set_version = version;
  const proposal = structuredClone(proposals);
  proposal.proposal_set_version = version;
  proposal.wire!.proposal_set_version = version;
  return {
    snapshot,
    proposals: proposal,
    findings,
    research,
    graph: { nodes: [], edges: [] },
    checkpoint: null,
    history: [],
  };
}
function result(
  id = "job-1",
  version = 1,
  status: Wire.RenderResult["status"] = "succeeded",
) {
  return normalize.render({
    render_request_id: id,
    proposal_set_version: version,
    variant_ids: ["variant-digital"],
    baseline_asset_id: "baseline",
    part_catalog_version: "catalog",
    status,
    assets: [
      {
        asset_id: `asset-${version}`,
        url: `https://assets.example/v${version}.png`,
        media_type: "image/png",
      },
      {
        asset_id: "unbound",
        url: "https://assets.example/unbound.png",
        media_type: "image/png",
      },
    ],
    outcomes: [
      {
        change_id: "change-dashboard",
        outcome: status === "failed" ? "failed" : "annotated",
        asset_ids: status === "failed" ? [] : [`asset-${version}`],
        reason: "Synthetic annotation-only result",
      },
    ],
    failure_reason: status === "failed" ? "Renderer offline" : null,
    stale: false,
  });
}
function service(
  handler?: (path: string, body?: unknown, key?: string) => Promise<unknown>,
  mode: Api["mode"] = "mock",
) {
  const request = vi.fn(async (path: string, body?: unknown, key?: string) => {
    if (handler) {
      const value = await handler(path, body, key);
      if (value !== undefined) return value;
    }
    if (body !== undefined)
      return {
        command_id: "cmd",
        resource_id: "job-1",
        resource_url: "/jobs/job-1",
        render_request_id: "job-1",
      };
    if (path.includes("/renders/")) return result();
    if (path.includes("/proposals")) {
      const p = structuredClone(proposals);
      p.proposal_set_version = Number(
        new URL(path, "http://local").searchParams.get(
          "proposal_set_version",
        ) ?? 1,
      );
      p.wire!.proposal_set_version = p.proposal_set_version;
      return p;
    }
    if (path.includes("/findings"))
      return { items: findings, revision: 1, next_cursor: null };
    if (path.includes("/research"))
      return { items: research, revision: 1, next_cursor: null };
    return evidence.find((e) => path.endsWith(e.evidence_id)) ?? evidence[0];
  });
  return {
    api: { mode, sessionNamespace: "test", request } as unknown as Api,
    request,
  };
}
function props(api: Api, w = workspace()) {
  return {
    api,
    workspace: w,
    variantId: "variant-digital",
    onRefresh: vi.fn(async () => w),
    onOpen: vi.fn(),
  };
}
it("creates one exact-version render and binds assets to outcomes and numbered change identities", async () => {
  const user = userEvent.setup();
  const { api, request } = service();
  render(<RenderPanel {...props(api)} />);
  await user.dblClick(screen.getByRole("button", { name: "Reimagine" }));
  const assets = await screen.findByRole("region", {
    name: "Current render assets",
  });
  expect(
    request.mock.calls.filter(([, body]) => body !== undefined),
  ).toHaveLength(1);
  expect(request).toHaveBeenCalledWith(
    "/runs/run-synthetic/renders",
    {
      proposal_set_version: 1,
      variant_ids: ["variant-digital"],
      baseline_asset_id: "baseline",
    },
    expect.any(String),
  );
  expect(
    within(assets).getByRole("link", { name: "Open variant asset asset-1" }),
  ).toHaveAttribute("href", "https://assets.example/v1.png");
  expect(
    screen.queryByRole("link", { name: "Open variant asset unbound" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Explain change 1 change-dashboard" }),
  );
  expect(
    screen.getByRole("region", { name: "Change explanation change-dashboard" }),
  ).toHaveTextContent("Proposal version 1 / variant variant-digital");
});
it("polls queued then rendering then partial without overlapping requests", async () => {
  vi.useFakeTimers();
  let reads = 0;
  let release!: (value: unknown) => void;
  const { api, request } = service(async (path, body) => {
    if (body === undefined && path.includes("/renders/")) {
      reads++;
      if (reads === 1)
        return new Promise((resolve) => {
          release = resolve;
        });
      return result("job-1", 1, reads === 2 ? "rendering" : "partial");
    }
  });
  render(<RenderPanel {...props(api)} />);
  fireEvent.click(screen.getByRole("button", { name: "Reimagine" }));
  await act(async () => {});
  await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(reads).toBe(1);
  await act(async () => release(result("job-1", 1, "queued")));
  expect(screen.getByText("queued")).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByText("rendering")).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByText("partial")).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(reads).toBe(3);
  expect(
    request.mock.calls.filter(([, body]) => body !== undefined),
  ).toHaveLength(1);
});
it("retains accepted job ID after retrieval fails and retries retrieval without another render command", async () => {
  const user = userEvent.setup();
  let reads = 0;
  const { api, request } = service(async (path, body) => {
    if (body === undefined && path.includes("/renders/") && ++reads === 1)
      throw new Error("Status offline");
  });
  render(<RenderPanel {...props(api)} />);
  await user.click(screen.getByRole("button", { name: "Reimagine" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Status offline");
  await user.click(
    screen.getByRole("button", { name: "Retry render status job-1" }),
  );
  await screen.findByRole("region", { name: "Current render assets" });
  expect(
    request.mock.calls.filter(([, body]) => body !== undefined),
  ).toHaveLength(1);
});
it("rejects result identity mismatches before displaying any assets", async () => {
  const user = userEvent.setup();
  const { api } = service(async (path, body) =>
    body === undefined && path.includes("/renders/")
      ? result("other-job", 2)
      : undefined,
  );
  render(<RenderPanel {...props(api)} />);
  await user.click(screen.getByRole("button", { name: "Reimagine" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/identity/);
  expect(
    screen.queryByRole("link", { name: /Open variant asset/ }),
  ).not.toBeInTheDocument();
});
it("keeps late old renders separate from current-version assets and fetches immutable earlier proposals", async () => {
  const user = userEvent.setup();
  let finish!: (value: unknown) => void;
  const { api, request } = service(async (path, body) => {
    if (body !== undefined && path.endsWith("/renders")) {
      const version = (body as Wire.RenderCommand).proposal_set_version;
      return {
        command_id: "cmd",
        resource_id: `job-${version}`,
        resource_url: "/accepted",
      };
    }
    if (path.endsWith("/renders/job-1"))
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (path.endsWith("/renders/job-2")) return result("job-2", 2);
  });
  const base = props(api);
  const { rerender } = render(<RenderPanel {...base} />);
  await user.click(screen.getByRole("button", { name: "Reimagine" }));
  rerender(<RenderPanel {...base} workspace={workspace(2)} />);
  await user.click(screen.getByRole("button", { name: "Reimagine" }));
  await screen.findByRole("link", { name: "Open variant asset asset-2" });
  await act(async () => finish(result("job-1", 1)));
  const current = screen.getByRole("region", { name: "Current render assets" });
  expect(current).toHaveTextContent("asset-2");
  expect(current).not.toHaveTextContent("asset-1");
  expect(
    screen.getByText(/Older render.*proposal version 1/),
  ).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith(
    "/runs/run-synthetic/proposals?proposal_set_version=1",
    undefined,
    undefined,
    expect.any(AbortSignal),
  );
});
it("uses the existing retry endpoint for failed jobs and preserves original binding", async () => {
  const user = userEvent.setup();
  const { api, request } = service(async (path, body) => {
    if (path.endsWith("/renders/job-1") && body === undefined)
      return result("job-1", 1, "failed");
    if (path.endsWith("/renders/job-1/retry"))
      return {
        command_id: "retry",
        resource_id: "job-retry",
        resource_url: "/accepted",
      };
    if (path.endsWith("/renders/job-retry")) return result("job-retry");
  });
  render(<RenderPanel {...props(api)} />);
  await user.click(screen.getByRole("button", { name: "Reimagine" }));
  await user.click(
    await screen.findByRole("button", { name: "Retry render job-1" }),
  );
  await screen.findByRole("region", { name: "Current render assets" });
  expect(request).toHaveBeenCalledWith(
    "/runs/run-synthetic/renders/job-1/retry",
    {},
    expect.any(String),
  );
  expect(
    request.mock.calls.filter(
      ([path, body]) => path.endsWith("/renders") && body !== undefined,
    ),
  ).toHaveLength(1);
});
it("recovers an uncertain render submission after real-mode reload with identical command key and body", async () => {
  const user = userEvent.setup();
  let posts = 0;
  const { api, request } = service(async (_path, body) => {
    if (body !== undefined && ++posts === 1)
      throw new TypeError("Interrupted POST");
  }, "real");
  const p = props(api);
  const { unmount } = render(<RenderPanel {...p} />);
  await user.click(screen.getByRole("button", { name: "Reimagine" }));
  await screen.findByRole("alert");
  unmount();
  render(<RenderPanel {...p} />);
  await user.click(
    screen.getByRole("button", { name: /Retry render submission/ }),
  );
  await screen.findByRole("region", { name: "Current render assets" });
  const commands = request.mock.calls.filter(([, body]) => body !== undefined);
  expect(commands[1]).toEqual(commands[0]);
});
it("restores accepted real-mode job tracking without submitting another render", async () => {
  const user = userEvent.setup();
  const { api, request } = service(undefined, "real");
  const p = props(api);
  const { unmount } = render(<RenderPanel {...p} />);
  await user.click(screen.getByRole("button", { name: "Reimagine" }));
  await screen.findByRole("region", { name: "Current render assets" });
  unmount();
  render(<RenderPanel {...p} />);
  await screen.findByRole("region", { name: "Current render assets" });
  expect(
    request.mock.calls.filter(([, body]) => body !== undefined),
  ).toHaveLength(1);
});
it("honors backend actions and never substitutes a missing selected variant", () => {
  const { api } = service();
  const w = workspace();
  w.snapshot.available_actions = [];
  const p = props(api, w);
  const { rerender } = render(<RenderPanel {...p} />);
  expect(screen.getByRole("button", { name: "Reimagine" })).toBeDisabled();
  rerender(<RenderPanel {...p} workspace={workspace()} variantId="missing" />);
  expect(screen.getByRole("button", { name: "Reimagine" })).toBeDisabled();
  expect(screen.getByText(/Selected variant unavailable/)).toBeInTheDocument();
});
it("discards late accepted submission and stops polling after unmount", async () => {
  const user = userEvent.setup();
  let finish!: (value: unknown) => void;
  const { api } = service(async (_path, body) =>
    body !== undefined
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : undefined,
  );
  const p = props(api);
  const { unmount } = render(<RenderPanel {...p} />);
  await user.click(screen.getByRole("button", { name: "Reimagine" }));
  unmount();
  await act(async () =>
    finish({
      command_id: "late",
      resource_id: "job-1",
      resource_url: "/accepted",
    }),
  );
  expect(p.onRefresh).not.toHaveBeenCalled();
});
it("keeps an uncertain mock command across remount using the same API instance", async () => {
  const user = userEvent.setup();
  let posts = 0;
  const { api, request } = service(async (_path, body) => {
    if (body !== undefined && ++posts === 1)
      throw new Error("Uncertain acknowledgement");
  });
  const p = props(api);
  const { unmount } = render(<RenderPanel {...p} />);
  await user.click(screen.getByRole("button", { name: "Reimagine" }));
  await screen.findByRole("alert");
  unmount();
  render(<RenderPanel {...p} />);
  await user.click(
    screen.getByRole("button", { name: /Retry render submission/ }),
  );
  await screen.findByRole("region", { name: "Current render assets" });
  expect(
    request.mock.calls.filter(([, body]) => body !== undefined)[1],
  ).toEqual(request.mock.calls.filter(([, body]) => body !== undefined)[0]);
});
it("resolves returned root-relative assets against the API origin", async () => {
  const user = userEvent.setup();
  const { api } = service(async (path, body) => {
    if (body === undefined && path.includes("/renders/")) {
      const value = result();
      value.wire!.assets[0].url = "/private/render.png";
      return value;
    }
  });
  api.linkUrl = (value) => new URL(value, "https://backend.example").href;
  render(<RenderPanel {...props(api)} />);
  await user.click(screen.getByRole("button", { name: "Reimagine" }));
  expect(
    await screen.findByRole("link", { name: "Open variant asset asset-1" }),
  ).toHaveAttribute("href", "https://backend.example/private/render.png");
});
it("offers numbered explanations before any render and focuses their exact change", async () => {
  const user = userEvent.setup();
  const { api } = service();
  render(<RenderPanel {...props(api)} />);
  await user.click(
    screen.getByRole("button", { name: "Explain change 1 change-dashboard" }),
  );
  expect(
    screen.getByRole("region", { name: "Change explanation change-dashboard" })
      .parentElement,
  ).toHaveFocus();
  expect(
    screen.getByRole("region", { name: "Change explanation change-dashboard" }),
  ).toHaveTextContent("Proposal version 1 / variant variant-digital");
});
it("permits a failed earlier-version job retry without rebinding it to the new proposal", async () => {
  const user = userEvent.setup();
  const { api, request } = service(async (path, body) => {
    if (path.endsWith("/renders/job-1") && body === undefined)
      return result("job-1", 1, "failed");
    if (path.endsWith("/renders/job-1/retry"))
      return {
        command_id: "retry",
        resource_id: "job-old-retry",
        resource_url: "/accepted",
      };
    if (path.endsWith("/renders/job-old-retry"))
      return result("job-old-retry", 1);
  });
  const p = props(api);
  const { rerender } = render(<RenderPanel {...p} />);
  await user.click(screen.getByRole("button", { name: "Reimagine" }));
  await screen.findByText("failed");
  rerender(<RenderPanel {...p} workspace={workspace(2)} />);
  await user.click(screen.getByRole("button", { name: "Retry render job-1" }));
  await screen.findByRole("region", { name: "Render job job-old-retry" });
  expect(request).toHaveBeenCalledWith(
    "/runs/run-synthetic/renders/job-1/retry",
    {},
    expect.any(String),
  );
  expect(
    screen.queryByRole("region", { name: "Current render assets" }),
  ).not.toBeInTheDocument();
});
it("aborts owned status reads when switching to another run", async () => {
  const user = userEvent.setup();
  const { api, request } = service();
  const p = props(api);
  const { rerender } = render(<RenderPanel {...p} />);
  await user.click(screen.getByRole("button", { name: "Reimagine" }));
  await screen.findByRole("region", { name: "Current render assets" });
  const read = request.mock.calls.find(
    ([path, body]) => path.includes("/renders/") && body === undefined,
  ) as unknown as [string, unknown, unknown, AbortSignal];
  const next = workspace();
  next.snapshot.run_id = "other-run";
  rerender(<RenderPanel {...p} workspace={next} />);
  expect(read[3].aborted).toBe(true);
  expect(
    screen.queryByRole("region", { name: "Render job job-1" }),
  ).not.toBeInTheDocument();
});
it("recovers a failed variant preview by retrieving authorized asset links without submitting another render", async () => {
  const user = userEvent.setup(); let reads = 0;
  const {api,request} = service(async (path,body) => {
    if (body === undefined && path.includes('/renders/')) {
      const next = result();
      next.wire!.assets[0].url = ++reads === 1 ? 'https://assets.example/expired.png' : 'https://assets.example/refreshed.png';
      return next;
    }
  });
  render(<RenderPanel {...props(api)} />);
  await user.click(screen.getByRole('button',{name:'Reimagine'}));
  const assets = await screen.findByRole('region',{name:'Current render assets'});
  const image = within(assets).getByRole('img');
  expect(image).toHaveAttribute('src','https://assets.example/expired.png');
  fireEvent.error(image);
  expect(screen.getByRole('button',{name:'Explain change 1 change-dashboard'})).toBeEnabled();
  await user.click(screen.getByRole('button',{name:/^Refresh asset links/}));
  await waitFor(()=>expect(within(assets).getByRole('img')).toHaveAttribute('src','https://assets.example/refreshed.png'));
  expect(request.mock.calls.filter(([,body])=>body!==undefined)).toHaveLength(1);
});
