// A member's own money as a graph: the money given in three parts, People,
// Power and Influence, as shares that add up to 100. People is the grade's
// score (peoplePowerInfluence in workers/tier-calculation.js). Three points
// joined by a curve that never overshoots them, open at the sides.
//
// Every graph is the same green-to-red gradient, fill and line (owner,
// 2026-10-17): left is people, right is corporate, the grade's own colours.
// On a member's page the shape is cut into darker strips, one per kind of
// money in each part, people to corporate (moneyStrips in lib/explain.js).
// A strip and its "Why" step light each other up; the lit strip breathes
// only while someone's looking at it (useLight in lib/light.js), and the
// biggest one breathes three times the first time the graph comes into view.
// Some readers prefer plain bars, since the three parts are separate: a
// switch on the member's page draws every graph as bars instead (lib/
// graph-shape.js), each bar stacked from its strips.
// Under the graph, the grade letters with this member's circled.
import React, { useEffect, useId, useRef, useState } from 'react';
import { monotonePath } from '../lib/curve.js';
import { CYCLE_SHORT } from '../lib/election.js';
import { setGraphShape, useGraphShape } from '../lib/graph-shape.js';
import { SOURCES } from '../lib/explain.js';
import { GRADES, GRAPH_GRADIENT as GRADIENT, LETTERS, PARTS } from '../lib/grades.js';

// Drawn narrower on a card, so its words come out the same size as the page's
const SIZE = {
  page: { W: 360, H: 196 },
  card: { W: 270, H: 160 },
};
const PAD = { left: 38, right: 12, top: 12, bottom: 44 };
const PART_LABEL = Object.fromEntries(PARTS.map(p => [p.key, p.label]));

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
 * strips (member page): moneyStrips(detail); light: { key, breathing } from
 * useLight, and onLight(key, how) to change it; onPick(key) when a strip is
 * clicked or tapped (the member page opens its step). `showToggle` adds the
 * curve-or-bars switch, `showKey` explains the three parts under the graph;
 * `compact` for cards.
 */
export default function MoneyGraph({
  ppi,
  tier,
  compact = false,
  showKey = false,
  strips = null,
  light = null,
  onLight = () => {},
  showToggle = false,
  onPick = null,
}) {
  const shape = useGraphShape();
  const bars = shape === 'bars';
  const [active, setActive] = useState(null);
  const [pointed, setPointed] = useState(null);
  const [hint, setHint] = useState(null);
  const figure = useRef(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const hasStrips = Boolean(strips?.length);

  // The first time the graph is properly in view, its biggest strip breathes
  // three times: a hint that the strips do something. Then it's still
  useEffect(() => {
    if (!hasStrips || !figure.current || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          setHint([...strips].sort((a, b) => b.v - a.v)[0].key);
          observer.disconnect();
        }
      },
      { threshold: 0.6 }
    );
    observer.observe(figure.current);
    return () => observer.disconnect();
    // Once per graph
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStrips]);

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
  const x0 = pts[0].x;
  const x2 = pts[pts.length - 1].x;
  const line = monotonePath(pts);
  const area = `${line} L${x2},${base} L${x0},${base} Z`;
  const paint = `url(#g${uid})`;
  const label = `${PARTS.map(p => `${p.label} ${ppi[p.key]}%`).join(', ')} of the money given${
    GRADES[tier] ? `. Grade ${tier}, ${GRADES[tier].name}` : ''
  }.`;

  // Bars: one per part, rounded at the top, as tall as the part's share
  const bw = Math.min(col * 0.46, 56);
  const barPath = p => {
    const top = p.y;
    const r = Math.min(4, Math.max(0, base - top));
    const l = p.x - bw / 2;
    const rt = p.x + bw / 2;
    return `M${l},${base} V${top + r} Q${l},${top} ${l + r},${top} H${rt - r} Q${rt},${top} ${rt},${top + r} V${base} Z`;
  };
  const shapePath = bars ? pts.map(barPath).join(' ') : area;

  // The strips. On the curve, each part gets an equal third of the shape and
  // its strips share that third in proportion to their shares of the part.
  // On bars, each bar is stacked from its strips, people at the bottom
  const third = (x2 - x0) / PARTS.length;
  const bands = [];
  if (hasStrips) {
    PARTS.forEach((p, i) => {
      const total = ppi[p.key] || 0;
      let x = x0 + third * i;
      let acc = 0;
      strips
        .filter(s => s.part === p.key && total > 0)
        .forEach(s => {
          if (bars) {
            const yTop = y(acc + s.v);
            bands.push({
              ...s,
              n: bands.length,
              x: pts[i].x - bw / 2,
              w: bw,
              y: yTop,
              h: y(acc) - yTop,
              tipX: pts[i].x,
              tipY: yTop,
            });
          } else {
            const w = (third * s.v) / total;
            bands.push({
              ...s,
              n: bands.length,
              x,
              w: w + 0.4,
              y: PAD.top,
              h: plotH,
              tipX: x + w / 2,
              tipY: pts[i].y,
            });
            x += w;
          }
          acc += s.v;
        });
    });
  }

  const hover = active === null ? null : pts[active];
  const tipStrip = pointed === null ? null : bands[pointed];
  // The part under the pointer, on a graph without strips
  const nearest = e => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    return Math.max(0, Math.min(PARTS.length - 1, Math.floor((x - PAD.left) / col)));
  };
  const stripClass = b =>
    [
      'ppi-strip',
      b.n % 2 ? 'is-deep' : '',
      light?.key === b.key ? 'is-lit' : '',
      light?.key === b.key && light.breathing ? 'is-breathing' : '',
      !light?.key && hint === b.key ? 'is-hint' : '',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <figure
      ref={figure}
      className={`ppi${compact ? ' is-compact' : ''}${hasStrips ? ' has-strips' : ''}${bars ? ' is-bars' : ''}`}
      style={{ '--g': GRADES[tier]?.color || 'var(--purple)' }}
    >
      {showToggle && (
        <div className="ppi-shape" role="group" aria-label="How to draw the graph">
          {[
            ['curve', 'Curve'],
            ['bars', 'Bars'],
          ].map(([value, text]) => (
            <button
              key={value}
              type="button"
              aria-pressed={shape === value}
              onClick={() => setGraphShape(value)}
            >
              {text}
            </button>
          ))}
        </div>
      )}
      <div className="ppi-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={label}
          onPointerMove={e => !hasStrips && e.pointerType === 'mouse' && setActive(nearest(e))}
          onPointerLeave={e => {
            if (e.pointerType === 'mouse') {
              setActive(null);
              setPointed(null);
              if (hasStrips) {
                onLight(null);
              }
            }
          }}
          onPointerDown={e => {
            // On a graph without strips, a tap shows a part; again hides it
            if (!hasStrips && e.pointerType !== 'mouse') {
              const i = nearest(e);
              setActive(a => (a === i ? null : i));
            }
          }}
        >
          <defs>
            <linearGradient
              id={`g${uid}`}
              gradientUnits="userSpaceOnUse"
              x1={x0}
              x2={x2}
              y1="0"
              y2="0"
            >
              {GRADIENT.map((c, i) => (
                <stop key={c} offset={i / (GRADIENT.length - 1)} stopColor={c} />
              ))}
            </linearGradient>
            <clipPath id={`c${uid}`}>
              <path d={shapePath} />
            </clipPath>
          </defs>
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
          <path d={shapePath} fill={paint} className="ppi-area" />
          {hasStrips && (
            <g clipPath={`url(#c${uid})`}>
              {bands.map(b => (
                <rect
                  key={`${b.part}-${b.key}`}
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  fill={paint}
                  className={stripClass(b)}
                  onAnimationEnd={() => hint === b.key && setHint(null)}
                  onClick={() => onPick?.(b.key)}
                  onPointerEnter={e => {
                    if (e.pointerType === 'mouse') {
                      setPointed(b.n);
                      onLight(b.key, 'hover');
                    }
                  }}
                  onPointerDown={e => {
                    if (e.pointerType !== 'mouse') {
                      setPointed(b.n);
                      onLight(b.key, 'tap');
                    }
                  }}
                />
              ))}
            </g>
          )}
          {!bars && <path d={line} stroke={paint} className="ppi-line" />}
          {pts.map((p, i) => (
            <g key={p.key}>
              {hover && active === i && !bars && (
                <>
                  <line x1={p.x} x2={p.x} y1={PAD.top} y2={base} className="ppi-cross" />
                  <circle cx={p.x} cy={p.y} r={6} fill={paint} className="ppi-dot" />
                </>
              )}
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
            style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}
            aria-hidden="true"
          >
            <strong>
              {hover.label} · {hover.value}%
            </strong>
            <span>{hover.about}</span>
          </div>
        )}
        {tipStrip && light?.key === tipStrip.key && (
          <div
            className="ppi-tip"
            style={{
              left: `${(tipStrip.tipX / W) * 100}%`,
              top: `${(tipStrip.tipY / H) * 100}%`,
            }}
            aria-hidden="true"
          >
            <strong>
              {SOURCES[tipStrip.key]} · {tipStrip.v}% {PART_LABEL[tipStrip.part]}
            </strong>
            <span>{PARTS.find(p => p.key === tipStrip.part)?.about}</span>
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
