import { afterEach, expect, it } from "vitest";
import { exportLink, readExportJob, saveExportJob } from "./exportJob";
import type { ExportJob } from "./exportJob";
import type { ExportResult } from "../api/wire";
const job: ExportJob = {
  key: "key",
  body: { proposal_set_version: 2, variant_ids: ["v"], format: "json" },
  sourceVersionIds: ["s"],
  resourceId: "e",
};
const result: ExportResult = {
  export_id: "e",
  status: "ready",
  manifest: {
    proposal_set_version: 2,
    variant_ids: ["v"],
    source_version_ids: ["s"],
  },
  download_url: "https://cdn.example/export",
};
afterEach(() => sessionStorage.clear());
it("accepts only exact ready export identity and manifest before exposing returned link", () => {
  expect(exportLink(result, job, "r", "real")).toBe(result.download_url);
  for (const bad of [
    { ...result, export_id: "other" },
    { ...result, manifest: { ...result.manifest, proposal_set_version: 3 } },
    { ...result, manifest: { ...result.manifest, variant_ids: ["other"] } },
    { ...result, manifest: { ...result.manifest, source_version_ids: [] } },
    { ...result, manifest: { ...result.manifest, run_id: "other" } },
  ])
    expect(() => exportLink(bad, job, "r", "real")).toThrow();
  expect(() =>
    exportLink(
      { ...result, download_url: "javascript:alert(1)" },
      job,
      "r",
      "real",
    ),
  ).toThrow();
  expect(() =>
    exportLink({ ...result, download_url: "blob:fake" }, job, "r", "real"),
  ).toThrow();
});
it("persists only validated pending command or accepted resource identity", () => {
  saveExportJob("job", job);
  expect(readExportJob("job")).toEqual(job);
  sessionStorage.setItem(
    "job",
    JSON.stringify({ ...job, body: { ...job.body, actor: "fake" } }),
  );
  expect(readExportJob("job")).toBeNull();
  sessionStorage.setItem(
    "job",
    JSON.stringify({ ...job, body: { ...job.body, proposal_set_version: 0 } }),
  );
  expect(readExportJob("job")).toBeNull();
});
it("checks provided research and scoring bindings without requiring unpublished manifest fields", () => {
  const bound = {
    ...job,
    researchIds: ["research-1"],
    scoringPolicyVersion: "policy-1",
  };
  expect(exportLink(result, bound, "r", "real")).toBe(result.download_url);
  expect(() =>
    exportLink(
      { ...result, manifest: { ...result.manifest, research_ids: ["wrong"] } },
      bound,
      "r",
      "real",
    ),
  ).toThrow();
  expect(() =>
    exportLink(
      {
        ...result,
        manifest: { ...result.manifest, scoring_policy_version: "wrong" },
      },
      bound,
      "r",
      "real",
    ),
  ).toThrow();
});
