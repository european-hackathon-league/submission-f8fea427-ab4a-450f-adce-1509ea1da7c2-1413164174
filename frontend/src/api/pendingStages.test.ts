import { afterEach, expect, it, vi } from "vitest";
import scenarios from "../../fixtures/scenarios.json";
import { createRealApi } from "./client";

afterEach(() => vi.unstubAllGlobals());
it.each([409, 401])("loads a processing snapshot with pending findings but preserves access failures (%s)", async status => {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("/runs/run_demo")) return Response.json({
      ...scenarios.standard_autonomous.payloads.Snapshot,
      analysis_status: "processing", current_proposal_set_version: null,
    });
    if (url.endsWith("/findings") || url.endsWith("/graph")) return Response.json({
      code: status === 409 ? "stage_pending" : "unauthorized", message: "Not yet available",
    }, { status });
    if (url.endsWith("/conflicts")) return Response.json({ conflicts: [], checkpoints: [] });
    return Response.json({ items: [], next_cursor: null, revision: 1 });
  });
  const pending = createRealApi().workspace("run_demo");
  if (status === 401) await expect(pending).rejects.toMatchObject({ status: 401 });
  else {
    const workspace = await pending;
    expect(workspace.snapshot.analysis_status).toBe("processing");
    expect(workspace.findings).toEqual([]);
    expect(workspace.graph.nodes).toEqual([]);
    expect(workspace.counts).toBeUndefined();
  }
});
