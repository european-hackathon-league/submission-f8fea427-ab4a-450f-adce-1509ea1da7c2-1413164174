import { afterEach, expect, it, vi } from "vitest";
import { createRealApi } from "./client";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const base = "https://api.example.test/api/v1";
const exportUrl = "/api/v1/runs/run-1/exports/export-1/download";
it.each(["/api/v1/runs/run-1/geometry/asset", "/api/v1/vehicles/g60-i5-m60/geometry/asset"])("retrieves verified baseline geometry through the authorized application route: %s", async (url) => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response("glb", { headers: { "Content-Type": "model/gltf-binary" } }));
  vi.stubGlobal("fetch", fetcher);
  const api = createRealApi(base, { headers: () => ({ Authorization: "Bearer runtime-token" }) });
  expect(api.canReadAsset?.(url)).toBe(true);
  expect(await (await api.readAsset!(url, new AbortController().signal)).text()).toBe("glb");
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer runtime-token");
  expect(api.canReadAsset?.("https://external.example.test" + url)).toBe(false);
  expect(api.canReadAsset?.(url + "?token=secret")).toBe(false);
});
it("reads only protected application asset/export routes with runtime authorization and exact bytes", async () => {
  const fetcher = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response("authoritative bytes", {
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const api = createRealApi(base, {
    headers: () => ({
      Authorization: "Bearer private-token",
      "X-Workspace-ID": "workspace-1",
    }),
  });
  expect(api.canReadAsset?.(exportUrl)).toBe(true);
  expect(
    api.canReadAsset?.("/api/v1/runs/run-1/renders/render-1/assets/asset-1"),
  ).toBe(true);
  const bytes = await api.readAsset!(exportUrl, new AbortController().signal);
  expect(await bytes.text()).toBe("authoritative bytes");
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.example.test" + exportUrl,
    expect.objectContaining({
      credentials: "include",
      redirect: "error",
      signal: expect.any(AbortSignal),
    }),
  );
  const init = fetcher.mock.calls[0][1] as RequestInit;
  expect(new Headers(init.headers).get("Authorization")).toBe(
    "Bearer private-token",
  );
  expect(new Headers(init.headers).get("X-Workspace-ID")).toBe("workspace-1");
});
it.each([
  "https://external.example.test/api/v1/runs/r/exports/e/download",
  "https://user:password@api.example.test/api/v1/runs/r/exports/e/download",
  "/api/v1/runs/r/exports/e/download?token=public-signed",
  "/api/v1/runs/r/exports/e/download#hash",
  "/api/v1/runs/r/proposals",
  "/api/v1/sources/s/content",
  "/different/runs/r/exports/e/download",
])(
  "never sends application credentials to an unapproved binary URL: %s",
  async (url) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const api = createRealApi(base);
    expect(api.canReadAsset?.(url)).toBe(false);
    await expect(
      api.readAsset!(url, new AbortController().signal),
    ).rejects.toMatchObject({ code: "unsupported_asset_url" });
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it.each([401, 403, 500])(
  "retains published protected-file error metadata (%s)",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            code: "denied",
            message: "Exact error",
            current_version: null,
            retryable: status >= 500,
            field_errors: [],
          },
          { status, headers: { "X-Request-ID": "binary-request" } },
        ),
      ),
    );
    const api = createRealApi(base);
    await expect(
      api.readAsset!(exportUrl, new AbortController().signal),
    ).rejects.toMatchObject({
      status,
      code: "denied",
      requestId: "binary-request",
    });
  },
);
it("cancels caller aborts and bounds a stalled protected response to thirty seconds", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init.signal!.addEventListener(
          "abort",
          () => reject(init.signal!.reason),
          { once: true },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const api = createRealApi(base);
  const caller = new AbortController();
  const first = api.readAsset!(exportUrl, caller.signal);
  const firstCheck = expect(first).rejects.toBeDefined();
  await Promise.resolve();
  await Promise.resolve();
  caller.abort();
  await firstCheck;
  const second = api.readAsset!(exportUrl, new AbortController().signal);
  const secondCheck = expect(second).rejects.toMatchObject({
    code: "asset_timeout",
  });
  await vi.advanceTimersByTimeAsync(30000);
  await secondCheck;
});
