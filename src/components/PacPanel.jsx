// Every PAC that gave to a member, by kind, and where each PAC's own money
// came from (#57). Falls back to the old partial list for members graded
// before the full one was collected.
import React from 'react';
import { PAC_KINDS, PAC_TYPES, pacLabel, pacRows, peopleLine } from '../lib/pacs.js';
import { usd } from '../lib/people.js';

const Explainer = () => (
  <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 12 }}>
    A PAC (political action committee) pools money and gives it to candidates. Some are run by
    companies, unions or trade groups, some by other politicians. They don&apos;t all count the same
    against the grade.
  </p>
);

function Chips({ pac }) {
  const heavier = PAC_TYPES[pac.kind]?.heavier;
  return (
    <>
      {' '}
      <span className={`pac-chip${heavier ? ' is-heavier' : ''}`}>{pacLabel(pac)}</span>
      {pac.kind === 'lobbyist' && <span className="pac-chip is-heavier">Lobbies Congress</span>}
    </>
  );
}

export default function PacPanel({ member, name, pacMoney }) {
  const s = member.pacSummary;
  if (!s) {
    const rows = pacRows(member.pacContributions);
    if (!rows.length) {
      return null;
    }
    const collected = rows.reduce((t, p) => t + p.amount, 0);
    return (
      <div className="panel" style={{ flexBasis: '100%' }}>
        <h3>PAC donations</h3>
        <Explainer />
        <ol className="ranked">
          {rows.slice(0, 10).map((p, i) => (
            <li key={p.id}>
              <span className="muted">{i + 1}.</span>
              <span className="name">
                {p.name}
                <Chips pac={{ kind: p.type }} />
              </span>
              <span className="leader" aria-hidden="true" />
              <strong>{usd(p.amount)}</strong>
            </li>
          ))}
        </ol>
        <p className="fine" style={{ marginTop: 12 }}>
          This is only part of the PAC money: {usd(collected)} of the {usd(pacMoney)} {name} took
          from PACs in all. We&apos;re working on the complete list.
        </p>
      </div>
    );
  }
  if (!s.count) {
    return null;
  }
  const kinds = PAC_KINDS.filter(k => s.byKind[k.kind] > 0);
  return (
    <div className="panel" style={{ flexBasis: '100%' }}>
      <h3>PAC donations</h3>
      <Explainer />
      <p style={{ marginBottom: 12 }}>
        {name} took <strong>{usd(s.total)}</strong> from{' '}
        {s.count === 1 ? 'one PAC' : `${s.count.toLocaleString('en-US')} PACs`}.
      </p>
      <div
        className="pac-split"
        role="img"
        aria-label={kinds.map(k => `${k.label}: ${usd(s.byKind[k.kind])}`).join(', ')}
      >
        {kinds.map(k => (
          <span
            key={k.kind}
            style={{ width: `${(s.byKind[k.kind] / s.total) * 100}%`, background: k.color }}
          />
        ))}
      </div>
      <ul className="pac-split-key">
        {kinds.map(k => (
          <li key={k.kind}>
            <span className="swatch" style={{ '--c': k.color }} aria-hidden="true" />
            <span>
              {k.label}
              {PAC_TYPES[k.kind]?.heavier && (
                <span className="muted"> · counts more against the grade</span>
              )}
            </span>
            <span className="leader" aria-hidden="true" />
            <strong>{usd(s.byKind[k.kind])}</strong>
          </li>
        ))}
      </ul>
      <h4 className="eyebrow" style={{ margin: '20px 0 10px' }}>
        The biggest
      </h4>
      <ol className="pac-list">
        {s.list.slice(0, 10).map((p, i) => {
          const line = peopleLine(p.profile);
          return (
            <li key={p.id}>
              <div className="pac-list-top">
                <span className="muted">{i + 1}.</span>
                <span className="name">
                  {p.name}
                  <Chips pac={p} />
                </span>
                <span className="leader" aria-hidden="true" />
                <strong>{usd(p.amount)}</strong>
              </div>
              {(p.connectedOrg || line) && (
                <p className="pac-list-sub">
                  {p.connectedOrg && p.connectedOrg !== 'NONE' && `Run by ${p.connectedOrg}. `}
                  {line}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <p className="fine" style={{ marginTop: 12 }}>
        Every PAC gift to {name}&apos;s campaign and leadership PAC this cycle, from the PACs&apos;
        own FEC reports. Where each PAC&apos;s money came from is from its own filings. For now, the
        grade counts all PAC money the same way whoever funds the PAC; how much credit a PAC funded
        by many ordinary people should get is still being decided.
      </p>
    </div>
  );
}
