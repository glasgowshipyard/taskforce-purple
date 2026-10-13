// Every PAC that gave to a member, sorted by who the PAC answers to, and how
// much of each counts toward the grade (FINAL-3: only PACs of groups run by
// their members count, and only the part of their money that traces back to
// many people). Also the committees that steered donors' gifts to the
// member. Members graded before FINAL-3 show the plain list.
import React from 'react';
import { Link } from '../lib/router.js';
import { pacRows, peopleLine } from '../lib/pacs.js';
import { usd } from '../lib/people.js';

const PAC_GROUPS = [
  { group: 'people', label: 'Run by their members', color: '#5B21B6', counts: true },
  { group: 'board', label: 'Run by a board', color: '#8F7FA8' },
  { group: 'untested', label: 'Not checked yet', color: '#CFCBC1' },
  { group: 'nosponsor', label: 'No group behind them', color: '#9C98A6' },
  { group: 'business', label: 'Businesses', color: '#E07A5F' },
  { group: 'politician', label: 'Politicians', color: '#C2412B' },
  { group: 'party', label: 'Parties', color: '#7B1E3A' },
];
const LABEL = Object.fromEntries(PAC_GROUPS.map(g => [g.group, g.label]));

const Explainer = () => (
  <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 12 }}>
    A PAC (political action committee) pools money and gives it to candidates. A PAC counts toward
    the grade only when the group behind it is run by its members (they elect its leaders, as in a
    union), and only the part of its money that traces back to many people. PACs of businesses,
    politicians and parties, and of groups run by a board, count nothing.{' '}
    <Link to="/how">How the grade works</Link>
  </p>
);

function Row({ p, i }) {
  const line = peopleLine(p.profile);
  return (
    <li>
      <div className="pac-list-top">
        <span className="muted">{i + 1}.</span>
        <span className="name">
          {p.name} <span className="pac-chip">{LABEL[p.group] || 'PAC'}</span>
          {p.to === 'own joint fund' && (
            <>
              {' '}
              <span className="pac-chip">To their joint fund</span>
            </>
          )}
        </span>
        <span className="leader" aria-hidden="true" />
        <strong>{usd(p.amount)}</strong>
      </div>
      <p className="pac-list-sub">
        {p.connectedOrg && p.connectedOrg !== 'NONE' && `Run by ${p.connectedOrg}. `}
        {p.group === 'people' && line ? `${line} ` : ''}
        Counts toward the grade: {usd(p.counts || 0)}.
      </p>
    </li>
  );
}

export default function PacPanel({ member, name, pacMoney }) {
  const s = member.pacSummary;
  if (s?.method !== 'final-3') {
    // Graded before FINAL-3: the PAC gifts we hold, no working
    const rows = pacRows(member.pacContributions);
    if (!rows.length) {
      return null;
    }
    return (
      <div className="panel" style={{ flexBasis: '100%' }}>
        <h3>PAC donations</h3>
        <Explainer />
        <ol className="ranked">
          {rows.slice(0, 10).map((p, i) => (
            <li key={p.id}>
              <span className="muted">{i + 1}.</span>
              <span className="name">{p.name}</span>
              <span className="leader" aria-hidden="true" />
              <strong>{usd(p.amount)}</strong>
            </li>
          ))}
        </ol>
        <p className="fine" style={{ marginTop: 12 }}>
          Of the {usd(pacMoney)} {name} took from PACs.
        </p>
      </div>
    );
  }
  if (!s.count && !s.directed?.length) {
    return null;
  }
  const groups = PAC_GROUPS.filter(g => s.byGroup?.[g.group] > 0);
  return (
    <div className="panel" style={{ flexBasis: '100%' }}>
      <h3>PAC donations</h3>
      <Explainer />
      {s.count > 0 && (
        <>
          <p style={{ marginBottom: 12 }}>
            {name} took <strong>{usd(s.total)}</strong> from{' '}
            {s.count === 1 ? 'one PAC' : `${s.count.toLocaleString('en-US')} PACs`}, to their
            campaigns, leadership PAC and own joint funds.
          </p>
          <div
            className="pac-split"
            role="img"
            aria-label={groups.map(g => `${g.label}: ${usd(s.byGroup[g.group])}`).join(', ')}
          >
            {groups.map(g => (
              <span
                key={g.group}
                style={{ width: `${(s.byGroup[g.group] / s.total) * 100}%`, background: g.color }}
              />
            ))}
          </div>
          <ul className="pac-split-key">
            {groups.map(g => (
              <li key={g.group}>
                <span className="swatch" style={{ '--c': g.color }} aria-hidden="true" />
                <span>
                  {g.label}
                  {g.counts ? (
                    <span className="muted"> · can count</span>
                  ) : (
                    <span className="muted"> · counts nothing</span>
                  )}
                </span>
                <span className="leader" aria-hidden="true" />
                <strong>{usd(s.byGroup[g.group])}</strong>
              </li>
            ))}
          </ul>
          <h4 className="eyebrow" style={{ margin: '20px 0 10px' }}>
            The biggest
          </h4>
          <ol className="pac-list">
            {s.list.slice(0, 10).map((p, i) => (
              <Row key={`${p.id}-${p.to}`} p={p} i={i} />
            ))}
          </ol>
        </>
      )}
      {s.directed?.length > 0 && (
        <>
          <h4 className="eyebrow" style={{ margin: '20px 0 10px' }}>
            Gifts steered to {name} by a committee: {usd(s.directedTotal)}
          </h4>
          <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 12 }}>
            Some donors gave through a committee that chose to pass their gifts on. We count those
            as the committee&apos;s gift. ActBlue, WinRed and Democracy Engine, which pass a gift to
            whoever the donor picks, aren&apos;t counted this way.
          </p>
          <ol className="pac-list">
            {s.directed.slice(0, 5).map((p, i) => (
              <Row key={p.id} p={p} i={i} />
            ))}
          </ol>
        </>
      )}
      <p className="fine" style={{ marginTop: 12 }}>
        From the PACs&apos; own FEC reports. Who each PAC answers to comes from its FEC filing, the
        IRS&apos;s list of tax-exempt groups and the group&apos;s own Form 990.
      </p>
    </div>
  );
}
