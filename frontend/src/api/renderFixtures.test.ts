import { afterEach, expect, it, vi } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import openapi from "../../fixtures/openapi.json";
import scenarios from "../../fixtures/frontend-render-scenarios.json";
import { createMockApi, createRealApi } from "./client";
import type { Accepted, RenderResult, Proposals } from "./wire";
const results = scenarios.results as Record<string, RenderResult>;
const defs = JSON.parse(
  JSON.stringify(openapi.components.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
const validate = new Ajv2020({ strict: false, allErrors: true }).compile({
  $ref: "#/$defs/RenderResult",
  $defs: defs,
});
afterEach(() => vi.unstubAllGlobals());
it("provides explicit contract-valid synthetic render states with useful partial assets and unsupported outcomes", () => {
  expect(Object.keys(results).sort()).toEqual(
    ["queued", "rendering", "success", "partial", "failure", "late"].sort(),
  );
  for (const result of Object.values(results))
    expect(validate(result), JSON.stringify(validate.errors)).toBe(true);
  expect(scenarios.synthetic).toBe(true);
  expect(results.success.status).toBe("succeeded");
  expect(
    results.success.outcomes.every(
      (outcome) => outcome.outcome === "annotated",
    ),
  ).toBe(true);
  expect(results.partial.assets).toHaveLength(1);
  expect(
    results.partial.outcomes.some(
      (outcome) => outcome.outcome === "unsupported",
    ),
  ).toBe(true);
  expect(results.failure.assets).toEqual([]);
  expect(results.failure.failure_reason).toMatch(/synthetic/i);
  expect(results.late.proposal_set_version).toBe(1);
  expect(results.late.stale).toBe(true);
  const assets = Object.values(results).flatMap((result) => result.assets);
  expect(
    assets.every(
      (asset) =>
        asset.url === "/vehicles/frontend-render-annotation.svg" &&
        asset.media_type === "image/svg+xml",
    ),
  ).toBe(true);
});
async function setup(scenario: string) {
  const api = createMockApi(scenario);
  const source = await api.upload(new File(["fixture"], "fixture.xlsx"));
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
  const before = await api.workspace(run_id);
  return { api, run_id, root: `/runs/${run_id}`, before };
}
async function terminal(api: ReturnType<typeof createMockApi>, path: string) {
  let result = await api.request<import("./contracts").RenderResult>(path);
  for (let n = 0; n < 8 && ["queued", "rendering"].includes(result.status); n++)
    result = await api.request(path);
  return result;
}
it("consumes partial fixtures with only selected variant/change identities and independently addressable annotation assets", async () => {
  const { api, root } = await setup("render_partial");
  const command = {
    proposal_set_version: 1,
    variant_ids: ["variant-digital", "variant-physical"],
    baseline_asset_id: "i5-m60-exterior-v1",
  };
  const accepted = await api.request<Accepted>(
    `${root}/renders`,
    command,
    "render",
  );
  const done = await terminal(api, `${root}/renders/${accepted.resource_id}`);
  expect(
    done.wire?.outcomes.map((outcome) => [outcome.change_id, outcome.outcome]),
  ).toEqual([
    ["change-dashboard", "annotated"],
    ["change-physical", "unsupported"],
  ]);
  expect(done.assets).toHaveLength(1);
  expect(done.assets[0].url).toBe("/vehicles/frontend-render-annotation.svg");
  expect(validate(done.wire), JSON.stringify(validate.errors)).toBe(true);
  const digital = await api.request<Accepted>(
    `${root}/renders`,
    { ...command, variant_ids: ["variant-digital"] },
    "digital",
  );
  const selected = await terminal(
    api,
    `${root}/renders/${digital.resource_id}`,
  );
  expect(selected.outcomes.map((outcome) => outcome.change_id)).toEqual([
    "change-dashboard",
  ]);
  expect(selected.wire?.variant_ids).toEqual(["variant-digital"]);
  const physical = await api.request<Accepted>(
    `${root}/renders`,
    { ...command, variant_ids: ["variant-physical"] },
    "physical",
  );
  const unsupported = await terminal(
    api,
    `${root}/renders/${physical.resource_id}`,
  );
  expect(unsupported.assets).toEqual([]);
  expect(unsupported.outcomes[0].status).toBe("unsupported");
});
it("keeps old late completion pinned to the original proposal while current annotation asset IDs remain independent", async () => {
  const { api, root, run_id } = await setup("render_late");
  const command = {
    proposal_set_version: 1,
    variant_ids: ["variant-digital"],
    baseline_asset_id: "i5-m60-exterior-v1",
  };
  const old = await api.request<Accepted>(`${root}/renders`, command, "old");
  await api.request(
    `${root}/instructions`,
    {
      operation: "edit_change",
      base_proposal_set_version: 1,
      target_ids: ["change-dashboard"],
      changed_fields: { after: "Revised scoped idea" },
    },
    "edit",
  );
  await api.workspace(run_id);
  await api.workspace(run_id);
  const current = await api.request<Accepted>(
    `${root}/renders`,
    { ...command, proposal_set_version: 2 },
    "current",
  );
  const first = await terminal(api, `${root}/renders/${old.resource_id}`);
  const second = await terminal(api, `${root}/renders/${current.resource_id}`);
  expect(first.proposal_set_version).toBe(1);
  expect(first.wire?.stale).toBe(true);
  expect(second.proposal_set_version).toBe(2);
  expect(second.wire?.stale).toBe(false);
  expect(first.assets[0].asset_id).not.toBe(second.assets[0].asset_id);
});
it("sends Reimagine only through the application API with runtime access and exact version tuple", async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      command_id: "c",
      resource_id: "render/exact",
      resource_url: "/api/v1/runs/run%2F1/renders/render%2Fexact",
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const api = createRealApi("https://app-api.example.test/api/v1", {
    headers: () => ({
      Authorization: "Bearer runtime-session",
      "X-Workspace-ID": "workspace-1",
    }),
  });
  const command = {
    proposal_set_version: 7,
    variant_ids: ["variant/exact"],
    baseline_asset_id: "baseline/exact",
  };
  await api.request("/runs/run%2F1/renders", command, "idempotency-key");
  expect(fetch).toHaveBeenCalledOnce();
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://app-api.example.test/api/v1/runs/run%2F1/renders");
  expect(JSON.parse(init.body as string)).toEqual(command);
  expect(new Headers(init.headers).get("Idempotency-Key")).toBe(
    "idempotency-key",
  );
  expect(new Headers(init.headers).get("Authorization")).toBe(
    "Bearer runtime-session",
  );
});
it("reports newly added unmapped PM changes as unsupported rather than substituting the static annotation", async () => {
  const { api, root, run_id } = await setup("render_success");
  await api.request(
    `${root}/instructions`,
    {
      operation: "add_change",
      base_proposal_set_version: 1,
      target_ids: ["variant-digital"],
      changed_fields: {
        after: "A new PM idea without an established visual mapping",
      },
    },
    "add",
  );
  await api.workspace(run_id);
  await api.workspace(run_id);
  await api.request(
    `${root}/instructions`,
    {
      operation: "remove_change",
      base_proposal_set_version: 2,
      target_ids: ["change-dashboard"],
      changed_fields: {},
    },
    "remove",
  );
  await api.workspace(run_id);
  const workspace = await api.workspace(run_id);
  const changeId = workspace.proposals.variants[0].changes[0].change_id;
  const accepted = await api.request<Accepted>(
    `${root}/renders`,
    {
      proposal_set_version: 3,
      variant_ids: ["variant-digital"],
      baseline_asset_id: "i5-m60-exterior-v1",
    },
    "render-unknown",
  );
  const done = await terminal(api, `${root}/renders/${accepted.resource_id}`);
  expect(done.status).toBe("partial");
  expect(done.assets).toEqual([]);
  expect(done.outcomes).toMatchObject([
    { change_id: changeId, status: "unsupported" },
  ]);
  expect(done.outcomes[0].reason).toMatch(/not fabricated/i);
  expect(validate(done.wire), JSON.stringify(validate.errors)).toBe(true);
});
