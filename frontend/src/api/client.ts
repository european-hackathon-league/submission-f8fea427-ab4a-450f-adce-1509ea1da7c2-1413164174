import type { Api, Instruction, Workspace } from "./contracts";
import type * as Wire from "./wire";
import * as normalize from "./normalize";
import { createMockTransport } from "./mock";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public current_version: number | null = null,
    public status: number | null = null,
    public retryable = false,
    public field_errors: Record<string, string>[] = [],
    public requestId: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export const commandKey = () => crypto.randomUUID();
export type Send = <T>(
  path: string,
  body?: unknown,
  key?: string,
) => Promise<T>;
async function readPages<T>(
  send: Send,
  path: string,
): Promise<{
  items: T[];
  first: Record<string, unknown>;
  pages: Record<string, unknown>[];
}> {
  const items: T[] = [];
  const pages: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  let first: Record<string, unknown> | null = null;
  do {
    const page: {
      items: T[];
      next_cursor?: string | null;
      revision?: number;
    } & Record<string, unknown> = await send<
      { items: T[]; next_cursor?: string | null; revision?: number } & Record<
        string,
        unknown
      >
    >(
      `${path}${cursor ? `${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    if (!first) first = page;
    if (first!.revision !== page.revision)
      throw new ApiError(
        "incoherent_resources",
        "Resource changed during pagination. Retry refresh.",
        null,
        null,
        true,
      );
    items.push(...page.items);
    pages.push(page);
    cursor = page.next_cursor ?? null;
    if (cursor && seen.has(cursor))
      throw new ApiError("invalid_cursor", "Repeated pagination cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { items, first: first ?? {}, pages };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function allPartAggregates(
  pages: Record<string, unknown>[],
): Wire.PartAggregate[] {
  const aggregates = new Map<string, Wire.PartAggregate>();
  for (const page of pages) {
    for (const aggregate of (page.part_aggregates ??
      []) as Wire.PartAggregate[]) {
      const scope = [...aggregate.cohort_ids].sort();
      const key = JSON.stringify([aggregate.part_id, scope]);
      const prior = aggregates.get(key);
      const comparable = (value: Wire.PartAggregate) => ({
        ...value,
        cohort_ids: [...value.cohort_ids].sort(),
        counts: {
          ...value.counts,
          record_ids: [...value.counts.record_ids].sort(),
        },
      });
      if (
        prior &&
        canonical(comparable(prior)) !== canonical(comparable(aggregate))
      ) {
        throw new ApiError(
          "incoherent_resources",
          "Part aggregate changed within the same paginated scope. Retry refresh.",
          null,
          null,
          true,
        );
      }
      if (!prior) aggregates.set(key, aggregate);
    }
  }
  return [...aggregates.values()];
}
async function readGraph(send: Send, path: string): Promise<Wire.Graph> {
  let cursor: string | null = null;
  let result: Wire.Graph | undefined;
  const seen = new Set<string>();
  do {
    const page: Wire.Graph = await send<Wire.Graph>(
      `${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    if (!result) result = { ...page, nodes: [], edges: [] };
    if (result!.revision !== page.revision)
      throw new ApiError(
        "incoherent_resources",
        "Graph changed during pagination.",
        null,
        null,
        true,
      );
    result!.nodes.push(...page.nodes);
    result!.edges.push(...page.edges);
    cursor = page.next_cursor ?? null;
    if (cursor && seen.has(cursor))
      throw new ApiError("invalid_cursor", "Repeated graph cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  result!.nodes = [...new Map(result!.nodes.map((n) => [n.id, n])).values()];
  result!.edges = [
    ...new Map(result!.edges.map((e) => [e.edge_id, e])).values(),
  ];
  result!.next_cursor = null;
  return result!;
}
function requestBody(path: string, body: unknown): unknown {
  if (body === undefined) return undefined;
  if (path.endsWith("/instructions"))
    return normalize.instruction(body as Instruction);
  if (path.endsWith("/continue")) {
    const old = body as {
      checkpoint_version: number;
      selected_resolution?: string;
      resolution?: string;
      cohort_assignments?: Record<string, string[]>;
    };
    return {
      checkpoint_version: old.checkpoint_version,
      resolution: old.resolution ?? old.selected_resolution,
      ...(old.cohort_assignments
        ? { cohort_assignments: old.cohort_assignments }
        : {}),
    };
  }
  return body;
}
function project(path: string, body: unknown, value: unknown): unknown {
  const p = path.split("?")[0];
  if (body !== undefined) {
    const accepted = value as Wire.Accepted;
    if (p.endsWith("/renders"))
      return { ...accepted, render_request_id: accepted.resource_id };
    if (p.endsWith("/exports"))
      return { ...accepted, export_id: accepted.resource_id };
    return value;
  }
  if (p === "/vehicles") {
    const page = value as Wire.Page_Vehicle_;
    return { ...page, items: page.items.map(normalize.vehicle) };
  }
  if (/\/runs\/[^/]+$/.test(p))
    return normalize.snapshot(value as Wire.Snapshot);
  if (p.endsWith("/findings")) {
    const page = value as Wire.FindingsPage;
    return { ...page, items: page.items.map(normalize.finding) };
  }
  if (p.endsWith("/proposals"))
    return normalize.proposals(value as Wire.Proposals);
  if (p.endsWith("/graph")) return normalize.graph(value as Wire.Graph);
  if (p.endsWith("/research")) {
    const page = value as Wire.Page_Research_;
    return { ...page, items: page.items.map(normalize.research) };
  }
  if (p.endsWith("/conflicts"))
    return {
      ...(value as Wire.Conflicts),
      checkpoint: normalize.checkpoint(value as Wire.Conflicts),
    };
  if (p.endsWith("/history")) {
    const page = value as Wire.Page_Audit_;
    return { ...page, items: page.items.map(normalize.audit) };
  }
  if (/\/evidence\/[^/]+$/.test(p))
    return normalize.evidence(value as Wire.Evidence);
  if (/\/renders\/[^/]+$/.test(p))
    return normalize.render(value as Wire.RenderResult);
  return value;
}
function boundary(
  mode: Api["mode"],
  send: Send,
  extras: Partial<Api> = {},
): Api {
  return {
    ...extras,
    mode,
    async request<T>(path: string, body?: unknown, key?: string) {
      if (body !== undefined && !key)
        throw new ApiError(
          "missing_idempotency_key",
          "Mutation requires Idempotency-Key.",
        );
      return project(
        path,
        body,
        await send(path, requestBody(path, body), key),
      ) as T;
    },
    async vehicles() {
      const result = await readPages<Wire.Vehicle>(send, "/vehicles");
      return result.items.map(normalize.vehicle);
    },
    async upload(file) {
      const body = new FormData();
      body.append("files", file);
      const result = await send<Wire.Uploads>("/uploads", body, commandKey());
      if (result.sources.length !== 1)
        throw new ApiError(
          "invalid_response",
          "Upload response must identify the submitted file.",
        );
      return { ...result.sources[0], reason: result.sources[0].reason ?? null };
    },
    async workspace(runId) {
      const root = `/runs/${encodeURIComponent(runId)}`;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const before = await send<Wire.Snapshot>(root);
          const [f, g, r, c, p, h] = await Promise.all([
            readPages<Wire.Finding>(send, `${root}/findings`),
            readGraph(send, `${root}/graph`),
            readPages<Wire.Research>(send, `${root}/research`),
            send<Wire.Conflicts>(`${root}/conflicts`),
            before.current_proposal_set_version === null
              ? Promise.resolve(null)
              : send<Wire.Proposals>(`${root}/proposals`),
            readPages<Wire.Audit>(send, `${root}/history`),
          ]);
          const after = await send<Wire.Snapshot>(root);
          if (before.run_id !== runId || after.run_id !== runId)
            throw new ApiError(
              "invalid_response",
              "Snapshot identity does not match requested run.",
            );
          if (
            before.revision !== after.revision ||
            before.last_event_sequence !== after.last_event_sequence ||
            before.current_proposal_set_version !==
              after.current_proposal_set_version ||
            (p &&
              p.proposal_set_version !== before.current_proposal_set_version)
          )
            continue;
          const snapshot = normalize.snapshot(before);
          snapshot.part_aggregates = allPartAggregates(f.pages).map((a) => ({
            wire: a,
            part_id:
              a.part_id as Workspace["snapshot"]["part_aggregates"][number]["part_id"],
            counts: {
              ...a.counts,
              negative_share: a.counts.negative_share ?? null,
              intensity_value: a.intensity_value,
              intensity_scale_id: a.intensity_scale_id,
              low_evidence: a.low_evidence,
              provisional: a.provisional,
            },
          }));
          return {
            snapshot,
            findings: f.items.map(normalize.finding),
            counts: f.first.counts as Wire.Counts,
            graph: normalize.graph(g),
            research: r.items.map(normalize.research),
            conflicts: c,
            checkpoint: normalize.checkpoint(c),
            proposals: p
              ? normalize.proposals(p)
              : {
                  proposal_set_version: 0,
                  variants: [],
                  unresolved_conflicts: [],
                },
            history: h.items.map(normalize.audit),
          };
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.code === "incoherent_resources" &&
            attempt < 2
          )
            continue;
          throw error;
        }
      }
      throw new ApiError(
        "incoherent_resources",
        "Run changed during refresh. Retry to load a coherent version.",
        null,
        null,
        true,
      );
    },
  };
}
export interface RealApiOptions {
  sessionNamespace?: string;
  headers?: () => HeadersInit | Promise<HeadersInit>;
}
async function checkResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const error = (await response
    .json()
    .catch(() => ({}))) as Partial<Wire.Error>;
  throw new ApiError(
    error.code ??
      (response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "forbidden"
          : "request_failed"),
    error.message ?? `Request failed (${response.status})`,
    error.current_version ?? null,
    response.status,
    error.retryable ?? false,
    error.field_errors ?? [],
    response.headers.get("x-request-id"),
  );
}
export function createRealApi(
  baseUrl = "/api/v1",
  options: RealApiOptions = {},
): Api {
  const base = baseUrl.replace(/\/$/, "");
  const headers = async (extra: HeadersInit = {}): Promise<Headers> => {
    const result = new Headers(await options.headers?.());
    new Headers(extra).forEach((value, key) => result.set(key, value));
    return result;
  };
  const origin =
    typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const apiUrl = new URL(base, origin);
  const sourcePrefix = `${apiUrl.pathname.replace(/\/$/, "")}/sources/`;
  const sourceAddress = (value: string): URL | null => {
    try {
      const address = new URL(value, apiUrl.origin);
      const suffix = address.pathname.slice(sourcePrefix.length);
      if (
        address.origin !== apiUrl.origin ||
        address.username ||
        address.password ||
        address.search ||
        address.hash ||
        !address.pathname.startsWith(sourcePrefix) ||
        !/^[^/]+\/content$/.test(suffix)
      )
        return null;
      return address;
    } catch {
      return null;
    }
  };
  const send: Send = async <T>(
    path: string,
    body?: unknown,
    key?: string,
  ): Promise<T> => {
    const multipart = body instanceof FormData;
    const init: RequestInit = {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      headers: await headers({
        ...(body !== undefined && !multipart
          ? { "Content-Type": "application/json" }
          : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      }),
      body:
        body === undefined
          ? undefined
          : multipart
            ? body
            : JSON.stringify(body),
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(`${base}${path}`, {
          ...init,
          signal: controller.signal,
        });
        await checkResponse(response);
        return await response.json();
      } catch (error) {
        if (
          attempt === 0 &&
          (error instanceof TypeError || controller.signal.aborted) &&
          (body === undefined || key)
        )
          continue;
        if (controller.signal.aborted)
          throw new ApiError(
            "request_timeout",
            "Request timed out. Retry the same command; its result may already exist.",
            null,
            null,
            true,
          );
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new ApiError("request_failed", "Request interrupted.");
  };
  return boundary("real", send, {
    sessionNamespace: options.sessionNamespace ?? base,
    sourceUrl: (sourceId) =>
      `${base}/sources/${encodeURIComponent(sourceId)}/content`,
    canReadSource: (url) => sourceAddress(url) !== null,
    async readSource(url, signal) {
      const address = sourceAddress(url);
      if (!address)
        throw new ApiError(
          "unsupported_source_url",
          "This link is not an application source-content URL.",
        );
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(), 30_000);
      try {
        const response = await fetch(address.href, {
          credentials: "include",
          headers: await headers(),
          signal: AbortSignal.any([signal, timeoutController.signal]),
          redirect: "error",
        });
        await checkResponse(response);
        return await response.blob();
      } catch (error) {
        if (timeoutController.signal.aborted && !signal.aborted)
          throw new ApiError(
            "source_timeout",
            "Source download timed out. Retry opening the source.",
            null,
            null,
            true,
          );
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
    async events(runId, sequence, lastEventId, signal) {
      const establishment = new AbortController();
      const timeout = setTimeout(() => establishment.abort(), 30_000);
      // Keep parent cancellation attached to the response body after headers arrive.
      // Native composition releases its internal subscriptions with signal lifetime.
      const requestSignal = AbortSignal.any([signal, establishment.signal]);
      try {
        return await fetch(
          `${base}/runs/${encodeURIComponent(runId)}/events?follow=true${lastEventId ? "" : `&after_sequence=${sequence}`}`,
          {
            credentials: "include",
            signal: requestSignal,
            headers: await headers({
              Accept: "text/event-stream",
              ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
            }),
          },
        );
      } catch (error) {
        if (establishment.signal.aborted && !signal.aborted) {
          throw new ApiError(
            "event_connection_timeout",
            "Event connection timed out. Reconnect from the last coherent snapshot.",
            null,
            null,
            true,
          );
        }
        throw error;
      } finally {
        // This deadline bounds headers only; healthy long streams remain open.
        clearTimeout(timeout);
      }
    },
  });
}
export function createMockApi(scenario = "standard_autonomous"): Api {
  const transport = createMockTransport(scenario);
  return boundary("mock", transport.send, { dispose: transport.dispose });
}
export function createApi(): Api {
  return import.meta.env.VITE_API_MODE === "real"
    ? createRealApi(import.meta.env.VITE_API_BASE_URL || "/api/v1")
    : createMockApi(import.meta.env.VITE_MOCK_SCENARIO);
}
