// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { startContractHarness } from "./contractHarness";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((f) => f()));
});
it("serves schema-checked actual HTTP and keeps fixture authentication explicit", async () => {
  const h = await startContractHarness({ scenario: "standard_autonomous" });
  cleanups.push(h.close);
  expect((await fetch(`${h.baseUrl}/vehicles`)).status).toBe(401);
  const response = await fetch(`${h.baseUrl}/vehicles`, { headers: h.headers });
  expect(response.status).toBe(200);
  expect((await response.json()).items).toHaveLength(4);
  expect(h.requests.map((r) => r.status)).toEqual([401, 200]);
  expect(h.validationErrors).toEqual([]);
});
it("rejects schema-invalid requests before transport and isolates workspaces", async () => {
  const h = await startContractHarness({ scenario: "guided_conflict" });
  cleanups.push(h.close);
  const response = await fetch(`${h.baseUrl}/runs`, {
    method: "POST",
    headers: {
      ...h.headers,
      "Content-Type": "application/json",
      "Idempotency-Key": "invalid",
    },
    body: JSON.stringify({ vehicle_id: "missing" }),
  });
  expect(response.status).toBe(422);
  expect((await response.json()).code).toBe("invalid_request");
  expect(
    (
      await fetch(`${h.baseUrl}/vehicles`, {
        headers: { ...h.headers, "X-Workspace-ID": "unknown" },
      })
    ).status,
  ).toBe(403);
  expect(h.validationErrors).toEqual([]);
});
it("withholds malformed transport output instead of passing invalid fixtures as accepted evidence", async () => {
  const h = await startContractHarness({
    scenario: "standard_autonomous",
    loadTransport: () => ({
      send: async <T>() => ({ items: [{ vehicle_id: "bad" }] }) as T,
      dispose: () => {},
    }),
  });
  cleanups.push(h.close);
  const response = await fetch(`${h.baseUrl}/vehicles`, { headers: h.headers });
  expect(response.status).toBe(500);
  expect((await response.json()).code).toBe("invalid_fixture_response");
  expect(h.validationErrors[0]).toContain("Page_Vehicle_");
});
it("injects explicit HTTP failures without replacing valid fixture state", async () => {
  const h = await startContractHarness();
  cleanups.push(h.close);
  h.controls.failNext("/vehicles", 503, "temporarily_unavailable");
  const failure = await fetch(`${h.baseUrl}/vehicles`, { headers: h.headers });
  expect(failure.status).toBe(503);
  expect((await failure.json()).retryable).toBe(true);
  expect(
    (await fetch(`${h.baseUrl}/vehicles`, { headers: h.headers })).status,
  ).toBe(200);
  expect(h.validationErrors).toEqual([]);
});
it("fails only the known annotation asset once, then serves its normal static bytes", async () => {
  const h = await startContractHarness({ failAssetOnce: true });
  cleanups.push(h.close);
  const origin = new URL(h.baseUrl).origin;
  expect((await fetch(`${origin}/vehicles/unknown.svg`)).status).toBe(404);
  const first = await fetch(
    `${origin}/vehicles/frontend-render-annotation.svg`,
  );
  expect(first.status).toBe(503);
  expect(first.headers.get("cache-control")).toBe("no-store");
  const retry = await fetch(
    `${origin}/vehicles/frontend-render-annotation.svg`,
  );
  expect(retry.status).toBe(200);
  expect(retry.headers.get("content-type")).toBe("image/svg+xml");
  expect(await retry.text()).toContain("Static annotation reference");
});
