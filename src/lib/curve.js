// The curve through a member's three points (People, Power, Influence), for
// the page's graph and the share card. One function so both draw the same
// shape. It runs from the first point to the last, open at the sides (owner,
// 2026-10-17: pinned to zero, it drew slopes that aren't in the data).

/**
 * An SVG path through `pts` ([{ x, y }], x increasing): a monotone cubic
 * (as d3's curveMonotoneX), so the curve stays between neighbouring points
 * and never shows a share that isn't there.
 */
export function monotonePath(pts) {
  const n = pts.length;
  const s = [];
  for (let i = 0; i < n - 1; i++) {
    s.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
  }
  const m = new Array(n);
  for (let i = 1; i < n - 1; i++) {
    const h0 = pts[i].x - pts[i - 1].x;
    const h1 = pts[i + 1].x - pts[i].x;
    const p = (s[i - 1] * h1 + s[i] * h0) / (h0 + h1);
    m[i] =
      (Math.sign(s[i - 1]) + Math.sign(s[i])) *
        Math.min(Math.abs(s[i - 1]), Math.abs(s[i]), 0.5 * Math.abs(p)) || 0;
  }
  m[0] = n > 2 ? (3 * s[0] - m[1]) / 2 : s[0];
  m[n - 1] = n > 2 ? (3 * s[n - 2] - m[n - 2]) / 2 : s[0];
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (pts[i + 1].x - pts[i].x) / 3;
    d += ` C${pts[i].x + h},${pts[i].y + m[i] * h} ${pts[i + 1].x - h},${pts[i + 1].y - m[i + 1] * h} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}
