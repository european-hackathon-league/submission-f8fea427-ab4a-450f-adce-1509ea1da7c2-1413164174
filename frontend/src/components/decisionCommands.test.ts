import { afterEach, expect, it } from "vitest";
import { readDecision, saveDecision } from "./decisionCommands";
afterEach(() => sessionStorage.clear());
it("restores only the original decision for the exact displayed version and target", () => {
  const command = {
    key: "original-command",
    body: {
      proposal_set_version: 2,
      variant_id: "variant-1",
      change_ids: ["change-1"],
      action: "approve",
      rationale: "Customer need",
    },
  };
  saveDecision("decision", command);
  expect(readDecision("decision", 2, "variant-1", "change-1")).toEqual(command);
  expect(readDecision("decision", 3, "variant-1", "change-1")).toBeNull();
  expect(readDecision("decision", 2, "variant-2", "change-1")).toBeNull();
  expect(readDecision("decision", 2, "variant-1", "change-2")).toBeNull();
  saveDecision("decision", null);
  expect(readDecision("decision", 2, "variant-1", "change-1")).toBeNull();
});
it("ignores corrupted or unsupported saved commands", () => {
  sessionStorage.setItem("decision", "{broken");
  expect(readDecision("decision", 2, "v", "c")).toBeNull();
  saveDecision("decision", {
    key: "command",
    body: {
      proposal_set_version: 2,
      variant_id: "v",
      change_ids: ["c"],
      action: "delete",
      rationale: "Invalid",
    },
  });
  expect(readDecision("decision", 2, "v", "c")).toBeNull();
});
