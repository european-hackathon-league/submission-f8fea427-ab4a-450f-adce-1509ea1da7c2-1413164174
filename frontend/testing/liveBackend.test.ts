// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { commandKey, createRealApi } from "../src/api/client";
import type * as Wire from "../src/api/wire";
import catalog from "../public/vehicles/scene-catalog-v1.json";

// Opt-in: creates persistent synthetic data and uses the configured AI provider.
it.skipIf(import.meta.env.MODE !== "live")("completes the real upload-to-decision and export flow through Vite", async () => {
  const base = process.env.LIVE_API_BASE_URL || "http://127.0.0.1:5173/api/v1";
  const api = createRealApi(base, { headers: () => ({
    Authorization: `Bearer ${process.env.LIVE_API_TOKEN || "development:pm_demo"}`,
    "X-Workspace-ID": process.env.LIVE_WORKSPACE_ID || "workspace_demo",
  }) });
  const vehicles = await api.vehicles!();
  const vehicle = vehicles.find(v => v.vehicle_id === catalog.vehicle_id)!;
  expect(vehicle?.baseline_asset_id).toBe(catalog.baseline_asset_id);
  expect(vehicle.part_catalog_version).toBe(catalog.part_catalog_version);
  const bytes = await readFile(new URL("./fixtures/integration-feedback.xlsx", import.meta.url));
  const source = await api.upload(new File([bytes], "integration-feedback.xlsx"));
  expect(source.status, source.reason ?? "").toBe("ready");
  const original = await api.readSource!(api.sourceUrl!(source.source_id), new AbortController().signal);
  expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes);
  const accepted = await api.request<Wire.RunAccepted>("/runs", {
    vehicle_id: vehicle.vehicle_id,
    baseline_asset_id: vehicle.baseline_asset_id,
    part_catalog_version: vehicle.part_catalog_version,
    source_ids: [source.source_id], market_context: [],
    participation_mode: "autonomous", deep_dive: { enabled: false },
  }, commandKey());
  console.info(`Live integration run: ${accepted.run_id}`);
  const root = `/runs/${accepted.run_id}`;
  expect((await api.workspace(accepted.run_id)).snapshot.run_id).toBe(accepted.run_id);
  await expect.poll(async () => {
    const snapshot = await api.request<Wire.Snapshot>(root);
    if (snapshot.analysis_status === "failed") throw new Error(JSON.stringify(snapshot));
    return snapshot.analysis_status;
  }, { timeout: 240_000, interval: 2000 }).toBe("proposals_ready");
  const workspace = await api.workspace(accepted.run_id);
  expect(workspace.counts?.total_records).toBe(2);
  expect(workspace.findings.length).toBeGreaterThan(0);
  expect(workspace.findings.some(f => f.part_ids.includes("seats"))).toBe(true);
  const finding = workspace.findings[0];
  const evidence = await api.request<Wire.Evidence>(`${root}/evidence/${finding.supporting_evidence_ids[0]}`);
  expect(evidence.excerpt).toContain("Synthetic integration feedback");
  const stream = await api.events!(accepted.run_id, 0, null, new AbortController().signal);
  expect(stream.ok).toBe(true);
  const reader = stream.body!.getReader();
  try {
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("data:");
  } finally { await reader.cancel(); }
  const proposals = workspace.proposals;
  const variant = proposals.variants[0];
  expect(variant.changes.length).toBeGreaterThan(0);
  await api.request(`${root}/decisions`, {
    action: "approve", change_ids: [variant.changes[0].change_id],
    proposal_set_version: proposals.proposal_set_version,
    variant_id: variant.variant_id, rationale: "Synthetic integration acceptance",
  }, commandKey());
  const refreshed = await api.workspace(accepted.run_id);
  expect(refreshed.proposals.variants[0].changes[0].decision_state).toBe("approved");
  expect(refreshed.history.length).toBeGreaterThan(workspace.history.length);
  const revisedText = "Improve front seat cushioning for long journeys (synthetic PM edit).";
  await api.request(`${root}/instructions`, {
    operation: "edit_change", base_proposal_set_version: proposals.proposal_set_version,
    variant_id: variant.variant_id, change_id: variant.changes[0].change_id,
    fields: { after: revisedText },
  }, commandKey());
  await expect.poll(async () => (await api.request<Wire.Snapshot>(root)).current_proposal_set_version,
    { timeout: 60_000, interval: 1000 }).toBe(proposals.proposal_set_version + 1);
  expect((await api.workspace(accepted.run_id)).proposals.variants[0].changes[0].after).toBe(revisedText);
  const groupedCohorts = variant.cohort_scope.slice(0, 1);
  await api.request(`${root}/instructions`, {
    operation: "regroup_variants", base_proposal_set_version: proposals.proposal_set_version + 1,
    target_ids: [variant.variant_id], changed_fields: { cohort_ids: groupedCohorts },
  }, commandKey());
  await expect.poll(async () => (await api.request<Wire.Snapshot>(root)).current_proposal_set_version,
    { timeout: 30_000, interval: 1000 }).toBe(proposals.proposal_set_version + 2);
  const regrouped = await api.workspace(accepted.run_id);
  expect(regrouped.proposals.variants[0].cohort_scope).toEqual(groupedCohorts);
  expect(regrouped.counts).toEqual(workspace.counts);
  // Export the original version even after a PM edit creates a newer version.
  for (const format of ["json", "xlsx"] as const) {
    const job = await api.request<Wire.Accepted>(`${root}/exports`, {
      format, proposal_set_version: proposals.proposal_set_version,
      variant_ids: [variant.variant_id],
    }, commandKey());
    let result: Wire.ExportResult;
    await expect.poll(async () => {
      result = await api.request<Wire.ExportResult>(`${root}/exports/${job.resource_id}`);
      return result.status;
    }, { timeout: 30_000, interval: 500 }).toBe("ready");
    const download = await api.readAsset!(result!.download_url!, new AbortController().signal);
    expect(download.size).toBeGreaterThan(0);
    if (format === "json") expect(JSON.parse(await download.text())).toBeTypeOf("object");
    else expect(new Uint8Array(await download.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([80, 75]));
  }
}, 300_000);
