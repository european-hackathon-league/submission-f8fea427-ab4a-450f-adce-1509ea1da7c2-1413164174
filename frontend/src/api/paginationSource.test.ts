import { afterEach, expect, it, vi } from "vitest";
import { createRealApi } from "./client";
import scenarios from "../../fixtures/scenarios.json";

const data = scenarios.standard_autonomous.payloads;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const vehicle = (id: string) => ({
  vehicle_id: id,
  baseline_asset_ids: [],
  part_catalog_versions: [],
  capabilities: [],
  synthetic: true,
});
it("loads every vehicle page with encoded opaque cursors", async () => {
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    paths.push(url);
    return Response.json(
      url.includes("cursor=")
        ? { items: [vehicle("second")], revision: 3, next_cursor: null }
        : {
            items: [vehicle("first")],
            revision: 3,
            next_cursor: "opaque /&?=",
          },
    );
  });
  const vehicles = await createRealApi().vehicles!();
  expect(vehicles.map((v) => v.vehicle_id)).toEqual(["first", "second"]);
  expect(paths[1]).toBe("/api/v1/vehicles?cursor=opaque%20%2F%26%3F%3D");
});
it.each(["repeat", "revision"])(
  "rejects unsafe vehicle pagination: %s",
  async (scenario) => {
    let calls = 0;
    vi.stubGlobal("fetch", async () =>
      Response.json({
        items: [vehicle("first")],
        revision: scenario === "revision" ? ++calls : 1,
        next_cursor: "same",
      }),
    );
    await expect(createRealApi().vehicles!()).rejects.toMatchObject({
      code: scenario === "revision" ? "incoherent_resources" : "invalid_cursor",
    });
  },
);
function workspaceServer(secondAggregate: unknown) {
  return async (url: string) => {
    if (url.endsWith("/runs/run_demo")) return Response.json(data.Snapshot);
    if (url.endsWith("/findings"))
      return Response.json({
        ...data.FindingsPage,
        part_aggregates: [aggregate("part.seat", ["cohort.eu"])],
        next_cursor: "next",
      });
    if (url.endsWith("/findings?cursor=next"))
      return Response.json({
        ...data.FindingsPage,
        items: [],
        part_aggregates: [
          aggregate("part.seat", ["cohort.eu"]),
          secondAggregate,
        ],
      });
    if (url.endsWith("/graph"))
      return Response.json({ nodes: [], edges: [], revision: 1 });
    if (url.endsWith("/conflicts"))
      return Response.json({ conflicts: [], checkpoints: [] });
    if (url.endsWith("/proposals")) return Response.json(data.Proposals);
    return Response.json({ items: [], revision: 1, next_cursor: null });
  };
}
function aggregate(part_id: string, cohort_ids: string[]) {
  return {
    part_id,
    cohort_ids,
    counts: {
      total_records: 5,
      negative_records: 2,
      negative_share: 0.4,
      record_ids: [],
    },
    intensity_value: 0.3,
    intensity_scale_id: "scale",
    low_evidence: false,
    provisional: false,
  };
}
it("retains aggregates from all findings pages and preserves cohort scope without local sums", async () => {
  vi.stubGlobal(
    "fetch",
    workspaceServer(aggregate("part.seat", ["cohort.us"])),
  );
  const workspace = await createRealApi().workspace("run_demo");
  expect(workspace.snapshot.part_aggregates).toHaveLength(2);
  expect(
    workspace.snapshot.part_aggregates.map((a) => a.wire?.cohort_ids),
  ).toEqual([["cohort.eu"], ["cohort.us"]]);
  expect(
    workspace.snapshot.part_aggregates.map((a) => a.counts.negative_records),
  ).toEqual([2, 2]);
});
it("rejects conflicting duplicate aggregate scope instead of choosing one", async () => {
  vi.stubGlobal(
    "fetch",
    workspaceServer({
      ...aggregate("part.seat", ["cohort.eu"]),
      intensity_value: 0.9,
    }),
  );
  await expect(createRealApi().workspace("run_demo")).rejects.toMatchObject({
    code: "incoherent_resources",
  });
});
it("authenticates only exact configured source-content URLs and never sends credentials to other links", async () => {
  let calls = 0;
  let sent: RequestInit | undefined;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    calls++;
    sent = init;
    return new Response("source bytes", {
      headers: { "Content-Type": "application/pdf" },
    });
  });
  const api = createRealApi("https://api.example/app/api/v1", {
    headers: () => ({
      Authorization: "Bearer token",
      "X-Workspace-ID": "workspace-a",
    }),
  });
  expect(
    api.canReadSource!(
      "https://api.example/app/api/v1/sources/source%2Fopaque/content",
    ),
  ).toBe(true);
  for (const url of [
    "https://evil.example/app/api/v1/sources/a/content",
    "https://api.example/app/api/v1/sources/a/content?signature=external",
    "https://api.example/app/api/v1/runs/r",
    "https://user:secret@api.example/app/api/v1/sources/a/content",
    "https://api.example/app/api/v1/sources/a/content#fragment",
  ]) {
    expect(api.canReadSource!(url)).toBe(false);
    await expect(
      api.readSource!(url, new AbortController().signal),
    ).rejects.toMatchObject({ code: "unsupported_source_url" });
  }
  expect(calls).toBe(0);
  const blob = await api.readSource!(
    "https://api.example/app/api/v1/sources/source%2Fopaque/content",
    new AbortController().signal,
  );
  expect(await blob.text()).toBe("source bytes");
  expect(new Headers(sent?.headers).get("Authorization")).toBe("Bearer token");
  expect(sent?.redirect).toBe("error");
});
it("preserves source access failure metadata and cancels stalled source downloads", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json(
      { code: "forbidden", message: "No access", retryable: false },
      { status: 403 },
    ),
  );
  const api = createRealApi();
  await expect(
    api.readSource!("/api/v1/sources/a/content", new AbortController().signal),
  ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        ),
      ),
  );
  const pending = api.readSource!(
    "/api/v1/sources/a/content",
    new AbortController().signal,
  );
  const assertion = expect(pending).rejects.toMatchObject({
    code: "source_timeout",
    retryable: true,
  });
  await vi.advanceTimersByTimeAsync(30_000);
  await assertion;
});
it("resolves backend root-relative source links against the configured API origin", async () => {
  let url = "";
  vi.stubGlobal("fetch", async (value: string) => {
    url = value;
    return new Response("source");
  });
  const api = createRealApi("https://backend.example/api/v1");
  expect(api.canReadSource!("/api/v1/sources/source-id/content")).toBe(true);
  await api.readSource!(
    "/api/v1/sources/source-id/content",
    new AbortController().signal,
  );
  expect(url).toBe("https://backend.example/api/v1/sources/source-id/content");
});
it("forwards caller cancellation to source download", async () => {
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        requestSignal = init.signal as AbortSignal;
        requestSignal.addEventListener(
          "abort",
          () => reject(requestSignal?.reason),
          { once: true },
        );
      }),
  );
  const parent = new AbortController();
  const pending = createRealApi().readSource!(
    "/api/v1/sources/source-id/content",
    parent.signal,
  );
  const assertion = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await Promise.resolve();
  await Promise.resolve();
  parent.abort();
  await assertion;
  expect(requestSignal?.aborted).toBe(true);
});
it("preserves opaque vehicle IDs and complete available asset references without local relabeling", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({
      items: [
        {
          ...vehicle("unknown:/vehicle?x=1"),
          baseline_asset_ids: ["baseline-a", "baseline-b"],
          part_catalog_versions: ["catalog-a", "catalog-b"],
        },
      ],
      revision: 1,
      next_cursor: null,
    }),
  );
  const [result] = await createRealApi().vehicles!();
  expect(result.vehicle_id).toBe("unknown:/vehicle?x=1");
  expect(result.title).toBe("unknown:/vehicle?x=1");
  expect(result.wire?.baseline_asset_ids).toEqual(["baseline-a", "baseline-b"]);
  expect(result.wire?.part_catalog_versions).toEqual([
    "catalog-a",
    "catalog-b",
  ]);
});
