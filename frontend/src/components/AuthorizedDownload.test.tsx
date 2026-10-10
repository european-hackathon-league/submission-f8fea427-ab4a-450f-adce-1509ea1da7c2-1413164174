import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Api } from "../api/contracts";
import AuthorizedDownload from "./AuthorizedDownload";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const url = "https://api.example.test/api/v1/runs/run/exports/export/download";
function api(
  readAsset: (url: string, signal: AbortSignal) => Promise<Blob>,
): Api {
  return {
    mode: "real",
    canReadAsset: () => true,
    readAsset,
  } as unknown as Api;
}
function objectUrls() {
  const create = vi.fn(() => "blob:authorized-export");
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  return { create, revoke };
}
it("downloads exact server bytes through authorization and revokes the object URL on cleanup", async () => {
  const bytes = new Blob(["server immutable bytes"]);
  const read = vi.fn(async () => bytes);
  const urls = objectUrls();
  const view = render(
    <AuthorizedDownload
      api={api(read)}
      url={url}
      filename="proposal-export.json"
    />,
  );
  const link = await screen.findByRole("link", {
    name: "Download authorized export",
  });
  expect(read).toHaveBeenCalledWith(url, expect.any(AbortSignal));
  expect(urls.create).toHaveBeenCalledWith(bytes);
  expect(link).toHaveAttribute("href", "blob:authorized-export");
  expect(link).toHaveAttribute("download", "proposal-export.json");
  view.unmount();
  expect(urls.revoke).toHaveBeenCalledWith("blob:authorized-export");
});
it("keeps externally authorized signed links direct without requesting credentials", () => {
  const read = vi.fn();
  const service = { ...api(read), canReadAsset: () => false };
  render(
    <AuthorizedDownload
      api={service}
      url="https://cdn.example.test/export?signature=public"
    />,
  );
  expect(
    screen.getByRole("link", { name: "Download authorized export" }),
  ).toHaveAttribute("href", "https://cdn.example.test/export?signature=public");
  expect(read).not.toHaveBeenCalled();
});
it("retries retrieval errors without creating an export and retains a keyboard destination", async () => {
  objectUrls();
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error("Access denied"))
    .mockResolvedValueOnce(new Blob(["server bytes"]));
  render(<AuthorizedDownload api={api(read)} url={url} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
  fireEvent.click(
    screen.getByRole("button", { name: "Retry authorized export download" }),
  );
  await screen.findByRole("link", { name: "Download authorized export" });
  expect(read).toHaveBeenCalledTimes(2);
  expect(
    screen.getByRole("region", { name: "Authorized export download" }),
  ).toHaveFocus();
});
it("aborts canceled/unmounted reads and discards late completions", async () => {
  const urls = objectUrls();
  let finish!: (blob: Blob) => void;
  let signal!: AbortSignal;
  const read = vi.fn((_url: string, s: AbortSignal) => {
    signal = s;
    return new Promise<Blob>((resolve) => (finish = resolve));
  });
  const view = render(<AuthorizedDownload api={api(read)} url={url} />);
  await screen.findByRole("button", { name: "Cancel export download" });
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel export download" }),
  );
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole("alert")).toHaveTextContent("canceled");
  await act(async () => finish(new Blob(["late"])));
  expect(urls.create).not.toHaveBeenCalled();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  view.unmount();
});
it("aborts on identity changes and never exposes an old blob as a new authorized export", async () => {
  const urls = objectUrls();
  const reads: Array<{ signal: AbortSignal; finish: (blob: Blob) => void }> =
    [];
  const service = api(
    (_url, signal) =>
      new Promise<Blob>((finish) => reads.push({ signal, finish })),
  );
  const view = render(<AuthorizedDownload api={service} url={url} />);
  await waitFor(() => expect(reads).toHaveLength(1));
  view.rerender(<AuthorizedDownload api={service} url={url + "-new"} />);
  await waitFor(() => expect(reads).toHaveLength(2));
  expect(reads[0].signal.aborted).toBe(true);
  await act(async () => reads[0].finish(new Blob(["old"])));
  expect(urls.create).not.toHaveBeenCalled();
  view.unmount();
  expect(reads[1].signal.aborted).toBe(true);
  await act(async () => reads[1].finish(new Blob(["new late"])));
  expect(urls.create).not.toHaveBeenCalled();
});
