// The pieces every page is built from: the grade stamp, a receipt's lines,
// the power bar and the evidence label.
import React from 'react';
import { CheckCircle2, Clock3 } from 'lucide-react';
import { gradeInfo } from '../lib/grades.js';

export function Stamp({
  tier,
  size = 92,
  rot = -9,
  dark = false,
  animate = false,
  delay = 0,
  word = true,
}) {
  const g = gradeInfo(tier);
  return (
    <div
      className={`stamp${animate ? ' stamp-in' : ''}${dark ? ' is-dark' : ''}`}
      style={{
        '--size': `${size}px`,
        '--rot': `${rot}deg`,
        '--g': dark ? g.light : g.color,
        '--delay': `${delay}s`,
      }}
      role="img"
      aria-label={
        g.mark.length === 1 && /[A-Z]/.test(g.mark) ? `Grade ${g.mark}, ${g.name}` : g.name
      }
    >
      <span className="stamp-letter" aria-hidden="true">
        {g.mark}
      </span>
      {word && (
        <span className="stamp-word" aria-hidden="true">
          {g.name}
        </span>
      )}
    </div>
  );
}

export function PowerBar({ lines, height }) {
  const label = lines.map(l => `${l.pct}% ${l.short.toLowerCase()}`).join(', ');
  return (
    <div className="powerbar" role="img" aria-label={label} style={height ? { height } : undefined}>
      {lines.map(l => (
        <span key={l.key} style={{ width: `${l.pct}%`, '--c': l.color }} />
      ))}
    </div>
  );
}

/** Itemised lines: swatch, label, dotted leader, value */
export function MoneyLines({ lines, value = l => `${l.pct}%`, short = false }) {
  return (
    <ul className="lines">
      {lines.map(l => (
        <li key={l.key}>
          <span className="swatch" style={{ '--c': l.color }} aria-hidden="true" />
          <span>{short ? l.short : l.label}</span>
          <span className="leader" aria-hidden="true" />
          <strong>{value(l)}</strong>
        </li>
      ))}
    </ul>
  );
}

/** Grade first, confirm after: say which this grade is */
export function Evidence({ checked, long = false }) {
  if (checked === true) {
    return (
      <span className="chip" style={{ '--c': 'var(--checked)' }}>
        <CheckCircle2 size={16} aria-hidden="true" />
        {long ? 'Every record checked against the FEC' : 'Checked against FEC'}
      </span>
    );
  }
  if (checked === false) {
    return (
      <span className="chip" style={{ '--c': 'var(--provisional)' }}>
        <Clock3 size={16} aria-hidden="true" />
        {long ? 'Graded from FEC bulk data, being double-checked' : 'Being double-checked'}
      </span>
    );
  }
  return null;
}

/** Decorative barcode, different for every person */
export function Barcode({ id = '', height = 34 }) {
  const bars = [];
  for (const ch of id.repeat(6).slice(0, 44)) {
    bars.push(1 + (ch.charCodeAt(0) % 4));
  }
  return (
    <div className="barcode" style={{ height }} aria-hidden="true">
      {bars.map((w, i) => (
        <span key={i} style={{ width: w }} />
      ))}
    </div>
  );
}

export function Skeleton({ height = 20, width = '100%', style }) {
  return <div className="skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}
