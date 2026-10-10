// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import openapi from "../fixtures/openapi.json";
import schemas from "../fixtures/schemas.json";
import { consumeEvents, recoverRun } from "../src/runRecovery";
import { createRealApi } from "../src/api/client";
import type {
  Api,
  Workspace,
  ProposalSet,
  RenderResult as ViewRender,
} from "../src/api/contracts";
import type * as Wire from "../src/api/wire";
import { startContractHarness } from "./contractHarness";

const names = [
  "standard_autonomous",
  "deep_dive_success",
  "deep_dive_partial",
  "guided_conflict",
  "duplicate_uploads",
  "pm_edit_stale",
  "render_partial",
  "render_late",
  "reconnect",
  "versioned_export",
] as const;
const defs = JSON.parse(
  JSON.stringify(openapi.components.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
function valid(name: string, value: unknown) {
  let validate = validators.get(name);
  if (!validate) {
    validate = ajv.compile(
      name === "Event"
        ? schemas.Event
        : { $ref: `#/$defs/${name}`, $defs: defs },
    );
    validators.set(name, validate);
  }
  expect(validate(value), `${name}: ${ajv.errorsText(validate.errors)}`).toBe(
    true,
  );
}
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
async function setup(scenario: string) {
  const harness = await startContractHarness({ scenario });
  cleanup.push(async () => {
    try {
      expect(harness.validationErrors).toEqual([]);
    } finally {
      await harness.close();
    }
  });
  const api = createRealApi(harness.baseUrl, {
    headers: () => harness.headers,
  });
  const vehicles = await api.vehicles!();
  vehicles.forEach((vehicle) => valid("Vehicle", vehicle.wire));
  const vehicle = vehicles.find(
    (item) => item.baseline_asset_id && item.part_catalog_version,
  )!;
  expect(vehicle).toBeDefined();
  const file = new File(
    ["contract-valid synthetic upload bytes"],
    "feedback.xlsx",
    {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  );
  const source = await api.upload(file);
  valid("UploadResult", source);
  expect(source.status).toBe("ready");
  const config: Wire.RunConfig = {
    vehicle_id: vehicle.vehicle_id,
    baseline_asset_id: vehicle.baseline_asset_id!,
    part_catalog_version: vehicle.part_catalog_version!,
    source_ids: [source.source_id],
    market_context: ["Europe"],
    participation_mode:
      scenario === "guided_conflict" ? "guided" : "autonomous",
    deep_dive: { enabled: scenario.startsWith("deep_dive") },
  };
  valid("RunConfig", config);
  const accepted = await api.request<Wire.RunAccepted>(
    "/runs",
    config,
    "create-run",
  );
  valid("RunAccepted", accepted);
  const root = `/runs/${encodeURIComponent(accepted.run_id)}`;
  const workspace = await api.workspace(accepted.run_id);
  checkWorkspace(workspace);
  return { harness, api, file, source, config, accepted, root, workspace };
}
function acceptedPayload(value: Wire.Accepted) {
  return {
    command_id: value.command_id,
    resource_id: value.resource_id,
    resource_url: value.resource_url,
  };
}
function checkWorkspace(workspace: Workspace) {
  valid("Snapshot", workspace.snapshot.wire);
  valid("Proposals", workspace.proposals.wire);
  valid("Graph", workspace.graph.wire);
  valid("Conflicts", workspace.conflicts);
  workspace.findings.forEach((finding) => valid("Finding", finding.wire));
  workspace.research.forEach((research) => valid("Research", research.wire));
  expect(workspace.proposals.wire?.run_id).toBe(workspace.snapshot.run_id);
  expect(workspace.proposals.proposal_set_version).toBe(
    workspace.snapshot.current_proposal_set_version,
  );
}
async function published(api: Api, runId: string, version: number) {
  for (let n = 0; n < 8; n++) {
    const workspace = await api.workspace(runId);
    if (workspace.proposals.proposal_set_version === version) {
      checkWorkspace(workspace);
      return workspace;
    }
  }
  throw new Error(`Proposal version ${version} never published`);
}
async function edit(
  api: Api,
  root: string,
  workspace: Workspace,
  key = "edit",
) {
  const change = workspace.proposals.variants[0].changes[0];
  const body: Wire.Instruction = {
    operation: "edit_change",
    base_proposal_set_version: workspace.proposals.proposal_set_version,
    target_ids: [change.change_id],
    changed_fields: { after: "Network verified scoped proposal draft" },
  };
  valid("Instruction", body);
  const accepted = await api.request<Wire.Accepted>(
    `${root}/instructions`,
    body,
    key,
  );
  valid("Accepted", acceptedPayload(accepted));
  return { change, body, accepted };
}
async function render(
  api: Api,
  root: string,
  workspace: Workspace,
  key: string,
) {
  const body: Wire.RenderCommand = {
    proposal_set_version: workspace.proposals.proposal_set_version,
    variant_ids: workspace.proposals.variants.map(
      (variant) => variant.variant_id,
    ),
    baseline_asset_id: workspace.snapshot.config.baseline_asset_id,
  };
  valid("RenderCommand", body);
  const accepted = await api.request<Wire.Accepted>(
    `${root}/renders`,
    body,
    key,
  );
  valid("Accepted", acceptedPayload(accepted));
  return { accepted, body };
}
async function finishRender(api: Api, root: string, id: string) {
  for (let n = 0; n < 12; n++) {
    const result = await api.request<ViewRender>(
      `${root}/renders/${encodeURIComponent(id)}`,
    );
    valid("RenderResult", result.wire);
    if (!["queued", "rendering"].includes(result.status)) return result;
  }
  throw new Error("Render never reached terminal state");
}
async function exportVersion(
  api: Api,
  root: string,
  proposal: ProposalSet,
  key: string,
) {
  const body: Wire.ExportCommand = {
    proposal_set_version: proposal.proposal_set_version,
    variant_ids: proposal.variants.map((variant) => variant.variant_id),
    format: "json",
  };
  valid("ExportCommand", body);
  const accepted = await api.request<Wire.Accepted>(
    `${root}/exports`,
    body,
    key,
  );
  valid("Accepted", acceptedPayload(accepted));
  for (let n = 0; n < 8; n++) {
    const result = await api.request<Wire.ExportResult>(
      `${root}/exports/${encodeURIComponent(accepted.resource_id)}`,
    );
    valid("ExportResult", result);
    if (result.status === "ready") return { accepted, result, body };
  }
  throw new Error("Export never became ready");
}

it.each(names)(
  "%s: real HTTP adapter consumes coherent published resources",
  async (scenario) => {
    const { api, file, source, accepted, root, workspace } =
      await setup(scenario);
    expect(api.mode).toBe("real");
    expect(workspace.findings.length).toBeGreaterThan(0);
    const counts = JSON.stringify(
      workspace.findings.map((finding) => finding.counts),
    );
    if (scenario === "standard_autonomous")
      expect(workspace.snapshot.analysis_status).not.toBe("waiting_for_pm");
    if (scenario.startsWith("deep_dive")) {
      expect(workspace.research.length).toBeGreaterThan(0);
      expect(
        workspace.research.every(
          (item) =>
            item.status ===
            (scenario === "deep_dive_success" ? "ready" : "partial"),
        ),
      ).toBe(true);
      const citation = workspace.research.flatMap((item) =>
        item.wire!.claims.flatMap((claim) => claim.evidence_ids),
      )[0];
      expect(citation).toBeTruthy();
      const evidence = await api.request<
        import("../src/api/contracts").Evidence
      >(`${root}/evidence/${encodeURIComponent(citation)}`);
      valid("Evidence", evidence.wire);
      if (scenario === "deep_dive_partial") {
        workspace.research.forEach((item) =>
          expect(item.recommendation).toBe(item.wire!.recommendation ?? ""),
        );
        expect(workspace.research.some((item) => item.gaps.length)).toBe(true);
      }
      expect(
        JSON.stringify(
          (await api.workspace(accepted.run_id)).findings.map(
            (finding) => finding.counts,
          ),
        ),
      ).toBe(counts);
    }
    if (scenario === "duplicate_uploads") {
      const duplicate = await api.upload(file);
      expect(duplicate.source_id).toBe(source.source_id);
      expect(
        JSON.stringify(
          (await api.workspace(accepted.run_id)).findings.map(
            (finding) => finding.counts,
          ),
        ),
      ).toBe(counts);
    }
    if (scenario === "guided_conflict") {
      const checkpoint = workspace.checkpoint!.wire!;
      expect(checkpoint.wait_state).toBe("waiting");
      expect(checkpoint.allowed_actions).toContain("regroup_variants");
      const knownCohorts = [
        ...new Set(
          workspace.conflicts!.conflicts.flatMap((conflict) =>
            conflict.alternatives.flatMap((scope) => scope.cohort_ids ?? []),
          ),
        ),
      ];
      expect(knownCohorts.length).toBeGreaterThan(0);
      const regrouped = workspace.proposals.variants[0].variant_id;
      const assigned = [knownCohorts.at(-1)!];
      const continuation: Wire.Continuation = {
        checkpoint_version: checkpoint.version,
        resolution: "regroup_variants",
        cohort_assignments: { [regrouped]: assigned },
      };
      valid("Continuation", continuation);
      const first = await api.request<Wire.Accepted>(
        `${root}/checkpoints/${encodeURIComponent(checkpoint.checkpoint_id)}/continue`,
        continuation,
        "continue",
      );
      expect(
        await api.request(
          `${root}/checkpoints/${encodeURIComponent(checkpoint.checkpoint_id)}/continue`,
          continuation,
          "continue",
        ),
      ).toEqual(first);
      const next = await api.workspace(accepted.run_id);
      expect(next.snapshot.analysis_status).not.toBe("waiting_for_pm");
      expect(
        next.proposals.variants.find(
          (variant) => variant.variant_id === regrouped,
        )?.cohort_scope,
      ).toEqual(assigned);
      expect(
        next.history.filter(
          (entry) => entry.description === "PM selected regroup_variants",
        ),
      ).toHaveLength(1);
      expect(
        JSON.stringify(next.findings.map((finding) => finding.counts)),
      ).toBe(counts);
    }
    if (scenario === "pm_edit_stale") {
      const change = workspace.proposals.variants[0].changes[0];
      const draft = "Retained network draft";
      const body: Wire.Instruction = {
        operation: "edit_change",
        base_proposal_set_version: workspace.proposals.proposal_set_version,
        target_ids: [change.change_id],
        changed_fields: { after: draft },
      };
      await expect(
        api.request(`${root}/instructions`, body, "stale"),
      ).rejects.toMatchObject({ code: "stale_version", status: 409 });
      const fresh = await api.workspace(accepted.run_id);
      expect(body.changed_fields.after).toBe(draft);
      expect(fresh.proposals.proposal_set_version).toBeGreaterThan(
        body.base_proposal_set_version,
      );
      await api.request(
        `${root}/instructions`,
        {
          ...body,
          base_proposal_set_version: fresh.proposals.proposal_set_version,
        },
        "reconciled",
      );
      const next = await published(
        api,
        accepted.run_id,
        fresh.proposals.proposal_set_version + 1,
      );
      expect(
        next.proposals.variants
          .flatMap((variant) => variant.changes)
          .find((item) => item.change_id === change.change_id)?.after,
      ).toBe(draft);
      expect(
        JSON.stringify(next.findings.map((finding) => finding.counts)),
      ).toBe(counts);
    }
    if (scenario === "render_partial") {
      const request = await render(api, root, workspace, "render");
      const result = await finishRender(
        api,
        root,
        request.accepted.resource_id,
      );
      expect(result.status).toBe("partial");
      expect(result.assets.length).toBeGreaterThan(0);
      expect(
        result.outcomes.some((outcome) => outcome.status === "unsupported"),
      ).toBe(true);
      expect(
        result
          .wire!.outcomes.flatMap((outcome) => outcome.asset_ids)
          .every((id) => result.assets.some((asset) => asset.asset_id === id)),
      ).toBe(true);
    }
    if (scenario === "render_late") {
      const old = await render(api, root, workspace, "old");
      await edit(api, root, workspace);
      const next = await published(api, accepted.run_id, 2);
      const current = await render(api, root, next, "current");
      const late = await finishRender(api, root, old.accepted.resource_id);
      const latest = await finishRender(
        api,
        root,
        current.accepted.resource_id,
      );
      expect(late.proposal_set_version).toBe(1);
      expect(late.wire!.stale).toBe(true);
      expect(latest.proposal_set_version).toBe(2);
      expect(latest.wire!.stale).toBe(false);
      expect(late.assets[0].asset_id).not.toBe(latest.assets[0].asset_id);
    }
    if (scenario === "versioned_export") {
      await edit(api, root, workspace);
      await published(api, accepted.run_id, 2);
      const earlier = await api.request<ProposalSet>(
        `${root}/proposals?proposal_set_version=1`,
      );
      expect(earlier.wire).toEqual(workspace.proposals.wire);
      const exported = await exportVersion(
        api,
        root,
        earlier,
        "export-earlier",
      );
      expect(exported.result.manifest.proposal_set_version).toBe(1);
      expect(exported.result.manifest.variant_ids).toEqual(
        exported.body.variant_ids,
      );
      expect(exported.result.download_url).toBeTruthy();
      const download = await fetch(
        api.linkUrl!(exported.result.download_url!)!,
      );
      expect(download.ok).toBe(true);
      const artifact = await download.json();
      expect(artifact.proposal_set_version).toBe(1);
      expect(artifact.proposals).toEqual(earlier.wire);
      expect(artifact.variant_ids).toEqual(exported.body.variant_ids);
    }
  },
);

it("completes upload to exact evidence, edit, bound annotation and authoritative export over HTTP", async () => {
  const { harness, api, accepted, root, workspace, source, file } = await setup(
    "standard_autonomous",
  );
  const finding = workspace.findings[0];
  expect(finding.supporting_evidence_ids.length).toBeGreaterThan(0);
  const evidence = await api.request<import("../src/api/contracts").Evidence>(
    `${root}/evidence/${encodeURIComponent(finding.supporting_evidence_ids[0])}`,
  );
  valid("Evidence", evidence.wire);
  expect(evidence.evidence_id).toBe(finding.supporting_evidence_ids[0]);
  expect(evidence.source_version_id).toBeTruthy();
  expect(evidence.wire!.locator).toBeDefined();
  const sourceUrl = evidence.source_url ?? api.sourceUrl!(source.source_id);
  expect(api.canReadSource!(sourceUrl)).toBe(true);
  const content = await api.readSource!(
    sourceUrl,
    new AbortController().signal,
  );
  expect(content.size).toBeGreaterThan(0);
  expect(await content.text()).toBe(await file.text());
  const instruction = await edit(api, root, workspace);
  const next = await published(api, accepted.run_id, 2);
  const variant = next.proposals.variants.find((item) =>
    item.changes.some(
      (change) => change.change_id === instruction.change.change_id,
    ),
  )!;
  const change = variant.changes.find(
    (item) => item.change_id === instruction.change.change_id,
  )!;
  expect(change.after).toBe(instruction.body.changed_fields.after);
  expect(change.evidence_ids).toEqual(instruction.change.evidence_ids);
  const rendered = await render(api, root, next, "reimagine");
  const result = await finishRender(api, root, rendered.accepted.resource_id);
  expect(result.proposal_set_version).toBe(2);
  expect(result.wire!.variant_ids).toContain(variant.variant_id);
  expect(
    result.wire!.outcomes.some(
      (outcome) => outcome.change_id === change.change_id,
    ),
  ).toBe(true);
  const asset = result.wire!.assets[0];
  expect(asset).toBeDefined();
  const image = await fetch(api.linkUrl!(asset.url)!);
  expect(image.ok).toBe(true);
  expect(image.headers.get("content-type")).toContain("image/");
  expect(await image.text()).toContain("Synthetic");
  const exported = await exportVersion(
    api,
    root,
    next.proposals,
    "export-exact",
  );
  expect(exported.result.manifest.proposal_set_version).toBe(2);
  expect(exported.result.manifest.variant_ids).toEqual(
    rendered.body.variant_ids,
  );
  expect(exported.result.manifest.source_version_ids).toEqual(
    next.proposals.wire!.source_version_ids,
  );
  const link = api.linkUrl!(exported.result.download_url!)!;
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:/);
  const download = await fetch(link);
  expect(download.ok).toBe(true);
  const artifact = await download.json();
  expect(artifact.synthetic).toBe(true);
  expect(artifact.proposal_set_version).toBe(2);
  expect(artifact.proposals).toEqual(next.proposals.wire);
  expect(artifact.variant_ids).toEqual(exported.body.variant_ids);
  const commands = harness.requests.filter(
    (request) => request.method === "POST",
  );
  expect(
    commands.every((request) => Boolean(request.headers["idempotency-key"])),
  ).toBe(true);
  expect(commands.some((request) => request.path.includes("/renderer/"))).toBe(
    false,
  );
  const sourceRequest = harness.requests.find(
    (request) =>
      request.path.includes("/sources/") && request.path.endsWith("/content"),
  )!;
  expect(sourceRequest.headers.authorization).toBe(
    harness.headers.Authorization,
  );
  const downloadRequest = harness.requests.find((request) =>
    request.path.split("?")[0].endsWith("/download"),
  )!;
  expect(downloadRequest.headers.authorization).toBeUndefined();
});

it.each([401, 403])(
  "preserves HTTP%s access errors and stops automatic access retries",
  async (status) => {
    const harness = await startContractHarness({
      scenario: "standard_autonomous",
    });
    cleanup.push(async () => {
      try {
        expect(harness.validationErrors).toEqual([]);
      } finally {
        await harness.close();
      }
    });
    const api = createRealApi(harness.baseUrl, {
      headers: () => harness.headers,
    });
    harness.controls.failNext(
      "/vehicles",
      status,
      status === 401 ? "unauthorized" : "forbidden",
    );
    await expect(api.vehicles!()).rejects.toMatchObject({
      status,
      code: status === 401 ? "unauthorized" : "forbidden",
    });
    expect(
      harness.requests.filter((request) => request.path.endsWith("/vehicles")),
    ).toHaveLength(1);
    const vehicles = await api.vehicles!();
    expect(vehicles.length).toBeGreaterThan(0);
    const denied = await fetch(`${harness.baseUrl}/vehicles`);
    expect([401, 403]).toContain(denied.status);
  },
);

it("replays a disconnected exact command with the same idempotency key and body", async () => {
  const { harness, api, accepted, root, workspace } = await setup(
    "standard_autonomous",
  );
  harness.controls.disconnectNext(`${root}/instructions`);
  const instruction = await edit(
    api,
    root,
    workspace,
    "interrupted-original-key",
  );
  const attempts = harness.requests.filter((request) =>
    request.path.endsWith("/instructions"),
  );
  expect(attempts).toHaveLength(2);
  expect(attempts.map((request) => request.headers["idempotency-key"])).toEqual(
    ["interrupted-original-key", "interrupted-original-key"],
  );
  expect(attempts.map((request) => request.body)).toEqual([
    instruction.body,
    instruction.body,
  ]);
  const next = await published(api, accepted.run_id, 2);
  expect(next.proposals.proposal_set_version).toBe(2);
  expect(
    next.history.filter(
      (entry) =>
        entry.description === "PM instruction accepted; recomputation pending",
    ),
  ).toHaveLength(1);
});

it("keeps useful findings during HTTP research failure and recovers through retrieval only", async () => {
  const { harness, api, accepted, root, workspace } =
    await setup("deep_dive_partial");
  harness.controls.failNext(`${root}/research`, 503, "research_unavailable");
  const failed = await api.workspace(accepted.run_id);
  expect(failed.findings).toEqual(workspace.findings);
  expect(failed.proposals).toEqual(workspace.proposals);
  expect(failed.resourceErrors?.research).toBeTruthy();
  const recovered = await api.workspace(accepted.run_id);
  expect(recovered.resourceErrors?.research).toBeUndefined();
  expect(recovered.research.length).toBeGreaterThan(0);
  expect(
    harness.requests.filter(
      (request) =>
        request.method === "POST" && request.path.includes("/research"),
    ),
  ).toEqual([]);
});
it("does not retry denied original sources and later retrieves the same authorized content", async () => {
  const { harness, api, source } = await setup("standard_autonomous");
  const url = api.sourceUrl!(source.source_id);
  const path = new URL(url).pathname.replace("/api/v1", "");
  harness.controls.failNext(path, 403, "forbidden");
  await expect(
    api.readSource!(url, new AbortController().signal),
  ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  expect(
    harness.requests.filter((request) => request.path.endsWith("/content")),
  ).toHaveLength(1);
  const bytes = await api.readSource!(url, new AbortController().signal);
  expect(bytes.size).toBeGreaterThan(0);
});
it("transports schema-valid duplicated SSE frames, replay cursors and expired-cursor snapshot recovery", async () => {
  const { harness, api, accepted, root, workspace } = await setup("reconnect");
  const controller = new AbortController();
  await edit(api, root, workspace);
  const latest = await published(api, accepted.run_id, 2);
  harness.controls.duplicateNextEvents();
  const seen: Parameters<Parameters<typeof consumeEvents>[1]>[0][] = [];
  const response = await api.events!(
    accepted.run_id,
    latest.snapshot.last_event_sequence,
    null,
    controller.signal,
  );
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  await consumeEvents(response, async (event) => {
    valid("Event", event);
    seen.push(event);
    if (seen.length === 3) controller.abort();
  }).catch((error) => {
    if (!controller.signal.aborted) throw error;
  });
  expect(seen.length).toBeGreaterThan(1);
  expect(seen[0]).toEqual(seen[1]);
  expect(seen[2].sequence).toBeLessThan(seen[0].sequence);
  const last = seen[0];
  const replay = await api.events!(
    accepted.run_id,
    last.sequence,
    last.event_id,
    new AbortController().signal,
  );
  await replay.body?.cancel();
  const request = harness.requests
    .filter((item) => item.path.includes("/events"))
    .at(-1)!;
  expect(request.headers["last-event-id"]).toBe(last.event_id);
  expect(request.path).not.toContain("after_sequence=");
  expect(request.headers.authorization).toBe(harness.headers.Authorization);
  harness.controls.expireNextEvents();
  const recoveryController = new AbortController();
  let snapshots = 0;
  const statuses: string[] = [];
  await recoverRun(
    api,
    accepted.run_id,
    {
      workspace: (current) => {
        expect(current.snapshot.run_id).toBe(accepted.run_id);
        if (++snapshots === 2) recoveryController.abort();
      },
      status: (message) => statuses.push(message),
    },
    recoveryController.signal,
    0,
  );
  expect(snapshots).toBe(2);
  expect(
    statuses.some((status) => status.includes("Event replay unavailable")),
  ).toBe(true);
  expect(
    harness.requests.some(
      (item) => item.path.startsWith(`${root}/events`) && item.status === 410,
    ),
  ).toBe(true);
});

it("ignores duplicate and older HTTP event frames before reconnecting and stopping on access denial", async () => {
  const { harness, api, root, workspace, accepted } = await setup("reconnect");
  await edit(api, root, workspace);
  const latest = await published(api, accepted.run_id, 2);
  harness.controls.duplicateNextEvents();
  const controller = new AbortController();
  let connections = 0;
  const snapshots: Workspace[] = [];
  const statuses: string[] = [];
  const recoveringApi: Api = {
    ...api,
    events: async (...args) => {
      const response = await api.events!(...args);
      if (++connections === 1) {
        harness.controls.failNext(`${root}/events`, 403, "forbidden");
        harness.controls.closeEvents();
      }
      return response;
    },
  };
  try {
    await recoverRun(
      recoveringApi,
      accepted.run_id,
      {
        workspace: (value) => snapshots.push(value),
        status: (value) => statuses.push(value),
      },
      controller.signal,
      0,
    );
    expect(
      snapshots.map((value) => value.snapshot.last_event_sequence),
    ).toEqual([latest.snapshot.last_event_sequence]);
    expect(connections).toBe(2);
    expect(statuses.at(-1)).toMatch(/access|denied|synthetic/i);
    expect(
      harness.requests
        .filter((request) => request.path.includes("/events"))
        .map((request) => request.status),
    ).toEqual([200, 403]);
  } finally {
    controller.abort();
  }
});
