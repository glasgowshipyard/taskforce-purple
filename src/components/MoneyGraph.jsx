// A member's own money as a graph (owner and Craig, 2026-10-13): the money
// given in three parts, People, Power and Influence, as shares that add up
// to 100. People is the grade's score (peoplePowerInfluence in
// workers/tier-calculation.js). Three points joined by a curve that never
// overshoots them, open at the sides (owner, 2026-10-17: pinning it to zero
// drew slopes that aren't in the data). No dots: pointing at or tapping a
// part shows it, with what it means. The election cycle in the corner.
// Under it, the grade letters with this member's circled.
import React, { useState } from 'react';
import { monotonePath } from '../lib/curve.js';
import { CYCLE_SHORT } from '../lib/election.js';
import { GRADES, LETTERS, PARTS } from '../lib/grades.js';

// Drawn narrower on a card, so its words come out the same size as the page's
const SIZE = {
  page: { W: 360, H: 196 },
  card: { W: 270, H: 160 },
};
const PAD = { left: 38, right: 12, top: 12, bottom: 44 };

/** The grade letters, S to F, with this one circled. */
export function TierStrip({ tier }) {
  return (
    <div className="tier-strip" aria-hidden="true">
      {LETTERS.map(l => (
        <span
          key={l}
          className={l === tier ? 'is-current' : undefined}
          style={l === tier ? { '--g': GRADES[l].color } : undefined}
        >
          {l}
        </span>
      ))}
    </div>
  );
}

/**
 * ppi: { people, power, influence }, whole percentages adding up to 100.
 * `showKey` explains the three parts under the graph; `compact` for cards.
 */
export default function MoneyGraph({ ppi, tier, compact = false, showKey = false }) {
  const [active, setActive] = useState(null);
  if (!ppi) {
    return null;
  }
  const { W, H } = SIZE[compact ? 'card' : 'page'];
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const base = PAD.top + plotH;
  const y = v => PAD.top + (1 - Math.max(0, Math.min(100, v)) / 100) * plotH;
  const col = plotW / PARTS.length;
  const pts = PARTS.map((p, i) => ({
    ...p,
    value: ppi[p.key] ?? 0,
    x: PAD.left + col * (i + 0.5),
    y: y(ppi[p.key] ?? 0),
  }));
  const line = monotonePath(pts);
  const area = `${line} L${pts[pts.length - 1].x},${base} L${pts[0].x},${base} Z`;
  const color = GRADES[tier]?.color || 'var(--purple)';
  const label = `${PARTS.map(p => `${p.label} ${ppi[p.key]}%`).join(', ')} of the money given${
    GRADES[tier] ? `. Grade ${tier}, ${GRADES[tier].name}` : ''
  }.`;
  const hover = active === null ? null : pts[active];
  // The part under the pointer: the whole column answers, not just the curve
  const nearest = e => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    return Math.max(0, Math.min(PARTS.length - 1, Math.floor((x - PAD.left) / col)));
  };

  return (
    <figure className={`ppi${compact ? ' is-compact' : ''}`} style={{ '--g': color }}>
      <div className="ppi-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={label}
          onPointerMove={e => e.pointerType === 'mouse' && setActive(nearest(e))}
          onPointerLeave={e => e.pointerType === 'mouse' && setActive(null)}
          onPointerDown={e => {
            // A tap shows a part; tapping it again hides it
            if (e.pointerType !== 'mouse') {
              const i = nearest(e);
              setActive(a => (a === i ? null : i));
            }
          }}
        >
          <text x={W - PAD.right} y={PAD.top + 4} textAnchor="end" className="ppi-cycle">
            {CYCLE_SHORT}
          </text>
          {[0, 50, 100].map(v => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(v)}
                y2={y(v)}
                className={v === 0 ? 'ppi-base' : 'ppi-grid'}
              />
              <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="ppi-tick">
                {v}%
              </text>
            </g>
          ))}
          <path d={area} className="ppi-area" />
          <path d={line} className="ppi-line" />
          {pts.map((p, i) => (
            <g key={p.key}>
              {hover && active === i && (
                <line x1={p.x} x2={p.x} y1={PAD.top} y2={base} className="ppi-cross" />
              )}
              {active === i && <circle cx={p.x} cy={p.y} r={6} className="ppi-dot" />}
              <text x={p.x} y={base + 18} textAnchor="middle" className="ppi-name">
                {p.label}
              </text>
              <text x={p.x} y={base + 36} textAnchor="middle" className="ppi-value">
                {p.value}%
              </text>
            </g>
          ))}
        </svg>
        {hover && (
          <div
            className="ppi-tip"
            style={{
              left: `${(hover.x / W) * 100}%`,
              top: `${(hover.y / H) * 100}%`,
            }}
            aria-hidden="true"
          >
            <strong>
              {hover.label} · {hover.value}%
            </strong>
            <span>{hover.about}</span>
          </div>
        )}
      </div>
      <TierStrip tier={tier} />
      {showKey && (
        <dl className="ppi-key">
          {PARTS.map(p => (
            <div key={p.key}>
              <dt>{p.label}</dt>
              <dd>{p.about}</dd>
            </div>
          ))}
        </dl>
      )}
    </figure>
  );
}
