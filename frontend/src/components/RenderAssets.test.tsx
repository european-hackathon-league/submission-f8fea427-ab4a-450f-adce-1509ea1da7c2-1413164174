import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import RenderAssets from "./RenderAssets";
import type { Api } from "../api/contracts";
import type { RenderResult } from "../api/wire";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const assets: RenderResult["assets"] = [
  {
    asset_id: "asset-1",
    media_type: "image/png",
    url: "https://cdn.example.test/signed.png?signature=authorized",
  },
];
const api = { mode: "real" } as Api;
it("shows exact asset identity and loading state until native image load completes", () => {
  render(
    <RenderAssets
      api={api}
      assets={assets}
      identity="run:version1:variant1:render1"
    />,
  );
  const image = screen.getByRole("img", {
    name: "Variant asset asset-1 preview",
  });
  expect(image).toHaveAttribute("src", assets[0].url);
  expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(screen.getByRole("status")).toHaveTextContent("Loading asset asset-1");
  expect(screen.getByText(/Asset asset-1.*image\/png/)).toBeInTheDocument();
  fireEvent.load(image);
  expect(screen.getByRole("status")).toHaveTextContent("Asset asset-1 loaded");
  expect(
    screen.getByRole("link", { name: "Open variant asset asset-1" }),
  ).toHaveAttribute("href", assets[0].url);
});
it("keeps authorized link and fallback after failure and retries only image loading", async () => {
  const user = userEvent.setup();
  render(<RenderAssets api={api} assets={assets} identity="1" />);
  const image = screen.getByRole("img");
  fireEvent.error(image);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Asset asset-1 preview unavailable",
  );
  expect(
    screen.getByText(/Baseline and numbered explanations remain available/),
  ).toBeInTheDocument();
  expect(screen.getByRole("link")).toHaveAttribute("href", assets[0].url);
  await user.click(
    screen.getByRole("button", { name: "Retry asset asset-1 preview" }),
  );
  const retried = screen.getByRole("img");
  expect(retried).not.toBe(image);
  expect(retried).toHaveAttribute("src", assets[0].url);
  fireEvent.load(retried);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("offers resource retrieval for expired authorized links without creating generation commands", async () => {
  const user = userEvent.setup();
  const onRefreshLinks = vi.fn();
  render(
    <RenderAssets
      api={api}
      assets={assets}
      identity="1"
      onRefreshLinks={onRefreshLinks}
    />,
  );
  fireEvent.error(screen.getByRole("img"));
  await user.click(screen.getByRole("button", { name: "Refresh asset links" }));
  expect(onRefreshLinks).toHaveBeenCalledOnce();
});
it("resolves root-relative links through configured API origin without attaching runtime auth", () => {
  const linkUrl = vi.fn(
    (value) => new URL(value, "https://api.example.test").href,
  );
  const request = vi.fn();
  render(
    <RenderAssets
      api={{ ...api, linkUrl, request }}
      assets={[{ ...assets[0], url: "/api/v1/assets/image?signature=signed" }]}
      identity="1"
    />,
  );
  expect(screen.getByRole("img")).toHaveAttribute(
    "src",
    "https://api.example.test/api/v1/assets/image?signature=signed",
  );
  expect(screen.getByRole("link")).toHaveAttribute(
    "href",
    "https://api.example.test/api/v1/assets/image?signature=signed",
  );
  expect(request).not.toHaveBeenCalled();
});
it.each([
  "javascript:alert(1)",
  "data:image/png;base64,AA==",
  "blob:unowned",
  "https://token:secret@example.test/image",
])("withholds unsafe authorized asset URL %s", (url) => {
  render(
    <RenderAssets api={api} assets={[{ ...assets[0], url }]} identity="1" />,
  );
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "authorized web link unavailable",
  );
});
it("retains unsupported media as explicit link fallback without guessing geometry or image format", () => {
  render(
    <RenderAssets
      api={api}
      assets={[
        {
          ...assets[0],
          media_type: "model/gltf-binary",
          url: "https://cdn.example.test/model.glb",
        },
      ]}
      identity="1"
    />,
  );
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(
    screen.getByText(/Inline preview unavailable for model\/gltf-binary/),
  ).toBeInTheDocument();
  expect(screen.getByRole("link")).toHaveAttribute(
    "href",
    "https://cdn.example.test/model.glb",
  );
});
it("ignores late load from prior exact binding and displays new asset loading state", () => {
  const { rerender } = render(
    <RenderAssets api={api} assets={assets} identity="version1" />,
  );
  const old = screen.getByRole("img");
  rerender(
    <RenderAssets
      api={api}
      assets={[{ ...assets[0], url: "https://cdn.example.test/version2.png" }]}
      identity="version2"
    />,
  );
  const current = screen.getByRole("img");
  expect(current).not.toBe(old);
  fireEvent.load(old);
  expect(screen.getByRole("status")).toHaveTextContent("Loading asset asset-1");
  expect(current).toHaveAttribute(
    "src",
    "https://cdn.example.test/version2.png",
  );
  fireEvent.load(current);
  expect(screen.getByRole("status")).toHaveTextContent("loaded");
});
it("resets preview failure when same asset identity receives refreshed URL", () => {
  const { rerender } = render(
    <RenderAssets api={api} assets={assets} identity="1" />,
  );
  fireEvent.error(screen.getByRole("img"));
  rerender(
    <RenderAssets
      api={api}
      assets={[{ ...assets[0], url: "https://cdn.example.test/refreshed.png" }]}
      identity="1"
    />,
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveAttribute(
    "src",
    "https://cdn.example.test/refreshed.png",
  );
  expect(screen.getByRole("status")).toHaveTextContent("Loading");
});
it("keeps successful images usable when another asset fails", () => {
  render(
    <RenderAssets
      api={api}
      assets={[
        ...assets,
        {
          ...assets[0],
          asset_id: "asset-2",
          url: "https://cdn.example.test/2.png",
        },
      ]}
      identity="1"
    />,
  );
  const one = screen.getByRole("img", {
    name: "Variant asset asset-1 preview",
  });
  fireEvent.load(one);
  fireEvent.error(
    screen.getByRole("img", { name: "Variant asset asset-2 preview" }),
  );
  expect(one).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Asset asset-1 loaded");
  expect(screen.getByRole("alert")).toHaveTextContent("asset-2");
});
it("deduplicates identical assets while withholding conflicting same-ID records", () => {
  const { rerender } = render(
    <RenderAssets api={api} assets={[assets[0], assets[0]]} identity="1" />,
  );
  expect(screen.getAllByRole("img")).toHaveLength(1);
  rerender(
    <RenderAssets
      api={api}
      assets={[
        assets[0],
        { ...assets[0], url: "https://cdn.example.test/conflict.png" },
      ]}
      identity="1"
    />,
  );
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Conflicting asset identity asset-1",
  );
});
it("times out hung image loading and clears old timeout on successful loading or unmount", async () => {
  vi.useFakeTimers();
  const { unmount } = render(
    <RenderAssets api={api} assets={assets} identity="1" />,
  );
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(screen.getByRole("alert")).toHaveTextContent("timed out");
  fireEvent.click(
    screen.getByRole("button", { name: "Retry asset asset-1 preview" }),
  );
  fireEvent.load(screen.getByRole("img"));
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it("empty assets keep baseline fallback explicit without manufacturing preview", () => {
  render(<RenderAssets api={api} assets={[]} identity="1" />);
  expect(
    screen.getByText(/No bound asset supplied for this variant/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

it("resets ready preview when API resolution changes with the same returned path", () => {
  const asset = [{ ...assets[0], url: "/assets/authorized.png" }];
  const first = {
    ...api,
    linkUrl: (value: string) =>
      new URL(value, "https://first.example.test").href,
  };
  const second = {
    ...api,
    linkUrl: (value: string) =>
      new URL(value, "https://second.example.test").href,
  };
  const { rerender } = render(
    <RenderAssets api={first} assets={asset} identity="1" />,
  );
  const old = screen.getByRole("img");
  fireEvent.load(old);
  rerender(<RenderAssets api={second} assets={asset} identity="1" />);
  const current = screen.getByRole("img");
  expect(current).not.toBe(old);
  expect(current).toHaveAttribute(
    "src",
    "https://second.example.test/assets/authorized.png",
  );
  fireEvent.load(old);
  expect(screen.getByRole("status")).toHaveTextContent("Loading asset asset-1");
});
it("moves focus to the retried preview after replacing the retry control", async () => {
  const user = userEvent.setup();
  render(<RenderAssets api={api} assets={assets} identity="1" />);
  fireEvent.error(screen.getByRole("img"));
  await user.click(
    screen.getByRole("button", { name: "Retry asset asset-1 preview" }),
  );
  expect(
    screen.getByRole("figure", { name: "Variant asset asset-1" }),
  ).toHaveFocus();
});

it("loads protected asset bytes through the API and previews only its owned blob URL", async () => {
  const createObjectURL = vi.fn(() => "blob:owned-asset");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  const readAsset = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
  const protectedApi = {
    ...api,
    canReadAsset: (url: string) =>
      url.startsWith("https://api.example.test/api/v1/assets/"),
    readAsset,
  };
  const { unmount } = render(
    <RenderAssets
      api={protectedApi}
      assets={[
        { ...assets[0], url: "https://api.example.test/api/v1/assets/a" },
      ]}
      identity="1"
    />,
  );
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  const image = await screen.findByRole("img");
  expect(image).toHaveAttribute("src", "blob:owned-asset");
  expect(readAsset).toHaveBeenCalledWith(
    "https://api.example.test/api/v1/assets/a",
    expect.any(AbortSignal),
  );
  expect(screen.getByRole("link")).toHaveAttribute("href", "blob:owned-asset");
  unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:owned-asset");
});
it("keeps protected fetch failures explicit and retries retrieval without exposing an unauthorized link", async () => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:retried");
      static revokeObjectURL = vi.fn();
    },
  );
  const readAsset = vi
    .fn()
    .mockRejectedValueOnce(new Error("Access denied"))
    .mockResolvedValueOnce(new Blob(["image"]));
  const protectedApi = { ...api, canReadAsset: () => true, readAsset };
  render(<RenderAssets api={protectedApi} assets={assets} identity="1" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Retry asset asset-1 preview" }));
  expect(await screen.findByRole("img")).toHaveAttribute("src", "blob:retried");
  expect(readAsset).toHaveBeenCalledTimes(2);
});
it("aborts obsolete protected reads and ignores their late bytes after exact binding changes", async () => {
  const createObjectURL = vi.fn(() => "blob:current");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  let release!: (value: Blob) => void;
  let oldSignal!: AbortSignal;
  const readAsset = vi
    .fn()
    .mockImplementationOnce((_url: string, signal: AbortSignal) => {
      oldSignal = signal;
      return new Promise<Blob>((resolve) => {
        release = resolve;
      });
    })
    .mockResolvedValueOnce(new Blob(["new"]));
  const protectedApi = { ...api, canReadAsset: () => true, readAsset };
  const { rerender, unmount } = render(
    <RenderAssets api={protectedApi} assets={assets} identity="v1" />,
  );
  rerender(
    <RenderAssets
      api={protectedApi}
      assets={[{ ...assets[0], url: "https://api.example.test/new" }]}
      identity="v2"
    />,
  );
  expect(oldSignal.aborted).toBe(true);
  expect(await screen.findByRole("img")).toHaveAttribute("src", "blob:current");
  await act(async () => release(new Blob(["old"])));
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  unmount();
  expect(revokeObjectURL).toHaveBeenCalledOnce();
});
it("retrieves protected non-image bytes as a download without guessing a preview", async () => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:geometry");
      static revokeObjectURL = vi.fn();
    },
  );
  const readAsset = vi.fn(async () => new Blob(["binary"]));
  render(
    <RenderAssets
      api={{ ...api, canReadAsset: () => true, readAsset }}
      assets={[{ ...assets[0], media_type: "model/gltf-binary" }]}
      identity="1"
    />,
  );
  const link = await screen.findByRole("link", {
    name: "Download variant asset asset-1",
  });
  expect(link).toHaveAttribute("href", "blob:geometry");
  expect(link).toHaveAttribute("download", "asset-1");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(
    screen.getByText(/Geometry and semantic mappings are not inferred/),
  ).toBeInTheDocument();
});
it("aborts a protected read at preview timeout and creates no late object URL", async () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn(() => "blob:late");
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = vi.fn();
    },
  );
  let signal!: AbortSignal;
  let release!: (value: Blob) => void;
  const readAsset = vi.fn((_url: string, s: AbortSignal) => {
    signal = s;
    return new Promise<Blob>((resolve) => {
      release = resolve;
    });
  });
  render(
    <RenderAssets
      api={{ ...api, canReadAsset: () => true, readAsset }}
      assets={assets}
      identity="1"
    />,
  );
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole("alert")).toHaveTextContent("timed out");
  await act(async () => release(new Blob(["late"])));
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
it("never fetches signed external assets with the protected-read boundary", () => {
  const readAsset = vi.fn();
  render(
    <RenderAssets
      api={{ ...api, canReadAsset: () => false, readAsset }}
      assets={assets}
      identity="1"
    />,
  );
  expect(screen.getByRole("img")).toHaveAttribute("src", assets[0].url);
  expect(readAsset).not.toHaveBeenCalled();
});
