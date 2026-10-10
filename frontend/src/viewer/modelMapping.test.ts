import { describe, expect, it } from "vitest";
import { componentForNodeName, componentHeatColor } from "./modelMapping";

describe("vehicle model mapping", () => {
  it("maps explicit mesh names and leaves unknown meshes unmapped", () => {
    expect(componentForNodeName("Body_Panels")).toBe("body");
    expect(componentForNodeName("Cockpit_Steering_Wheel")).toBe("steering");
    expect(componentForNodeName("unknown_mesh")).toBeNull();
  });
  it("uses supplied negative-volume intensity even when negative share is low", () => {
    expect(
      componentHeatColor({
        id: "body",
        counts: {
          negative_records: 100,
          total_records: 10000,
          negative_share: 1,
          intensity_value: 0.8,
          intensity_scale_id: "volume-v1",
          low_evidence: false,
          provisional: false,
        },
      }),
    ).toBe("color-mix(in srgb, #b62e3c 80%, #e9dfe0)");
    expect(componentHeatColor(undefined)).toBe("#8a909b");
  });
});
