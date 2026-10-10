import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BmwAssetViewer, {
  BMW_I5_MODEL_UID,
  frameCameraForAspect,
  normalizeSketchfabNodeMap,
} from "./BmwAssetViewer";
import { findings as apiFindings } from "../api/fixtures";
const findings = apiFindings.flatMap((f) =>
  f.part_ids.map((id) => ({
    id,
    counts: {
      intensity_value: 0,
      intensity_scale_id: "synthetic-test",
      low_evidence: false,
      provisional: false,
      ...f.counts,
    },
  })),
);

type InitOptions = { success: (api: any) => void; error: () => void };

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("normalizeSketchfabNodeMap", () => {
  it("accepts documented flattened nodes and object-wrapped node maps", () => {
    expect(
      normalizeSketchfabNodeMap([{ instanceID: 7, name: "Headlamps" }]),
    ).toEqual([{ instanceID: 7, name: "Headlamps" }]);
    expect(
      normalizeSketchfabNodeMap({ nodes: { "8": { name: "Dashboard" } } }),
    ).toEqual([{ instanceID: 8, name: "Dashboard" }]);
    expect(
      normalizeSketchfabNodeMap({ bad: { name: "No instance id" } }),
    ).toEqual([]);
  });
});

describe("aspect-aware camera framing", () => {
  it("pulls back for narrow stages while preserving target and Z-up viewing direction", () => {
    const camera = { position: [5, 3, 8], target: [1, -2, 2] };
    const framed = frameCameraForAspect(camera, 573 / 450);
    const originalDirection = camera.position.map(
      (value, index) => value - camera.target[index],
    );
    const framedDirection = framed.position.map(
      (value, index) => value - framed.target[index],
    );

    expect(framed.target).toEqual(camera.target);
    expect(framed.position[2] - framed.target[2]).toBeGreaterThan(
      originalDirection[2],
    );
    expect(framedDirection[0] / originalDirection[0]).toBeCloseTo(
      framedDirection[1] / originalDirection[1],
    );
    expect(framedDirection[2] / originalDirection[2]).toBeCloseTo(
      framedDirection[0] / originalDirection[0],
    );
    expect(frameCameraForAspect(camera, 16 / 9)).toEqual(camera);
  });
});

describe("BmwAssetViewer", () => {
  it("shows every cohort aggregate for a shared part without summing counts or choosing one heat color", () => {
    const scoped = [
      {
        id: "body" as const,
        cohort_ids: ["urban", "premium"],
        counts: {
          negative_records: 3,
          total_records: 10,
          negative_share: 0.3,
          intensity_value: 0.8,
          intensity_scale_id: "backend-volume-v1",
          low_evidence: false,
          provisional: false,
        },
      },
      {
        id: "body" as const,
        cohort_ids: ["rural"],
        counts: {
          negative_records: 2,
          total_records: 4,
          negative_share: 0.5,
          intensity_value: 0.2,
          intensity_scale_id: "backend-volume-v1",
          low_evidence: true,
          provisional: true,
        },
      },
    ];
    const props = {
      selectedComponent: "body" as const,
      onSelectComponent: vi.fn(),
      view: "exterior" as const,
      onViewChange: vi.fn(),
      heatmap: true,
    };
    const { rerender } = render(
      <BmwAssetViewer {...props} findings={scoped} />,
    );
    const body = screen.getByRole("button", { name: /Body.*urban/ });
    expect(body).toHaveTextContent(
      "Cohorts urban, premium: 3/10 negative feedback records",
    );
    expect(body).toHaveTextContent(
      "Cohorts rural: 2/4 negative feedback records / provisional / low evidence",
    );
    expect(body).not.toHaveTextContent("5/14");
    expect(body.querySelector(".bmw-asset-viewer__part-dot")).toHaveStyle({
      "--heat": "#8a909b",
    });
    rerender(<BmwAssetViewer {...props} findings={[scoped[1]]} />);
    expect(
      screen.getByRole("button", { name: /Body.*rural/ }),
    ).toHaveTextContent("Cohorts rural: 2/4");
    expect(
      screen
        .getByRole("button", { name: /Body.*rural/ })
        .querySelector(".bmw-asset-viewer__part-dot"),
    ).not.toHaveStyle({ "--heat": "#8a909b" });
  });

  it("keeps selected component inside the active view when switching presets", () => {
    const onSelectComponent = vi.fn();
    const onViewChange = vi.fn();
    render(
      <BmwAssetViewer
        selectedComponent="body"
        onSelectComponent={onSelectComponent}
        view="exterior"
        onViewChange={onViewChange}
        heatmap={false}
        findings={findings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Interior photo" }));

    expect(onViewChange).toHaveBeenCalledWith("interior");
    expect(onSelectComponent).toHaveBeenCalledWith("steering");
  });

  it("shows real-asset attribution and keeps parent-controlled component selection usable", () => {
    const onSelectComponent = vi.fn();
    const props = {
      onSelectComponent,
      view: "exterior" as const,
      onViewChange: vi.fn(),
      heatmap: true,
      findings,
      className: "bmw-asset-viewer--compact",
    };
    const { rerender } = render(
      <BmwAssetViewer {...props} selectedComponent="body" />,
    );

    expect(
      screen.getByRole("region", { name: "BMW i5 M60 vehicle viewer" }),
    ).toHaveClass("bmw-asset-viewer--compact");
    expect(screen.getByRole("link", { name: /Nazh Design/ })).toHaveAttribute(
      "href",
      expect.stringContaining("sketchfab.com"),
    );
    expect(screen.getByRole("link", { name: /CC BY 4.0/ })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by/4.0/",
    );
    expect(
      screen
        .getByRole("button", { name: /Headlamps/ })
        .querySelector(".bmw-asset-viewer__part-dot"),
    ).toHaveStyle({ "--heat": "#8a909b" });
    fireEvent.click(screen.getByRole("button", { name: /Headlamps/ }));
    expect(onSelectComponent).toHaveBeenCalledWith("lighting");
    rerender(<BmwAssetViewer {...props} selectedComponent="lighting" />);
    expect(screen.getByRole("button", { name: /Headlamps/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("uses a licensed real G60 cabin photograph instead of claiming an unverified 3D interior", () => {
    const onSelectComponent = vi.fn();
    const { container } = render(
      <BmwAssetViewer
        selectedComponent="dashboard"
        onSelectComponent={onSelectComponent}
        view="interior"
        onViewChange={vi.fn()}
        heatmap
        findings={findings}
      />,
    );

    expect(
      screen.getByRole("img", {
        name: /BMW 5 Series G60 cabin reference photo/i,
      }),
    ).toHaveAttribute("src", "/vehicles/g60-interior.jpg");
    expect(
      container.querySelector(".bmw-asset-viewer__photo-canvas"),
    ).toContainElement(
      container.querySelector(".bmw-asset-viewer__photo-markers"),
    );
    expect(
      screen.getByText(/Detailed 3D cabin not verified/i),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Dashboard feedback marker/ }),
    );
    expect(onSelectComponent).toHaveBeenCalledWith("dashboard");
  });

  it("does not map plausible unverified Sketchfab nodes to a component", async () => {
    const onSelectComponent = vi.fn();
    const onStatusChange = vi.fn();
    const events: Record<string, (value?: any) => void> = {};
    const api = {
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn(
        (name: string, callback: (value?: any) => void) => {
          events[name] = callback;
        },
      ),
      getCameraLookAt: (callback: (error: unknown, camera: any) => void) =>
        callback(null, { position: [2, 2, 4], target: [0, 0, 0] }),
      getNodeMap: (callback: (error: unknown, nodes: unknown) => void) =>
        callback(null, {
          nodes: {
            front: { instanceID: 77, name: "headlamps" },
            wheel: { instanceID: 78, name: "steering_wheel" },
          },
        }),
      setCameraLookAt: vi.fn(),
      setBackground: vi.fn(),
      recenterCamera: vi.fn(),
    };
    const init = vi.fn();
    class SketchfabMock {
      init(uid: string, options: InitOptions) {
        init(uid, options);
        options.success(api);
      }
    }
    Object.assign(window, { Sketchfab: SketchfabMock });
    render(
      <BmwAssetViewer
        selectedComponent="body"
        onSelectComponent={onSelectComponent}
        view="exterior"
        onViewChange={vi.fn()}
        heatmap={false}
        findings={findings}
        onStatusChange={onStatusChange}
      />,
    );

    await waitFor(() =>
      expect(init).toHaveBeenCalledWith(
        BMW_I5_MODEL_UID,
        expect.objectContaining({ autospin: 0, dnt: 1 }),
      ),
    );
    expect(events.viewerready).toBeTypeOf("function");
    act(() => events.viewerready());
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("ready"));
    expect(api.setBackground).toHaveBeenCalledWith({
      color: [0.93, 0.94, 0.95],
    });
    events.click({ instanceID: 77 });
    expect(onSelectComponent).not.toHaveBeenCalled();
    events.click({ instanceID: 78 });
    expect(onSelectComponent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Headlamps/ }));
    expect(onSelectComponent).toHaveBeenCalledWith("lighting");
  });

  it("keeps hosted camera and iframe when switching views or refreshing aggregate data", async () => {
    const events: Record<string, (value?: any) => void> = {};
    const api = {
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn(
        (name: string, callback: (value?: any) => void) => {
          events[name] = callback;
        },
      ),
      getCameraLookAt: (callback: (error: unknown, camera: any) => void) =>
        callback(null, { position: [2, 2, 4], target: [0, 0, 0] }),
      getNodeMap: (callback: (error: unknown, nodes: unknown) => void) =>
        callback(null, []),
      setCameraLookAt: vi.fn(),
      setBackground: vi.fn(),
      recenterCamera: vi.fn(),
    };
    const init = vi.fn((_uid: string, options: InitOptions) =>
      options.success(api),
    );
    class SketchfabMock {
      init = init;
    }
    Object.assign(window, { Sketchfab: SketchfabMock });
    const props = {
      selectedComponent: "body" as const,
      onSelectComponent: vi.fn(),
      view: "exterior" as const,
      onViewChange: vi.fn(),
      heatmap: false,
      findings,
    };
    const { rerender } = render(<BmwAssetViewer {...props} />);
    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    act(() => events.viewerready());
    const frame = screen.getByTitle(
      "Interactive 3D model of the 2023 BMW i5 M60",
    );
    api.setCameraLookAt.mockClear();
    rerender(<BmwAssetViewer {...props} view="interior" />);
    expect(frame).toBeInTheDocument();
    expect(frame).not.toBeVisible();
    rerender(<BmwAssetViewer {...props} findings={[...findings].reverse()} />);
    expect(frame).toBeVisible();
    expect(init).toHaveBeenCalledTimes(1);
    expect(api.setCameraLookAt).not.toHaveBeenCalled();
    expect(api.stop).toHaveBeenCalled();
  });

  it.each(["camerastop", "pagehide"])(
    "restores the actual SDK camera saved on %s after a same-tab reload without changing the reset preset",
    async (event) => {
      let camera = { position: [2, 2, 4], target: [0, 0, 0] };
      const events: Record<string, () => void> = {};
      const api = {
        start: vi.fn(),
        stop: vi.fn(),
        addEventListener: vi.fn((name: string, callback: () => void) => {
          events[name] = callback;
        }),
        getCameraLookAt: (callback: (error: unknown, camera: any) => void) =>
          callback(null, camera),
        getNodeMap: (callback: (error: unknown, nodes: unknown) => void) =>
          callback(null, []),
        setCameraLookAt: vi.fn((position: number[], target: number[]) => {
          camera = { position, target };
        }),
        setBackground: vi.fn(),
        recenterCamera: vi.fn(),
      };
      class SketchfabMock {
        init(_uid: string, options: InitOptions) {
          options.success(api);
        }
      }
      Object.assign(window, { Sketchfab: SketchfabMock });
      const props = {
        selectedComponent: "body" as const,
        onSelectComponent: vi.fn(),
        view: "exterior" as const,
        onViewChange: vi.fn(),
        heatmap: false,
        findings,
      };
      const first = render(<BmwAssetViewer {...props} />);
      await waitFor(() => expect(events.viewerready).toBeTypeOf("function"));
      act(() => events.viewerready());
      camera = { position: [9, -3, 7], target: [1, 2, 0] };
      expect(events.camerastop).toBeTypeOf("function");
      act(() => {
        if (event === "pagehide") window.dispatchEvent(new Event("pagehide"));
        else events.camerastop();
      });
      first.unmount();
      camera = { position: [2, 2, 4], target: [0, 0, 0] };
      api.setCameraLookAt.mockClear();
      delete events.viewerready;
      render(<BmwAssetViewer {...props} />);
      await waitFor(() => expect(events.viewerready).toBeTypeOf("function"));
      act(() => events.viewerready());
      expect(api.setCameraLookAt).toHaveBeenCalledWith(
        [9, -3, 7],
        [1, 2, 0],
        0,
      );
      fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
      expect(api.setCameraLookAt).toHaveBeenLastCalledWith(
        [1.6, 1.6, 3.2],
        [0, 0, 0],
        expect.any(Number),
      );
    },
  );

  it.each([
    "{invalid",
    JSON.stringify({ position: [1, 2], target: [0, 0, 0] }),
    JSON.stringify({ position: [null, 2, 3], target: [0, 0, 0] }),
    JSON.stringify({ position: [0, 0, 0], target: [0, 0, 0] }),
  ])(
    "ignores an invalid cached camera and keeps SDK navigation usable: %s",
    async (cached) => {
      sessionStorage.setItem("vehicle-camera:" + BMW_I5_MODEL_UID, cached);
      const events: Record<string, () => void> = {};
      const api = {
        start: vi.fn(),
        stop: vi.fn(),
        addEventListener: vi.fn((name: string, callback: () => void) => {
          events[name] = callback;
        }),
        getCameraLookAt: (callback: (error: unknown, camera: any) => void) =>
          callback(null, { position: [2, 2, 4], target: [0, 0, 0] }),
        getNodeMap: (callback: (error: unknown, nodes: unknown) => void) =>
          callback(null, []),
        setCameraLookAt: vi.fn(),
        setBackground: vi.fn(),
        recenterCamera: vi.fn(),
      };
      class SketchfabMock {
        init(_uid: string, options: InitOptions) {
          options.success(api);
        }
      }
      Object.assign(window, { Sketchfab: SketchfabMock });
      render(
        <BmwAssetViewer
          selectedComponent="body"
          onSelectComponent={vi.fn()}
          view="exterior"
          onViewChange={vi.fn()}
          heatmap={false}
          findings={findings}
        />,
      );
      await waitFor(() => expect(events.viewerready).toBeTypeOf("function"));
      act(() => events.viewerready());
      expect(api.setCameraLookAt).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    },
  );

  it("keeps camera controls usable when session storage access is denied", async () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("Blocked", "SecurityError");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Blocked", "SecurityError");
      });
    const events: Record<string, () => void> = {};
    const api = {
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn((name: string, callback: () => void) => {
        events[name] = callback;
      }),
      getCameraLookAt: (callback: (error: unknown, camera: any) => void) =>
        callback(null, { position: [2, 2, 4], target: [0, 0, 0] }),
      getNodeMap: (callback: (error: unknown, nodes: unknown) => void) =>
        callback(null, []),
      setCameraLookAt: vi.fn(),
      setBackground: vi.fn(),
      recenterCamera: vi.fn(),
    };
    class SketchfabMock {
      init(_uid: string, options: InitOptions) {
        options.success(api);
      }
    }
    Object.assign(window, { Sketchfab: SketchfabMock });
    render(
      <BmwAssetViewer
        selectedComponent="body"
        onSelectComponent={vi.fn()}
        view="exterior"
        onViewChange={vi.fn()}
        heatmap={false}
        findings={findings}
      />,
    );
    await waitFor(() => expect(events.viewerready).toBeTypeOf("function"));
    act(() => events.viewerready());
    act(() => events.camerastop());
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(api.setCameraLookAt).toHaveBeenCalledWith(
      [1.6, 1.6, 3.2],
      [0, 0, 0],
      expect.any(Number),
    );
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("keeps vehicle-wide findings spatially unselected across view changes", () => {
    const onSelectComponent = vi.fn();
    render(
      <BmwAssetViewer
        selectedComponent={null}
        onSelectComponent={onSelectComponent}
        view="exterior"
        onViewChange={vi.fn()}
        heatmap
        findings={findings}
      />,
    );
    expect(screen.getByText("No spatial part selected")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Interior photo" }));
    expect(onSelectComponent).not.toHaveBeenCalled();
  });

  it("recovers a missing cabin photograph without floating markers over an unavailable image", () => {
    render(
      <BmwAssetViewer
        selectedComponent="dashboard"
        onSelectComponent={vi.fn()}
        view="interior"
        onViewChange={vi.fn()}
        heatmap
        findings={findings}
      />,
    );
    fireEvent.error(
      screen.getByRole("img", {
        name: /BMW 5 Series G60 cabin reference photo/i,
      }),
    );
    expect(
      screen.getByText(/Cabin reference image unavailable/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Dashboard feedback marker/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Dashboard.*negative feedback records/,
      }),
    ).toBeEnabled();
    screen.getByRole("button", { name: "Retry cabin image" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Retry cabin image" }));
    expect(
      screen.getByRole("button", { name: "Interior photo" }),
    ).toHaveFocus();
    expect(
      screen.getByRole("img", {
        name: /BMW 5 Series G60 cabin reference photo/i,
      }),
    ).toBeInTheDocument();
  });

  it("offers recovery when both hosted model and local exterior preview fail", async () => {
    class SketchfabMock {
      init(_uid: string, options: InitOptions) {
        options.error();
      }
    }
    Object.assign(window, { Sketchfab: SketchfabMock });
    render(
      <BmwAssetViewer
        selectedComponent="body"
        onSelectComponent={vi.fn()}
        view="exterior"
        onViewChange={vi.fn()}
        heatmap={false}
        findings={findings}
      />,
    );
    fireEvent.error(
      screen.getByRole("img", {
        name: /BMW i5 M60 three-quarter exterior preview/i,
      }),
    );
    await screen.findByRole("button", { name: "Retry 3D model" });
    expect(
      screen.getByText(/Exterior preview unavailable/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Verified preview stays available/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry 3D model" }),
    ).toBeEnabled();
    screen.getByRole("button", { name: "Retry exterior preview" }).focus();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry exterior preview" }),
    );
    expect(screen.getByRole("button", { name: "Exterior 3D" })).toHaveFocus();
    expect(
      screen.getByRole("img", {
        name: /BMW i5 M60 three-quarter exterior preview/i,
      }),
    ).toBeInTheDocument();
  });

  it("reports initialization failure and keeps verified preview available", async () => {
    const onStatusChange = vi.fn();
    const init = vi.fn((_uid: string, options: InitOptions) => options.error());
    class SketchfabMock {
      init = init;
    }
    Object.assign(window, { Sketchfab: SketchfabMock });
    render(
      <BmwAssetViewer
        selectedComponent="body"
        onSelectComponent={vi.fn()}
        view="exterior"
        onViewChange={vi.fn()}
        heatmap={false}
        findings={findings}
        onStatusChange={onStatusChange}
      />,
    );
    await waitFor(() => expect(init).toHaveBeenCalled());

    expect(screen.getByRole("alert")).toHaveTextContent(
      /3D model could not load/i,
    );
    expect(
      screen.getByRole("img", {
        name: /BMW i5 M60 three-quarter exterior preview/i,
      }),
    ).toBeInTheDocument();
    expect(onStatusChange).toHaveBeenCalledWith("fallback");
  });

  it("offers retry after a failed API initialization and starts the model again", async () => {
    const events: Record<string, (value?: any) => void> = {};
    const api = {
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn(
        (name: string, callback: (value?: any) => void) => {
          events[name] = callback;
        },
      ),
      getCameraLookAt: (callback: (error: unknown, camera: any) => void) =>
        callback(null, { position: [2, 2, 4], target: [0, 0, 0] }),
      getNodeMap: (callback: (error: unknown, nodes: unknown) => void) =>
        callback(null, []),
      setCameraLookAt: vi.fn(),
      setBackground: vi.fn(),
      recenterCamera: vi.fn(),
    };
    const init = vi.fn((_uid: string, options: InitOptions) =>
      init.mock.calls.length === 1 ? options.error() : options.success(api),
    );
    class SketchfabMock {
      init = init;
    }
    Object.assign(window, { Sketchfab: SketchfabMock });
    render(
      <BmwAssetViewer
        selectedComponent="body"
        onSelectComponent={vi.fn()}
        view="exterior"
        onViewChange={vi.fn()}
        heatmap={false}
        findings={findings}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry 3D model" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry 3D model" }));
    await waitFor(() => expect(init).toHaveBeenCalledTimes(2));
    act(() => events.viewerready());
    expect(api.start).toHaveBeenCalled();
  });

  it("provides semantic orbit and zoom controls and honors reduced motion on reset", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    const events: Record<string, (value?: any) => void> = {};
    const api = {
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn(
        (name: string, callback: (value?: any) => void) => {
          events[name] = callback;
        },
      ),
      getCameraLookAt: (callback: (error: unknown, camera: any) => void) =>
        callback(null, { position: [2, 2, 4], target: [0, 0, 0] }),
      getNodeMap: (callback: (error: unknown, nodes: unknown) => void) =>
        callback(null, []),
      setCameraLookAt: vi.fn(),
      setBackground: vi.fn(),
      recenterCamera: vi.fn(),
    };
    class SketchfabMock {
      init(_uid: string, options: InitOptions) {
        options.success(api);
      }
    }
    Object.assign(window, { Sketchfab: SketchfabMock });
    render(
      <BmwAssetViewer
        selectedComponent="body"
        onSelectComponent={vi.fn()}
        view="exterior"
        onViewChange={vi.fn()}
        heatmap={false}
        findings={findings}
      />,
    );
    await waitFor(() => expect(api.start).toHaveBeenCalled());
    act(() => events.viewerready());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(api.setCameraLookAt).toHaveBeenCalledWith(
      [1.6, 1.6, 3.2],
      [0, 0, 0],
      0,
    );
    fireEvent.click(screen.getByRole("button", { name: "Orbit model left" }));
    const [orbitPosition, orbitTarget] = api.setCameraLookAt.mock.lastCall!;
    expect(orbitTarget).toEqual([0, 0, 0]);
    // Sketchfab's native autospin is around Z; keep the camera's Z component fixed.
    expect(orbitPosition[0]).toBeCloseTo(
      2 * Math.cos(-Math.PI / 12) - 2 * Math.sin(-Math.PI / 12),
    );
    expect(orbitPosition[1]).toBeCloseTo(
      2 * Math.sin(-Math.PI / 12) + 2 * Math.cos(-Math.PI / 12),
    );
    expect(orbitPosition[2]).toBeCloseTo(4);
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(api.setCameraLookAt).toHaveBeenLastCalledWith(
      [1.6, 1.6, 3.2],
      [0, 0, 0],
      0,
    );
  });
});
