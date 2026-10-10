import type {ComponentId, Finding, Period} from '../domain/contracts';
import {heatColor, negativeShare} from '../domain/metrics';

const nodeMappings: Record<string, ComponentId> = {
  body: 'body', body_panels: 'body', exterior_body: 'body',
  steering: 'steering', steering_wheel: 'steering', cockpit_steering_wheel: 'steering',
  dashboard: 'dashboard', instrument_panel: 'dashboard', cockpit_dashboard: 'dashboard',
  seats: 'seats', seat_front_left: 'seats', seat_front_right: 'seats',
  charging: 'charging', charge_port: 'charging', charging_port: 'charging',
  lighting: 'lighting', headlamps: 'lighting', rear_lamps: 'lighting',
};

export function componentForNodeName(name: string): ComponentId | null {
  return nodeMappings[name.trim().toLowerCase()] ?? null;
}

export function componentHeatColor(finding: Finding | undefined, period: Period): string {
  const sample = finding ? period === '2025' ? finding.previous : finding.current : undefined;
  return heatColor(sample ? negativeShare(sample) : null);
}
