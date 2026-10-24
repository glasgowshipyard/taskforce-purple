// A person's money as a receipt card: who they are, their stamp, and their
// money as a graph of People, Power and Influence with one sentence under it.
// Used for your representatives on the home page and for candidates on the
// ballot.
import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from '../lib/router.js';
import { gradeInfo, isRingfenced } from '../lib/grades.js';
import { peopleSentence } from '../lib/explain.js';
import { moneyLines, usd } from '../lib/people.js';
import MoneyGraph from './MoneyGraph.jsx';
import { Evidence, MoneyLines, Stamp } from './ui.jsx';

/**
 * person: { name, seat, party, tier, figures (gradedFigures), ppi (People,
 *           Power, Influence), evidenceChecked, href, badge, note }
 */
export default function Receipt({ person, delay = 0, animate = true, headingLevel = 3 }) {
  const H = `h${headingLevel}`;
  const g = gradeInfo(person.tier, person.withheldReason);
  const f = person.figures;
  const withheld = isRingfenced(person.tier);
  const hasMoney = f && f.totalRaised > 0;
  const ppi = hasMoney && !withheld ? person.ppi : null;
  // Graded before the three parts were published: the receipt's lines
  const lines = hasMoney && !withheld && !ppi ? moneyLines(f) : null;

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
        <Stamp
          tier={person.tier}
          reason={person.withheldReason}
          animate={animate}
          delay={delay + 0.35}
        />
      </div>

      {ppi ? (
        <div className="tear" style={{ paddingTop: 16 }}>
          <MoneyGraph ppi={ppi} tier={person.tier} cycle={person.cycle} compact />
          <p className="receipt-sentence">{peopleSentence(ppi.people)}</p>
        </div>
      ) : lines ? (
        <div className="tear" style={{ paddingTop: 16 }}>
          <MoneyLines lines={lines} />
        </div>
      ) : (
        <p className="small muted tear" style={{ paddingTop: 16 }}>
          {person.note || (withheld || !hasMoney ? g.meaning : null)}
        </p>
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
          See the full breakdown <ArrowRight size={18} aria-hidden="true" />
        </Link>
      )}
    </article>
  );
}
