import type {
  Api,
  AuditEntry,
  Checkpoint,
  Evidence,
  Instruction,
  Page,
  ProposalSet,
  RenderResult,
  RunConfig,
  Snapshot,
  Upload,
  Workspace,
} from "./contracts";
import * as fixtures from "./fixtures";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public current_version: number | null = null,
  ) {
    super(message);
  }
}
export const commandKey = () => crypto.randomUUID();

async function readPages<T>(
  request: Api["request"],
  path: string,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page: Page<T> = await request(
      `${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    rows.push(...page.items);
    cursor = page.next_cursor;
    if (cursor && seen.has(cursor))
      throw new Error("Repeated pagination cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return rows;
}

function withWorkspace(api: Omit<Api, "workspace">): Api {
  return {
    ...api,
    async workspace(runId) {
      const root = `/runs/${encodeURIComponent(runId)}`;
      // Poll a coherent snapshot; retry if resources changed while loading.
      for (let attempt = 0; attempt < 3; attempt++) {
        const snapshot = await api.request<Snapshot>(root);
        const [findings, graph, research, conflicts, proposals, history] =
          await Promise.all([
            readPages<Workspace["findings"][number]>(
              api.request,
              `${root}/findings`,
            ),
            api.request<Workspace["graph"]>(`${root}/graph`),
            readPages<Workspace["research"][number]>(
              api.request,
              `${root}/research`,
            ),
            api.request<{ checkpoint: Checkpoint | null }>(`${root}/conflicts`),
            api.request<ProposalSet>(`${root}/proposals`),
            readPages<AuditEntry>(api.request, `${root}/history`),
          ]);
        const latest = await api.request<Snapshot>(root);
        if (
          latest.revision === snapshot.revision &&
          proposals.proposal_set_version ===
            snapshot.current_proposal_set_version
        )
          return {
            snapshot,
            findings,
            graph,
            research,
            checkpoint: conflicts.checkpoint,
            proposals,
            history,
          };
      }
      throw new Error(
        "Run changed during refresh. Retry to load a coherent version.",
      );
    },
  };
}

export function createRealApi(baseUrl = "/api/v1"): Api {
  async function send<T>(
    path: string,
    body?: unknown,
    key?: string,
  ): Promise<T> {
    const multipart = body instanceof FormData;
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      headers: {
        ...(body !== undefined && !multipart
          ? { "Content-Type": "application/json" }
          : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body:
        body === undefined
          ? undefined
          : multipart
            ? body
            : JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        error.code ?? "request_failed",
        error.message ?? `Request failed (${response.status})`,
        error.current_version ?? null,
      );
    }
    return response.json();
  }
  return withWorkspace({
    mode: "real",
    request: send,
    async upload(file) {
      const body = new FormData();
      body.append("file", file);
      return send<Upload>("/uploads", body, commandKey());
    },
  });
}

export function createMockApi(scenario = "standard_autonomous"): Api {
  let snapshot: Snapshot | null = null;
  let proposals = structuredClone(fixtures.proposals);
  let checkpoint: Checkpoint | null = null;
  const history: AuditEntry[] = [];
  const uploads = new Map<string, Upload>();
  const sourceContents = new Map<string, string>();
  const commands = new Map<string, { input: string; result: unknown }>();
  const renders = new Map<string, RenderResult>();
  const exports = new Map<
    string,
    { export_id: string; status: string; download_url: string }
  >();
  let staleInjected = false;
  let analysisPending = false;
  const record = (description: string, actor = "AI") =>
    history.push({
      event_id: `audit-${history.length + 1}`,
      occurred_at: new Date().toISOString(),
      actor,
      description,
      proposal_set_version: proposals.proposal_set_version,
    });
  const touch = () => {
    if (snapshot) {
      snapshot.revision++;
      snapshot.last_event_sequence++;
    }
  };
  const page = <T>(items: T[]): Page<T> => ({
    items: structuredClone(items),
    next_cursor: null,
  });
  async function request<T>(
    path: string,
    body?: unknown,
    key?: string,
  ): Promise<T> {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const input = JSON.stringify({ path, body });
    if (body !== undefined && !key)
      throw new ApiError(
        "missing_idempotency_key",
        "Mutation requires Idempotency-Key.",
      );
    const prior = key ? commands.get(key) : undefined;
    if (prior) {
      if (prior.input !== input)
        throw new ApiError(
          "idempotency_conflict",
          "Command key already used for different input.",
        );
      return structuredClone(prior.result) as T;
    }
    let result: unknown;
    if (path === "/vehicles") result = page(fixtures.vehicles);
    else if (path === "/runs" && body) {
      const config = body as RunConfig;
      const vehicle = fixtures.vehicles.find(
        (v) => v.vehicle_id === config.vehicle_id,
      );
      if (
        !vehicle?.baseline_asset_id ||
        vehicle.baseline_asset_id !== config.baseline_asset_id ||
        vehicle.part_catalog_version !== config.part_catalog_version
      )
        throw new ApiError(
          "invalid_asset",
          "Vehicle and baseline asset do not match.",
        );
      if (
        !config.source_ids.length ||
        config.source_ids.some((id) => uploads.get(id)?.status !== "ready")
      )
        throw new ApiError("invalid_sources", "Choose completed uploads.");
      if (snapshot)
        throw new ApiError(
          "run_exists",
          "Start a new workspace before creating another run.",
        );
      checkpoint =
        config.participation_mode === "guided"
          ? {
              checkpoint_id: "checkpoint-comfort",
              version: 1,
              question: "Choose the comfort-control approach.",
              alternatives: [
                {
                  id: "variant-digital",
                  title: "Persistent digital controls",
                  tradeoff:
                    "Preserves hardware; discoverability needs validation.",
                },
                {
                  id: "variant-physical",
                  title: "Dedicated comfort control",
                  tradeoff: "Tactile access; packaging and cost uncertain.",
                },
              ],
            }
          : null;
      snapshot = {
        run_id: "run-synthetic",
        contract_version: "1",
        config: structuredClone(config),
        analysis_status: "queued",
        stage: "Uploads accepted",
        revision: 1,
        last_event_sequence: 1,
        current_proposal_set_version: 1,
        available_actions: [],
        warnings: [
          "Synthetic scenario; uploaded contents are not analyzed.",
          "Partial package: baseline and coverage need validation.",
        ],
        part_aggregates: fixtures.findings.flatMap((f) =>
          f.part_ids.map((part_id) => ({ part_id, counts: f.counts })),
        ),
      };
      analysisPending = true;
      record("Run created with saved configuration", "System");
      result = { run_id: snapshot.run_id };
    } else {
      if (!snapshot || !path.startsWith(`/runs/${snapshot.run_id}`))
        throw new ApiError("not_found", "Run not found.");
      const resource = path.slice(`/runs/${snapshot.run_id}`.length);
      if (resource === "") {
        if (analysisPending) {
          analysisPending = false;
          snapshot.analysis_status = checkpoint
            ? "waiting_for_pm"
            : "proposals_ready";
          snapshot.stage = checkpoint
            ? "Guided checkpoint"
            : "Proposals complete";
          snapshot.available_actions = checkpoint
            ? ["continue_checkpoint"]
            : ["edit", "reimagine", "export"];
          touch();
        }
        result = snapshot;
      } else if (resource === "/findings") result = page(fixtures.findings);
      else if (resource === "/graph") result = fixtures.graph;
      else if (resource === "/research")
        result = page(
          snapshot.config.deep_dive.enabled
            ? fixtures.research.map((r) =>
                scenario === "deep_dive_success"
                  ? { ...r, status: "ready" as const, gaps: [] }
                  : r,
              )
            : [],
        );
      else if (resource === "/conflicts") result = { checkpoint };
      else if (resource === "/proposals") result = proposals;
      else if (resource === "/history") result = page(history);
      else if (resource.startsWith("/evidence/")) {
        result = fixtures.evidence.find(
          (e) => e.evidence_id === decodeURIComponent(resource.slice(10)),
        );
        if (!result) throw new ApiError("not_found", "Evidence not found.");
      } else if (resource === "/instructions" && body) {
        if (!snapshot.available_actions.includes("edit"))
          throw new ApiError(
            "action_unavailable",
            "Editing unavailable in current run state.",
          );
        const instruction = body as Instruction;
        if (scenario === "pm_edit_stale" && !staleInjected) {
          staleInjected = true;
          proposals.proposal_set_version++;
          snapshot.current_proposal_set_version++;
          touch();
        }
        if (
          instruction.base_proposal_set_version !==
          proposals.proposal_set_version
        )
          throw new ApiError(
            "stale_version",
            "Proposal changed. Your draft is retained; reconcile against the current version.",
            proposals.proposal_set_version,
          );
        const next = structuredClone(proposals);
        const variant = next.variants.find(
          (v) => v.variant_id === instruction.variant_id,
        );
        if (!variant) throw new ApiError("not_found", "Variant not found.");
        const change = variant.changes.find(
          (c) => c.change_id === instruction.change_id,
        );
        if (instruction.operation === "regroup_variants")
          variant.cohort_scope =
            instruction.fields.cohort_scope ?? variant.cohort_scope;
        else if (instruction.operation === "remove_change") {
          if (!change) throw new ApiError("not_found", "Change not found.");
          variant.changes = variant.changes.filter(
            (c) => c.change_id !== instruction.change_id,
          );
        } else if (instruction.operation === "add_change") {
          if (!instruction.fields.after?.trim())
            throw new ApiError("invalid_input", "Proposal text required.");
          variant.changes.push({
            change_id: `pm-change-${commandKey()}`,
            finding_id: "finding-unmapped",
            origin: "pm",
            part_ids: instruction.fields.part_ids ?? [],
            before: "PM-originated idea",
            after: instruction.fields.after.trim(),
            rationale: "PM instruction; not customer evidence.",
            evidence_ids: [],
            target: instruction.fields.target ?? "Validation pending",
            target_maturity: "proposed",
            assumptions: ["PM idea requires evidence and feasibility checks."],
            decision_state: "proposed",
          });
        } else {
          if (!change) throw new ApiError("not_found", "Change not found.");
          if (instruction.operation === "edit_change") {
            if (!instruction.fields.after?.trim())
              throw new ApiError("invalid_input", "Proposal text required.");
            change.after = instruction.fields.after.trim();
          } else if (instruction.operation === "edit_target")
            change.target = instruction.fields.target ?? change.target;
        }
        next.proposal_set_version++;
        proposals = next;
        snapshot.current_proposal_set_version = next.proposal_set_version;
        snapshot.analysis_status = "processing";
        snapshot.stage = "Recomputing proposals";
        snapshot.available_actions = [];
        analysisPending = true;
        touch();
        record("PM instruction accepted; proposals recomputed", "PM");
        result = { instruction_id: `instruction-${history.length}` };
      } else if (
        resource === "/checkpoints/checkpoint-comfort/continue" &&
        body
      ) {
        const command = body as {
          checkpoint_version: number;
          selected_resolution: string;
        };
        if (!checkpoint || command.checkpoint_version !== checkpoint.version)
          throw new ApiError(
            "stale_checkpoint",
            "Checkpoint has changed. Refresh before continuing.",
          );
        if (
          !checkpoint.alternatives.some(
            (a) => a.id === command.selected_resolution,
          )
        )
          throw new ApiError(
            "invalid_resolution",
            "Choose a checkpoint alternative.",
          );
        checkpoint = null;
        snapshot.analysis_status = "proposals_ready";
        snapshot.stage = "Proposals complete";
        snapshot.available_actions = ["edit", "reimagine", "export"];
        touch();
        record(`PM selected ${command.selected_resolution}`, "PM");
        result = { accepted: true };
      } else if (resource === "/renders" && body) {
        if (!snapshot.available_actions.includes("reimagine"))
          throw new ApiError(
            "action_unavailable",
            "Rendering unavailable in current run state.",
          );
        const command = body as {
          proposal_set_version: number;
          variant_ids: string[];
          baseline_asset_id: string;
        };
        if (command.proposal_set_version !== proposals.proposal_set_version)
          throw new ApiError(
            "stale_version",
            "Refresh proposals before rendering.",
            proposals.proposal_set_version,
          );
        if (
          command.baseline_asset_id !== snapshot.config.baseline_asset_id ||
          command.variant_ids.some(
            (id) => !proposals.variants.some((v) => v.variant_id === id),
          )
        )
          throw new ApiError(
            "invalid_render",
            "Render inputs do not match this run.",
          );
        const renderId = `render-${command.proposal_set_version}-${command.variant_ids.join("-")}`;
        if (!renders.has(renderId)) {
          renders.set(renderId, {
            render_request_id: renderId,
            proposal_set_version: command.proposal_set_version,
            variant_ids: command.variant_ids,
            status: "partial",
            assets: [],
            outcomes: proposals.variants
              .filter((v) => command.variant_ids.includes(v.variant_id))
              .flatMap((v) =>
                v.changes.map((c) => ({
                  change_id: c.change_id,
                  status: "annotated" as const,
                  reason:
                    "Digital change: annotation only. New geometry is unsupported by this development stub.",
                })),
              ),
          });
          record(
            `Render requested for proposal version ${command.proposal_set_version}`,
            "System",
          );
          touch();
        }
        result = { render_request_id: renderId };
      } else if (resource.startsWith("/renders/")) {
        result = renders.get(decodeURIComponent(resource.slice(9)));
        if (!result)
          throw new ApiError("not_found", "Render request not found.");
      } else if (resource === "/exports" && body) {
        if (!snapshot.available_actions.includes("export"))
          throw new ApiError(
            "action_unavailable",
            "Export unavailable in current run state.",
          );
        const command = body as {
          proposal_set_version: number;
          variant_ids: string[];
        };
        if (command.proposal_set_version !== proposals.proposal_set_version)
          throw new ApiError(
            "stale_version",
            "Refresh proposals before exporting.",
            proposals.proposal_set_version,
          );
        const exportId = `export-${command.proposal_set_version}`;
        const artifact = {
          synthetic: true,
          run_id: snapshot.run_id,
          ...command,
          proposals: proposals.variants.filter((v) =>
            command.variant_ids.includes(v.variant_id),
          ),
          source_version_ids: ["synthetic-source-v1"],
        };
        const download_url = URL.createObjectURL(
          new Blob([JSON.stringify(artifact, null, 2)], {
            type: "application/json",
          }),
        );
        exports.set(exportId, {
          export_id: exportId,
          status: "ready",
          download_url,
        });
        record(
          `Synthetic export prepared for proposal version ${command.proposal_set_version}`,
          "System",
        );
        touch();
        result = { export_id: exportId };
      } else if (resource.startsWith("/exports/")) {
        result = exports.get(decodeURIComponent(resource.slice(9)));
        if (!result) throw new ApiError("not_found", "Export not found.");
      } else
        throw new ApiError(
          "not_found",
          "Operation not supported by this mock.",
        );
    }
    if (key) commands.set(key, { input, result: structuredClone(result) });
    return structuredClone(result) as T;
  }
  return withWorkspace({
    mode: "mock",
    request,
    async upload(file) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (!/\.(csv|xlsx|xls|pdf|txt|docx)$/i.test(file.name))
        return {
          source_id: commandKey(),
          filename: file.name,
          status: "rejected",
          reason: "Unsupported file. Use CSV, XLSX, XLS, PDF, TXT or DOCX.",
        };
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer())).join(
        ",",
      );
      let sourceId = sourceContents.get(bytes);
      if (!sourceId) {
        sourceId = `source-${commandKey()}`;
        sourceContents.set(bytes, sourceId);
      }
      const result: Upload = {
        source_id: sourceId,
        filename: file.name,
        status: "ready",
        reason: null,
      };
      uploads.set(sourceId, result);
      return result;
    },
  });
}

export function createApi(): Api {
  return import.meta.env.VITE_API_MODE === "real"
    ? createRealApi(import.meta.env.VITE_API_BASE_URL || "/api/v1")
    : createMockApi(import.meta.env.VITE_MOCK_SCENARIO);
}
