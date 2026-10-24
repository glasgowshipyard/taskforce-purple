// Your ballot: everyone running for Congress where you live, side by side.
// Live once November's field is published (the races job, October 23).
import React, { useState } from 'react';
import Lookup from '../components/Lookup.jsx';
import Receipt from '../components/Receipt.jsx';
import { Skeleton, Stamp } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { ELECTION_DAY_TEXT, RACES_ARRIVE_TEXT, daysUntilElection } from '../lib/election.js';
import { GRADES, gradeInfo } from '../lib/grades.js';
import { useAsync, useTitle } from '../lib/hooks.js';
import {
  ballotPartyName,
  displayName,
  gradedFigures,
  raceSeat,
  stateName,
  usd,
} from '../lib/people.js';
import { racesFor, savePlace, savedPlace } from '../lib/place.js';
import { Link, memberPath, racePath } from '../lib/router.js';

const SHOWN = 4;

// A candidate on the ballot who never registered with the FEC has no ID
const candidateKey = c => c.candidateId || `${c.office}-${c.state}-${c.district}-${c.name}`;

function candidatePerson(c) {
  const graded = Boolean(c.tier);
  const figures = gradedFigures({
    totalRaised: c.totalRaised,
    grassrootsDonations: c.smallDonors,
    largeDonorDonations: c.largeDonors,
    pacMoney: c.pac,
  });
  return {
    id: c.candidateId,
    name: displayName(c.name),
    seat: c.ici === 'I' ? 'In office' : c.ici === 'O' ? 'Open seat' : 'Challenger',
    party: ballotPartyName(c),
    tier: c.tier,
    figures: graded ? figures : null,
    note: graded
      ? null
      : c.registered === false
        ? "Not registered with the FEC. Candidates don't have to register until they raise or spend $5,000, so there's nothing to grade."
        : c.totalRaised > 0
          ? 'Not graded yet. No campaign committee for this election has been found to grade.'
          : 'Not graded. No campaign money for this election has been reported to the FEC yet.',
    evidenceChecked: c.evidenceChecked,
    ppi: c.peoplePowerInfluence ?? null,
    href: c.bioguideId
      ? memberPath(c.bioguideId)
      : c.candidateId
        ? `/candidate/${encodeURIComponent(c.candidateId)}`
        : null,
  };
}

// The one figure for "from people": People, the grade's share
const fromPeople = c =>
  Number.isFinite(c.peoplePowerInfluence?.people) ? c.peoplePowerInfluence.people : null;

// One plain sentence: who raised most, and who gets the most from people
function shortVersion(cands) {
  const graded = cands.filter(c => c.tier && c.totalRaised > 0 && fromPeople(c) !== null);
  if (graded.length < 2) {
    return null;
  }
  const most = [...graded].sort((a, b) => b.totalRaised - a.totalRaised)[0];
  const people = [...graded].sort((a, b) => fromPeople(b) - fromPeople(a))[0];
  const name = c => displayName(c.name);
  const first = `${name(most)} has raised the most, ${usd(most.totalRaised)}.`;
  if (people === most) {
    return `${first} ${name(most)} also gets the most from people: ${fromPeople(most)}% of their money.`;
  }
  return `${first} ${name(people)} gets the most from people: ${fromPeople(people)}% of their money, compared with ${fromPeople(most)}% for ${name(most)}.`;
}

function CompareTable({ cands }) {
  const rows = [
    { label: 'Grade', value: c => gradeInfo(c.tier).mark, score: c => GRADES[c.tier]?.rank ?? -1 },
    { label: 'Total raised', value: c => usd(c.totalRaised) },
    {
      label: 'From people',
      value: c => (fromPeople(c) === null ? '—' : `${fromPeople(c)}%`),
      score: c => (c.tier && fromPeople(c) !== null ? fromPeople(c) : -1),
    },
    {
      label: 'From PACs',
      value: c => (Number.isFinite(c.pac) ? usd(c.pac) : '—'),
      score: c => (c.tier && Number.isFinite(c.pac) ? -c.pac / c.totalRaised : -Infinity),
    },
    {
      label: 'Half the big money came from',
      // As member pages say it, "52 of 343" (owner, 2026-10-17); the
      // best-cell mark still compares the shares
      value: c =>
        c.nakamoto > 0 && c.uniqueDonors > 0
          ? `${c.nakamoto.toLocaleString('en-US')} of ${c.uniqueDonors.toLocaleString('en-US')} big donors`
          : '—',
      score: c => (c.nakamoto > 0 && c.uniqueDonors > 0 ? c.nakamoto / c.uniqueDonors : -1),
    },
  ];
  return (
    <div className="scroll-x">
      <table className="compare">
        <caption className="eyebrow">2025–26 election cycle</caption>
        <thead>
          <tr>
            <td />
            {cands.map(c => (
              <th key={candidateKey(c)} scope="col">
                {displayName(c.name).split(' ').slice(-1)[0]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const best = r.score ? Math.max(...cands.map(r.score)) : null;
            return (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {cands.map(c => (
                  <td
                    key={candidateKey(c)}
                    className={r.score && r.score(c) === best && best > -1 ? 'best' : undefined}
                  >
                    {r.value(c)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RaceView({ race, others }) {
  const days = daysUntilElection();
  const cands = race.candidates;
  const top = cands.slice(0, SHOWN);
  const rest = cands.slice(SHOWN);
  const summary = shortVersion(top);
  const notInCongress = top.some(c => !c.bioguideId && c.tier);
  return (
    <>
      <section className="race-hero band on-dark" aria-labelledby="race-title">
        <div className="wrap">
          <div style={{ flex: '1 1 560px', minWidth: 0 }}>
            <p className="eyebrow" style={{ marginBottom: 14 }}>
              {raceSeat(race)} · {cands.length} {cands.length === 1 ? 'candidate' : 'candidates'}
            </p>
            <h1
              id="race-title"
              className="display display-xl"
              style={{ fontSize: 'clamp(48px, 7.4vw, 104px)' }}
            >
              Who&apos;s paying the candidates?
            </h1>
          </div>
          {days >= 0 && (
            <div className="countdown">
              <b>{days}</b>
              <span>
                {days === 1 ? 'DAY' : 'DAYS'} TO ELECTION DAY
                <br />
                {ELECTION_DAY_TEXT.toUpperCase()}
              </span>
            </div>
          )}
        </div>
      </section>

      <div className="wrap">
        <div className="race-cards">
          {top.map((c, i) => (
            <Receipt
              key={candidateKey(c)}
              person={candidatePerson(c)}
              delay={i * 0.12}
              headingLevel={2}
            />
          ))}
        </div>

        {rest.length > 0 && (
          <div className="panel" style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 18, marginBottom: 10 }}>Also running</h2>
            <ul className="ranked" style={{ fontFamily: 'var(--body)', fontSize: 16 }}>
              {rest.map(c => (
                <li key={candidateKey(c)}>
                  {c.candidateId ? (
                    <Link to={candidatePerson(c).href}>{displayName(c.name)}</Link>
                  ) : (
                    displayName(c.name)
                  )}
                  <span className="muted small"> · {ballotPartyName(c)}</span>
                  <span className="leader" aria-hidden="true" />
                  <span className="mono small">
                    {c.registered === false
                      ? 'not registered with the FEC'
                      : `${usd(c.totalRaised)} · ${c.tier || 'not graded'}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {top.length > 1 && (
          <section className="section-tight" aria-labelledby="short-title">
            <div className="panel" style={{ padding: 'clamp(20px, 3vw, 40px)' }}>
              <h2 id="short-title" className="display display-m">
                How they compare
              </h2>
              {summary && (
                <p
                  className="lede"
                  style={{ margin: '12px 0 24px', color: 'var(--ink-2)', maxWidth: '46em' }}
                >
                  {summary}
                </p>
              )}
              <CompareTable cands={top} />
              <p className="fine" style={{ marginTop: 18 }}>
                In each row, the figure in bold is the most people-funded. Grades are based only on
                where the money comes from.
                {notInCongress &&
                  " Candidates who aren't in Congress are graded from the FEC's bulk data files. Their donations are checked against the FEC's own records afterwards."}
                {race.office === 'H' &&
                  ' Some states redrew their congressional districts for this election. If yours did, your district number may be different. You can check at vote.gov.'}
              </p>
            </div>
          </section>
        )}

        <section className="section-tight" style={{ paddingBottom: 'clamp(48px, 7vw, 80px)' }}>
          <div className="panels">
            {others.length > 0 && (
              <div>
                <h2 className="display display-m" style={{ marginBottom: 14 }}>
                  Also on your ballot
                </h2>
                <ul className="race-list">
                  {others.map(r => (
                    <li key={r.key}>
                      <Link to={racePath(r.key)} className="race-link">
                        <span>
                          <span className="eyebrow" style={{ display: 'block', fontSize: 12 }}>
                            {raceSeat(r)}
                          </span>
                          <span
                            style={{
                              display: 'block',
                              marginTop: 4,
                              fontWeight: 700,
                              fontSize: 18,
                            }}
                          >
                            {r.candidates
                              .slice(0, 2)
                              .map(c => displayName(c.name))
                              .join(' vs. ')}
                            {r.candidates.length > 2 ? ` and ${r.candidates.length - 2} more` : ''}
                          </span>
                        </span>
                        <span className="mini-stamps" aria-hidden="true">
                          {r.candidates.slice(0, 2).map(c => (
                            <Stamp
                              key={candidateKey(c)}
                              tier={c.tier}
                              size={44}
                              word={false}
                              rot={0}
                            />
                          ))}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="headline dark on-dark">
              <p className="display" style={{ fontSize: 36, lineHeight: 0.95 }}>
                Make sure you&apos;re registered to vote
              </p>
              <div className="row" style={{ marginTop: 20 }}>
                <a href="https://vote.gov" className="btn btn-light">
                  Check at vote.gov
                </a>
              </div>
              <p className="small" style={{ marginTop: 14, color: 'var(--on-dark-2)' }}>
                vote.gov is run by the federal government and links to your state&apos;s
                registration page.
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function NotYet() {
  useTitle('Your ballot');
  const days = daysUntilElection();
  return (
    <section className="race-hero band on-dark" style={{ paddingBottom: 'clamp(56px, 8vw, 96px)' }}>
      <div className="wrap">
        <div style={{ flex: '1 1 560px', minWidth: 0 }}>
          <p className="eyebrow" style={{ marginBottom: 14 }}>
            Election day is {ELECTION_DAY_TEXT}
          </p>
          <h1 className="display display-xl" style={{ fontSize: 'clamp(48px, 7.4vw, 104px)' }}>
            Candidate grades arrive {RACES_ARRIVE_TEXT}
          </h1>
          <p className="lede" style={{ marginTop: 22, color: 'var(--on-dark)' }}>
            Candidates for Congress file their last campaign finance reports before the election on
            October 22. Every candidate will be graded the next day, the same way as current
            members, and you&apos;ll be able to compare the candidates in your district and state.
          </p>
          <div className="row" style={{ marginTop: 28 }}>
            <Link to="/" className="btn btn-big btn-light">
              See your current representatives
            </Link>
          </div>
        </div>
        {days >= 0 && (
          <div className="countdown">
            <b>{days}</b>
            <span>
              DAYS TO ELECTION DAY
              <br />
              {ELECTION_DAY_TEXT.toUpperCase()}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

/** /ballot (your races) and /race/:key (any race) */
export default function Ballot({ raceKey }) {
  const races = useAsync(() => api.races(), []);
  const [place, setPlace] = useState(savedPlace);
  const all = races.data?.races || [];
  const race = raceKey ? all.find(r => r.key === raceKey) : null;
  const mine = place ? racesFor(all, place) : [];
  const shown = race || mine[0] || null;
  useTitle(shown ? raceSeat(shown) : 'Your ballot');

  if (races.loading) {
    return (
      <div className="wrap section">
        <Skeleton height={80} width="70%" />
        <Skeleton height={420} style={{ marginTop: 32 }} />
      </div>
    );
  }
  if (!races.data) {
    return <NotYet />;
  }
  if (raceKey && !race) {
    return (
      <div className="wrap section">
        <h1 className="display display-l">That race isn&apos;t here</h1>
        <p className="lede" style={{ marginTop: 16 }}>
          The link may be out of date. <Link to="/ballot">See the races where you live</Link>.
        </p>
      </div>
    );
  }
  if (!shown) {
    return (
      <section className="hero dark on-dark">
        <div className="wrap">
          <div className="hero-copy">
            <p className="eyebrow" style={{ marginBottom: 20 }}>
              Election day is {ELECTION_DAY_TEXT}
            </p>
            <h1 className="display display-xl" style={{ fontSize: 'clamp(48px, 7.4vw, 104px)' }}>
              {place
                ? `No races for Congress found in ${stateName(place.state)}`
                : 'Where are you registered to vote?'}
            </h1>
            <Lookup
              idPrefix="ballot"
              submitLabel="Find my ballot"
              onFound={p => {
                savePlace(p);
                setPlace(p);
              }}
            />
          </div>
        </div>
      </section>
    );
  }
  const others = (place ? mine : all.filter(r => r.state === shown.state)).filter(
    r => r.key !== shown.key
  );
  return <RaceView race={shown} others={others} />;
}
