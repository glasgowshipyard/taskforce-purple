// A person's money as a receipt card: who they are, their stamp, where the
// money came from, and how few donors gave half the big money. Used for your
// representatives on the home page and for candidates on the ballot.
import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from '../lib/router.js';
import { gradeInfo, isIdentityUnverified, isRingfenced } from '../lib/grades.js';
import { concentration, count, moneyLines, usd } from '../lib/people.js';
import { Evidence, MoneyLines, PowerBar, Stamp } from './ui.jsx';

/**
 * person: { name, seat, party, tier, figures (gradedFigures), evidenceChecked,
 *           nakamotoCoefficient, uniqueDonors, href, badge, note }
 */
export default function Receipt({ person, delay = 0, animate = true, headingLevel = 3 }) {
  const H = `h${headingLevel}`;
  const g = gradeInfo(person.tier);
  const f = person.figures;
  const withheld = isRingfenced(person.tier);
  const hasMoney = f && f.totalRaised > 0;
  const lines = hasMoney && !withheld ? moneyLines(f) : null;
  const conc = isIdentityUnverified(person.tier) ? null : concentration(person);

  return (
    <article
      className={`receipt${animate ? ' print-in' : ''}`}
      style={{ '--delay': `${delay}s` }}
      aria-label={`${person.name}, grade ${g.mark}`}
    >
      <div className="receipt-top">
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow" style={{ fontSize: 12 }}>
            {person.seat}
          </p>
          <H className="receipt-name">
            {person.href ? <Link to={person.href}>{person.name}</Link> : person.name}
          </H>
          <p className="small muted">
            {person.party}
            {person.badge ? ` · ${person.badge}` : ''}
          </p>
        </div>
        <Stamp tier={person.tier} animate={animate} delay={delay + 0.35} />
      </div>

      {lines ? (
        <div className="tear" style={{ paddingTop: 16 }}>
          <MoneyLines lines={lines} />
          <div style={{ marginTop: 12 }}>
            <PowerBar lines={lines} />
          </div>
        </div>
      ) : (
        <p className="small muted tear" style={{ paddingTop: 16 }}>
          {person.note || (withheld || !hasMoney ? g.meaning : null)}
        </p>
      )}

      {conc && (
        <div className="half-box">
          <p className="half-num">
            {count(conc.n)} <small>{conc.n === 1 ? 'person' : 'people'}</small>
          </p>
          <p className="small" style={{ marginTop: 6, color: 'var(--ink-2)' }}>
            gave half of all the big-check money
            {conc.of ? `, out of ${count(conc.of)} named donors.` : '.'}
          </p>
        </div>
      )}

      <div className="receipt-foot tear" style={{ paddingTop: 14 }}>
        {hasMoney && !withheld ? (
          <span>
            RAISED <strong style={{ fontSize: 15 }}>{usd(f.totalRaised)}</strong>
          </span>
        ) : (
          <span />
        )}
        {!withheld && hasMoney && <Evidence checked={person.evidenceChecked} />}
      </div>
      {person.href && (
        <Link
          to={person.href}
          className="link-button"
          style={{
            alignSelf: 'flex-start',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          See the full receipt <ArrowRight size={18} aria-hidden="true" />
        </Link>
      )}
    </article>
  );
}
