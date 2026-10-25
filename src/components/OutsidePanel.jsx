// Outside groups: what super PACs and other groups reported spending to help
// or hurt someone (src/lib/outside.js, scripts/site/outside.mjs). Shown
// first after the grade (owner, 2026-10-25); never part of it.
import React from 'react';
import { ExternalLink } from 'lucide-react';
import { InfoNote, Section } from './ui.jsx';
import {
  BOOSTED_MEANING,
  LEFT_OUT_NOTE,
  NO_OUTSIDE,
  OUTSIDE_SOURCE_URL,
  REGISTER_URL,
  isBoosted,
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

export default function OutsidePanel({ outside, personId, name, totalRaised }) {
  if (!outside) {
    // No file (development, or a build that couldn't read the FEC's)
    return null;
  }
  const o = outside.people?.[personId];
  const through = dayText(outside.through);
  if (!o || (o.for <= 0 && o.against <= 0)) {
    return (
      <Section title="Outside groups">
        <p>{NO_OUTSIDE}</p>
        {through && <p className="fine">From reports filed with the FEC up to {through}.</p>}
      </Section>
    );
  }
  const boosted = isBoosted(o, totalRaised, personId);
  return (
    <Section title="Outside groups">
      <p style={{ marginBottom: 14 }}>
        Super PACs and other groups can spend as much as they like to help or hurt a candidate, as
        long as they don&apos;t work with the candidate&apos;s campaign. This money doesn&apos;t go
        to {name}, and it isn&apos;t in the grade.
      </p>
      <div className="outside-totals">
        <div>
          <span className="small muted">Spent to help {name}</span>
          <strong>{usd(o.for)}</strong>
        </div>
        <div>
          <span className="small muted">Spent against them</span>
          <strong>{usd(o.against)}</strong>
        </div>
        {totalRaised > 0 && (
          <div>
            <span className="small muted">Their own campaign raised</span>
            <strong>{usd(totalRaised)}</strong>
          </div>
        )}
      </div>
      {boosted && <p className="boosted-line">{BOOSTED_MEANING}</p>}
      <Spenders o={o} side="for" title="The biggest spenders helping them" />
      <Spenders o={o} side="against" title="The biggest spenders against them" />
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
