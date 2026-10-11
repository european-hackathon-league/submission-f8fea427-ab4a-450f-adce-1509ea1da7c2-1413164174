import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createMockApi, createRealApi } from "./client";
import type {
  Api,
  Evidence,
  ProposalSet,
  RunConfig,
  RenderResult,
} from "./contracts";

afterEach(() => vi.unstubAllGlobals());

async function setup(api: Api, guided = false, deepDive = false) {
  const upload = await api.upload(new File(["feedback"], "regional.xlsx"));
  const config: RunConfig = {
    vehicle_id: "g60-i5-m60",
    baseline_asset_id: "i5-m60-exterior-v1",
    part_catalog_version: "g60-parts-v1",
    source_ids: [upload.source_id],
    market_context: ["Europe"],
    participation_mode: guided ? "guided" : "autonomous",
    deep_dive: { enabled: deepDive },
  };
  const run = await api.request<{ run_id: string }>(
    "/runs",
    config,
    "create-run",
  );
  const root = `/runs/${run.run_id}`;
  await api.workspace(run.run_id);
  return { root, config, run };
}

describe("application API boundary", () => {
  it("uses completed upload IDs and does not count duplicate file contents twice", async () => {
    const api = createMockApi();
    const first = await api.upload(new File(["same records"], "germany.xlsx"));
    const second = await api.upload(new File(["same records"], "europe.xlsx"));
    expect(first.source_id).toBe(second.source_id);
    const { config } = await setup(api);
    await expect(
      api.request(
        "/runs",
        { ...config, source_ids: ["/Users/customer/feedback.xlsx"] },
        "invalid-upload",
      ),
    ).rejects.toMatchObject({ code: "invalid_sources" });
  });
  it("replays identical command keys and rejects changed input", async () => {
    const api = createMockApi();
    const { config, run } = await setup(api);
    expect(await api.request("/runs", config, "create-run")).toEqual(run);
    await expect(
      api.request(
        "/runs",
        { ...config, deep_dive: { enabled: true } },
        "create-run",
      ),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });
  it("rejects stale edits atomically and leaves customer evidence unchanged", async () => {
    const api = createMockApi("pm_edit_stale");
    const { root, run } = await setup(api);
    const command = {
      operation: "edit_change",
      base_proposal_set_version: 1,
      variant_id: "variant-digital",
      change_id: "change-dashboard",
      fields: { after: "My change" },
    };
    await expect(
      api.request(`${root}/instructions`, command, "edit"),
    ).rejects.toMatchObject({ code: "stale_version", current_version: 2 });
    const before = await api.request<ProposalSet>(`${root}/proposals`);
    expect(before.variants[0].changes[0].after).toBe(
      "Keep frequent comfort controls reachable from the main display.",
    );
    await api.request(
      `${root}/instructions`,
      { ...command, base_proposal_set_version: 2 },
      "reconciled-edit",
    );
    const processing = await api.workspace(run.run_id);
    expect(processing.snapshot.analysis_status).toBe("processing");
    expect(processing.proposals.proposal_set_version).toBe(2);
    expect(
      (await api.workspace(run.run_id)).proposals.proposal_set_version,
    ).toBe(3);
    expect(
      (await api.request<Evidence>(`${root}/evidence/dashboard-E1`)).excerpt,
    ).toBe("Changing the climate setting should not take several screens.");
  });
  it("does not change uploaded-feedback counts when Deep Dive is enabled", async () => {
    const standard = createMockApi();
    const deep = createMockApi();
    const a = await setup(standard);
    const b = await setup(deep, false, true);
    const plain = await standard.workspace(a.run.run_id);
    const researched = await deep.workspace(b.run.run_id);
    expect(researched.findings[0].counts.negative_records).toBe(172);
    expect(plain.findings[0].counts).toEqual(researched.findings[0].counts);
    expect(researched.research[0].status).toBe("partial");
    expect(plain.research).toEqual([]);
  });
  it("binds renders to exact versions and reuses a repeated request without duplicate audit entries", async () => {
    const api = createMockApi();
    const { root, run } = await setup(api);
    const body = {
      proposal_set_version: 1,
      variant_ids: ["variant-digital"],
      baseline_asset_id: "i5-m60-exterior-v1",
    };
    const first = await api.request<{ render_request_id: string }>(
      `${root}/renders`,
      body,
      "render-1",
    );
    expect(await api.request(`${root}/renders`, body, "render-2")).toEqual(
      first,
    );
    const renderPath = `${root}/renders/${first.render_request_id}`;
    expect((await api.request<RenderResult>(renderPath)).status).toBe("queued");
    expect((await api.request<RenderResult>(renderPath)).status).toBe(
      "rendering",
    );
    const result = await api.request<RenderResult>(renderPath);
    expect(result.proposal_set_version).toBe(1);
    expect(result.status).toBe("partial");
    expect(
      (await api.workspace(run.run_id)).history.filter((h) =>
        h.description.startsWith("Render requested"),
      ),
    ).toHaveLength(1);
    await expect(
      api.request(
        `${root}/renders`,
        { ...body, proposal_set_version: 0 },
        "stale-render",
      ),
    ).rejects.toMatchObject({ code: "stale_version" });
  });
  it("checks checkpoint versions and does not apply an obsolete continuation", async () => {
    const api = createMockApi();
    const { root, run } = await setup(api, true);
    await expect(
      api.request(
        `${root}/checkpoints/checkpoint-comfort/continue`,
        { checkpoint_version: 0, selected_resolution: "continue" },
        "bad-checkpoint",
      ),
    ).rejects.toMatchObject({ code: "stale_checkpoint" });
    const body = {
      checkpoint_version: 1,
      selected_resolution: "continue",
    };
    await api.request(
      `${root}/checkpoints/checkpoint-comfort/continue`,
      body,
      "continue",
    );
    await api.request(
      `${root}/checkpoints/checkpoint-comfort/continue`,
      body,
      "continue",
    );
    expect(
      (await api.workspace(run.run_id)).history.filter((h) =>
        h.description.startsWith("PM selected"),
      ),
    ).toHaveLength(1);
  });
  it("sends multipart uploads and command versions through the real adapter and exposes stale responses", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url.endsWith("/uploads"))
        return new Response(
          JSON.stringify({
            sources: [
              {
                source_id: "server-source",
                filename: "input.xlsx",
                detected_type: "xlsx",
                status: "ready",
                reason: null,
              },
            ],
          }),
          { status: 200 },
        );
      return new Response(
        JSON.stringify({
          code: "stale_version",
          message: "Refresh current proposal.",
          current_version: 7,
        }),
        { status: 409 },
      );
    });
    const api = createRealApi("/api/v1");
    expect(
      (await api.upload(new File(["feedback"], "input.xlsx"))).source_id,
    ).toBe("server-source");
    expect(requests[0].init.body).toBeInstanceOf(FormData);
    await expect(
      api.request(
        "/runs/r/instructions",
        {
          operation: "edit_change",
          base_proposal_set_version: 6,
          target_ids: ["change-1"],
          changed_fields: { after: "Updated" },
        },
        "edit-key",
      ),
    ).rejects.toEqual(
      new ApiError("stale_version", "Refresh current proposal.", 7, 409),
    );
    expect(new Headers(requests[1].init.headers).get("Idempotency-Key")).toBe(
      "edit-key",
    );
    expect(new Headers(requests[1].init.headers).get("Content-Type")).toBe(
      "application/json",
    );
    expect(requests[1].init.credentials).toBe("include");
  });
});
