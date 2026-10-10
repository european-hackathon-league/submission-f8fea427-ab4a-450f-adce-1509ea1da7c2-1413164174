export interface DecisionCommand {
  key: string;
  body: {
    proposal_set_version: number;
    variant_id: string;
    change_ids: string[];
    action: string;
    rationale: string;
  };
}
export function readDecision(
  key: string | null,
  version: number,
  variant: string,
  change: string,
): DecisionCommand | null {
  if (!key) return null;
  try {
    const value = JSON.parse(
      sessionStorage.getItem(key) ?? "null",
    ) as DecisionCommand | null;
    const body = value?.body;
    if (
      typeof value?.key !== "string" ||
      !value.key ||
      !body ||
      body.proposal_set_version !== version ||
      body.variant_id !== variant ||
      !Array.isArray(body.change_ids) ||
      body.change_ids.length !== 1 ||
      body.change_ids[0] !== change ||
      !["approve", "defer", "reject"].includes(body.action) ||
      typeof body.rationale !== "string" ||
      !body.rationale.trim()
    )
      return null;
    return {
      key: value.key,
      body: {
        proposal_set_version: version,
        variant_id: variant,
        change_ids: [change],
        action: body.action,
        rationale: body.rationale,
      },
    };
  } catch {
    return null;
  }
}
export function saveDecision(
  key: string | null,
  command: DecisionCommand | null,
) {
  if (!key) return;
  try {
    if (command) sessionStorage.setItem(key, JSON.stringify(command));
    else sessionStorage.removeItem(key);
  } catch {
    /* In-memory retry remains available when storage is blocked. */
  }
}
