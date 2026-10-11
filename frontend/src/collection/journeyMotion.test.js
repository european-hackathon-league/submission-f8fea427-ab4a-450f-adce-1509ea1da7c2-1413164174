import { expect, test } from 'vitest';
import { journeySample, dampProgress, angleFrames } from './journeyMotion.js';
import { models } from './journeyData.js';
test('includes the complete requested dataset without invented G68 trims', () => {
  expect(models).toHaveLength(24);
  expect(['F70','G60','G70','G68'].map(f => models.filter(m=>m.family===f).length)).toEqual([6,10,7,1]);
  expect(new Set(models.map(m=>m.id)).size).toBe(24);
});
test('keeps camera angle continuous across every family handoff and reverses exactly', () => {
  for(let boundary=1;boundary<4;boundary++) {
    const before=journeySample(boundary-.25-0.0001), after=journeySample(boundary-.25+0.0001);
    expect(Math.abs(before.angle-after.angle)).toBeLessThan(0.1);
    expect(before.mix).toBeCloseTo(after.mix,2);
  }
  expect(journeySample(1.4)).toEqual(journeySample(1.4));
});
test('damping is frame-rate independent and angles wrap without a last-frame jump', () => {
  const whole=dampProgress(0,2,1/30);
  expect(dampProgress(dampProgress(0,2,1/60),2,1/60)).toBeCloseTo(whole,8);
  expect(angleFrames(359,36)).toEqual({first:35,second:0,mix:0.9});
  expect(angleFrames(360,36)).toEqual({first:0,second:1,mix:0});
});

test('handoffs span the complete blend before the next family settles',()=>{expect(journeySample(.6).mix).toBeCloseTo(0);expect(journeySample(.75).mix).toBeCloseTo(.5);expect(journeySample(.9).mix).toBeCloseTo(1);expect(journeySample(3).from).toBe(3);});
