import {describe, expect, it} from 'vitest';
import {componentForNodeName, componentHeatColor} from './modelMapping';
import {findings} from '../domain/fixtures';

describe('vehicle model mapping', () => {
  it('maps explicit model node names to stable component ids', () => {
    expect(componentForNodeName('Body_Panels')).toBe('body');
    expect(componentForNodeName('Cockpit_Steering_Wheel')).toBe('steering');
    expect(componentForNodeName('unknown_mesh')).toBeNull();
  });

  it('uses selected period metric color and neutral for missing samples', () => {
    expect(componentHeatColor(findings[0], '2025')).toBe('#e45454');
    expect(componentHeatColor(findings[0], '2026')).toBe('#e8b75a');
    expect(componentHeatColor(undefined, '2026')).toBe('#8a909b');
    expect(componentHeatColor({...findings[0], previous:{negative:0,total:0}}, '2025')).toBe('#8a909b');
  });

  it('uses parent-adapted samples for the active period', () => {
    const marketAdjusted = {...findings[0], current:{negative:2,total:10}, previous:{negative:0,total:0}};
    expect(componentHeatColor(marketAdjusted, '2026')).toBe('#57b6a0');
    expect(componentHeatColor(marketAdjusted, '2025')).toBe('#8a909b');
  });
});
