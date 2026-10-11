import { beforeEach, expect, it } from "vitest";
import { readSession, saveSession, clearSession } from "./session";
beforeEach(() => sessionStorage.clear());
it("restores run identity, selections and versioned drafts in current API namespace", () => {
  saveSession("real:/api/v1", { runId: "opaque/run", tab: "Proposals", selectedFindingId: "f", selectedComponent: "seats", view: "interior", variantId: "v", ideaDraft: "unsaved", proposalDrafts: [["v:c", { text: "draft", target: "12", baseVersion: 4 }]] });
  expect(readSession("real:/api/v1")?.proposalDrafts).toEqual([["v:c", { text: "draft", target: "12", baseVersion: 4 }]]);
  expect(readSession("real:other")).toBeNull();
  clearSession("real:/api/v1");
  expect(readSession("real:/api/v1")).toBeNull();
});
it("ignores malformed/foreign session data and unavailable browser storage", () => {
  sessionStorage.setItem("vehicle-workspace:real:/api/v1", '{"runId":12}');
  expect(readSession("real:/api/v1")).toBeNull();
});
it("restores only a valid exact proposal explanation identity", () => {
  const session = {runId:"r",tab:"Evidence",selectedFindingId:null,selectedComponent:"",view:"exterior",variantId:"v",ideaDraft:"",proposalDrafts:[]};
  saveSession("proposal", {...session,proposalSelection:{proposalVersion:7,variantId:"opaque/v",changeId:"opaque/c"}});
  expect(readSession("proposal")?.proposalSelection).toEqual({proposalVersion:7,variantId:"opaque/v",changeId:"opaque/c"});
  sessionStorage.setItem("vehicle-workspace:proposal", JSON.stringify({...session,proposalSelection:{proposalVersion:0,variantId:"v",changeId:"c"}}));
  expect(readSession("proposal")).toBeNull();
});
