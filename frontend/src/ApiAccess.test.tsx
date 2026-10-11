import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import ApiAccess from "./ApiAccess";
afterEach(cleanup);
it("connects using runtime application access headers without persisting the token", async () => {
  const user = userEvent.setup();
  let connected: { headers: Record<string, string>; namespace: string } | undefined;
  render(<ApiAccess baseUrl="/api/v1" onConnect={(_base, headers, namespace) => { connected = { headers, namespace }; }} />);
  expect(screen.getByRole("button", { name: "Connect to API" })).toBeDisabled();
  await user.type(screen.getByLabelText("Workspace ID"), "workspace-a");
  await user.type(screen.getByLabelText("API access token"), "example-token");
  await user.click(screen.getByRole("button", { name: "Connect to API" }));
  expect(connected).toEqual({ headers: { Authorization: "Bearer example-token", "X-Workspace-ID": "workspace-a" }, namespace: "/api/v1|workspace-a" });
  expect(sessionStorage.getItem("token")).toBeNull();
  expect(screen.getByLabelText("API access token")).toHaveValue("");
});
