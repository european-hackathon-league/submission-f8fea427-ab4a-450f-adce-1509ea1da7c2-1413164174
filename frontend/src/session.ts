import type { RunConfig } from "./api/contracts";
export type PendingRun = { key: string; config: RunConfig };
export type ProposalSelection = { proposalVersion: number; variantId: string; changeId: string };
export type Session = { proposalSelection?: ProposalSelection | null; pendingRun?: PendingRun | null; runId: string | null; tab: string; selectedFindingId: string | null; selectedComponent: string; view: string; variantId: string; ideaDraft: string; proposalDrafts: Array<[string, { text: string; target: string; baseVersion: number }]> };
const key = (namespace: string) => `vehicle-workspace:${namespace}`;
export function readSession(namespace: string): Session | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(namespace)) ?? "null");
    if (!value || (value.runId !== null && typeof value.runId !== "string") || !["tab", "selectedComponent", "view", "variantId", "ideaDraft"].every(k => typeof value[k] === "string") || (value.selectedFindingId !== null && typeof value.selectedFindingId !== "string") || !Array.isArray(value.proposalDrafts)) return null;
    if (!value.proposalDrafts.every((row: unknown) => Array.isArray(row) && row.length === 2 && typeof row[0] === "string" && row[1] && typeof row[1].text === "string" && typeof row[1].target === "string" && Number.isSafeInteger(row[1].baseVersion) && row[1].baseVersion >= 1)) return null;
    if (value.proposalSelection != null && (!Number.isSafeInteger(value.proposalSelection.proposalVersion) || value.proposalSelection.proposalVersion < 1 || ![value.proposalSelection.variantId, value.proposalSelection.changeId].every(id => typeof id === "string" && id.length > 0))) return null;
    if (value.pendingRun != null) {
      const { key, config } = value.pendingRun;
      if (typeof key !== "string" || !key || !config || !["vehicle_id", "baseline_asset_id", "part_catalog_version"].every(k => typeof config[k] === "string") || !Array.isArray(config.source_ids) || !config.source_ids.length || !config.source_ids.every((id: unknown) => typeof id === "string") || !Array.isArray(config.market_context) || !config.market_context.every((v: unknown) => typeof v === "string") || !["autonomous", "guided"].includes(config.participation_mode) || typeof config.deep_dive?.enabled !== "boolean") return null;
    }
    return value;
  } catch { return null; }
}
export function saveSession(namespace: string, session: Session) {
  try { sessionStorage.setItem(key(namespace), JSON.stringify(session)); } catch { /* Storage disabled: in-memory drafts still work. */ }
}
export function clearSession(namespace: string) {
  try { sessionStorage.removeItem(key(namespace)); } catch { /* Storage may be disabled. */ }
}
