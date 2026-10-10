import type { Continuation } from "../api/wire";
export type CheckpointDraft = {
  version: number;
  resolution: string;
  assignments: Record<string, string[]>;
};
export type CheckpointCommand = { key: string; body: Continuation };
export type SavedCheckpointDraft = {
  draft: CheckpointDraft;
  command: CheckpointCommand | null;
  acceptedVersion: number | null;
};
const version = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
function assignments(value: unknown): value is Record<string, string[]> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([id, cohorts]) =>
        text(id) &&
        Array.isArray(cohorts) &&
        cohorts.every(text) &&
        new Set(cohorts).size === cohorts.length,
    )
  );
}
export function readCheckpointDraft(
  key: string | null,
): SavedCheckpointDraft | null {
  if (!key) return null;
  try {
    const value = JSON.parse(
      sessionStorage.getItem(key) ?? "null",
    ) as SavedCheckpointDraft;
    const draft = value?.draft;
    if (
      !draft ||
      !version(draft.version) ||
      typeof draft.resolution !== "string" ||
      !assignments(draft.assignments) ||
      (value.acceptedVersion !== null && !version(value.acceptedVersion))
    )
      return null;
    if (
      value.acceptedVersion !== null &&
      value.acceptedVersion !== draft.version
    )
      return null;
    const command = value.command;
    if (command !== null) {
      if (
        !command ||
        !text(command.key) ||
        !command.body ||
        command.body.checkpoint_version !== draft.version ||
        command.body.resolution !== draft.resolution ||
        !text(command.body.resolution)
      )
        return null;
      if (
        Object.keys(command.body).some(
          (key) =>
            ![
              "checkpoint_version",
              "resolution",
              "cohort_assignments",
            ].includes(key),
        )
      )
        return null;
      if (draft.resolution === "regroup_variants") {
        if (
          !assignments(command.body.cohort_assignments) ||
          JSON.stringify(command.body.cohort_assignments) !==
            JSON.stringify(draft.assignments)
        )
          return null;
      } else if (command.body.cohort_assignments !== undefined) return null;
      if (value.acceptedVersion !== null) return null;
    }
    return value;
  } catch {
    return null;
  }
}
export function saveCheckpointDraft(
  key: string | null,
  value: SavedCheckpointDraft | null,
) {
  if (!key) return;
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage unavailable: the current in-memory draft remains usable. */
  }
}
