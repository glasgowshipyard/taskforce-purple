// Every PAC that gave to a member, sorted by who the PAC answers to, and how
// much of each gift is People money (FINAL-3: only PACs of groups run by
// their members, and only the part of their money that came from many
// people; the rest is Influence). Also the committees that passed donors'
// gifts on to the member. Members graded before FINAL-3 show the plain list.
import React from 'react';
import { Link } from '../lib/router.js';
import { pacRows } from '../lib/pacs.js';
import { usd } from '../lib/people.js';
import { Fold } from './ui.jsx';

// `people`: the group whose gifts can be People money
const PAC_GROUPS = [
  { group: 'people', label: 'Run by their members', color: '#5B21B6', people: true },
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
    A PAC (political action committee) pools money and gives it to candidates. When the group behind
    a PAC is run by its members, who elect most of its board, as in a union, the part of its money
    that came from many people is People money. All other PAC money is Influence.{' '}
    <Link to="/how">How grades work</Link>
  </p>
);

const plain = s =>
  String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

// Who set the PAC up, from its FEC filing. Never a politician's surname (a
// politician's PAC says so instead), and never the PAC named as its own sponsor
function sponsorText(p) {
  if (p.group === 'politician') {
    return "A politician's PAC.";
  }
  if (p.group === 'party') {
    return 'A party committee.';
  }
  const org = p.connectedOrg;
  if (!org || org === 'NONE' || plain(org) === plain(p.name)) {
    return null;
  }
  if (/\b(PAC|POLITICAL ACTION COMMITTEE|POLITICAL ACTION)\b/.test(plain(org))) {
    return null;
  }
  return `Set up by ${org}.`;
}

function Row({ p, i }) {
  const sponsor = sponsorText(p);
  return (
    <li>
      <div className="pac-list-top">
        <span className="muted">{i + 1}.</span>
        <span className="name">
          {p.name} <span className="pac-chip">{LABEL[p.group] || 'PAC'}</span>
          {p.country && (
            <>
              {' '}
              <span className="pac-chip">Country-focused: {p.country}</span>
            </>
          )}
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
      {(sponsor || p.group === 'people') && (
        <p className="pac-list-sub">
          {sponsor}
          {sponsor && p.group === 'people' ? ' ' : ''}
          {p.group === 'people' && `${usd(p.counts || 0)} of ${usd(p.amount)} comes from people.`}
        </p>
      )}
    </li>
  );
}

function Key({ title, groups, s }) {
  if (!groups.length) {
    return null;
  }
  return (
    <>
      <h4 className="pac-key-title">{title}</h4>
      <ul className="pac-split-key">
        {groups.map(g => (
          <li key={g.group}>
            <span className="swatch" style={{ '--c': g.color }} aria-hidden="true" />
            <span>{g.label}</span>
            <span className="leader" aria-hidden="true" />
            <strong>{usd(s.byGroup[g.group])}</strong>
          </li>
        ))}
      </ul>
    </>
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
      <Fold title="PAC donations">
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
          Of the {usd(pacMoney)} that PACs gave {name}.
        </p>
      </Fold>
    );
  }
  if (!s.count && !s.directed?.length) {
    return null;
  }
  const groups = PAC_GROUPS.filter(g => s.byGroup?.[g.group] > 0);
  // The receipt's PAC figure (and the grade's) is from the member's own
  // reports; the list is from the PACs' reports, and the two don't always match
  const differs = Math.abs((s.total || 0) - (pacMoney || 0)) >= 1;
  return (
    <Fold title="PAC donations">
      <Explainer />
      {s.count > 0 && (
        <>
          <p style={{ marginBottom: 12 }}>
            {name}&apos;s own reports show <strong>{usd(pacMoney)}</strong> from PACs.
            {differs
              ? ` The PACs' own reports, listed below, add up to ${usd(s.total)} from ${s.count === 1 ? 'one PAC' : `${s.count.toLocaleString('en-US')} PACs`}. The two sides' reports don't always match. The grade uses ${name}'s.`
              : ''}
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
          <Key title="People, in part" groups={groups.filter(g => g.people)} s={s} />
          <Key title="Influence" groups={groups.filter(g => !g.people)} s={s} />
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
            Gifts passed on to {name} by a committee: {usd(s.directedTotal)}
          </h4>
          <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 12 }}>
            Some donors gave through a committee that chose to pass their gifts on. Those gifts are
            the committee&apos;s, so they follow the same rule as PACs. ActBlue, WinRed and
            Democracy Engine pass each gift to whoever the donor picks, so gifts through them stay
            the donor&apos;s own.
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
        &ldquo;Country-focused&rdquo; means the group behind it tells the IRS, on its own Form 990,
        that it exists to advance a particular country&apos;s interests or its relationship with the
        United States.
      </p>
    </Fold>
  );
}
