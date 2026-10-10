import { expect, it } from "vitest";
import { placeRegionLabels } from "./RegionTags";

it.each([
  [800, 580],
  [320, 360],
])(
  "keeps crowded vehicle labels inside %i×%i without overlaps and retains world projections",
  (width, height) => {
    const points = [
      { id: "seats", x: 5, y: 5, width: 100, height: 40 },
      { id: "charging", x: width - 5, y: height - 5, width: 100, height: 40 },
      { id: "dashboard", x: width - 5, y: height - 5, width: 110, height: 40 },
    ];
    const labels = placeRegionLabels(points, width, height);
    expect(labels).toHaveLength(3);
    labels.forEach((label, index) => {
      expect(label.x).toBeGreaterThanOrEqual(12);
      expect(label.y).toBeGreaterThanOrEqual(12);
      expect(label.x + label.width).toBeLessThanOrEqual(width);
      expect(label.y + label.height).toBeLessThanOrEqual(height);
      expect(label.anchorX).toBe(points[index].x);
      expect(label.anchorY).toBe(points[index].y);
      labels
        .slice(index + 1)
        .forEach((other) =>
          expect(
            label.x + label.width + 10 <= other.x ||
              other.x + other.width + 10 <= label.x ||
              label.y + label.height + 10 <= other.y ||
              other.y + other.height + 10 <= label.y,
          ).toBe(true),
        );
    });
  },
);
it("updates tag placement when projected vehicle coordinates change", () => {
  const label = { id: "dashboard", x: 200, y: 200, width: 110, height: 40 };
  const before = placeRegionLabels([label], 800, 580)[0];
  const after = placeRegionLabels([{ ...label, x: 500, y: 300 }], 800, 580)[0];
  expect(after.x - before.x).toBe(300);
  expect(after.y - before.y).toBe(100);
});
it("hides offscreen or invalid anchors instead of falsely attaching them to a screen edge", () => {
  expect(
    placeRegionLabels(
      [
        { id: "offscreen", x: -10, y: 30, width: 100, height: 40 },
        { id: "invalid", x: NaN, y: 30, width: 100, height: 40 },
      ],
      800,
      580,
    ),
  ).toEqual([]);
});
