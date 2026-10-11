import { afterEach, expect, it, vi } from "vitest";
import {
  readRenderJobs,
  renderAssetUrl,
  saveRenderJobs,
  validateRenderResult,
} from "./renderJobs";
import type { RenderJob } from "./renderJobs";
import * as normalize from "../api/normalize";
afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const job = (): RenderJob => ({
  localId: "local",
  binding: {
    runId: "run",
    proposalVersion: 2,
    variantIds: ["variant"],
    baselineAssetId: "baseline",
    partCatalogVersion: "catalog",
  },
  requestId: null,
  submission: {
    key: "key",
    kind: "create",
    body: {
      proposal_set_version: 2,
      variant_ids: ["variant"],
      baseline_asset_id: "baseline",
    },
  },
});
it("restores only validated command metadata, never stored assets, errors or automatic POST flags", () => {
  const saved = {
    ...job(),
    result: { assets: [{ url: "https://fake.invalid" }] },
    error: "old",
    autoSubmit: true,
  };
  sessionStorage.setItem("jobs", JSON.stringify([saved]));
  expect(readRenderJobs("jobs", "run")).toEqual([job()]);
});
it.each([
  [
    "wrong run",
    (j: RenderJob) => {
      j.binding.runId = "another";
    },
  ],
  [
    "version mismatch",
    (j: RenderJob) => {
      j.binding.proposalVersion = 3;
    },
  ],
  [
    "unknown extra command field",
    (j: RenderJob) => {
      (j.submission!.body as unknown as Record<string, unknown>).extra = true;
    },
  ],
  [
    "duplicate variant IDs",
    (j: RenderJob) => {
      j.binding.variantIds.push("variant");
    },
  ],
  [
    "accepted job with pending command",
    (j: RenderJob) => {
      j.requestId = "accepted";
    },
  ],
  [
    "invalid request ID",
    (j: RenderJob) => {
      j.requestId = "" as string;
      j.submission = null;
    },
  ],
])("rejects saved %s", (name, mutate) => {
  const value = job();
  mutate(value);
  sessionStorage.setItem("jobs", JSON.stringify([value]));
  expect(readRenderJobs("jobs", "run")).toEqual([]);
});
it("retains recovery in memory when session storage is disabled without sharing APIs or runs", () => {
  vi.stubGlobal("sessionStorage", {
    getItem: () => null,
    clear: () => {},
    setItem: () => {
      throw new Error("disabled");
    },
  });
  const api = {} as never;
  saveRenderJobs("jobs", [job()], api, "run");
  expect(readRenderJobs("jobs", "run", api)).toEqual([
    { ...job(), autoSubmit: false },
  ]);
  expect(readRenderJobs("jobs", "other", api)).toEqual([]);
  expect(readRenderJobs("jobs", "run", {} as never)).toEqual([]);
});
it("validates every render binding and rejects dangling assets before consumption", () => {
  const accepted = { ...job(), requestId: "accepted", submission: null };
  const wire = {
    render_request_id: "accepted",
    proposal_set_version: 2,
    variant_ids: ["variant"],
    baseline_asset_id: "baseline",
    part_catalog_version: "catalog",
    status: "succeeded" as const,
    assets: [
      {
        asset_id: "asset",
        url: "https://example.test/asset",
        media_type: "image/png",
      },
    ],
    outcomes: [
      {
        change_id: "change",
        outcome: "rendered" as const,
        asset_ids: ["asset"],
      },
    ],
  };
  expect(() =>
    validateRenderResult(normalize.render(wire), accepted),
  ).not.toThrow();
  for (const patch of [
    { render_request_id: "other" },
    { proposal_set_version: 1 },
    { variant_ids: ["other"] },
    { baseline_asset_id: "other" },
    { part_catalog_version: "other" },
    {
      outcomes: [
        {
          change_id: "change",
          outcome: "rendered" as const,
          asset_ids: ["missing"],
        },
      ],
    },
    { assets: [wire.assets[0], wire.assets[0]] },
  ])
    expect(() =>
      validateRenderResult(normalize.render({ ...wire, ...patch }), accepted),
    ).toThrow();
});
it.each([
  "javascript:alert(1)",
  "data:text/html,test",
  "https://user:secret@example.test/asset",
])("rejects unsafe asset link %s", (value) => {
  expect(renderAssetUrl(value)).toBeNull();
});
it("returns canonical safe asset addresses", () => {
  expect(renderAssetUrl("https://assets.example/path")).toBe(
    "https://assets.example/path",
  );
});
