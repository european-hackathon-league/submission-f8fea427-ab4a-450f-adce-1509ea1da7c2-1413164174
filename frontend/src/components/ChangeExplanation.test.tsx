import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import ChangeExplanation from "./ChangeExplanation";
import { proposals, findings, research, evidence } from "../api/fixtures";
import type { Api } from "../api/contracts";
afterEach(cleanup);
function api() {
  return {
    mode: "real",
    request: vi.fn(async (path: string) => {
      if (path.includes("/findings"))
        return { items: findings, revision: 1, next_cursor: null };
      if (path.includes("/research"))
        return { items: research, revision: 1, next_cursor: null };
      return evidence.find((e) => path.endsWith(e.evidence_id)) ?? evidence[0];
    }),
  } as unknown as Api;
}
const props = {
  runId: "run-synthetic",
  proposals,
  variantId: "variant-digital",
  changeId: "change-dashboard",
  onOpen: vi.fn(),
};
it("explains exact proposal/variant/change with source-bound evidence and target maturity", async () => {
  const service = api();
  render(<ChangeExplanation {...props} api={service} />);
  expect(
    screen.getByRole("region", { name: "Change explanation change-dashboard" }),
  ).toHaveTextContent("Proposal version 1 / variant variant-digital");
  expect(
    screen.getByText("Comfort functions span several screens."),
  ).toBeInTheDocument();
  expect(screen.getByText("Target basis").nextElementSibling).toHaveTextContent(
    "Validate task success with representative drivers.",
  );
  expect(screen.getByText(/needs_validation/)).toBeInTheDocument();
  expect(screen.getByText(/AI proposal/)).toBeInTheDocument();
  expect(screen.getByText(/Decision state: proposed/)).toBeInTheDocument();
  expect(
    await screen.findByText(/Current finding finding-dashboard.*172 of 400/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Historical counts are not available/),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(/Persistent shortcuts may reduce navigation/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Research counterevidence" }),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(
    (
      await screen.findAllByRole("button", { name: "Open source dashboard-E1" })
    )[0],
  );
  expect(props.onOpen).toHaveBeenCalledWith(evidence[0]);
});
it("does not substitute another variant or change when exact identity is missing", () => {
  const service = api();
  render(
    <ChangeExplanation {...props} api={service} variantId="missing-variant" />,
  );
  expect(
    screen.getByText(/Exact proposal variant or change unavailable/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Comfort functions span several screens."),
  ).not.toBeInTheDocument();
  expect(service.request).not.toHaveBeenCalled();
});
it("keeps immutable proposal text usable when current counts or research fail", async () => {
  const service = {
    mode: "real",
    request: async (path: string) => {
      if (path.includes("/findings") || path.includes("/research"))
        throw new Error("Resource offline");
      return evidence.find((e) => path.endsWith(e.evidence_id)) ?? evidence[0];
    },
  } as unknown as Api;
  render(<ChangeExplanation {...props} api={service} />);
  expect(await screen.findAllByRole("alert")).toHaveLength(2);
  expect(
    screen.getByText("Comfort functions span several screens."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Retry current finding counts" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Retry proposal research" }),
  ).toBeEnabled();
});
it("discards late data from previous exact change selection", async () => {
  let finish!: (value: unknown) => void;
  const service = {
    mode: "real",
    request: (path: string) =>
      path.includes("/findings")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ items: [], revision: 1, next_cursor: null }),
  } as unknown as Api;
  const { rerender } = render(<ChangeExplanation {...props} api={service} />);
  rerender(
    <ChangeExplanation {...props} api={service} changeId="missing-change" />,
  );
  finish({ items: findings, revision: 1, next_cursor: null });
  await waitFor(() =>
    expect(screen.queryByText(/172 of 400/)).not.toBeInTheDocument(),
  );
});
it("labels current research as current and displays an explicit missing before value", async () => {
  const service = api();
  const p = structuredClone(proposals);
  p.variants[0].changes[0].before = "";
  render(<ChangeExplanation {...props} api={service} proposals={p} />);
  expect(screen.getByText("Before").nextElementSibling).toHaveTextContent(
    "Not supplied",
  );
  expect(
    screen.getByText(/Historical research content is not available/),
  ).toBeInTheDocument();
  await screen.findByRole("heading", {
    name: "Current proposal-referenced research",
  });
});
