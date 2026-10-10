import { afterEach, expect, it, vi } from "vitest";
import { createMockApi } from "./client";
import type { Api, ProposalSet } from "./contracts";
import type { Accepted, ExportResult } from "./wire";
afterEach(() => vi.unstubAllGlobals());
async function setup(scenario = "standard_autonomous") {
  const api = createMockApi(scenario);
  const source = await api.upload(new File(["feedback"], "feedback.xlsx"));
  const { run_id } = await api.request<{ run_id: string }>(
    "/runs",
    {
      vehicle_id: "g60-i5-m60",
      baseline_asset_id: "i5-m60-exterior-v1",
      part_catalog_version: "g60-parts-v1",
      source_ids: [source.source_id],
      market_context: [],
      participation_mode: "autonomous",
      deep_dive: { enabled: false },
    },
    "run",
  );
  await api.workspace(run_id);
  return { api, run_id, root: `/runs/${run_id}` };
}
async function edit(api: Api, root: string) {
  return api.request<Accepted>(
    `${root}/instructions`,
    {
      operation: "edit_change",
      base_proposal_set_version: 1,
      target_ids: ["change-dashboard"],
      changed_fields: { after: "PM revised controls" },
    },
    "edit",
  );
}
it("keeps exact proposal history immutable across change-only instructions and coherent asynchronous recomputation", async () => {
  const { api, root, run_id } = await setup();
  const before = await api.request<ProposalSet>(
    `${root}/proposals?proposal_set_version=1`,
  );
  const accepted = await edit(api, root);
  expect(accepted.resource_id).toMatch(/^instruction-/);
  const processing = await api.workspace(run_id);
  expect(processing.snapshot.analysis_status).toBe("processing");
  expect(processing.snapshot.current_proposal_set_version).toBe(1);
  expect(processing.proposals.proposal_set_version).toBe(1);
  expect(processing.snapshot.available_actions).not.toContain("edit");
  const after = await api.workspace(run_id);
  expect(after.proposals.proposal_set_version).toBe(2);
  expect(after.proposals.variants[0].changes[0].after).toBe(
    "PM revised controls",
  );
  expect(await api.request(`${root}/proposals?proposal_set_version=1`)).toEqual(
    before,
  );
  await expect(
    api.request(`${root}/proposals?proposal_set_version=900`),
  ).rejects.toMatchObject({ status: 404 });
});
it("retains last published proposal when accepted recomputation fails", async () => {
  const { api, root, run_id } = await setup("proposal_recompute_failed");
  await edit(api, root);
  expect((await api.workspace(run_id)).snapshot.analysis_status).toBe(
    "processing",
  );
  const failed = await api.workspace(run_id);
  expect(failed.snapshot.analysis_status).toBe("failed");
  expect(failed.proposals.proposal_set_version).toBe(1);
  expect(failed.snapshot.warnings.join(" ")).toMatch(/recomputation failed/i);
});
it("exports the exact immutable earlier proposal with a server manifest", async () => {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:synthetic-export"),
      revokeObjectURL: vi.fn(),
    }),
  );
  const { api, root, run_id } = await setup();
  await edit(api, root);
  await api.workspace(run_id);
  await api.workspace(run_id);
  const accepted = await api.request<Accepted>(
    `${root}/exports`,
    {
      proposal_set_version: 1,
      variant_ids: ["variant-digital"],
      format: "json",
    },
    "export-old",
  );
  const result = await api.request<ExportResult>(
    `${root}/exports/${accepted.resource_id}`,
  );
  expect(result.manifest).toMatchObject({
    run_id,
    proposal_set_version: 1,
    variant_ids: ["variant-digital"],
  });
  expect(result.status).toBe("queued");
  expect(
    (await api.request<ExportResult>(`${root}/exports/${accepted.resource_id}`))
      .status,
  ).toBe("processing");
  expect(
    (await api.request<ExportResult>(`${root}/exports/${accepted.resource_id}`))
      .status,
  ).toBe("ready");
});
it("resolves returned export links against configured API origin and rejects unsafe links", async () => {
  const { createRealApi } = await import("./client");
  const api = createRealApi("https://api.example.test/api/v1");
  expect(api.linkUrl?.("/api/v1/runs/r/exports/e/download")).toBe(
    "https://api.example.test/api/v1/runs/r/exports/e/download",
  );
  expect(
    api.linkUrl?.("https://cdn.example.test/signed?token=authorized"),
  ).toBe("https://cdn.example.test/signed?token=authorized");
  expect(api.linkUrl?.("javascript:alert(1)")).toBeNull();
  expect(api.linkUrl?.("https://token:secret@example.test/file")).toBeNull();
});
it("cancels component-owned resource reads without retrying a canceled request", async () => {
  const { createRealApi } = await import("./client");
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      calls++;
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener(
          "abort",
          () => reject(new DOMException("Canceled", "AbortError")),
          { once: true },
        );
      });
    }),
  );
  const controller = new AbortController();
  const pending = createRealApi().request(
    "/runs/r/proposals?proposal_set_version=1",
    undefined,
    undefined,
    controller.signal,
  );
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBeLessThanOrEqual(1);
});

it.each([
  ["render_partial", "partial"],
  ["render_success", "succeeded"],
  ["render_failed", "failed"],
  ["render_late", "partial"],
])(
  "exposes asynchronous %s render states without fabricated geometry",
  async (scenario, terminal) => {
    const { api, root } = await setup(scenario);
    const accepted = await api.request<Accepted>(
      `${root}/renders`,
      {
        proposal_set_version: 1,
        variant_ids: ["variant-digital"],
        baseline_asset_id: "i5-m60-exterior-v1",
      },
      "render",
    );
    const path = `${root}/renders/${accepted.resource_id}`;
    const queued = await api.request<import("./contracts").RenderResult>(path);
    expect(queued.status).toBe("queued");
    expect(
      (await api.request<import("./contracts").RenderResult>(path)).status,
    ).toBe("rendering");
    let done = await api.request<import("./contracts").RenderResult>(path);
    for (let n = 0; n < 5 && done.status === "rendering"; n++)
      done = await api.request(path);
    expect(done.status).toBe(terminal);
    expect(done.assets).toEqual([]);
    expect(done.proposal_set_version).toBe(1);
    if (terminal === "failed") {
      const retry = await api.request<Accepted>(
        `${path}/retry`,
        {},
        "render-retry",
      );
      expect(retry.resource_id).toBe(accepted.resource_id);
      expect(
        (await api.request<import("./contracts").RenderResult>(path)).status,
      ).toBe("queued");
    }
  },
);
it("new failed-export recovery command gets a distinct resource while repeated key reuses accepted result", async () => {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:synthetic-export"),
      revokeObjectURL: vi.fn(),
    }),
  );
  const { api, root } = await setup("export_failed");
  const command = {
    proposal_set_version: 1,
    variant_ids: ["variant-digital"],
    format: "json",
  };
  const first = await api.request<Accepted>(
    `${root}/exports`,
    command,
    "export-1",
  );
  for (let n = 0; n < 3; n++)
    await api.request(`${root}/exports/${first.resource_id}`);
  expect(await api.request(`${root}/exports`, command, "export-1")).toEqual(
    first,
  );
  const second = await api.request<Accepted>(
    `${root}/exports`,
    command,
    "export-2",
  );
  expect(second.resource_id).not.toBe(first.resource_id);
});
it("rejects a same-version proposal belonging to another run during coherent workspace retrieval", async () => {
  const { createRealApi } = await import("./client");
  const { default: scenarios } = await import("../../fixtures/scenarios.json");
  const data = scenarios.standard_autonomous.payloads;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/runs/run_demo")) return Response.json(data.Snapshot);
      if (url.endsWith("/proposals"))
        return Response.json({ ...data.Proposals, run_id: "different-run" });
      if (url.endsWith("/findings")) return Response.json(data.FindingsPage);
      if (url.endsWith("/graph"))
        return Response.json({ nodes: [], edges: [], revision: 1 });
      if (url.endsWith("/conflicts"))
        return Response.json({ conflicts: [], checkpoints: [] });
      return Response.json({ items: [], next_cursor: null, revision: 1 });
    }),
  );
  await expect(createRealApi().workspace("run_demo")).rejects.toMatchObject({
    code: "incoherent_resources",
  });
});
it("removes orphan requirement references with a removed proposal change", async () => {
  const { api, root, run_id } = await setup();
  const before = await api.workspace(run_id);
  const removed = before.proposals.variants[0].changes[0].wire!;
  await api.request(
    `${root}/instructions`,
    {
      operation: "remove_change",
      base_proposal_set_version: 1,
      target_ids: [removed.change_id],
      changed_fields: {},
    },
    "remove",
  );
  await api.workspace(run_id);
  const after = await api.workspace(run_id);
  expect(
    after.proposals.wire!.changes.some(
      (change) => change.change_id === removed.change_id,
    ),
  ).toBe(false);
  expect(after.proposals.variants[0].wire!.requirement_ids).not.toContain(
    removed.requirement_id,
  );
});
it("regroups proposal applicability using existing cohorts while retaining original feedback counts", async () => {
  const { api, root, run_id } = await setup();
  const before = await api.workspace(run_id);
  await expect(
    api.request(
      `${root}/instructions`,
      {
        operation: "regroup_variants",
        base_proposal_set_version: 1,
        target_ids: ["variant-digital"],
        changed_fields: { cohort_ids: ["invented"] },
      },
      "bad-group",
    ),
  ).rejects.toMatchObject({ status: 422 });
  await api.request(
    `${root}/instructions`,
    {
      operation: "regroup_variants",
      base_proposal_set_version: 1,
      target_ids: ["variant-digital"],
      changed_fields: { cohort_ids: ["North America"] },
    },
    "group",
  );
  await api.workspace(run_id);
  const after = await api.workspace(run_id);
  expect(after.proposals.variants[0].cohort_scope).toEqual(["North America"]);
  expect(after.proposals.variants[0].changes[0].wire!.scope.cohort_ids).toEqual(
    ["North America"],
  );
  expect(
    after.findings.map((finding) => [finding.cohort_ids, finding.counts]),
  ).toEqual(
    before.findings.map((finding) => [finding.cohort_ids, finding.counts]),
  );
});
