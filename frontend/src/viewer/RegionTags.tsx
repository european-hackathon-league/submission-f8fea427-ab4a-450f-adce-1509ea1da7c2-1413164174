import { useEffect, useRef, useState } from "react";
import type { ComponentId, PartFeedback } from "../domain/contracts";
import { feedbackColor, partLabel } from "../components/WorkshopSummary";
// Reference-region coordinates for this Sketchfab asset; cabin tags are approximate, not mesh identities.
export const regionAnchors: Partial<Record<ComponentId, number[]>> = {
  seats: [4.7481239028, -0.7548861555, 1.1763151446],
  charging: [5.5466307399, -0.9396966937, 0.836112487],
  dashboard: [2.9584006468, -0.1996651545, 1.0861706146],
};
type Rect = { x: number; y: number; width: number; height: number };
export function placeRegionLabels(
  points: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>,
  width: number,
  height: number,
) {
  const placed: Rect[] = [];
  return points
    .map((p) => {
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.y < 0 ||
        p.x > width ||
        p.y > height
      )
        return null;
      const choices: number[][] = [];
      for (const gap of [24, 64, 108, 156])
        choices.push(
          [p.x - p.width / 2, p.y - p.height - gap],
          [p.x + gap, p.y - p.height / 2],
          [p.x - p.width - gap, p.y - p.height / 2],
          [p.x - p.width / 2, p.y + gap],
        );
      for (let y = 12; y <= height - p.height - 12; y += p.height + 12)
        for (let x = 12; x <= width - p.width - 12; x += p.width + 12)
          choices.push([x, y]);
      const rect = choices
        .map(([x, y]) => ({
          x: Math.max(12, Math.min(x, width - p.width - 12)),
          y: Math.max(12, Math.min(y, height - p.height - 12)),
          width: p.width,
          height: p.height,
        }))
        .find(
          (r) =>
            r.x + r.width <= width &&
            r.y + r.height <= height &&
            placed.every(
              (q) =>
                r.x + r.width + 10 <= q.x ||
                q.x + q.width + 10 <= r.x ||
                r.y + r.height + 10 <= q.y ||
                q.y + q.height + 10 <= r.y,
            ),
        );
      if (!rect) return null;
      placed.push(rect);
      return { ...rect, id: p.id, anchorX: p.x, anchorY: p.y };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
}
export type ProjectionApi = {
  getWorldToScreenCoordinates?: (
    point: number[],
    callback: (result: { canvasCoord: ArrayLike<number> }) => void,
  ) => void;
};
export default function RegionTags({
  api,
  ready,
  findings,
  onSelect,
  selected,
}: {
  api: React.RefObject<ProjectionApi | null>;
  ready: boolean;
  findings: PartFeedback[];
  onSelect: (id: ComponentId) => void;
  selected: ComponentId | null;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ReturnType<typeof placeRegionLabels>>(
    [],
  );
  const ids = [
    ...new Set(findings.filter((f) => regionAnchors[f.id]).map((f) => f.id)),
  ];
  const idKey = JSON.stringify(ids);
  useEffect(() => {
    if (!ready || !api.current?.getWorldToScreenCoordinates) {
      setLayout([]);
      return;
    }
    let disposed = false,
      raf = 0,
      last = 0,
      busy = false;
    const project = (time: number) => {
      raf = requestAnimationFrame(project);
      const el = overlay.current;
      if (
        disposed ||
        busy ||
        document.hidden ||
        !el ||
        !el.getClientRects().length ||
        time - last < 32
      )
        return;
      const width = el.clientWidth,
        height = el.clientHeight;
      if (!width || !height) return;
      last = time;
      busy = true;
      const currentIds = JSON.parse(idKey) as ComponentId[];
      if (!currentIds.length) {
        busy = false;
        return;
      }
      let remaining = currentIds.length;
      const points: Parameters<typeof placeRegionLabels>[0] = [];
      currentIds.forEach((id) =>
        api.current?.getWorldToScreenCoordinates?.(
          regionAnchors[id]!,
          (result) => {
            if (disposed) return;
            const label = el.querySelector<HTMLButtonElement>(
              `[data-region="${id}"]`,
            );
            points.push({
              id,
              x: result.canvasCoord?.[0],
              y: result.canvasCoord?.[1],
              width: label?.offsetWidth || 100,
              height: label?.offsetHeight || 40,
            });
            if (--remaining === 0) {
              setLayout(
                placeRegionLabels(
                  points.sort((a, b) => a.id.localeCompare(b.id)),
                  width,
                  height,
                ),
              );
              busy = false;
            }
          },
        ),
      );
    };
    raf = requestAnimationFrame(project);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [api, ready, idKey]);
  return (
    <div
      className="vehicle-region-tags"
      ref={overlay}
      aria-label="Suggestions on vehicle"
    >
      <svg aria-hidden="true">
        {layout.map((p) => (
          <g key={p.id}>
            <path
              d={`M${p.anchorX},${p.anchorY} L${Math.max(p.x, Math.min(p.anchorX, p.x + p.width))},${Math.max(p.y, Math.min(p.anchorY, p.y + p.height))}`}
            />
            <circle cx={p.anchorX} cy={p.anchorY} r="3" />
          </g>
        ))}
      </svg>
      {ids.map((id) => {
        const p = layout.find((p) => p.id === id);
        const scoped = findings.filter((f) => f.id === id);
        const share =
          scoped.length === 1 ? scoped[0].counts.negative_share : null;
        return (
          <button
            key={id}
            data-region={id}
            aria-pressed={selected === id}
            style={{
              left: p?.x,
              top: p?.y,
              visibility: p ? "visible" : "hidden",
            }}
            onClick={() => onSelect(id)}
          >
            <i style={{ background: feedbackColor(share) }} />
            {partLabel(id)}
          </button>
        );
      })}
    </div>
  );
}
