import { afterEach, expect, it, vi } from "vitest";
import { createMockApi, createRealApi } from "./client";
import scenarios from "../../fixtures/scenarios.json";
import { wireFixtures } from "./fixtures";
import * as normalize from "./normalize";
import type * as Wire from "./wire";
const data = scenarios.deep_dive_partial.payloads;
afterEach(() => vi.unstubAllGlobals());
function server(research: () => Response | Promise<Response>) {
  return async (url: string) => {
    if (url.endsWith("/research")) return research();
    if (url.endsWith("/runs/run_demo")) return Response.json(data.Snapshot);
    if (url.endsWith("/findings")) return Response.json(data.FindingsPage);
    if (url.endsWith("/graph"))
      return Response.json({ nodes: [], edges: [], revision: 1 });
    if (url.endsWith("/conflicts"))
      return Response.json({ conflicts: [], checkpoints: [] });
    if (url.endsWith("/proposals")) return Response.json(data.Proposals);
    return Response.json({ items: [], next_cursor: null, revision: 1 });
  };
}
it.each([501, 503])(
  "keeps findings and proposals usable when research returns %s",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      server(() =>
        Response.json(
          {
            code: "research_unavailable",
            message: "Research service unavailable",
          },
          { status },
        ),
      ),
    );
    const result = await createRealApi().workspace("run_demo");
    expect(result.findings[0].finding_id).toBe("finding_demo");
    expect(result.proposals.proposal_set_version).toBe(1);
    expect(result.research).toEqual([]);
    expect(result.resourceErrors?.research).toBe(
      "Research service unavailable",
    );
  },
);
it("isolates exhausted research network failures and recovers on later refresh", async () => {
  let failed = true;
  vi.stubGlobal(
    "fetch",
    server(() => {
      if (failed) throw new TypeError("Network failed");
      return Response.json(data.ResearchPage);
    }),
  );
  const api = createRealApi();
  expect((await api.workspace("run_demo")).resourceErrors?.research).toMatch(
    /Network/,
  );
  failed = false;
  const recovered = await api.workspace("run_demo");
  expect(recovered.resourceErrors?.research).toBeUndefined();
  expect(recovered.research[0].wire?.claims[0].claim_id).toBe("claim_demo");
});
it.each([401, 403])(
  "does not hide research access failure %s",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      server(() =>
        Response.json(
          { code: "access_denied", message: "Access denied" },
          { status },
        ),
      ),
    );
    await expect(createRealApi().workspace("run_demo")).rejects.toMatchObject({
      status,
    });
  },
);
it("does not hide malformed research payloads", async () => {
  vi.stubGlobal(
    "fetch",
    server(() =>
      Response.json({
        items: [{ ...data.ResearchPage.items[0], status: "invented_state" }],
        revision: 1,
        next_cursor: null,
      }),
    ),
  );
  await expect(createRealApi().workspace("run_demo")).rejects.toMatchObject({
    code: "invalid_response",
  });
});
it.each([
  "queued",
  "searching",
  "checking",
  "ready",
  "partial",
  "unavailable",
] as const)(
  "retains research identity, null recommendation, claims, limitations and counterevidence in %s",
  (status) => {
    const wire: Wire.Research = {
      ...wireFixtures.research[0],
      status,
      recommendation: null,
      claims: [
        {
          claim_id: "claim-stable",
          type: "opinion",
          text: "Sampled owner opinion",
          evidence_ids: ["dashboard-E1"],
          limitations: ["Small sample"],
        },
      ],
      counterevidence_ids: ["dashboard-E2"],
    };
    const result = normalize.research(wire);
    expect(result.status).toBe(status);
    expect(result.wire?.recommendation).toBeNull();
    expect(result.wire?.claims[0]).toEqual({
      claim_id: "claim-stable",
      type: "opinion",
      text: "Sampled owner opinion",
      evidence_ids: ["dashboard-E1"],
      limitations: ["Small sample"],
    });
    expect(result.wire?.counterevidence_ids).toEqual(["dashboard-E2"]);
  },
);
async function guided(scenario = "guided_conflict") {
  const api = createMockApi(scenario);
  const upload = await api.upload(new File(["bytes"], "regional.xlsx"));
  const run = await api.request<{ run_id: string }>(
    "/runs",
    {
      vehicle_id: "g60-i5-m60",
      baseline_asset_id: "i5-m60-exterior-v1",
      part_catalog_version: "g60-parts-v1",
      source_ids: [upload.source_id],
      market_context: [],
      participation_mode: "guided",
      deep_dive: { enabled: true },
    },
    "create",
  );
  await api.workspace(run.run_id);
  return { api, root: `/runs/${run.run_id}`, runId: run.run_id };
}
it("rejects invented checkpoint resolutions and cohort IDs atomically", async () => {
  const { api, root, runId } = await guided();
  await expect(
    api.request(
      `${root}/checkpoints/checkpoint-comfort/continue`,
      { checkpoint_version: 1, resolution: "invented" },
      "bad-resolution",
    ),
  ).rejects.toMatchObject({ code: "invalid_resolution" });
  await expect(
    api.request(
      `${root}/checkpoints/checkpoint-comfort/continue`,
      {
        checkpoint_version: 1,
        resolution: "regroup_variants",
        cohort_assignments: { "variant-digital": ["invented-cohort"] },
      },
      "bad-cohort",
    ),
  ).rejects.toMatchObject({ code: "invalid_cohort" });
  expect((await api.workspace(runId)).checkpoint?.version).toBe(1);
});
it("applies a versioned supported cohort regroup once and retains unchanged feedback counts", async () => {
  const { api, root, runId } = await guided();
  const before = await api.workspace(runId);
  const command = {
    checkpoint_version: 1,
    resolution: "regroup_variants",
    cohort_assignments: { "variant-digital": ["Europe"] },
  };
  await api.request(
    `${root}/checkpoints/checkpoint-comfort/continue`,
    command,
    "regroup",
  );
  await api.request(
    `${root}/checkpoints/checkpoint-comfort/continue`,
    command,
    "regroup",
  );
  const after = await api.workspace(runId);
  expect(after.proposals.proposal_set_version).toBe(2);
  expect(after.proposals.variants[0].cohort_scope).toEqual(["Europe"]);
  expect(after.findings[0].counts).toEqual(before.findings[0].counts);
  expect(after.checkpoint).toBeNull();
});
it("exposes actual refreshed checkpoint version after stale continuation", async () => {
  const { api, root, runId } = await guided("guided_checkpoint_stale");
  await expect(
    api.request(
      `${root}/checkpoints/checkpoint-comfort/continue`,
      { checkpoint_version: 1, resolution: "continue" },
      "stale",
    ),
  ).rejects.toMatchObject({ code: "stale_checkpoint", current_version: 2 });
  expect((await api.workspace(runId)).checkpoint?.version).toBe(2);
  await api.request(
    `${root}/checkpoints/checkpoint-comfort/continue`,
    { checkpoint_version: 2, resolution: "continue" },
    "refreshed",
  );
  expect((await api.workspace(runId)).checkpoint).toBeNull();
});
it.each([
  "research_queued",
  "research_searching",
  "research_checking",
  "deep_dive_success",
  "deep_dive_partial",
  "research_unavailable",
])("mock fixture supports research state scenario %s", async (scenario) => {
  const { api, runId } = await guided(scenario);
  const expected: Record<string, string> = {
    research_queued: "queued",
    research_searching: "searching",
    research_checking: "checking",
    deep_dive_success: "ready",
    deep_dive_partial: "partial",
    research_unavailable: "unavailable",
  };
  expect((await api.workspace(runId)).research[0].status).toBe(
    expected[scenario],
  );
});
it("continued checkpoint remains auditable and later edits do not reopen PM waiting", async () => {
  const { api, root, runId } = await guided();
  await api.request(
    `${root}/checkpoints/checkpoint-comfort/continue`,
    { checkpoint_version: 1, resolution: "continue" },
    "continue",
  );
  const continued = await api.workspace(runId);
  expect(continued.conflicts?.checkpoints[0].wait_state).toBe("continued");
  expect(continued.conflicts?.conflicts[0].resolution_status).toBe("resolved");
  expect(continued.proposals.unresolved_conflicts).toEqual([]);
  await api.request(
    `${root}/instructions`,
    {
      operation: "edit_change",
      base_proposal_set_version: 2,
      variant_id: "variant-digital",
      change_id: "change-dashboard",
      fields: { after: "Refined proposal" },
    },
    "edit",
  );
  expect((await api.workspace(runId)).snapshot.analysis_status).toBe(
    "proposals_ready",
  );
});
it("does not hide research pagination revision conflicts", async () => {
  vi.stubGlobal(
    "fetch",
    server(() =>
      Response.json({ items: [], next_cursor: "next", revision: 1 }),
    ),
  );
  const current = globalThis.fetch;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.includes("/research?cursor=")
      ? Promise.resolve(
          Response.json({ items: [], next_cursor: null, revision: 2 }),
        )
      : current(url, init),
  );
  await expect(createRealApi().workspace("run_demo")).rejects.toMatchObject({
    code: "incoherent_resources",
  });
});
it("regrouped proposal changes retain the accepted variant applicability scope without relabeling feedback", async () => {
  const { api, root, runId } = await guided();
  await api.request(
    `${root}/checkpoints/checkpoint-comfort/continue`,
    {
      checkpoint_version: 1,
      resolution: "regroup_variants",
      cohort_assignments: { "variant-digital": ["North America"] },
    },
    "regroup-scope",
  );
  const after = await api.workspace(runId);
  expect(after.proposals.variants[0].changes[0].wire?.scope.cohort_ids).toEqual(
    ["North America"],
  );
  expect(after.findings[0].cohort_ids).toEqual(["Europe"]);
});
