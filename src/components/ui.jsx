// The pieces every page is built from: the grade stamp, a receipt's lines,
// the evidence label, a section with a plain heading and a country's flag.
import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, Clock3, Info } from 'lucide-react';
import { flagSrc } from '../lib/flags.js';
import { gradeInfo } from '../lib/grades.js';
import { COUNTRY_FOCUS_NOTE } from '../lib/pacs.js';

export function Stamp({
  tier,
  reason = null,
  size = 92,
  rot = -9,
  dark = false,
  onPaper = false,
  animate = false,
  delay = 0,
  word = true,
}) {
  const g = gradeInfo(tier, reason);
  return (
    <div
      className={`stamp${animate ? ' stamp-in' : ''}${dark ? ' is-dark' : ''}${onPaper ? ' on-paper' : ''}`}
      style={{
        // A number of pixels, or any CSS length (the home page scales its stamps)
        '--size': typeof size === 'number' ? `${size}px` : size,
        '--rot': `${rot}deg`,
        '--gb': dark ? g.light : g.color,
        '--gl': g.light,
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
        <span className={`stamp-word${g.name.length > 12 ? ' is-long' : ''}`} aria-hidden="true">
          {g.name}
        </span>
      )}
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
        {long ? 'Every donation checked against FEC records' : 'Checked against FEC records'}
      </span>
    );
  }
  if (checked === false) {
    return (
      <span className="chip is-checking" style={{ '--c': 'var(--provisional)' }}>
        <Clock3 size={16} aria-hidden="true" />
        {long ? 'Graded from FEC bulk data. Still being checked.' : 'Still being checked'}
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

/**
 * A section of a person's page: a plain heading that folds the detail away
 * (owner, 2026-10-25). The browser's own fold-out, so the pre-built pages
 * and anyone without the script still read all of it. `open`: how it starts
 */
export function Section({ title, children, open = true }) {
  return (
    <details className="fold" open={open}>
      <summary className="fold-summary">
        <h2 className="fold-title">{title}</h2>
        <ChevronDown className="fold-chevron" size={24} aria-hidden="true" />
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

/** An (i) that opens a plain note under the line it's on */
export function InfoNote({ label, children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="chip-info info-note"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(o => !o)}
      >
        <Info size={16} aria-hidden="true" />
      </button>
      {open && (
        <span className="chip-note" role="note">
          {children}
        </span>
      )}
    </>
  );
}

/**
 * BOOSTED (owner, 2026-10-25): red, stamped across the receipt, when outside
 * groups spent more to help someone than their campaign raised
 * (src/lib/outside.js). `small` for a race card's row
 */
export function BoostedStamp({ small = false, animate = false, delay = 0 }) {
  return (
    <span
      className={`boosted${small ? ' is-small' : ''}${animate ? ' stamp-in' : ''}`}
      style={{ '--delay': `${delay}s`, '--rot': small ? '-4deg' : '-7deg' }}
      role="img"
      aria-label="Boosted: groups spent more to help them than their campaign raised"
    >
      <span aria-hidden="true">BOOSTED</span>
    </span>
  );
}

export function Skeleton({ height = 20, width = '100%', style }) {
  return <div className="skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

/** A country's flag, beside its name (the name says it; the flag is decoration) */
export function Flag({ country }) {
  const src = flagSrc(country);
  return src ? (
    <img className="flag" src={src} alt="" width={22} height={16} loading="lazy" decoding="async" />
  ) : null;
}

/** "Country-focused: Israel", with an (i) that says what the label means */
export function CountryChip({ country }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className="pac-chip has-flag">
        <Flag country={country} /> Country-focused: {country}
        <button
          type="button"
          className="chip-info"
          aria-expanded={open}
          aria-label="What Country-focused means"
          onClick={e => {
            e.preventDefault();
            setOpen(o => !o);
          }}
        >
          <Info size={14} aria-hidden="true" />
        </button>
      </span>
      {open && (
        <span className="chip-note" role="note">
          {COUNTRY_FOCUS_NOTE}
        </span>
      )}
    </>
  );
}

/**
 * Where to vote, on every page that couldn't show what was asked for (owner,
 * 2026-10-24): whatever went wrong here, a visitor can still get to their
 * state's election site
 */
export function VoteLink() {
  return (
    <p className="vote-link">
      Looking for where to vote? <a href="https://vote.gov">vote.gov</a> is run by the federal
      government and links to your state&apos;s election site, where you can check your registration
      and find your polling place.
    </p>
  );
}
