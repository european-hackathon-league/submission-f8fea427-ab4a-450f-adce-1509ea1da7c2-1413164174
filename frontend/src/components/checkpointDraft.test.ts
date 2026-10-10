import { afterEach, expect, it } from "vitest";
import { readCheckpointDraft } from "./checkpointDraft";
afterEach(() => sessionStorage.clear());
it("rejects mismatched accepted version rather than treating browser storage as checkpoint state", () => {
  sessionStorage.setItem(
    "draft",
    JSON.stringify({
      draft: { version: 1, resolution: "continue", assignments: {} },
      command: null,
      acceptedVersion: 2,
    }),
  );
  expect(readCheckpointDraft("draft")).toBeNull();
});
it("rejects extra continuation command fields instead of forwarding unvalidated stored mutations", () => {
  sessionStorage.setItem(
    "draft",
    JSON.stringify({
      draft: { version: 1, resolution: "continue", assignments: {} },
      command: {
        key: "original-key",
        body: {
          checkpoint_version: 1,
          resolution: "continue",
          actor: "invented",
        },
      },
      acceptedVersion: null,
    }),
  );
  expect(readCheckpointDraft("draft")).toBeNull();
});
it.each([
  { version: 0, resolution: "continue", assignments: {} },
  { version: 1.5, resolution: "continue", assignments: {} },
  { version: 1, resolution: "continue", assignments: [] },
  {
    version: 1,
    resolution: "regroup_variants",
    assignments: { variant: ["cohort", "cohort"] },
  },
  {
    version: 1,
    resolution: "regroup_variants",
    assignments: { variant: [12] },
  },
])("rejects malformed checkpoint draft %#", (draft) => {
  sessionStorage.setItem(
    "draft",
    JSON.stringify({ draft, command: null, acceptedVersion: null }),
  );
  expect(readCheckpointDraft("draft")).toBeNull();
});
it("rejects a stored idempotency command with a different draft version or body", () => {
  sessionStorage.setItem(
    "draft",
    JSON.stringify({
      draft: {
        version: 1,
        resolution: "regroup_variants",
        assignments: { variant: ["cohort"] },
      },
      command: {
        key: "original-key",
        body: {
          checkpoint_version: 1,
          resolution: "regroup_variants",
          cohort_assignments: { variant: [] },
        },
      },
      acceptedVersion: null,
    }),
  );
  expect(readCheckpointDraft("draft")).toBeNull();
});
