// Races (owner, 2026-10-23): every race for Congress at once. The country
// as a map of who gets most of their money from people, then the races
// themselves, each candidate's money filling in as it scrolls into view.
// The figures and orders come from lib/races.js; the field from the races
// job (Wikipedia's lists matched to the FEC).
import React, { useMemo, useRef, useState } from 'react';
import Lookup from '../components/Lookup.jsx';
import { BoostedStamp, Skeleton, Stamp, VoteLink } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { ELECTION_LABEL, daysUntilElection } from '../lib/election.js';
import {
  GRADES,
  GRADE_SCOPE_SHORT,
  LETTERS,
  PARTS,
  gradeInfo,
  isLetter,
  withheldReasonOf,
} from '../lib/grades.js';
import { useAsync, useCountUp, useInView, useTitle } from '../lib/hooks.js';
import { isBoosted } from '../lib/outside.js';
import { ballotPartyName, displayName, raceSeat, stateName, usdShort } from '../lib/people.js';
import { savePlace } from '../lib/place.js';
import {
  VIEWS,
  bandOf,
  nationalFigures,
  peopleShare,
  racesInView,
  searchRaces,
  stateFigures,
} from '../lib/races.js';
import { Link, navigate, racePath } from '../lib/router.js';
import { TILES } from '../lib/tilemap.js';

const PAGE = 24;
const SHOWN = 3;
const count = n => n.toLocaleString('en-US');
const candidateKey = c => c.candidateId || `${c.state}-${c.district}-${c.name}`;

function Counter({ value, run, label }) {
  const n = useCountUp(value, run);
  return (
    <div className="races-stat">
      <b>{count(n)}</b>
      <span>{label}</span>
    </div>
  );
}

function Hero({ figures }) {
  const ref = useRef(null);
  const seen = useInView(ref, '0px');
  const mostly = useCountUp(figures.mostlyPeople, seen);
  const days = daysUntilElection();
  return (
    <section className="race-hero band on-dark races-hero" aria-labelledby="races-title">
      <div className="wrap">
        <div style={{ flex: '1 1 560px', minWidth: 0 }}>
          <p className="eyebrow" style={{ marginBottom: 14 }}>
            {ELECTION_LABEL}
            {days > 0 && ` · ${days} ${days === 1 ? 'day' : 'days'} to go`}
          </p>
          <h1
            id="races-title"
            className="display display-xl"
            style={{ fontSize: 'clamp(48px, 7.4vw, 104px)' }}
          >
            Every race for Congress
          </h1>
          <p className="lede" style={{ marginTop: 18, maxWidth: '36em' }}>
            The candidates for the House and Senate in the 2026 election are graded the same way as
            the members already there, on where their campaign money comes from.
          </p>
          {/* How grading works, in one line, for visitors who land here first
              from a shared link (owner, 2026-10-24). A letter being explained
              wears its colour */}
          <p className="races-howto">
            Each grade is the share of a candidate&apos;s money that comes from many different
            people: <b style={{ color: GRADES.S.light }}>S</b> is 90% or more,{' '}
            <b style={{ color: GRADES.F.light }}>F</b> is under 15%. It&apos;s only about where the
            money comes from, not votes or character. <Link to="/how">How grades work</Link>
          </p>
          <div className="races-stats" ref={ref}>
            <Counter value={figures.races} run={seen} label="races" />
            <Counter value={figures.candidates} run={seen} label="candidates" />
            <div className="races-stat">
              <b>
                {count(mostly)}
                <small> of {count(figures.graded)}</small>
              </b>
              <span>graded candidates get most of their money from people</span>
            </div>
          </div>
        </div>
        <div className="races-find">
          <Lookup
            idPrefix="races"
            submitLabel="Find my ballot"
            onFound={p => {
              savePlace(p);
              navigate('/ballot');
            }}
          />
        </div>
      </div>
    </section>
  );
}

function TileMap({ byState, selected, onPick }) {
  const ref = useRef(null);
  const seen = useInView(ref);
  return (
    <section className="section-tight" aria-labelledby="map-title">
      <h2 id="map-title" className="display display-m">
        Where the candidates&apos; money comes from, state by state
      </h2>
      <p style={{ margin: '10px 0 18px', maxWidth: '44em', color: 'var(--ink-2)' }}>
        Each state is coloured by the grade of its typical candidate. Green means most of their
        money comes from people. Red means it comes from a few wealthy donors, or from PACs,
        politicians and parties. Tap a state to see its races.
      </p>
      <div className={`tilemap${seen ? ' is-in' : ''}`} ref={ref}>
        {Object.entries(TILES).map(([code, [row, col]]) => {
          const s = byState[code];
          const band = bandOf(s?.typical ?? null);
          const name = stateName(code);
          const words = s?.graded
            ? `the typical graded candidate gets ${s.typical}% of their money from people (${band} range). ${count(s.mostlyPeople)} of ${count(s.graded)} get most of their money from people`
            : 'no graded candidates';
          return (
            <button
              key={code}
              type="button"
              className={`tile${band ? '' : ' is-empty'}`}
              style={{
                gridRow: row + 1,
                gridColumn: col + 1,
                '--d': `${col * 40 + row * 25}ms`,
                ...(band ? { background: GRADES[band].light } : {}),
              }}
              aria-pressed={selected === code}
              aria-label={`${name}: ${words}. Show its races.`}
              title={`${name}: ${words}`}
              disabled={!s}
              onClick={() => onPick(selected === code ? null : code)}
            >
              {code}
            </button>
          );
        })}
      </div>
      <ol className="tile-key" aria-label="The typical candidate's share of money from people">
        {LETTERS.map(l => (
          <li key={l}>
            <span
              className="tile-swatch"
              style={{ background: GRADES[l].light }}
              aria-hidden="true"
            />
            {/* A grade letter being explained wears its colour (owner, 2026-10-17) */}
            <b style={{ color: GRADES[l].color }}>{l}</b> {GRADES[l].range}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** People, Power and Influence as one bar, filling in when the card arrives */
function MoneyBar({ c, i }) {
  const ppi = c.peoplePowerInfluence;
  const share = peopleShare(c);
  if (share === null || !ppi) {
    return (
      <span className="race-bar is-none">
        {c.registered === false
          ? 'Not registered with the FEC'
          : c.tier && !isLetter(c.tier)
            ? gradeInfo(c.tier, withheldReasonOf(c)).name
            : 'Not graded yet'}
      </span>
    );
  }
  return (
    <span className="race-bar" style={{ '--i': i }} aria-label={`${share}% from people`}>
      <span className="seg-people" style={{ '--w': `${ppi.people}%` }} />
      <span className="seg-power" style={{ '--w': `${ppi.power}%` }} />
      <span className="seg-influence" style={{ '--w': `${ppi.influence}%` }} />
    </span>
  );
}

/**
 * What the candidate put in of their own (owner, 2026-10-23: "make it clear,
 * to the point of maybe even slightly animating it"), in gold, filling in
 * with the card. Shown from a tenth of what they raised; never graded
 */
function OwnLine({ c, i }) {
  const own = c.ownMoney;
  const raised = c.totalRaised;
  if (!(own > 0) || !(raised > 0) || own / raised < 0.1) {
    return null;
  }
  const pct = Math.min(100, Math.round((own / raised) * 100));
  return (
    <span className="own-line">
      <span className="own-bar" style={{ '--i': i }} aria-hidden="true">
        <span style={{ '--w': `${pct}%` }} />
      </span>
      <span className="own-text">
        Put in {usdShort(own)} of their own: {pct}% of what they raised
      </span>
    </span>
  );
}

function RaceCard({ race, cycle, outside }) {
  const ref = useRef(null);
  const seen = useInView(ref);
  const top = race.candidates.slice(0, SHOWN);
  const more = race.candidates.length - top.length;
  return (
    <li ref={ref} className={`race-card${seen ? ' is-in' : ''}`}>
      <Link to={racePath(race.key, cycle)} className="race-card-link">
        <span className="race-card-head">
          <span className="eyebrow">{raceSeat(race)}</span>
        </span>
        <span className="race-card-people">
          {top.map((c, i) => {
            const share = peopleShare(c);
            return (
              <span key={candidateKey(c)} className="race-row">
                <Stamp tier={c.tier} size={40} word={false} rot={0} />
                <span className="race-row-who">
                  <span className="race-row-name">{displayName(c.name)}</span>
                  <span className="race-row-meta">
                    {ballotPartyName(c)}
                    {c.ici === 'I' ? ' · in office' : ''}
                    {c.totalRaised > 0 ? ` · raised ${usdShort(c.totalRaised)}` : ''}
                    {share !== null ? ` · ${share}% from people` : ''}
                    {share !== null && c.evidenceChecked === false && (
                      <span className="is-checking"> · still being checked</span>
                    )}
                    {isBoosted(
                      outside?.people?.[c.bioguideId || c.candidateId],
                      c.totalRaised,
                      c.bioguideId || c.candidateId
                    ) && (
                      <>
                        {' '}
                        <BoostedStamp small />
                      </>
                    )}
                  </span>
                  <MoneyBar c={c} i={i} />
                  <OwnLine c={c} i={i} />
                </span>
              </span>
            );
          })}
        </span>
        <span className="race-card-foot">
          {more > 0 ? `and ${more} more ${more === 1 ? 'candidate' : 'candidates'} · ` : ''}
          Compare them
          <span aria-hidden="true"> →</span>
        </span>
      </Link>
    </li>
  );
}

function RaceList({ races, byState, state, onClearState, cycle, outside }) {
  const [view, setView] = useState('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const list = searchRaces(racesInView(races, view, state), query, stateName);
  const shown = list.slice(0, limit);
  const s = state ? byState[state] : null;
  return (
    <section className="section-tight" id="race-list" aria-labelledby="list-title">
      <h2 id="list-title" className="display display-m">
        {state ? `The races in ${stateName(state)}` : 'The races'}
      </h2>
      {s && (
        <p style={{ margin: '10px 0 0', color: 'var(--ink-2)' }}>
          {count(s.races)} {s.races === 1 ? 'race' : 'races'}.{' '}
          {s.graded
            ? `${count(s.mostlyPeople)} of the ${count(s.graded)} graded candidates get most of their money from people.`
            : 'No candidate here has been graded yet.'}{' '}
          <button type="button" className="link-button" onClick={onClearState}>
            Show every state
          </button>
        </p>
      )}
      <div className="filters" style={{ marginTop: 18 }}>
        <input
          type="search"
          className="input"
          placeholder="Search by name or state"
          aria-label="Search the races by a candidate's name or the state"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
        />
        <div className="seg" role="group" aria-label="Which races">
          {VIEWS.map(v => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => {
                setView(v.id);
                setLimit(PAGE);
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <p className="fine" style={{ marginBottom: 16 }}>
        Each bar is a candidate&apos;s money:{' '}
        {PARTS.map((p, i) => (
          <React.Fragment key={p.key}>
            <span className={`key-dot seg-${p.key}`} aria-hidden="true" />
            <b style={{ color: `var(--${p.key})` }}>{p.label}</b>
            {i < PARTS.length - 1 ? ', ' : '. '}
          </React.Fragment>
        ))}
        {GRADE_SCOPE_SHORT}
      </p>
      {list.length === 0 ? (
        <p className="lede" style={{ color: 'var(--ink-2)' }}>
          {query
            ? `No candidate or state matches “${query}”. Check the spelling, or try just a last name.`
            : 'No races here fit that. Try another view.'}
        </p>
      ) : (
        <ul className="race-grid">
          {shown.map(r => (
            <RaceCard key={r.key} race={r} cycle={cycle} outside={outside} />
          ))}
        </ul>
      )}
      {list.length > shown.length && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 28 }}>
          <button type="button" className="btn" onClick={() => setLimit(l => l + PAGE)}>
            Show {Math.min(PAGE, list.length - shown.length)} more of {count(list.length)}
          </button>
        </div>
      )}
    </section>
  );
}

function Sources({ sources }) {
  const link = s => `https://en.wikipedia.org/w/index.php?oldid=${s.revid}`;
  return (
    <p className="fine" style={{ marginTop: 32 }}>
      Who&apos;s running comes from Wikipedia&apos;s lists of candidates for the{' '}
      {sources?.H ? <a href={link(sources.H)}>House</a> : 'House'} and the{' '}
      {sources?.S ? <a href={link(sources.S)}>Senate</a> : 'Senate'}, in the versions that were
      checked. Each candidate is matched to their own registration with the FEC, and checked against
      the reports campaigns filed before the election. Candidates who aren&apos;t in Congress are
      graded from the FEC&apos;s bulk data files, and their donations are checked against the
      FEC&apos;s own records afterwards. <Link to="/how">How grades work</Link>.
    </p>
  );
}

export default function Races() {
  useTitle('Every race for Congress');
  const races = useAsync(() => api.races(), []);
  const outside = useAsync(() => api.outside(), []);
  const [state, setState] = useState(null);
  const all = useMemo(() => races.data?.races || [], [races.data]);
  const figures = useMemo(() => nationalFigures(all), [all]);
  const byState = useMemo(() => stateFigures(all), [all]);

  if (races.loading) {
    return (
      <div className="wrap section">
        <Skeleton height={80} width="70%" />
        <Skeleton height={420} style={{ marginTop: 32 }} />
      </div>
    );
  }
  if (!races.data) {
    return (
      <div className="wrap section">
        <h1 className="display display-l">The races aren&apos;t published right now</h1>
        <p className="lede" style={{ marginTop: 16, color: 'var(--ink-2)' }}>
          The candidates are graded from the reports their campaigns file with the FEC.{' '}
          <Link to="/">See your current representatives</Link>.
        </p>
        <VoteLink />
      </div>
    );
  }
  const pick = code => {
    setState(code);
    if (code) {
      requestAnimationFrame(() =>
        document.getElementById('race-list')?.scrollIntoView({ behavior: 'smooth' })
      );
    }
  };
  return (
    <>
      <Hero figures={figures} />
      <div className="wrap races-body">
        <TileMap byState={byState} selected={state} onPick={pick} />
        <RaceList
          key={state || 'all'}
          outside={outside.data}
          races={all}
          byState={byState}
          state={state}
          cycle={races.data.cycle}
          onClearState={() => setState(null)}
        />
        <Sources sources={races.data.sources} />
      </div>
    </>
  );
}
