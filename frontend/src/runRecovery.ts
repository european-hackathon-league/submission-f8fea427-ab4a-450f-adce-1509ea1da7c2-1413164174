import type { Api, Workspace } from "./api/contracts";

type RunEvent = { contract_version: "1"; event_id: string; sequence: number; run_id: string; type: string; resource: { type: string; id: string; revision: number } };

// Events invalidate resources. Only coherent snapshots replace visible state.
export async function consumeEvents(response: Response, receive: (event: RunEvent) => Promise<void>) {
  if (!response.body) throw new Error("Event stream body unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1_000_000) throw new Error("Event frame too large");
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const lines = frame.split(/\r?\n/);
        const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const event = JSON.parse(data) as RunEvent;
        const id = lines.find(line => line.startsWith("id:"))?.slice(3).trim();
        if (event.contract_version !== "1" || typeof event.event_id !== "string" || !event.event_id || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || typeof event.run_id !== "string" || typeof event.type !== "string" || !event.resource || !Number.isSafeInteger(event.resource.revision) || (id && id !== event.event_id))
          throw new Error("Invalid run event envelope");
        await receive(event);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}
function accessFailure(error: unknown) {
  const e = error as { status?: number; code?: string };
  return e?.status === 401 || e?.status === 403 || ["authentication_required", "invalid_token", "workspace_required", "forbidden"].includes(e?.code ?? "");
}

export async function recoverRun(api: Api, runId: string, callbacks: { workspace: (w: Workspace) => void; status: (message: string) => void }, signal: AbortSignal, delay = 2000) {
  let sequence = 0;
  let cursor: string | null = null;
  let revision = -1;
  let expiredAttempts = 0;
  let needsSnapshot = true;
  let polling = !api.events;
  const reconcile = async () => {
    const next = await api.workspace(runId);
    if (signal.aborted) return;
    if (next.snapshot.run_id !== runId) throw new Error("Run identity mismatch during recovery");
    if (next.snapshot.revision >= revision && next.snapshot.last_event_sequence >= sequence) {
      callbacks.workspace(next);
      revision = next.snapshot.revision;
      sequence = next.snapshot.last_event_sequence;
      cursor = null;
    }
    callbacks.status("");
  };
  while (!signal.aborted) {
    try {
      if (needsSnapshot || polling) { await reconcile(); needsSnapshot = false; }
      if (signal.aborted) return;
      if (polling) { await pause(delay, signal); continue; }
      const response = await api.events!(runId, sequence, cursor, signal);
      if (signal.aborted) return;
      if (response.status === 410) {
        needsSnapshot = true; cursor = null;
        if (++expiredAttempts >= 2) polling = true;
        callbacks.status("Event replay unavailable. Recovering from current snapshot.");
        await pause(delay, signal);
        continue;
      }
      expiredAttempts = 0;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw Object.assign(new Error(body.message ?? `Event request failed (${response.status})`), { status: response.status, code: body.code });
      }
      if (!response.headers.get("Content-Type")?.includes("text/event-stream")) throw new Error("Event transport unavailable");
      await consumeEvents(response, async event => {
        if (signal.aborted) return;
        if (event.run_id !== runId) throw new Error("Run event identity mismatch");
        if (event.sequence <= sequence) return;
        const gap = event.sequence !== sequence + 1;
        await reconcile();
        if (sequence < event.sequence) throw new Error("Snapshot behind event watermark");
        if (!gap && sequence === event.sequence) cursor = event.event_id;
      });
      await pause(delay, signal);
    } catch (error) {
      if (signal.aborted) return;
      if (accessFailure(error)) { callbacks.status(error instanceof Error ? error.message : "Workspace access denied. Restore access before reconnecting."); return; }
      callbacks.status("Connection interrupted. Retrying from a coherent snapshot; your drafts remain here.");
      needsSnapshot = true;
      // Polling remains usable when a proxy/browser cannot carry SSE.
      polling = true;
      await pause(delay, signal);
    }
  }
}
