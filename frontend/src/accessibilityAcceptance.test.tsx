import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import GraphPanel from "./components/GraphPanel";
import { findings, proposals, graph } from "./api/fixtures";
import type { Workspace } from "./api/contracts";
import SceneCapabilities from "./components/SceneCapabilities";
import { readFileSync } from "node:fs";
const workspaceCss = readFileSync("src/ui/workspace.css", "utf8");
const viewerCss = readFileSync("src/viewer/bmw-asset-viewer.css", "utf8");
function workspace(): Workspace {
  return {
    snapshot: {} as Workspace["snapshot"],
    findings,
    proposals,
    graph: structuredClone(graph),
    research: [],
    checkpoint: null,
    history: [],
  };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
function stylesheetRules(source: string) {
  const style = document.createElement("style");
  style.textContent = source;
  document.head.append(style);
  try {
    return [...style.sheet!.cssRules];
  } finally {
    style.remove();
  }
}
function mediaStyles(source: string, condition: string) {
  const media = stylesheetRules(source).find(
    (rule) => "conditionText" in rule && rule.conditionText === condition,
  ) as CSSMediaRule | undefined;
  expect(media, `Missing ${condition} acceptance rule`).toBeDefined();
  return [...media!.cssRules] as CSSStyleRule[];
}
it("preserves graph identity and moves focus to its unavailable detail when the focused node disappears", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const node = w.graph.nodes.find((item) => item.entity_type === "finding")!;
  const p = { workspace: w, onSelect: vi.fn() };
  const { rerender } = render(<GraphPanel {...p} />);
  const control = screen.getByRole("button", {
    name: `Inspect finding ${node.node_id}`,
  });
  control.focus();
  await user.keyboard("{Enter}");
  expect(control).toHaveFocus();
  const next = structuredClone(w);
  next.graph.nodes = next.graph.nodes.filter(
    (item) => item.node_id !== node.node_id,
  );
  rerender(<GraphPanel {...p} workspace={next} />);
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: node.node_id })).toHaveFocus(),
  );
  expect(
    screen.getByRole("region", { name: "Selected graph entity" }),
  ).toHaveTextContent("Selected entity is no longer present");
});
it("does not steal keyboard focus from search when a previously inspected graph node disappears", async () => {
  const user = userEvent.setup();
  const w = workspace();
  const node = w.graph.nodes.find((item) => item.entity_type === "finding")!;
  const p = { workspace: w, onSelect: vi.fn() };
  const { rerender } = render(<GraphPanel {...p} />);
  const control = screen.getByRole("button", {
    name: `Inspect finding ${node.node_id}`,
  });
  control.focus();
  await user.keyboard("{Enter}");
  const search = screen.getByRole("textbox", { name: "Search graph" });
  search.focus();
  const next = structuredClone(w);
  next.graph.nodes = next.graph.nodes.filter(
    (item) => item.node_id !== node.node_id,
  );
  rerender(<GraphPanel {...p} workspace={next} />);
  expect(search).toHaveFocus();
});

it("supports keyboard-only component selection with text equivalents for provisional feedback and live reduced-motion camera controls", async () => {
  const { act } = await import("@testing-library/react");
  const { default: Viewer } = await import("./viewer/BmwAssetViewer");
  let reduced = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduced })),
  );
  const events: Record<string, () => void> = {};
  const camera = { position: [2, 2, 4], target: [0, 0, 0] };
  const sdk = {
    start: vi.fn(),
    stop: vi.fn(),
    addEventListener: (name: string, callback: () => void) => {
      events[name] = callback;
    },
    getCameraLookAt: (
      callback: (error: unknown, value: typeof camera) => void,
    ) => callback(null, camera),
    getNodeMap: (callback: (error: unknown, value: unknown[]) => void) =>
      callback(null, []),
    setBackground: vi.fn(),
    setCameraLookAt: vi.fn(),
    recenterCamera: vi.fn(),
  };
  class HostedViewer {
    init(_id: string, options: { success: (value: typeof sdk) => void }) {
      options.success(sdk);
    }
  }
  const old = window.Sketchfab;
  window.Sketchfab = HostedViewer as unknown as NonNullable<
    Window["Sketchfab"]
  >;
  try {
    const user = userEvent.setup();
    const select = vi.fn();
    render(
      <Viewer
        selectedComponent="body"
        onSelectComponent={select}
        view="exterior"
        onViewChange={vi.fn()}
        heatmap
        findings={[
          {
            id: "body",
            cohort_ids: ["scope/exact"],
            counts: {
              negative_records: 2,
              total_records: 5,
              negative_share: 0.4,
              intensity_value: 0.8,
              intensity_scale_id: "server",
              low_evidence: true,
              provisional: true,
            },
          },
        ]}
      />,
    );
    await waitFor(() => expect(events.viewerready).toBeTypeOf("function"));
    act(() => events.viewerready());
    const body = screen.getByRole("button", {
      name: /Body.*2\/5 negative feedback records.*provisional.*low evidence/,
    });
    expect(body).toHaveTextContent("Cohorts scope/exact");
    const lamps = screen.getByRole("button", { name: /Headlamps.*No sample/ });
    lamps.focus();
    await user.keyboard("{Enter}");
    expect(select).toHaveBeenCalledWith("lighting");
    expect(lamps).toHaveFocus();
    const zoom = screen.getByRole("button", { name: "Zoom in" });
    zoom.focus();
    await user.keyboard(" ");
    expect(sdk.setCameraLookAt).toHaveBeenLastCalledWith(
      [1.6, 1.6, 3.2],
      [0, 0, 0],
      0.22,
    );
    reduced = true;
    await user.keyboard("{Enter}");
    expect(sdk.setCameraLookAt).toHaveBeenLastCalledWith(
      [1.6, 1.6, 3.2],
      [0, 0, 0],
      0,
    );
  } finally {
    window.Sketchfab = old;
    vi.unstubAllGlobals();
  }
});
it("retains a keyboard destination when an unactivated focused graph node disappears", async () => {
  const w = workspace();
  const node = w.graph.nodes[0];
  const p = { workspace: w, onSelect: vi.fn() };
  const { rerender } = render(<GraphPanel {...p} />);
  screen
    .getByRole("button", {
      name: `Inspect ${node.entity_type} ${node.node_id}`,
    })
    .focus();
  const next = structuredClone(w);
  next.graph.nodes = next.graph.nodes.filter(
    (item) => item.node_id !== node.node_id,
  );
  rerender(<GraphPanel {...p} workspace={next} />);
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Evidence graph" }),
    ).toHaveFocus(),
  );
  expect(p.onSelect).not.toHaveBeenCalled();
});
it("ships reduced-motion overrides for page transitions and hosted-viewer loading motion", () => {
  const global = mediaStyles(
    workspaceCss,
    "(prefers-reduced-motion: reduce)",
  ).find((rule) => rule.selectorText.includes("*"))!.style;
  expect(global.getPropertyValue("animation")).toBe("none");
  expect(global.getPropertyPriority("animation")).toBe("important");
  expect(global.getPropertyValue("transition")).toBe("none");
  expect(global.getPropertyValue("scroll-behavior")).toBe("auto");
  const viewer = mediaStyles(
    viewerCss,
    "(prefers-reduced-motion: reduce)",
  ).find((rule) => rule.selectorText.includes(".bmw-asset-viewer"))!.style;
  expect(viewer.getPropertyValue("animation-iteration-count")).toBe("1");
  expect(viewer.getPropertyValue("animation-duration")).toBe("0.01ms");
  expect(viewer.getPropertyValue("transition-duration")).toBe("0.01ms");
  expect(viewer.getPropertyValue("scroll-behavior")).toBe("auto");
});
it("retains full opaque scene identities and ships wrapping and single-column mobile safeguards", () => {
  const vehicleId = `vehicle/${"x".repeat(300)}`;
  render(
    <SceneCapabilities
      config={{
        vehicle_id: vehicleId,
        baseline_asset_id: "asset/unknown",
        part_catalog_version: "catalog/unknown",
      }}
    />,
  );
  const region = screen.getByRole("region", { name: "Scene capabilities" });
  expect(region).toHaveTextContent(vehicleId);
  expect(region).toHaveTextContent(
    "No substitute model or part mapping is applied.",
  );
  expect(
    screen.queryByRole("link", { name: "Open hosted baseline model" }),
  ).not.toBeInTheDocument();
  const sceneRule = stylesheetRules(workspaceCss).find(
    (rule) =>
      "selectorText" in rule && rule.selectorText === ".scene-capabilities",
  ) as CSSStyleRule;
  expect(region).toHaveClass("scene-capabilities");
  expect(sceneRule.style.getPropertyValue("overflow-wrap")).toBe("anywhere");
  const mobile = mediaStyles(workspaceCss, "(max-width: 760px)");
  expect(
    mobile
      .find((rule) => rule.selectorText === ".work-area")!
      .style.getPropertyValue("grid-template-columns"),
  ).toBe("minmax(0, 1fr)");
  expect(
    mobile
      .find((rule) => rule.selectorText === "button")!
      .style.getPropertyValue("min-height"),
  ).toBe("44px");
  const viewerMobile = mediaStyles(viewerCss, "(max-width: 640px)");
  expect(
    viewerMobile
      .find((rule) => rule.selectorText === ".bmw-asset-viewer__layout")!
      .style.getPropertyValue("grid-template-columns"),
  ).toBe("minmax(0,1fr)");
});
