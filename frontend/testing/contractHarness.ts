import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import openapi from "../fixtures/openapi.json";
import schemas from "../fixtures/schemas.json";
import sharedScenarios from "../fixtures/scenarios.json";
import type { Send } from "../src/api/client";
import type * as Wire from "../src/api/wire";

type Transport = { send: Send; dispose: () => void };
export type HarnessRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  status?: number;
  response?: unknown;
};
type Options = {
  scenario?: string;
  loadTransport?: (scenario: string) => Promise<Transport> | Transport;
};
type Event = {
  contract_version: "1";
  event_id: string;
  sequence: number;
  run_id: string;
  type: "analysis.updated" | "proposals.ready";
  occurred_at: string;
  resource: { type: string; id: string; revision: number };
  proposal_set_version: number | null;
};
const scenarioNames = Object.keys(sharedScenarios);
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const defs = JSON.parse(
  JSON.stringify(openapi.components.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
const checks = new Map<string, ReturnType<typeof ajv.compile>>();
function check(name: string, value: unknown) {
  let validate = checks.get(name);
  if (!validate) {
    validate = ajv.compile({ $ref: `#/$defs/${name}`, $defs: defs });
    checks.set(name, validate);
  }
  return validate(value) ? null : ajv.errorsText(validate.errors);
}
const checkEvent = ajv.compile(schemas.Event);
const routes = Object.entries(openapi.paths).flatMap(([path, operations]) =>
  Object.entries(operations).map(([method, operation]) => ({
    method: method.toUpperCase(),
    path,
    operation: operation as unknown as {
      requestBody?: { content: Record<string, { schema: { $ref?: string } }> };
      responses: Record<
        string,
        { content?: Record<string, { schema: { $ref?: string } }> }
      >;
    },
    pattern: new RegExp(`^${path.replace(/\{[^}]+\}/g, "[^/]+")}$`),
  })),
);
const errorBody = (code: string, message: string, retryable = false) => ({
  code,
  message,
  retryable,
  current_version: null,
  field_errors: [],
});
const schemaName = (ref?: string) => ref?.split("/").at(-1);

/** Frontend-only synthetic network fixture server. Never install in production. */
export function createContractHarness(options: Options = {}) {
  const requests: HarnessRequest[] = [];
  const validationErrors: string[] = [];
  const transports = new Map<string, Promise<Transport>>();
  const events = new Map<string, Event[]>();
  const streams = new Set<ServerResponse>();
  const timers = new Set<ReturnType<typeof setInterval>>();
  const uploads = new Map<string, { bytes: Uint8Array; type: string }>();
  const artifacts = new Map<string, { blobUrl: string; type: string }>();
  const faults: {
    path: string;
    status?: number;
    code?: string;
    disconnect?: boolean;
  }[] = [];
  let expire = false,
    duplicate = false,
    disposed = false;
  const load =
    options.loadTransport ??
    (async (scenario: string) =>
      (await import("../src/api/mock")).createMockTransport(scenario));
  const transport = (workspace: string) => {
    let item = transports.get(workspace);
    if (!item) {
      item = Promise.resolve(load(workspace));
      transports.set(workspace, item);
    }
    return item;
  };
  function remember(workspace: string, snapshot: Wire.Snapshot) {
    const list = events.get(workspace) ?? [];
    if (
      snapshot.last_event_sequence > 0 &&
      !list.some((e) => e.sequence === snapshot.last_event_sequence)
    ) {
      const e: Event = {
        contract_version: "1",
        event_id: `fixture-${snapshot.run_id}-${snapshot.last_event_sequence}`,
        sequence: snapshot.last_event_sequence,
        run_id: snapshot.run_id,
        type:
          snapshot.current_proposal_set_version === null
            ? "analysis.updated"
            : "proposals.ready",
        occurred_at: new Date().toISOString(),
        resource: {
          type: "run",
          id: snapshot.run_id,
          revision: snapshot.revision,
        },
        proposal_set_version: snapshot.current_proposal_set_version,
      };
      if (!checkEvent(e)) throw new Error(ajv.errorsText(checkEvent.errors));
      list.push(e);
      events.set(workspace, list);
    }
  }
  const json = (
    res: ServerResponse,
    status: number,
    value: unknown,
    trace: HarnessRequest,
    name?: string,
  ) => {
    const invalid = name ? check(name, value) : null;
    if (invalid) {
      validationErrors.push(
        `${trace.method} ${trace.path} ${name}: ${invalid}`,
      );
      status = 500;
      value = errorBody(
        "invalid_fixture_response",
        "Synthetic fixture failed published schema validation.",
      );
    }
    trace.status = status;
    trace.response = value;
    res.writeHead(status, {
      "Content-Type": "application/json",
      "X-Frontend-Contract-Harness": "synthetic",
      "X-Request-ID": `harness-${requests.length}`,
    });
    res.end(JSON.stringify(value));
  };
  const middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next?: () => void,
  ) => {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );
    if (!url.pathname.startsWith("/api/v1/")) {
      if (next) {
        next();
        return;
      }
      if (
        req.method === "GET" &&
        url.pathname === "/vehicles/frontend-render-annotation.svg"
      ) {
        const bytes = await readFile(
          new URL(
            "../public/vehicles/frontend-render-annotation.svg",
            import.meta.url,
          ),
        );
        res.writeHead(200, {
          "Content-Type": "image/svg+xml",
          "X-Frontend-Contract-Harness": "synthetic",
        });
        res.end(bytes);
        return;
      }
      res.writeHead(404);
      res.end();
      return;
    }
    const path = url.pathname.slice("/api/v1".length) + url.search;
    const trace: HarnessRequest = {
      method: req.method ?? "GET",
      path,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          Array.isArray(v) ? v.join(",") : (v ?? ""),
        ]),
      ),
    };
    requests.push(trace);
    const fail = (
      status: number,
      code: string,
      message: string,
      retryable = false,
    ) => json(res, status, errorBody(code, message, retryable), trace, "Error");
    try {
      if (disposed) return fail(503, "unavailable", "Fixture harness closed.");
      const signedWorkspace = url.searchParams.get("workspace");
      const signedArtifact =
        !!signedWorkspace &&
        url.searchParams.get("fixture_token") === "harness-token" &&
        artifacts.has(`${signedWorkspace}:${url.pathname}`);
      if (
        req.headers.authorization !== "Bearer harness-token" &&
        !signedArtifact
      )
        return fail(
          401,
          "authentication_required",
          "Synthetic harness requires its documented fixture token.",
        );
      const workspace = signedArtifact
        ? signedWorkspace!
        : String(req.headers["x-workspace-id"] ?? "");
      if (!workspace)
        return fail(401, "workspace_required", "X-Workspace-ID is required.");
      if (
        !scenarioNames.includes(workspace) ||
        (options.scenario && workspace !== options.scenario)
      )
        return fail(403, "forbidden", "Unknown synthetic workspace scenario.");
      let disconnectAfter = false;
      const faultIndex = faults.findIndex(
        (f) =>
          f.path === path ||
          f.path === url.pathname ||
          f.path === url.pathname.slice(7),
      );
      if (faultIndex >= 0) {
        const fault = faults.splice(faultIndex, 1)[0];
        if (fault.disconnect) disconnectAfter = true;
        else
          return fail(
            fault.status!,
            fault.code ?? "injected_failure",
            "Explicit synthetic network fault.",
            fault.status! >= 500,
          );
      }
      const t = await transport(workspace);
      const artifactKey = `${workspace}:${url.pathname}`;
      const artifact = artifacts.get(artifactKey);
      if (artifact) {
        const result = await fetch(artifact.blobUrl);
        if (!result.ok)
          return fail(404, "not_found", "Synthetic artifact expired.");
        trace.status = 200;
        res.writeHead(200, {
          "Content-Type": artifact.type,
          "X-Frontend-Contract-Harness": "synthetic",
        });
        res.end(new Uint8Array(await result.arrayBuffer()));
        return;
      }
      const route = routes.find(
        (r) => r.method === trace.method && r.pattern.test(url.pathname),
      );
      if (!route)
        return fail(
          404,
          "not_found",
          "No published application route matches this request.",
        );
      if (
        trace.method === "GET" &&
        /^\/sources\/[^/]+\/content$/.test(url.pathname.slice(7))
      ) {
        const id = decodeURIComponent(url.pathname.split("/")[4]);
        const source = uploads.get(`${workspace}:${id}`);
        if (!source)
          return fail(
            404,
            "not_found",
            "Source bytes unavailable in this synthetic upload session.",
          );
        trace.status = 200;
        res.writeHead(200, {
          "Content-Type": source.type,
          "X-Frontend-Contract-Harness": "synthetic",
        });
        res.end(source.bytes);
        return;
      }
      if (trace.method === "GET" && url.pathname.endsWith("/events")) {
        const runPath = path.split("/events")[0];
        const snapshot = await t.send<Wire.Snapshot>(runPath);
        remember(workspace, snapshot);
        const list = events.get(workspace) ?? [];
        const cursor = req.headers["last-event-id"];
        if (expire || (cursor && !list.some((e) => e.event_id === cursor))) {
          expire = false;
          return fail(
            410,
            "event_cursor_expired",
            "Synthetic replay cursor expired. Fetch a coherent snapshot.",
          );
        }
        const after = cursor
          ? list.find((e) => e.event_id === cursor)!.sequence
          : Number(url.searchParams.get("after_sequence") ?? 0);
        if (!Number.isSafeInteger(after) || after < 0)
          return fail(
            422,
            "invalid_request",
            "after_sequence must be a nonnegative integer.",
          );
        const follow = url.searchParams.get("follow");
        if (follow !== null && !["true", "false"].includes(follow))
          return fail(422, "invalid_request", "follow must be a boolean.");
        const replay = list.filter((e) => e.sequence > after);
        trace.status = 200;
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Frontend-Contract-Harness": "synthetic",
        });
        res.flushHeaders();
        streams.add(res);
        const write = (e: Event) =>
          res.write(
            `id: ${e.event_id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`,
          );
        replay.forEach(write);
        let sent = replay.at(-1)?.sequence ?? after;
        if (duplicate) {
          duplicate = false;
          const latest = list.at(-1);
          if (latest) {
            write(latest);
            write(latest);
            if (list.length > 1) write(list[list.length - 2]);
          }
        }
        let reading = false;
        if (follow === "false") {
          res.end();
          streams.delete(res);
          return;
        }
        const timer = setInterval(() => {
          if (res.destroyed || reading) return;
          reading = true;
          void t
            .send<Wire.Snapshot>(runPath)
            .then((s) => {
              if (res.destroyed || disposed) return;
              remember(workspace, s);
              for (const e of events.get(workspace) ?? [])
                if (e.sequence > sent) {
                  write(e);
                  sent = e.sequence;
                }
              res.write(": synthetic fixture heartbeat\n\n");
            })
            .catch(() => res.end())
            .finally(() => {
              reading = false;
            });
        }, 500);
        timers.add(timer);
        res.once("close", () => {
          clearInterval(timer);
          timers.delete(timer);
          streams.delete(res);
        });
        return;
      }
      let body: unknown;
      let files: File[] = [];
      if (trace.method === "POST") {
        if (!req.headers["idempotency-key"])
          return fail(
            422,
            "missing_idempotency_key",
            "Mutation requires Idempotency-Key.",
          );
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 20_000_000)
            return fail(
              413,
              "package_too_large",
              "Synthetic harness request limit exceeded.",
            );
          chunks.push(Buffer.from(chunk));
        }
        const bytes = Buffer.concat(chunks);
        if (
          String(req.headers["content-type"]).startsWith("multipart/form-data")
        ) {
          const request = new Request(url, {
            method: "POST",
            headers: { "Content-Type": String(req.headers["content-type"]) },
            body: bytes,
          });
          const form = await request.formData();
          files = form
            .getAll("files")
            .filter((f): f is File => typeof f !== "string");
          if (!files.length || [...form.keys()].some((k) => k !== "files"))
            return fail(
              422,
              "invalid_request",
              "Published uploads use multipart files.",
            );
          body = form;
          trace.body = {
            files: files.map((f) => ({
              name: f.name,
              type: f.type,
              size: f.size,
            })),
          };
        } else {
          try {
            body = bytes.length ? JSON.parse(bytes.toString("utf8")) : {};
          } catch {
            return fail(422, "invalid_request", "Expected JSON request body.");
          }
          trace.body = body;
          const name = schemaName(
            route.operation.requestBody?.content["application/json"]?.schema
              .$ref,
          );
          const invalid = name ? check(name, body) : null;
          if (invalid)
            return fail(
              422,
              "invalid_request",
              `Published ${name} request rejected: ${invalid}`,
            );
        }
      }
      let result = await t.send<unknown>(
        path,
        body,
        typeof req.headers["idempotency-key"] === "string"
          ? req.headers["idempotency-key"]
          : undefined,
      );
      if (files.length) {
        const upload = result as Wire.Uploads;
        for (let i = 0; i < upload.sources.length; i++) {
          const source = upload.sources[i];
          if (source.status === "ready" && files[i])
            uploads.set(`${workspace}:${source.source_id}`, {
              bytes: new Uint8Array(await files[i].arrayBuffer()),
              type: files[i].type || "application/octet-stream",
            });
        }
      }
      if (
        trace.method === "GET" &&
        /^\/runs\/[^/]+$/.test(url.pathname.slice(7))
      )
        remember(workspace, result as Wire.Snapshot);
      if (
        trace.method === "GET" &&
        /^\/runs\/[^/]+\/exports\/[^/]+$/.test(url.pathname.slice(7))
      ) {
        const job = structuredClone(result as Wire.ExportResult);
        if (job.download_url?.startsWith("blob:")) {
          const download = `${url.pathname}/download`;
          artifacts.set(`${workspace}:${download}`, {
            blobUrl: job.download_url,
            type: "application/json",
          });
          job.download_url = `${url.origin}${download}?workspace=${encodeURIComponent(workspace)}&fixture_token=harness-token`;
        }
        result = job;
      }
      if (disconnectAfter) {
        trace.status = 0;
        trace.response = result;
        req.socket.destroy();
        return;
      }
      const status =
        route.operation.responses["202"] && trace.method === "POST" ? 202 : 200;
      const name = schemaName(
        route.operation.responses[String(status)]?.content?.["application/json"]
          ?.schema.$ref,
      );
      json(res, status, result, trace, name);
    } catch (error) {
      const e = error as {
        status?: number | null;
        code?: string;
        message?: string;
        current_version?: number | null;
        retryable?: boolean;
        field_errors?: Record<string, string>[];
      };
      json(
        res,
        e.status ?? 500,
        {
          ...errorBody(
            e.code ?? "harness_failure",
            e.message ?? "Synthetic harness failed.",
            e.retryable ?? false,
          ),
          current_version: e.current_version ?? null,
          field_errors: e.field_errors ?? [],
        },
        trace,
        "Error",
      );
    }
  };
  return {
    middleware,
    requests,
    validationErrors,
    controls: {
      failNext: (path: string, status: number, code?: string) => {
        faults.push({ path, status, code });
      },
      disconnectNext: (path: string) => {
        faults.push({ path, disconnect: true });
      },
      expireNextEvents: () => {
        expire = true;
      },
      duplicateNextEvents: () => {
        duplicate = true;
      },
      closeEvents: () => {
        for (const stream of streams) stream.end();
      },
    },
    dispose: async () => {
      disposed = true;
      for (const timer of timers) clearInterval(timer);
      for (const stream of streams) stream.end();
      await Promise.all(
        [...transports.values()].map(async (p) => (await p).dispose()),
      );
    },
  };
}

export async function startContractHarness(options: Options = {}) {
  const harness = createContractHarness(options);
  const server = createServer((req, res) => {
    void harness.middleware(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Harness address unavailable");
  return {
    ...harness,
    baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
    headers: {
      Authorization: "Bearer harness-token",
      "X-Workspace-ID": options.scenario ?? "standard_autonomous",
    },
    close: async () => {
      await harness.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
