// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { models } from './journeyData.js';
import { frameUrl } from './vehicleFrames.js';

function dimensions(bytes) {
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
  for (let offset = 12; offset < bytes.length;) {
    const type = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (type === 'VP8X') return [bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1];
    if (type === 'VP8 ') return [bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff];
    if (type === 'VP8L') { const bits = bytes.readUInt32LE(start + 1); return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]; }
    offset += 8 + size + (size % 2);
  }
  throw new Error('WebP has no image payload');
}

it('ships all 36 native source angles for each of the 24 selectable cars', () => {
  const sources = JSON.parse(readFileSync('public/images/bmw/exterior-sources.json', 'utf8')).models;
  expect(models).toHaveLength(24);
  expect(new Set(models.map(model => model.exterior)).size).toBe(24);
  for (const model of models) {
    const source = sources[model.id];
    expect(source.code).toBe(model.exterior);
    expect(source.frames).toHaveLength(36);
    for (let angle = 0; angle < 36; angle++) {
      const bytes = readFileSync(`public${frameUrl(model.exterior, angle)}`);
      expect(dimensions(bytes), `${model.id}, angle ${angle * 10}`).toEqual([source.width, source.height]);
    }
  }
});
