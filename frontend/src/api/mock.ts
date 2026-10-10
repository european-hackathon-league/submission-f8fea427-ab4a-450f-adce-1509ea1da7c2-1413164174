import { ApiError, commandKey } from "./client";
import type { Send } from "./client";
import type * as Wire from "./wire";
import { wireFixtures } from "./fixtures";

export function createMockTransport(scenario: string): {
  send: Send;
  dispose: () => void;
} {
  let snapshot: Wire.Snapshot | null = null;
  let proposals = structuredClone(wireFixtures.proposals);
  let checkpoint: Wire.Checkpoint | null = null;
  const conflicts: Wire.Conflict[] = [
    {
      conflict_id: "conflict-comfort",
      version: 1,
      finding_ids: ["finding-dashboard"],
      alternatives: [
        { cohort_ids: ["Europe"] },
        { cohort_ids: ["North America"] },
      ],
      rationale: "Digital flexibility versus tactile access and hardware cost.",
      resolution_status: "unresolved",
    },
  ];
  const history: Wire.Audit[] = [];
  const uploads = new Map<string, Wire.UploadResult>();
  const contents = new Map<string, string>();
  const commands = new Map<string, { input: string; result: unknown }>();
  const renders = new Map<string, Wire.RenderResult>();
  const exports = new Map<string, Wire.ExportResult>();
  const blobUrls = new Set<string>();
  let pending = false;
  let staleInjected = false;
  let checkpointStaleInjected = false;
  let researchFailed = false;
  const touch = () => {
    if (snapshot) {
      snapshot.revision++;
      snapshot.last_event_sequence++;
    }
  };
  const record = (
    action: string,
    actor_type: Wire.Audit["actor_type"] = "service",
  ) =>
    history.push({
      audit_id: `audit-${history.length + 1}`,
      actor_id: actor_type,
      actor_type,
      action,
      occurred_at: new Date().toISOString(),
      resource_id: snapshot?.run_id ?? "run-synthetic",
      proposal_set_version: proposals.proposal_set_version,
      rationale: null,
    });
  const accepted = (
    resource_id: string,
    resource_url: string,
  ): Wire.Accepted => ({
    command_id: `command-${history.length}`,
    resource_id,
    resource_url,
  });
  const page = <T>(items: T[]) => ({
    items: structuredClone(items),
    revision: 1,
    next_cursor: null,
  });
  const send: Send = async <T>(
    path: string,
    body?: unknown,
    key?: string,
  ): Promise<T> => {
    const url = new URL(path, "https://frontend.invalid");
    const pathname = url.pathname;
    let input = JSON.stringify({ path, body });
    if (body instanceof FormData) {
      const files = body.getAll("files") as File[];
      input = JSON.stringify({
        path,
        files: await Promise.all(
          files.map(async (f) => ({
            name: f.name,
            bytes: Array.from(new Uint8Array(await f.arrayBuffer())),
          })),
        ),
      });
    }
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
          null,
          409,
        );
      return structuredClone(prior.result) as T;
    }
    let result: unknown;
    if (pathname === "/uploads" && body instanceof FormData) {
      const sources: Wire.UploadResult[] = [];
      for (const file of body.getAll("files") as File[]) {
        const detected_type: Wire.UploadResult["detected_type"] =
          /\.xlsx$/i.test(file.name)
            ? "xlsx"
            : /\.pdf$/i.test(file.name)
              ? "pdf"
              : "unsupported";
        if (detected_type === "unsupported") {
          sources.push({
            source_id: `rejected-${commandKey()}`,
            filename: file.name,
            detected_type,
            status: "rejected",
            reason: "Unsupported file. Use XLSX or PDF.",
          });
          continue;
        }
        const bytes = Array.from(new Uint8Array(await file.arrayBuffer())).join(
          ",",
        );
        let source_id = contents.get(bytes);
        if (!source_id) {
          source_id = `source-${commandKey()}`;
          contents.set(bytes, source_id);
        }
        const source: Wire.UploadResult = {
          source_id,
          filename: file.name,
          detected_type,
          status: "ready",
          reason: null,
        };
        uploads.set(source_id, source);
        sources.push(source);
      }
      result = { sources } satisfies Wire.Uploads;
    } else if (pathname === "/vehicles") result = page(wireFixtures.vehicles);
    else if (pathname === "/runs" && body) {
      const config = body as Wire.RunConfig;
      const vehicle = wireFixtures.vehicles.find(
        (v) => v.vehicle_id === config.vehicle_id,
      );
      if (
        !vehicle?.baseline_asset_ids.includes(config.baseline_asset_id) ||
        !vehicle.part_catalog_versions.includes(config.part_catalog_version)
      )
        throw new ApiError(
          "invalid_asset",
          "Vehicle and baseline asset do not match.",
          null,
          422,
        );
      if (
        !config.source_ids.length ||
        config.source_ids.some((id) => uploads.get(id)?.status !== "ready")
      )
        throw new ApiError(
          "invalid_sources",
          "Choose completed uploads.",
          null,
          422,
        );
      if (snapshot)
        throw new ApiError(
          "run_exists",
          "Start a new workspace before creating another run.",
          null,
          409,
        );
      checkpoint =
        config.participation_mode === "guided"
          ? {
              checkpoint_id: "checkpoint-comfort",
              version: 1,
              conflict_ids: ["conflict-comfort"],
              allowed_actions: ["continue", "regroup_variants"],
              wait_state: "waiting",
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
        current_proposal_set_version: null,
        available_actions: [],
        warnings: [
          "Synthetic scenario; uploaded contents are not analyzed.",
          "Partial package: baseline and coverage need validation.",
        ],
        resource_links: { proposals: "/api/v1/runs/run-synthetic/proposals" },
      };
      pending = true;
      record("Run created with saved configuration");
      result = {
        run_id: snapshot.run_id,
        snapshot_url: "/api/v1/runs/run-synthetic",
        events_url: "/api/v1/runs/run-synthetic/events",
      } satisfies Wire.RunAccepted;
    } else {
      if (!snapshot || !pathname.startsWith(`/runs/${snapshot.run_id}`))
        throw new ApiError("not_found", "Run not found.", null, 404);
      const resource = pathname.slice(`/runs/${snapshot.run_id}`.length);
      if (resource === "") {
        if (pending) {
          pending = false;
          snapshot.analysis_status =
            checkpoint?.wait_state === "waiting"
              ? "waiting_for_pm"
              : "proposals_ready";
          snapshot.stage =
            checkpoint?.wait_state === "waiting"
              ? "Guided checkpoint"
              : "Proposals complete";
          snapshot.current_proposal_set_version =
            proposals.proposal_set_version;
          snapshot.available_actions =
            checkpoint?.wait_state === "waiting"
              ? ["continue_checkpoint"]
              : ["edit", "reimagine", "export"];
          touch();
        }
        result = snapshot;
      } else if (resource === "/findings") result = wireFixtures.findings;
      else if (resource === "/graph") result = wireFixtures.graph;
      else if (resource === "/research") {
        if (
          scenario === "research_failure" &&
          snapshot.config.deep_dive?.enabled &&
          !researchFailed
        ) {
          researchFailed = true;
          throw new ApiError(
            "research_unavailable",
            "Synthetic research service interruption. Retry research while findings remain available.",
            null,
            503,
            true,
          );
        }
        const states: Record<string, Wire.Research["status"]> = {
          research_queued: "queued",
          research_searching: "searching",
          research_checking: "checking",
          research_unavailable: "unavailable",
          deep_dive_success: "ready",
          deep_dive_partial: "partial",
        };
        result = page(
          snapshot.config.deep_dive?.enabled
            ? wireFixtures.research.map((r) => ({
                ...r,
                status: states[scenario] ?? r.status,
                ...(states[scenario] === "ready" ? { gaps: [] } : {}),
              }))
            : [],
        );
      } else if (resource === "/conflicts")
        result = {
          conflicts,
          checkpoints: checkpoint ? [checkpoint] : [],
        } satisfies Wire.Conflicts;
      else if (resource === "/proposals") result = proposals;
      else if (resource === "/history") result = page(history);
      else if (resource.startsWith("/evidence/")) {
        result = wireFixtures.evidence.find(
          (e) => e.evidence_id === decodeURIComponent(resource.slice(10)),
        );
        if (!result)
          throw new ApiError("not_found", "Evidence not found.", null, 404);
      } else if (resource === "/instructions" && body) {
        if (!snapshot.available_actions.includes("edit"))
          throw new ApiError(
            "action_unavailable",
            "Editing unavailable in current run state.",
            null,
            409,
          );
        const command = body as Wire.Instruction;
        if (scenario === "pm_edit_stale" && !staleInjected) {
          staleInjected = true;
          proposals.proposal_set_version++;
          snapshot.current_proposal_set_version =
            proposals.proposal_set_version;
          touch();
        }
        if (
          command.base_proposal_set_version !== proposals.proposal_set_version
        )
          throw new ApiError(
            "stale_version",
            "Proposal changed. Your draft is retained; reconcile against the current version.",
            proposals.proposal_set_version,
            409,
          );
        const next = structuredClone(proposals);
        const variant = next.variants.find((v) =>
          command.target_ids.includes(v.variant_id),
        );
        const change = next.changes.find((c) =>
          command.target_ids.includes(c.change_id),
        );
        if (!variant)
          throw new ApiError("not_found", "Variant not found.", null, 404);
        if (command.operation === "regroup_variants") {
          const groups =
            command.changed_fields.cohort_scope ??
            command.changed_fields.cohort_ids;
          if (!Array.isArray(groups))
            throw new ApiError(
              "invalid_input",
              "Cohort IDs required.",
              null,
              422,
            );
          variant.cohort_ids = groups;
        } else if (command.operation === "remove_change") {
          if (!change)
            throw new ApiError("not_found", "Change not found.", null, 404);
          variant.change_ids = variant.change_ids.filter(
            (id) => id !== change.change_id,
          );
          if (
            !next.variants.some((v) => v.change_ids.includes(change.change_id))
          )
            next.changes = next.changes.filter(
              (c) => c.change_id !== change.change_id,
            );
        } else if (command.operation === "add_change") {
          if (
            typeof command.changed_fields.after !== "string" ||
            !command.changed_fields.after.trim()
          )
            throw new ApiError(
              "invalid_input",
              "Proposal text required.",
              null,
              422,
            );
          const c: Wire.Change = {
            ...structuredClone(wireFixtures.proposals.changes[0]),
            change_id: `pm-change-${commandKey()}`,
            requirement_id: `pm-requirement-${commandKey()}`,
            origin: "pm",
            finding_ids: [],
            supporting_evidence_ids: [],
            opposing_evidence_ids: [],
            part_ids: Array.isArray(command.changed_fields.part_ids)
              ? command.changed_fields.part_ids
              : [],
            before: null,
            after: command.changed_fields.after.trim(),
            outcome: "PM instruction; not customer evidence.",
            target: null,
            target_basis: null,
            validation_method: "Requires validation",
            uncertainty: ["PM idea requires evidence and feasibility checks."],
          };
          next.changes.push(c);
          variant.change_ids.push(c.change_id);
          variant.requirement_ids.push(c.requirement_id);
        } else {
          if (!change)
            throw new ApiError("not_found", "Change not found.", null, 404);
          if (command.operation === "edit_change") {
            const after = command.changed_fields.after;
            if (typeof after !== "string" || !after.trim())
              throw new ApiError(
                "invalid_input",
                "Proposal text required.",
                null,
                422,
              );
            change.after = after.trim();
          }
          if ("target" in command.changed_fields) {
            const target = command.changed_fields.target;
            if (
              target !== null &&
              (typeof target !== "number" || !Number.isFinite(target))
            )
              throw new ApiError(
                "invalid_input",
                "Target must be numeric or null.",
                null,
                422,
              );
            change.target = target;
          }
          change.version++;
        }
        next.proposal_set_version++;
        proposals = next;
        snapshot.current_proposal_set_version = next.proposal_set_version;
        snapshot.analysis_status = "processing";
        snapshot.stage = "Recomputing proposals";
        snapshot.available_actions = [];
        pending = true;
        touch();
        record("PM instruction accepted; proposals recomputed", "pm");
        result = accepted(
          `instruction-${history.length}`,
          `/api/v1/runs/${snapshot.run_id}/proposals`,
        );
      } else if (
        resource === "/checkpoints/checkpoint-comfort/continue" &&
        body
      ) {
        const command = body as Wire.Continuation;
        if (
          scenario === "guided_checkpoint_stale" &&
          checkpoint &&
          !checkpointStaleInjected
        ) {
          checkpointStaleInjected = true;
          checkpoint.version++;
          touch();
        }
        if (
          !checkpoint ||
          checkpoint.wait_state !== "waiting" ||
          command.checkpoint_version !== checkpoint.version
        )
          throw new ApiError(
            "stale_checkpoint",
            "Checkpoint has changed. Refresh before continuing.",
            checkpoint?.version ?? null,
            409,
          );
        if (!checkpoint.allowed_actions.includes(command.resolution))
          throw new ApiError(
            "invalid_resolution",
            "Choose a checkpoint resolution.",
            null,
            422,
          );
        const assignments = command.cohort_assignments ?? {};
        const cohortIds = new Set([
          ...wireFixtures.findings.items.flatMap(
            (finding) => finding.cohort_ids,
          ),
          ...proposals.variants.flatMap((variant) => variant.cohort_ids),
          ...conflicts.flatMap((conflict) =>
            conflict.alternatives.flatMap((scope) => scope.cohort_ids ?? []),
          ),
        ]);
        if (
          command.resolution === "regroup_variants" &&
          !Object.keys(assignments).length
        )
          throw new ApiError(
            "invalid_cohort",
            "Choose existing cohorts for at least one variant.",
            null,
            422,
          );
        if (
          command.resolution !== "regroup_variants" &&
          Object.keys(assignments).length
        )
          throw new ApiError(
            "invalid_resolution",
            "Cohort assignments require the supported regroup action.",
            null,
            422,
          );
        for (const [variantId, ids] of Object.entries(assignments)) {
          if (
            !proposals.variants.some(
              (variant) => variant.variant_id === variantId,
            ) ||
            !Array.isArray(ids) ||
            !ids.length ||
            ids.some((id) => !cohortIds.has(id)) ||
            new Set(ids).size !== ids.length
          )
            throw new ApiError(
              "invalid_cohort",
              "Choose existing variant and cohort IDs from the checkpoint scope.",
              null,
              422,
            );
        }
        const next = structuredClone(proposals);
        for (const variant of next.variants) {
          if (!assignments[variant.variant_id]) continue;
          variant.cohort_ids = [...assignments[variant.variant_id]];
          for (const change of next.changes.filter((change) =>
            variant.change_ids.includes(change.change_id),
          )) {
            change.scope = {
              ...change.scope,
              cohort_ids: [...variant.cohort_ids],
            };
            change.version++;
            change.uncertainty = [
              ...new Set([
                ...change.uncertainty,
                "PM regroup changes applicability; uploaded feedback counts retain their original cohort scope.",
              ]),
            ];
          }
        }
        next.unresolved_conflict_ids = next.unresolved_conflict_ids.filter(
          (id) => !checkpoint!.conflict_ids.includes(id),
        );
        next.proposal_set_version++;
        proposals = next;
        snapshot.current_proposal_set_version = proposals.proposal_set_version;
        conflicts.forEach((conflict) => {
          if (checkpoint!.conflict_ids.includes(conflict.conflict_id)) {
            conflict.resolution_status = "resolved";
            conflict.version++;
          }
        });
        checkpoint = { ...checkpoint, wait_state: "continued" };
        snapshot.analysis_status = "proposals_ready";
        snapshot.stage = "Proposals complete";
        snapshot.available_actions = ["edit", "reimagine", "export"];
        touch();
        record(`PM selected ${command.resolution}`, "pm");
        result = accepted(
          "checkpoint-comfort",
          `/api/v1/runs/${snapshot.run_id}/conflicts`,
        );
      } else if (resource === "/renders" && body) {
        const command = body as Wire.RenderCommand;
        if (!snapshot.available_actions.includes("reimagine"))
          throw new ApiError(
            "action_unavailable",
            "Rendering unavailable in current run state.",
            null,
            409,
          );
        if (command.proposal_set_version !== proposals.proposal_set_version)
          throw new ApiError(
            "stale_version",
            "Refresh proposals before rendering.",
            proposals.proposal_set_version,
            409,
          );
        if (
          command.baseline_asset_id !== snapshot.config.baseline_asset_id ||
          !command.variant_ids.length ||
          command.variant_ids.some(
            (id) => !proposals.variants.some((v) => v.variant_id === id),
          )
        )
          throw new ApiError(
            "invalid_render",
            "Render inputs do not match this run.",
            null,
            422,
          );
        const id = `render-${command.proposal_set_version}-${command.variant_ids.join("-")}`;
        if (!renders.has(id)) {
          const changeIds = new Set(
            proposals.variants
              .filter((v) => command.variant_ids.includes(v.variant_id))
              .flatMap((v) => v.change_ids),
          );
          renders.set(id, {
            render_request_id: id,
            proposal_set_version: command.proposal_set_version,
            variant_ids: command.variant_ids,
            baseline_asset_id: command.baseline_asset_id,
            part_catalog_version: snapshot.config.part_catalog_version,
            status: "partial",
            assets: [],
            outcomes: proposals.changes
              .filter((c) => changeIds.has(c.change_id))
              .map((c) => ({
                change_id: c.change_id,
                outcome: "annotated",
                asset_ids: [],
                reason:
                  "Annotation only. New geometry is unsupported by this synthetic frontend fixture.",
              })),
            stale: false,
            failure_reason: null,
            job_id: null,
          });
          record(
            `Render requested for proposal version ${command.proposal_set_version}`,
          );
          touch();
        }
        result = accepted(id, `/api/v1/runs/${snapshot.run_id}/renders/${id}`);
      } else if (resource.startsWith("/renders/")) {
        result = renders.get(decodeURIComponent(resource.slice(9)));
        if (!result)
          throw new ApiError(
            "not_found",
            "Render request not found.",
            null,
            404,
          );
      } else if (resource === "/exports" && body) {
        const command = body as Wire.ExportCommand;
        if (!snapshot.available_actions.includes("export"))
          throw new ApiError(
            "action_unavailable",
            "Export unavailable in current run state.",
            null,
            409,
          );
        if (command.proposal_set_version !== proposals.proposal_set_version)
          throw new ApiError(
            "stale_version",
            "Refresh proposals before exporting.",
            proposals.proposal_set_version,
            409,
          );
        if (
          !command.variant_ids.length ||
          command.variant_ids.some(
            (id) => !proposals.variants.some((v) => v.variant_id === id),
          )
        )
          throw new ApiError(
            "invalid_export",
            "Export variants do not match proposals.",
            null,
            422,
          );
        const id = `export-${command.proposal_set_version}-${command.variant_ids.join("-")}`;
        if (!exports.has(id)) {
          const artifact = {
            synthetic: true,
            run_id: snapshot.run_id,
            ...command,
            proposals: structuredClone(proposals),
            source_version_ids: proposals.source_version_ids,
          };
          const download_url = URL.createObjectURL(
            new Blob([JSON.stringify(artifact, null, 2)], {
              type: "application/json",
            }),
          );
          blobUrls.add(download_url);
          exports.set(id, {
            export_id: id,
            status: "ready",
            download_url,
            manifest: {
              run_id: snapshot.run_id,
              proposal_set_version: command.proposal_set_version,
              variant_ids: command.variant_ids,
              source_version_ids: proposals.source_version_ids,
            },
          });
          record(
            `Synthetic export prepared for proposal version ${command.proposal_set_version}`,
          );
          touch();
        }
        result = accepted(id, `/api/v1/runs/${snapshot.run_id}/exports/${id}`);
      } else if (resource.startsWith("/exports/")) {
        result = exports.get(decodeURIComponent(resource.slice(9)));
        if (!result)
          throw new ApiError("not_found", "Export not found.", null, 404);
      } else
        throw new ApiError(
          "not_found",
          "Operation not supported by this mock.",
          null,
          404,
        );
    }
    if (key) commands.set(key, { input, result: structuredClone(result) });
    return structuredClone(result) as T;
  };
  return {
    send,
    dispose: () => {
      for (const url of blobUrls) URL.revokeObjectURL(url);
      blobUrls.clear();
    },
  };
}
