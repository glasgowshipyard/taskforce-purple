import { describe, expect, it } from 'vitest';
import { monotonePath } from './curve.js';

// Every y in the path (points and control points): the curve stays inside them
const ys = d => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => Number(m[2]));

describe('the graph curve', () => {
  const base = 150;
  const shapes = {
    'one peak': [90, 5, 5],
    'two humps': [60, 0, 40],
    'peak in the middle': [10, 60, 30],
    'all influence': [0, 0, 100],
  };
  for (const [name, values] of Object.entries(shapes)) {
    it(`runs from the first point to the last and never overshoots them (${name})`, () => {
      const pts = values.map((v, i) => ({ x: 60 + i * 100, y: base - v * 1.4 }));
      const d = monotonePath(pts);
      expect(d.startsWith(`M${pts[0].x},${pts[0].y}`)).toBe(true);
      expect(d.endsWith(`${pts[2].x},${pts[2].y}`)).toBe(true);
      const top = Math.min(...pts.map(p => p.y));
      const bottom = Math.max(...pts.map(p => p.y));
      for (const y of ys(d)) {
        expect(y).toBeLessThanOrEqual(bottom + 1e-9);
        expect(y).toBeGreaterThanOrEqual(top - 1e-9);
      }
    });
  }
});
