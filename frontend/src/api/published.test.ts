import { afterEach, expect, it, vi } from "vitest";
import { createMockApi, createRealApi } from "./client";
import scenarios from "../../fixtures/scenarios.json";
import type { Workspace } from "./contracts";
afterEach(() => vi.unstubAllGlobals());
const data = scenarios.standard_autonomous.payloads;
it("uses published uploads sources envelope and multipart files field", async () => {
  let body: FormData | undefined;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    body = init.body as FormData;
    return Response.json({
      sources: [
        {
          source_id: "source_demo",
          filename: "input.xlsx",
          detected_type: "xlsx",
          status: "ready",
          reason: null,
        },
      ],
    });
  });
  const upload = await createRealApi().upload(
    new File(["bytes"], "input.xlsx"),
  );
  expect(upload.source_id).toBe("source_demo");
  expect(body?.getAll("files")).toHaveLength(1);
  expect(body?.has("file")).toBe(false);
});
it("projects published snapshots, findings, split proposals and typed evidence without inventing mappings", async () => {
  vi.stubGlobal("fetch", async (url: string) => {
    const path = url.replace("/api/v1", "");
    if (path === "/runs/run_demo") return Response.json(data.Snapshot);
    if (path.endsWith("/findings")) return Response.json(data.FindingsPage);
    if (path.endsWith("/graph"))
      return Response.json({
        nodes: [
          { id: "finding_demo", entity_type: "finding", revision: 1 },
          { id: "part_seat", entity_type: "part", revision: 1 },
        ],
        edges: [],
        revision: 1,
        next_cursor: null,
      });
    if (path.endsWith("/research"))
      return Response.json({ items: [], next_cursor: null, revision: 1 });
    if (path.endsWith("/conflicts"))
      return Response.json({ conflicts: [], checkpoints: [] });
    if (path.endsWith("/proposals")) return Response.json(data.Proposals);
    if (path.endsWith("/history"))
      return Response.json({ items: [], next_cursor: null, revision: 1 });
    throw new Error(path);
  });
  const w: Workspace = await createRealApi().workspace("run_demo");
  expect(w.findings[0].part_ids).toEqual(["part_seat"]);
  expect(w.findings[0].counts.negative_share).toBe(1);
  expect(w.snapshot.part_aggregates).toEqual([]);
  expect(w.proposals.variants[0].changes[0].change_id).toBe("change_demo");
  expect(w.proposals.variants[0].changes[0].wire?.finding_ids).toEqual([
    "finding_demo",
  ]);
  expect(w.graph.nodes[1].finding_id).toBe("");
});
it("supports snapshots before proposals exist without requesting an unavailable proposals resource", async () => {
  let requested = false;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("/runs/run_demo"))
      return Response.json({
        ...data.Snapshot,
        current_proposal_set_version: null,
        analysis_status: "processing",
      });
    if (url.endsWith("/findings")) return Response.json(data.FindingsPage);
    if (url.endsWith("/graph"))
      return Response.json({
        nodes: [],
        edges: [],
        revision: 1,
        next_cursor: null,
      });
    if (url.endsWith("/conflicts"))
      return Response.json({ conflicts: [], checkpoints: [] });
    if (url.endsWith("/proposals")) {
      requested = true;
      return Response.json(
        { code: "not_ready", message: "No proposals" },
        { status: 409 },
      );
    }
    return Response.json({ items: [], next_cursor: null, revision: 1 });
  });
  const w = await createRealApi().workspace("run_demo");
  expect(requested).toBe(false);
  expect(w.snapshot.current_proposal_set_version).toBe(null);
  expect(w.proposals.variants).toEqual([]);
});
it("mock accepts only published xlsx/pdf upload formats", async () => {
  const api = createMockApi();
  expect((await api.upload(new File(["csv"], "input.csv"))).status).toBe(
    "rejected",
  );
  expect((await api.upload(new File(["xlsx"], "input.xlsx"))).status).toBe(
    "ready",
  );
});
it("retries an interrupted command once with its original key and exact body", async () => {
  const seen: RequestInit[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    seen.push(init);
    if (seen.length === 1)
      throw new TypeError("Network disconnected after acceptance");
    return Response.json({
      command_id: "command-1",
      resource_id: "render-1",
      resource_url: "/api/v1/runs/r/renders/render-1",
    });
  });
  const result = await createRealApi().request<{ render_request_id: string }>(
    "/runs/r/renders",
    { proposal_set_version: 3, variant_ids: ["v"], baseline_asset_id: "a" },
    "stable-key",
  );
  expect(result.render_request_id).toBe("render-1");
  expect(seen).toHaveLength(2);
  expect(seen[0].body).toBe(seen[1].body);
  expect(new Headers(seen[1].headers).get("Idempotency-Key")).toBe(
    "stable-key",
  );
});
it("retains access error metadata without retrying and sends runtime session headers", async () => {
  let calls = 0;
  let headers: Headers | undefined;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    calls++;
    headers = new Headers(init.headers);
    return Response.json(
      {
        code: "forbidden",
        message: "Workspace access denied",
        retryable: false,
        field_errors: [{ workspace: "denied" }],
      },
      { status: 403, headers: { "x-request-id": "req-123" } },
    );
  });
  const api = createRealApi("/api/v1", {
    headers: () => ({
      Authorization: "Bearer session-token",
      "X-Workspace-ID": "workspace-a",
    }),
    sessionNamespace: "api|workspace-a",
  });
  await expect(api.request("/vehicles")).rejects.toMatchObject({
    code: "forbidden",
    status: 403,
    retryable: false,
    field_errors: [{ workspace: "denied" }],
    requestId: "req-123",
  });
  expect(calls).toBe(1);
  expect(headers?.get("Authorization")).toBe("Bearer session-token");
  expect(headers?.get("X-Workspace-ID")).toBe("workspace-a");
});
it("replays SSE by event ID without an ambiguous sequence cursor and exposes expired cursor", async () => {
  let url = "";
  let init: RequestInit | undefined;
  vi.stubGlobal("fetch", async (u: string, i: RequestInit) => {
    url = u;
    init = i;
    return Response.json(
      { code: "replay_expired", message: "Fetch snapshot" },
      { status: 410 },
    );
  });
  const response = await createRealApi().events!(
    "run_a",
    42,
    "event-42",
    new AbortController().signal,
  );
  expect(url).toBe("/api/v1/runs/run_a/events?follow=true");
  expect(new Headers(init?.headers).get("Last-Event-ID")).toBe("event-42");
  expect(response.status).toBe(410);
});
it("serializes numeric targets and published instruction identity fields", async () => {
  let body = "";
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    body = String(init.body);
    return Response.json({
      command_id: "cmd",
      resource_id: "instruction-1",
      resource_url: "/api/v1/runs/r/proposals",
    });
  });
  await createRealApi().request(
    "/runs/r/instructions",
    {
      operation: "edit_target",
      base_proposal_set_version: 8,
      variant_id: "v",
      change_id: "c",
      fields: { target: "2.5" },
    },
    "edit-key",
  );
  expect(JSON.parse(body)).toEqual({
    operation: "edit_target",
    base_proposal_set_version: 8,
    target_ids: ["v", "c"],
    changed_fields: { target: 2.5 },
  });
});
it("loads all contract graph pages, deduplicates identities, and derives finding navigation only from actual edges", async () => {
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    paths.push(url);
    if (url.endsWith("/runs/run_demo")) return Response.json(data.Snapshot);
    if (url.endsWith("/findings")) return Response.json(data.FindingsPage);
    if (url.endsWith("/graph"))
      return Response.json({
        nodes: [
          { id: "finding_demo", entity_type: "finding", revision: 1 },
          { id: "part_seat", entity_type: "part", revision: 1 },
        ],
        edges: [],
        revision: 4,
        next_cursor: "graph:next",
      });
    if (url.endsWith("/graph?cursor=graph%3Anext"))
      return Response.json({
        nodes: [{ id: "finding_demo", entity_type: "finding", revision: 1 }],
        edges: [
          {
            edge_id: "membership-1",
            from_id: "part_seat",
            to_id: "finding_demo",
            relationship: "mention",
            evidence_ids: ["evidence_demo"],
          },
        ],
        revision: 4,
        next_cursor: null,
      });
    if (url.endsWith("/conflicts"))
      return Response.json({ conflicts: [], checkpoints: [] });
    if (url.endsWith("/proposals")) return Response.json(data.Proposals);
    return Response.json({ items: [], next_cursor: null, revision: 1 });
  });
  const w = await createRealApi().workspace("run_demo");
  expect(paths).toContain("/api/v1/runs/run_demo/graph?cursor=graph%3Anext");
  expect(w.graph.nodes).toHaveLength(2);
  expect(w.graph.nodes.find((n) => n.node_id === "part_seat")?.finding_id).toBe(
    "finding_demo",
  );
  expect(w.graph.revision).toBe(4);
});
it("rejects incoherent snapshots after bounded retries instead of mixing proposal versions", async () => {
  let snapshots = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("/runs/run_demo"))
      return Response.json({ ...data.Snapshot, revision: ++snapshots });
    if (url.endsWith("/findings")) return Response.json(data.FindingsPage);
    if (url.endsWith("/graph"))
      return Response.json({ nodes: [], edges: [], revision: 1 });
    if (url.endsWith("/conflicts"))
      return Response.json({ conflicts: [], checkpoints: [] });
    if (url.endsWith("/proposals")) return Response.json(data.Proposals);
    return Response.json({ items: [], next_cursor: null, revision: 1 });
  });
  await expect(createRealApi().workspace("run_demo")).rejects.toMatchObject({
    code: "incoherent_resources",
    retryable: true,
  });
  expect(snapshots).toBe(6);
});
it("uses canonical cohort_ids when regrouping variants", async () => {
  let body = "";
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    body = String(init.body);
    return Response.json({
      command_id: "cmd",
      resource_id: "instruction-1",
      resource_url: "/api/v1/runs/r/proposals",
    });
  });
  await createRealApi().request(
    "/runs/r/instructions",
    {
      operation: "regroup_variants",
      base_proposal_set_version: 2,
      variant_id: "v",
      fields: { cohort_scope: ["cohort-eu"] },
    },
    "regroup",
  );
  expect(JSON.parse(body)).toEqual({
    operation: "regroup_variants",
    base_proposal_set_version: 2,
    target_ids: ["v"],
    changed_fields: { cohort_ids: ["cohort-eu"] },
  });
});
