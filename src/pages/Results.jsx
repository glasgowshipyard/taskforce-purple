// The results (owner's brief, 2026-11-04; ROADMAP 0b): who won, set beside
// where each candidate's money came from, in six views. Every figure comes
// from lib/results.js and says how many races it covers; the page updates
// as the daily check marks new winners. Party is shown on the
// incumbents-who-lost table only (owner, same day). Each view opens with a
// short summary worked out from its own figures, and the long ones fold,
// open and close again (owner, 2026-11-06).
import React, { createContext, useContext, useMemo, useRef, useState } from 'react';
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
  dollarsInWords,
  gradeMix,
  incumbentsWhoLost,
  lostSummary,
  moneyAndGrade,
  outsideAndResult,
  seatsBeforeAndAfter,
  shareWords,
  votingRaces,
  winRates,
  winsByGrade,
} from '../lib/results.js';
import { Link, racePath } from '../lib/router.js';

const count = n => n.toLocaleString('en-US');
const pct = (won, of) => (of ? Math.round((won / of) * 100) : 0);
// A grade's colour and its light step (for dark surfaces), as CSS variables
const colours = tier =>
  isLetter(tier)
    ? { '--g': GRADES[tier].color, '--gl': GRADES[tier].light }
    : { '--g': 'var(--leader)', '--gl': 'var(--leader)' };
const peopleOf = c => c?.peoplePowerInfluence?.people ?? null;
// "all 5", "4 of the 5", "none of the 5"
const howMany = (k, n) =>
  k === n ? `all ${n}` : k === 0 ? `none of the ${n}` : `${k} of the ${n}`;
// "Graded S or A", "Graded B", "Graded C to F"
const gradesLabel = g =>
  g.length === 1
    ? `Graded ${g[0]}`
    : g.length === 2
      ? `Graded ${g[0]} or ${g[1]}`
      : `Graded ${g[0]} to ${g[g.length - 1]}`;

function Section({ eyebrow, title, summary, children, note }) {
  const ref = useRef(null);
  const seen = useInView(ref);
  return (
    <section ref={ref} className={`res-section${seen ? ' is-in' : ''}`}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="display display-m">{title}</h2>
      {summary && <p className="res-summary">{summary}</p>}
      {children}
      {note && <p className="fine res-note">{note}</p>}
    </section>
  );
}

// Opens the fold a view sits in (a card's list opened inside a folded view)
const UnfoldContext = createContext(() => {});

/** A long view shown in part, fading into a button that opens and closes it */
function Fold({ height, label, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  return (
    <>
      <div
        ref={ref}
        className={`res-fold${open ? ' is-open' : ''}`}
        style={{ '--fold': `${height}px` }}
      >
        <UnfoldContext.Provider value={() => setOpen(true)}>{children}</UnfoldContext.Provider>
      </div>
      <p className="res-more">
        <button
          type="button"
          className="btn"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            // Folding back: return to where the view starts
            if (open && ref.current && ref.current.getBoundingClientRect().top < 0) {
              ref.current.scrollIntoView({ block: 'start' });
            }
          }}
        >
          {open ? 'Show fewer' : label}
        </button>
      </p>
    </>
  );
}

/** Outside money as one bar: spent for (›››), then against (‹‹‹) */
function SpendBar({ forAmount, against, max, wide = false }) {
  return (
    <span className={`res-track${wide ? ' is-wide' : ''}`} aria-hidden="true">
      <span className="res-for" style={{ '--w': `${max ? (forAmount / max) * 100 : 0}%` }} />
      <span className="res-against" style={{ '--w': `${max ? (against / max) * 100 : 0}%` }} />
    </span>
  );
}

function SpendKey() {
  return (
    <div className="res-key" aria-hidden="true">
      <span>
        <i className="res-for" /> Spent for ›››
      </span>
      <span>
        <i className="res-against" /> ‹‹‹ Spent against
      </span>
    </div>
  );
}

function OutsideBar({ c, max, raceKey, cycle }) {
  return (
    <Link to={racePath(raceKey, cycle)} className="res-spend">
      <Stamp tier={c.c.tier} size={30} word={false} rot={0} />
      <span className="res-spend-who">
        <span className="res-name">
          {displayName(c.c.name)}
          {c.c.won && <WonTag />}
        </span>
        <SpendBar forAmount={c.for} against={c.against} max={max} />
        <span className="res-small">
          {usdShort(c.for)} for · {usdShort(c.against)} against
        </span>
      </span>
    </Link>
  );
}

/**
 * Who spent the most in a race, by whose side they were on (owner,
 * 2026-11-06), from outside.json's races: closed until opened
 */
function WhoSpent({ race, sides }) {
  const [open, setOpen] = useState(false);
  const unfold = useContext(UnfoldContext);
  if (!sides?.length) {
    return null;
  }
  const nameOf = id => displayName(race.candidates.find(c => c.candidateId === id)?.name || '');
  const max = Math.max(1, ...sides.flatMap(s => s.groups.map(g => g.amount)));
  return (
    <div className="res-who">
      <button
        type="button"
        className="res-who-toggle"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            unfold();
          }
          setOpen(!open);
        }}
      >
        <span aria-hidden="true">›</span> Who spent the most
      </button>
      {open && (
        <div className="res-who-panel">
          <div className="res-sides">
            {sides.map(side => (
              <div key={side.candidateId}>
                <p className="eyebrow">On {nameOf(side.candidateId)}&rsquo;s side</p>
                <ol className="res-groups">
                  {side.groups.map(g => (
                    <li key={g.id}>
                      <a
                        href={`https://www.fec.gov/data/committee/${g.id}/`}
                        className="res-group-name"
                        title={g.name}
                      >
                        {g.name}
                      </a>
                      <span className="res-group-value">{usdShort(g.amount)}</span>
                      <span className="res-group-bar" aria-hidden="true">
                        <span style={{ width: `${(g.amount / max) * 100}%` }} />
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          <p className="res-small">
            A group is on a candidate&rsquo;s side when it spent for them or against their opponent.
            General election only.
          </p>
        </div>
      )}
    </div>
  );
}

function Costliest({ list, cycle, outside }) {
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
          <WhoSpent race={x.race} sides={outside?.races?.[x.race.key]?.sides} />
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

function Rates({ title, rows }) {
  return (
    <div className="res-rates">
      <p className="eyebrow">{title}</p>
      {rows.map(r => (
        <div key={r.grades.join('')} className="res-rate">
          <span className="res-rate-label">{gradesLabel(r.grades)}</span>
          <span className="res-rate-track" aria-hidden="true">
            <span style={{ '--w': `${pct(r.won, r.ran)}%` }} />
          </span>
          <span className="res-rate-value">
            {pct(r.won, r.ran)}%<small>{` ${r.won} of ${r.ran}`}</small>
          </span>
        </div>
      ))}
    </div>
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
      <p className="eyebrow" style={{ margin: 0 }}>
        Every candidate: a filled dot won
      </p>
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

/** Ten dots: how many races in every ten went this way */
function Tens({ won, of }) {
  const v = of ? (won / of) * 10 : 0;
  return (
    <span className="res-tens" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => {
        const f = Math.max(0, Math.min(1, v - i));
        return <i key={i} style={{ '--p': `${Math.round(f * 100)}%` }} />;
      })}
    </span>
  );
}

function MoneyRow({ won, of, text, note }) {
  return (
    <div className="res-money-row">
      <Tens won={won} of={of} />
      <span className="res-money-text">
        {text}
        <span className="res-small">
          {count(won)} of {count(of)} races{note ? ` · ${note}` : ''}
        </span>
      </span>
    </div>
  );
}

function OutsideTotals({ t }) {
  const max = Math.max(1, t.winners.for + t.winners.against, t.losers.for + t.losers.against);
  const row = (label, x) => (
    <div className="res-total-row">
      <span className="res-total-label">{label}</span>
      <span>
        <SpendBar forAmount={x.for} against={x.against} max={max} wide />
        <span className="res-small">
          {usdShort(x.for)} for · {usdShort(x.against)} against
        </span>
      </span>
      <span className="res-total-value">{usdShort(x.for + x.against)}</span>
    </div>
  );
  return (
    <div className="res-card res-totals">
      <SpendKey />
      {row('The winners', t.winners)}
      {row('The losers', t.losers)}
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

function BeforeAfter({ seats, before, after }) {
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

  const f = useMemo(() => {
    const o = outside.data;
    const lost = incumbentsWhoLost(all);
    const wins = winsByGrade(all);
    const bySeat =
      seats.data && members.data
        ? seatsBeforeAndAfter(all, seats.data.seats, members.data.members)
        : null;
    return {
      voting: votingRaces(all).length,
      called: calledRaces(all).length,
      contests: contests(all).length,
      senate: costliest(all, o, 'S'),
      house: costliest(all, o, 'H'),
      lost,
      lostSum: lostSummary(lost),
      wins,
      rates: winRates(wins),
      money: moneyAndGrade(all),
      totals: o ? outsideAndResult(all, o) : null,
      seats: bySeat,
      before: bySeat && gradeMix(bySeat.map(s => s.before?.tier)),
      after: bySeat && gradeMix(bySeat.map(s => s.after?.tier)),
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
  if (!f.called) {
    return (
      <div className="wrap section">
        <h1 className="display display-l">No results yet</h1>
        <p className="lede" style={{ marginTop: 16, color: 'var(--ink-2)' }}>
          Results appear here as races are called. <Link to="/races">See every race</Link>.
        </p>
      </div>
    );
  }

  // The summaries, from the figures
  const total = list => list.reduce((t, x) => t + x.total, 0);
  const againstWinner = list =>
    list.filter(x => {
      const w = x.candidates.find(y => y.c.won);
      return w && w.against > w.for;
    }).length;
  const ls = f.lostSum;
  const hiChallenger = f.rates.challenger[0];
  const loChallenger = f.rates.challenger[f.rates.challenger.length - 1];
  const hiRate = hiChallenger.won / (hiChallenger.ran || 1);
  const loRate = loChallenger.won / (loChallenger.ran || 1);
  const m = f.money;
  const t = f.totals;
  const sumOf = (mix, ls2) => ls2.reduce((s, l) => s + mix[l], 0);

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
                  {count(f.called)}
                  <small> of {count(f.voting)}</small>
                </b>
                <span>seats called</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap res-body">
        <Section
          eyebrow="The costliest races · general election"
          title="Outside spending"
          summary={
            <>
              Groups <b>outside the campaigns</b> spent {dollarsInWords(total(f.senate))} on the{' '}
              {f.senate.length} costliest Senate races. In{' '}
              {howMany(againstWinner(f.senate), f.senate.length)}, more was spent against the winner
              than for them. The same was true in {howMany(againstWinner(f.house), f.house.length)}{' '}
              costliest House races.
            </>
          }
        >
          <SpendKey />
          <Fold height={560} label={`Show all ${f.senate.length + f.house.length} races`}>
            <div className="res-costly-cols">
              <div>
                <h3 className="res-col-title">Senate</h3>
                <Costliest list={f.senate} cycle={cycle} outside={outside.data} />
              </div>
              <div>
                <h3 className="res-col-title">House</h3>
                <Costliest list={f.house} cycle={cycle} outside={outside.data} />
              </div>
            </div>
          </Fold>
        </Section>

        <Section
          eyebrow={`${count(ls.seats)} incumbents lost their seats`}
          title="Winning grades"
          summary={
            <>
              In{' '}
              {ls.higherGrade === ls.seats
                ? `all ${ls.seats}`
                : `${ls.higherGrade} of the ${ls.seats}`}{' '}
              seats where the incumbent lost, the winning grade was higher. The typical winner got{' '}
              <b>{ls.winners}%</b> of their money from people. The typical incumbent who lost got{' '}
              <b>{ls.incumbents}%</b>.
            </>
          }
        >
          {f.lost.length > 5 ? (
            <Fold height={640} label={`Show all ${f.lost.length} seats`}>
              <Lost list={f.lost} cycle={cycle} />
            </Fold>
          ) : (
            <Lost list={f.lost} cycle={cycle} />
          )}
        </Section>

        <Section
          eyebrow={`${count(f.contests)} races with two or more graded candidates`}
          title="Winners by grade"
          summary={
            <>
              Incumbents kept their seat in{' '}
              <b>{pct(f.rates.incumbent.won, f.rates.incumbent.ran)}%</b> of races.{' '}
              {hiRate > loRate * 2 && hiRate - loRate >= 0.1
                ? 'Challengers with high grades won far more often than those with low grades.'
                : hiRate > loRate
                  ? 'Challengers with high grades won more often than those with low grades.'
                  : 'Challengers with high grades won no more often than those with low grades.'}
            </>
          }
        >
          <div className="res-card res-rate-card">
            <Rates title="How often challengers won" rows={f.rates.challenger} />
            <Rates title="How often open-seat candidates won" rows={f.rates.open} />
          </div>
          <Fold height={300} label="Show every candidate">
            <ByGrade wins={f.wins} />
          </Fold>
        </Section>

        <Section
          eyebrow={`${count(m.raisedMost.of)} races with two or more graded candidates`}
          title="Money and winning"
          summary={
            <b>
              {m.raisedMost.won / m.raisedMost.of >= 0.5
                ? 'In most races, the candidate who raised the most money won.'
                : `The candidate who raised the most money won ${shareWords(m.raisedMost.won, m.raisedMost.of)}.`}{' '}
              The candidate with the higher grade won{' '}
              {shareWords(m.higherGrade.won, m.higherGrade.of)}.
            </b>
          }
          note="Each winner is compared with the opponent who raised the most."
        >
          <div className="res-money">
            <MoneyRow
              won={m.raisedMost.won}
              of={m.raisedMost.of}
              text="The candidate who raised the most money won."
            />
            <MoneyRow
              won={m.higherGrade.won}
              of={m.higherGrade.of}
              text="The candidate with the higher grade won."
              note="races where the two grades were different"
            />
            <MoneyRow
              won={m.both.won}
              of={m.both.of}
              text={
                <>
                  Candidates who raised the most <b>and</b> had the higher grade won.
                </>
              }
            />
            <MoneyRow
              won={m.split.won}
              of={m.split.of}
              text="Candidates who raised the most but had the lower grade still won."
            />
          </div>
        </Section>

        {t && (
          <Section
            eyebrow={`General election · ${count(f.called)} called seats`}
            title="Outside money"
            summary={
              <>
                Outside groups spent{' '}
                {t.winners.against + t.losers.against > 2 * (t.winners.for + t.losers.for)
                  ? 'far more'
                  : t.winners.against + t.losers.against > t.winners.for + t.losers.for
                    ? 'more'
                    : 'less'}{' '}
                <b>against</b> candidates than for them:{' '}
                <b>{dollarsInWords(t.winners.against + t.losers.against)}</b> against and{' '}
                <b>{dollarsInWords(t.winners.for + t.losers.for)}</b> for.{' '}
                {t.losers.for > t.winners.for && t.losers.against > t.winners.against
                  ? 'The losers had more spent on them both ways.'
                  : t.winners.for > t.losers.for && t.winners.against > t.losers.against
                    ? 'The winners had more spent on them both ways.'
                    : `More was spent for the ${t.winners.for > t.losers.for ? 'winners' : 'losers'}, and more against the ${t.winners.against > t.losers.against ? 'winners' : 'losers'}.`}{' '}
                {t.boosted.won} of {t.boosted.ran} BOOSTED candidates won. {t.selfFunded.won} of{' '}
                {t.selfFunded.ran} candidates who put in half or more of their own money won.
              </>
            }
          >
            <OutsideTotals t={t} />
          </Section>
        )}

        {f.seats && (
          <Section
            eyebrow={`${count(f.seats.length)} called seats`}
            title="Seats, before and after"
            summary={
              <>
                Seats graded S or A went from <b>{sumOf(f.before, ['S', 'A'])}</b> to{' '}
                <b>{sumOf(f.after, ['S', 'A'])}</b>. Seats graded E or F went from{' '}
                <b>{sumOf(f.before, ['E', 'F'])}</b> to <b>{sumOf(f.after, ['E', 'F'])}</b>.
              </>
            }
            note="Each square is a called seat, coloured by the grade of the member who held it, then of the person who won it. Where districts were redrawn, a seat's member before the election is the one who defended it."
          >
            <BeforeAfter seats={f.seats} before={f.before} after={f.after} />
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
