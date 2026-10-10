import { describe, expect, it, vi } from "vitest";
import { recoverRun, consumeEvents } from "./runRecovery";
import type { Api, Workspace } from "./api/contracts";

const event = (sequence: number, run_id = "r") => ({ contract_version: "1", event_id: `e${sequence}`, sequence, run_id, type: "findings.updated", resource: { type: "findings", id: "f", revision: sequence }, occurred_at: "2026-10-10T00:00:00Z", proposal_set_version: null });
const stream = (chunks: string[]) => new Response(new ReadableStream({ start(c) { chunks.forEach(x => c.enqueue(new TextEncoder().encode(x))); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
const workspace = (revision: number, sequence = revision) => ({ snapshot: { run_id: "r", revision, last_event_sequence: sequence } }) as Workspace;

describe("run event recovery", () => {
  it("parses fragmented CRLF frames and ignores heartbeat comments", async () => {
    const seen: unknown[] = [];
    await consumeEvents(stream([": ping\r\n\r\nid: e1\r\nda", `ta: ${JSON.stringify(event(1))}\r\n\r\n`]), async e => { seen.push(e); });
    expect(seen).toEqual([event(1)]);
  });
  it("rejects malformed events instead of applying unversioned patches", async () => {
    await expect(consumeEvents(stream(['data: {"sequence":1}\n\n']), async () => {})).rejects.toThrow(/event/i);
  });
  it("ignores duplicate/out-of-order events, reconciles gaps from fresh watermark, and replays cursor", async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    let snapshots = 0;
    const api = {
      mode: "real", request: vi.fn(), upload: vi.fn(),
      workspace: async () => { snapshots++; return workspace(snapshots === 1 ? 1 : 5); },
      events: vi.fn(async (_run: string, sequence: number, cursor: string | null) => {
        if (sequence === 1) return stream([...[2, 2, 1, 5].map(n => `id: e${n}\ndata: ${JSON.stringify(event(n))}\n\n`)]);
        expect(sequence).toBe(5);
        expect(cursor).toBeNull();
        controller.abort(); return stream([]);
      }),
    } as Api;
    await recoverRun(api, "r", { workspace: w => seen.push(w.snapshot.revision), status: () => {} }, controller.signal, 0);
    expect(seen).toEqual([1, 5]);
    expect(snapshots).toBe(2);
  });
  it("reconnects with last event ID after bounded replay and rejects foreign run events", async () => {
    const controller = new AbortController();
    let reads = 0;
    let calls = 0;
    const api = { mode: "real", request: vi.fn(), upload: vi.fn(), workspace: async () => workspace(++reads), events: async (_id: string, sequence: number, cursor: string | null) => {
      if (++calls === 1) return stream([`id: e2\ndata: ${JSON.stringify(event(2))}\n\n`]);
      expect(sequence).toBe(2); expect(cursor).toBe("e2");
      controller.abort(); return stream([]);
    } } as Api;
    await recoverRun(api, "r", { workspace: () => {}, status: () => {} }, controller.signal, 0);
    expect(calls).toBe(2);
  });
  it("recovers expired cursor through snapshot and stops access-denied retries", async () => {
    const controller = new AbortController();
    let reads = 0;
    let attempts = 0;
    const statuses: string[] = [];
    const api = { mode: "real", request: vi.fn(), upload: vi.fn(), workspace: async () => workspace(++reads), events: async () => { attempts++; return new Response(JSON.stringify({ code: attempts === 1 ? "cursor_expired" : "forbidden", message: attempts === 1 ? "Cursor expired" : "Workspace access denied" }), { status: attempts === 1 ? 410 : 403 }); } } as Api;
    await recoverRun(api, "r", { workspace: () => {}, status: s => statuses.push(s) }, controller.signal, 0);
    expect(reads).toBe(2);
    expect(attempts).toBe(2);
    expect(statuses.at(-1)).toMatch(/access denied/i);
  });
  it("bounds repeated expired cursors and falls back without a hot retry loop", async () => {
    const controller = new AbortController();
    let reads = 0; let streams = 0;
    const api = { mode: "real", request: vi.fn(), upload: vi.fn(), workspace: async () => { if (++reads === 4) controller.abort(); return workspace(reads); }, events: async () => { streams++; return new Response("{}", { status: 410 }); } } as Api;
    await recoverRun(api, "r", { workspace: () => {}, status: () => {} }, controller.signal, 0);
    expect(streams).toBe(2);
    expect(reads).toBe(4);
  });
  it("uses polling fallback after unavailable transport and cleans up on abort", async () => {
    const controller = new AbortController();
    let reads = 0;
    const api = { mode: "mock", request: vi.fn(), upload: vi.fn(), workspace: async () => { if (++reads === 2) controller.abort(); return workspace(reads); } } as Api;
    const seen: number[] = [];
    await recoverRun(api, "r", { workspace: w => seen.push(w.snapshot.revision), status: () => {} }, controller.signal, 0);
    expect(seen).toEqual([1]);
    expect(reads).toBe(2);
  });
});
