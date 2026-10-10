import type { ComponentId, PartFeedback } from "../domain/contracts";

const nodeMappings: Record<string, ComponentId> = {
  body: "body",
  body_panels: "body",
  exterior_body: "body",
  steering: "steering",
  steering_wheel: "steering",
  cockpit_steering_wheel: "steering",
  dashboard: "dashboard",
  instrument_panel: "dashboard",
  cockpit_dashboard: "dashboard",
  seats: "seats",
  seat_front_left: "seats",
  seat_front_right: "seats",
  charging: "charging",
  charge_port: "charging",
  charging_port: "charging",
  lighting: "lighting",
  headlamps: "lighting",
  rear_lamps: "lighting",
};

export function componentForNodeName(name: string): ComponentId | null {
  return nodeMappings[name.trim().toLowerCase()] ?? null;
}

export function componentHeatColor(finding: PartFeedback | undefined): string {
  if (!finding || !Number.isFinite(finding.counts.intensity_value))
    return "#8a909b";
  const intensity = Math.max(0, Math.min(1, finding.counts.intensity_value));
  return `color-mix(in srgb, #b62e3c ${intensity * 100}%, #e9dfe0)`;
}
