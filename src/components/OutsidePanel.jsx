// Outside groups: what super PACs and other groups reported spending to help
// or hurt someone (src/lib/outside.js, scripts/site/outside.mjs). Shown
// first after the grade (owner, 2026-10-25); never part of it.
import React from 'react';
import { ExternalLink } from 'lucide-react';
import { InfoNote, Section } from './ui.jsx';
import {
  LEFT_OUT_NOTE,
  NO_OUTSIDE,
  OUTSIDE_SOURCE_URL,
  REGISTER_URL,
  stageText,
} from '../lib/outside.js';
import { count, usd } from '../lib/people.js';

const fecCommittee = id => `https://www.fec.gov/data/committee/${encodeURIComponent(id)}/`;

const dayText = d =>
  d
    ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

function Spenders({ o, side, title }) {
  const rows = o.spenders.filter(s => s.side === side);
  if (!rows.length) {
    return null;
  }
  const all = o.spenderCount?.[side] ?? rows.length;
  return (
    <>
      <h3 className="outside-side">{title}</h3>
      <ol className="ranked">
        {rows.map((s, i) => (
          <li key={s.id}>
            <span className="muted">{i + 1}.</span>
            <span className="name">
              <a href={fecCommittee(s.id)} target="_blank" rel="noopener noreferrer">
                {s.name}{' '}
                <ExternalLink
                  size={13}
                  aria-label="(opens on fec.gov)"
                  style={{ display: 'inline', verticalAlign: '-1px' }}
                />
              </a>
            </span>
            {stageText(s.stages) && <span className="stage-tag">{stageText(s.stages)}</span>}
            <span className="leader" aria-hidden="true" />
            <strong>{usd(s.amount)}</strong>
          </li>
        ))}
      </ol>
      {all > rows.length && (
        <p className="fine" style={{ marginTop: 6 }}>
          And {count(all - rows.length)} more {all - rows.length === 1 ? 'group' : 'groups'}.
        </p>
      )}
    </>
  );
}

export default function OutsidePanel({ outside, personId }) {
  if (!outside) {
    // No file (development, or a build that couldn't read the FEC's)
    return null;
  }
  const o = outside.people?.[personId];
  const through = dayText(outside.through);
  if (!o || (o.for <= 0 && o.against <= 0)) {
    return (
      <Section title="Super PAC spending">
        <p>{NO_OUTSIDE}</p>
        {through && <p className="fine">From reports filed with the FEC up to {through}.</p>}
      </Section>
    );
  }
  // The owner's words (2026-10-25). The campaign's own total isn't here: it
  // read as the groups' money, and the receipt beside it has it
  return (
    <Section title="Super PAC spending">
      <p style={{ marginBottom: 14 }}>
        Super PACs and other groups spend their own money to elect or beat a candidate. They
        can&apos;t work with the campaign. <em>None of this is in the grade.</em>
      </p>
      <div className="outside-totals">
        <div>
          <span className="small muted">Spent to help them</span>
          <strong>{usd(o.for)}</strong>
        </div>
        <div>
          <span className="small muted">Spent to beat them</span>
          <strong>{usd(o.against)}</strong>
        </div>
      </div>
      <Spenders o={o} side="for" title="Who spent most to help them" />
      <Spenders o={o} side="against" title="Who spent most to beat them" />
      <p className="fine" style={{ marginTop: 14 }}>
        As reported to the FEC by the groups themselves
        {through ? `, in reports filed up to ${through}` : ''}. Only groups on the FEC&apos;s
        register of committees are counted.{' '}
        <InfoNote label="Why some filings are left out">
          {LEFT_OUT_NOTE} <a href={REGISTER_URL}>The FEC&apos;s register of committees</a>.
        </InfoNote>{' '}
        <a href={OUTSIDE_SOURCE_URL} target="_blank" rel="noopener noreferrer">
          The FEC&apos;s outside spending data
        </a>
        .
      </p>
    </Section>
  );
}
