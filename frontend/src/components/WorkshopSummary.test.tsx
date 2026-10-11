import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createMockApi } from "../api/client";
import {
  FeedbackOverview,
  FeedbackRing,
  SuggestionReview,
} from "./WorkshopSummary";
import type { Workspace } from "../api/contracts";
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
async function sample() {
  const api = createMockApi();
  const upload = await api.upload(new File(["feedback"], "test.xlsx"));
  const sourceId = upload.source_id;
  const vehicle = (await api.vehicles!())[0];
  const run = await api.request<{ run_id: string }>(
    "/runs",
    {
      vehicle_id: vehicle.vehicle_id,
      baseline_asset_id: vehicle.baseline_asset_id!,
      part_catalog_version: vehicle.part_catalog_version!,
      source_ids: [sourceId],
      market_context: [],
      participation_mode: "autonomous",
      deep_dive: { enabled: false },
    },
    "test-run",
  );
  return { api, w: await api.workspace(run.run_id) };
}
it("uses backend negative shares and leaves unknown shares unestimated", async () => {
  const { w } = await sample();
  const finding = {
    ...w.findings[0],
    counts: { ...w.findings[0].counts, negative_share: null },
  };
  render(
    <>
      <FeedbackOverview findings={[finding]} onReview={vi.fn()} />
      <FeedbackRing finding={finding} />
    </>,
  );
  expect(screen.getByRole("img")).toHaveAccessibleName(
    `${finding.counts.negative_records} of ${finding.counts.total_records} negative feedback records`,
  );
  expect(screen.queryByText("0%")).toBeInTheDocument(); // Axis only; no invented share.
  expect(screen.getAllByText("—")).toHaveLength(2);
});
it("replays an uncertain decision with identical body/key and refreshes real decision state", async () => {
  const { api, w } = await sample(),
    request = api.request,
    commands: Array<{ body: unknown; key?: string }> = [];
  api.request = async <T,>(path: string, body?: unknown, key?: string) => {
    const result = await request<T>(path, body, key);
    if (path.endsWith("/decisions")) {
      commands.push({ body, key });
      if (commands.length === 1) throw new Error("Response interrupted");
    }
    return result;
  };
  const variant = w.proposals.variants[0],
    change = variant.changes[0],
    onClose = vi.fn();
  let refreshed: Workspace | undefined;
  const onRefresh = vi.fn(async () => {
    refreshed = await api.workspace(w.snapshot.run_id);
    return refreshed;
  });
  const user = userEvent.setup();
  render(
    <SuggestionReview
      api={api}
      workspace={w}
      variantId={variant.variant_id}
      changeId={change.change_id}
      onClose={onClose}
      onRefresh={onRefresh}
      onOpen={vi.fn()}
      onEdit={vi.fn()}
    />,
  );
  await user.type(screen.getByLabelText("Decision note"), "Prioritize comfort");
  await user.click(screen.getByRole("button", { name: /^Approve$/ }));
  await screen.findByText("Response interrupted");
  expect(screen.getByRole("button", { name: "Close review" })).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Retry original decision" }),
  );
  await screen.findByText("Decision recorded");
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  expect(commands[0].body).toMatchObject({
    proposal_set_version: w.proposals.proposal_set_version,
    variant_id: variant.variant_id,
    change_ids: [change.change_id],
    action: "approve",
  });
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(refreshed?.proposals.variants[0].changes[0].decision_state).toBe(
    "approved",
  );
  expect(
    refreshed?.history.filter((a) => a.wire?.actor_type === "pm"),
  ).toHaveLength(1);
});
