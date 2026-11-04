// The results (owner's brief, 2026-11-04; ROADMAP 0b): who won, set beside
// where each candidate's money came from, in six views. Every figure comes
// from lib/results.js and says how many races it covers; the page updates
// as the daily check marks new winners. Party is shown on the
// incumbents-who-lost table only (owner, same day).
import React, { useMemo, useRef } from 'react';
import { Skeleton, Stamp, WonTag } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { ELECTION_LABEL } from '../lib/election.js';
import { GRADES, GRADE_SCOPE, LETTERS, isLetter } from '../lib/grades.js';
import { useAsync, useInView, useTitle } from '../lib/hooks.js';
import { ballotPartyName, displayName, raceSeat, usdShort } from '../lib/people.js';
import {
  calledRaces,
  contests,
  costliest,
  gradeMix,
  incumbentsWhoLost,
  moneyAndResult,
  outsideAndResult,
  seatsBeforeAndAfter,
  votingRaces,
  winsByGrade,
} from '../lib/results.js';
import { Link, racePath } from '../lib/router.js';

const count = n => n.toLocaleString('en-US');
// A grade's colour and its light step (for dark surfaces), as CSS variables
const colours = tier =>
  isLetter(tier)
    ? { '--g': GRADES[tier].color, '--gl': GRADES[tier].light }
    : { '--g': 'var(--leader)', '--gl': 'var(--leader)' };
const peopleOf = c => c?.peoplePowerInfluence?.people ?? null;

function Section({ eyebrow, title, lead, children, note }) {
  const ref = useRef(null);
  const seen = useInView(ref);
  return (
    <section ref={ref} className={`res-section${seen ? ' is-in' : ''}`}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="display display-m">{title}</h2>
      {lead && <p className="res-lead">{lead}</p>}
      {children}
      {note && <p className="fine res-note">{note}</p>}
    </section>
  );
}

/** One candidate's outside money as a bar: spent for, then against */
function OutsideBar({ c, max, raceKey, cycle }) {
  const forW = max ? (c.for / max) * 100 : 0;
  const againstW = max ? (c.against / max) * 100 : 0;
  return (
    <Link to={racePath(raceKey, cycle)} className="res-spend">
      <Stamp tier={c.c.tier} size={30} word={false} rot={0} />
      <span className="res-spend-who">
        <span className="res-name">
          {displayName(c.c.name)}
          {c.c.won && <WonTag />}
        </span>
        <span className="res-track" aria-hidden="true">
          <span className="res-for" style={{ '--w': `${forW}%` }} />
          <span className="res-against" style={{ '--w': `${againstW}%` }} />
        </span>
        <span className="res-small">
          {usdShort(c.for)} for · {usdShort(c.against)} against
        </span>
      </span>
    </Link>
  );
}

function Costliest({ list, cycle }) {
  const max = Math.max(1, ...list.flatMap(x => x.candidates.map(c => c.for + c.against)));
  return (
    <ol className="res-costly">
      {list.map(x => (
        <li key={x.race.key} className="res-card">
          <p className="res-card-head">
            <span className="eyebrow">{raceSeat(x.race)}</span>
            <span className="res-total">{usdShort(x.total)}</span>
          </p>
          {x.candidates.slice(0, 3).map(c => (
            <OutsideBar
              key={c.c.candidateId || c.c.name}
              c={c}
              max={max}
              raceKey={x.race.key}
              cycle={cycle}
            />
          ))}
        </li>
      ))}
    </ol>
  );
}

function Person({ c, won }) {
  const p = peopleOf(c);
  return (
    <span className="res-person">
      <Stamp tier={c.tier} size={38} word={false} rot={0} />
      <span className="res-person-text">
        <span className="res-name">
          {displayName(c.name)}
          {won && <WonTag />}
        </span>
        <span className="res-small">
          {ballotPartyName(c)}
          {p !== null ? ` · ${p}% from people` : ''}
        </span>
        {p !== null && (
          <span className="res-share" aria-hidden="true">
            <span style={{ '--w': `${p}%`, ...colours(c.tier) }} />
          </span>
        )}
      </span>
    </span>
  );
}

function Lost({ list, cycle }) {
  return (
    <ol className="res-lost">
      <li className="res-lost-head" aria-hidden="true">
        <span className="eyebrow">Lost</span>
        <span />
        <span className="eyebrow">Won</span>
      </li>
      {list.map(x => (
        <li key={x.race.key}>
          <Link to={racePath(x.race.key, cycle)} className="res-card res-match">
            <span className="eyebrow res-match-seat">{raceSeat(x.race)}</span>
            <Person c={x.incumbent} />
            <span className="res-arrow" aria-label="lost to">
              →
            </span>
            <Person c={x.winner} won />
          </Link>
        </li>
      ))}
    </ol>
  );
}

const ROLES = [
  ['incumbent', 'Incumbents'],
  ['challenger', 'Challengers'],
  ['open', 'Open seats'],
];

function ByGrade({ wins }) {
  return (
    <div
      className="res-dots"
      role="table"
      aria-label="Candidates who won and ran, by grade and role"
    >
      <div className="res-dots-row" role="row">
        <span role="columnheader" />
        {ROLES.map(([role, label]) => (
          <span key={role} role="columnheader" className="res-dots-label">
            {label}
          </span>
        ))}
      </div>
      {LETTERS.map(l => (
        <div key={l} className="res-dots-row" role="row">
          <span role="rowheader" className="res-dots-grade">
            <Stamp tier={l} size={30} word={false} rot={0} />
          </span>
          {ROLES.map(([role, label]) => {
            const { won, ran } = wins[role][l];
            return (
              <span
                key={role}
                role="cell"
                className="res-dots-cell"
                aria-label={`${label} graded ${l}: ${won} of ${ran} won`}
              >
                <span className="res-dot-grid" aria-hidden="true">
                  {Array.from({ length: ran }, (_, i) => (
                    <i
                      key={i}
                      className={i < won ? 'is-won' : ''}
                      style={{ ...colours(l), '--d': `${i * 8}ms` }}
                    />
                  ))}
                </span>
                <span className="res-small">
                  {won} of {ran}
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Figure({ value, of, words, detail }) {
  return (
    <div className="res-figure">
      <b>
        {count(value)}
        <small> of {count(of)}</small>
      </b>
      <span>{words}</span>
      {detail && <span className="res-small">{detail}</span>}
    </div>
  );
}

const split = (m, k) =>
  `${m.incumbent[k]} of ${m.incumbent.races} with an incumbent running, ${m.open[k]} of ${m.open.races} open seats.`;

function OutsideTotals({ t }) {
  const max = Math.max(1, t.winners.for, t.losers.for, t.winners.against, t.losers.against);
  const row = (label, v, cls) => (
    <div className="res-total-row">
      <span className="res-total-label">{label}</span>
      <span className="res-track is-wide" aria-hidden="true">
        <span className={cls} style={{ '--w': `${(v / max) * 100}%` }} />
      </span>
      <span className="res-total-value">{usdShort(v)}</span>
    </div>
  );
  return (
    <div className="res-card res-totals">
      <p className="eyebrow">Spent for</p>
      {row('The winners', t.winners.for, 'res-for')}
      {row('The losers', t.losers.for, 'res-for')}
      <p className="eyebrow" style={{ marginTop: 18 }}>
        Spent against
      </p>
      {row('The winners', t.winners.against, 'res-against')}
      {row('The losers', t.losers.against, 'res-against')}
    </div>
  );
}

function Squares({ label, seats }) {
  return (
    <div className="res-squares">
      <p className="eyebrow">{label}</p>
      <div className="res-square-grid">
        {seats.map((s, i) => (
          <i
            key={s.key}
            title={s.title}
            style={{ ...colours(s.tier), '--d': `${Math.min(i, 400) * 2}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function BeforeAfter({ seats }) {
  const rank = t => (isLetter(t) ? LETTERS.indexOf(t) : LETTERS.length);
  const side = pick =>
    seats
      .map(s => {
        const p = pick(s);
        return {
          key: s.race.key,
          tier: p?.tier ?? null,
          title: `${raceSeat(s.race)}: ${p ? `${displayName(p.name)}, ${p.tier}` : 'empty seat'}`,
        };
      })
      .sort((a, b) => rank(a.tier) - rank(b.tier));
  const before = gradeMix(seats.map(s => s.before?.tier));
  const after = gradeMix(seats.map(s => s.after?.tier));
  return (
    <div className="res-card res-before-after">
      <Squares label="Before the election" seats={side(s => s.before)} />
      <Squares label="After" seats={side(s => s.after)} />
      <ol className="res-mix" aria-label="Seats by grade, before and after">
        {LETTERS.map(l => (
          <li key={l}>
            <Stamp tier={l} size={26} word={false} rot={0} />
            <span>
              {before[l]} → <b>{after[l]}</b>
            </span>
          </li>
        ))}
        <li>
          <i className="res-no-grade" aria-hidden="true" />
          <span>
            No grade: {before.other} → <b>{after.other}</b>
          </span>
        </li>
      </ol>
      <p className="fine" style={{ margin: 0 }}>
        No grade: the money was mostly their own, the grade was withheld, or the seat was empty.
      </p>
    </div>
  );
}

export default function Results() {
  useTitle('The results');
  const races = useAsync(() => api.races(), []);
  const outside = useAsync(() => api.outside(), []);
  const seats = useAsync(() => api.seats(), []);
  const members = useAsync(() => api.members(), []);
  const all = useMemo(() => races.data?.races || [], [races.data]);
  const cycle = races.data?.cycle;

  const figures = useMemo(() => {
    const o = outside.data;
    return {
      voting: votingRaces(all).length,
      called: calledRaces(all).length,
      contests: contests(all).length,
      senate: costliest(all, o, 'S'),
      house: costliest(all, o, 'H'),
      lost: incumbentsWhoLost(all),
      wins: winsByGrade(all),
      money: moneyAndResult(all),
      totals: o ? outsideAndResult(all, o) : null,
      seats:
        seats.data && members.data
          ? seatsBeforeAndAfter(all, seats.data.seats, members.data.members)
          : null,
    };
  }, [all, outside.data, seats.data, members.data]);

  if (races.loading) {
    return (
      <div className="wrap section">
        <Skeleton height={80} width="70%" />
        <Skeleton height={420} style={{ marginTop: 32 }} />
      </div>
    );
  }
  if (!figures.called) {
    return (
      <div className="wrap section">
        <h1 className="display display-l">No results yet</h1>
        <p className="lede" style={{ marginTop: 16, color: 'var(--ink-2)' }}>
          Results appear here as races are called. <Link to="/races">See every race</Link>.
        </p>
      </div>
    );
  }
  const m = figures.money;
  return (
    <>
      <section className="race-hero band on-dark races-hero" aria-labelledby="results-title">
        <div className="wrap">
          <div style={{ flex: '1 1 560px', minWidth: 0 }}>
            <p className="eyebrow" style={{ marginBottom: 14 }}>
              {ELECTION_LABEL}
            </p>
            <h1
              id="results-title"
              className="display display-xl"
              style={{ fontSize: 'clamp(48px, 7.4vw, 104px)' }}
            >
              The results
            </h1>
            <p className="lede" style={{ marginTop: 18, maxWidth: '36em' }}>
              Who won, set beside where each candidate&apos;s money came from. The figures update as
              the rest of the races are called.
            </p>
            <div className="races-stats">
              <div className="races-stat">
                <b>
                  {count(figures.called)}
                  <small> of {count(figures.voting)}</small>
                </b>
                <span>seats called</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap res-body">
        <Section
          eyebrow="General election · outside spending"
          title="The costliest races"
          lead="What outside groups spent for and against each candidate."
        >
          <div className="res-key" aria-hidden="true">
            <span>
              <i className="res-for" /> Spent for
            </span>
            <span>
              <i className="res-against" /> Spent against
            </span>
          </div>
          <div className="res-costly-cols">
            <div>
              <h3 className="res-col-title">Senate</h3>
              <Costliest list={figures.senate} cycle={cycle} />
            </div>
            <div>
              <h3 className="res-col-title">House</h3>
              <Costliest list={figures.house} cycle={cycle} />
            </div>
          </div>
        </Section>

        <Section
          eyebrow={`${count(figures.lost.length)} seats`}
          title="Incumbents who lost"
          lead="Who lost their seat, who won it, and how much of each one's money came from people."
        >
          <Lost list={figures.lost} cycle={cycle} />
        </Section>

        <Section
          eyebrow={`${count(figures.contests)} races with two or more graded candidates`}
          title="Who won, by grade"
          lead="Each dot is a candidate. Filled dots won."
        >
          <ByGrade wins={figures.wins} />
        </Section>

        <Section
          eyebrow={`${count(m.all.races)} races with two or more graded candidates`}
          title="Money and the result"
          note="Each winner is compared with the opponent who raised the most."
        >
          <div className="res-figures">
            <Figure
              value={m.all.raisedMore}
              of={m.all.races}
              words="were won by the candidate who raised more money."
              detail={split(m, 'raisedMore')}
            />
            <Figure
              value={m.all.morePeople}
              of={m.all.races}
              words="were won by the candidate with more of their money from people."
              detail={split(m, 'morePeople')}
            />
          </div>
        </Section>

        {figures.totals && (
          <Section
            eyebrow={`General election · ${count(figures.called)} called seats`}
            title="Outside money"
            lead="What outside groups spent for and against the people who won, and the people who lost."
          >
            <OutsideTotals t={figures.totals} />
            <div className="res-figures">
              <Figure
                value={figures.totals.boosted.won}
                of={figures.totals.boosted.ran}
                words="BOOSTED candidates won."
              />
              <Figure
                value={figures.totals.selfFunded.won}
                of={figures.totals.selfFunded.ran}
                words="candidates who put in half or more of their own money won."
              />
            </div>
          </Section>
        )}

        {figures.seats && (
          <Section
            eyebrow={`${count(figures.seats.length)} called seats`}
            title="The seats, before and after"
            lead="Each square is a called seat, coloured by the grade of the member who held it, then of the person who won it."
            note="Where districts were redrawn, a seat's member before the election is the one who defended it."
          >
            <BeforeAfter seats={figures.seats} />
          </Section>
        )}

        <p className="fine res-sources">
          Only seats that vote on laws are counted: the delegates are left out. Grades are as they
          stood on election day. Who won comes from Wikipedia&apos;s results and the AP&apos;s
          calls; the money comes from reports filed with the FEC. {GRADE_SCOPE}{' '}
          <Link to="/how">How grades work</Link>.
        </p>
      </div>
    </>
  );
}
