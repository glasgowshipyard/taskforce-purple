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
  count,
  displayName,
  gradedFigures,
  partyName,
  raceSeat,
  stateName,
  usd,
} from '../lib/people.js';
import { racesFor, savePlace, savedPlace } from '../lib/place.js';
import { Link, memberPath, racePath } from '../lib/router.js';

const SHOWN = 4;
const NUMBER_WORDS = [
  'No one',
  'One person',
  'Two people',
  'Three people',
  'Four people',
  'Five people',
  'Six people',
];

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
    party: partyName(c.party),
    tier: c.tier,
    figures: graded ? figures : null,
    note: graded ? null : 'Not graded yet: no campaign committee we can grade for this election.',
    evidenceChecked: c.evidenceChecked,
    nakamotoCoefficient: c.nakamoto,
    uniqueDonors: c.uniqueDonors ?? null,
    href: c.bioguideId
      ? memberPath(c.bioguideId)
      : `/candidate/${encodeURIComponent(c.candidateId)}`,
  };
}

function pctOf(part, whole) {
  return Number.isFinite(part) && whole > 0 ? Math.round((part / whole) * 100) : null;
}

// One plain sentence: who raised most, and who leans most on small donors
function shortVersion(cands) {
  const graded = cands.filter(c => c.tier && c.totalRaised > 0);
  if (graded.length < 2) {
    return null;
  }
  const most = [...graded].sort((a, b) => b.totalRaised - a.totalRaised)[0];
  const small = [...graded].sort(
    (a, b) => b.smallDonors / b.totalRaised - a.smallDonors / a.totalRaised
  )[0];
  const name = c => displayName(c.name);
  const first = `${name(most)} raised the most: ${usd(most.totalRaised)}.`;
  if (small === most) {
    return `${first} ${name(most)} also took the biggest share from small donors: ${pctOf(most.smallDonors, most.totalRaised)} cents of every dollar.`;
  }
  return `${first} ${name(small)} raised more of it from small donors: ${pctOf(small.smallDonors, small.totalRaised)} cents of every dollar, against ${pctOf(most.smallDonors, most.totalRaised)} for ${name(most)}.`;
}

function CompareTable({ cands }) {
  const rows = [
    { label: 'Grade', value: c => gradeInfo(c.tier).mark, score: c => GRADES[c.tier]?.rank ?? -1 },
    { label: 'Total raised', value: c => usd(c.totalRaised) },
    {
      label: 'From small donors',
      value: c =>
        (pctOf(c.smallDonors, c.totalRaised) ?? '—') +
        (pctOf(c.smallDonors, c.totalRaised) === null ? '' : '%'),
      score: c => (c.tier ? c.smallDonors / c.totalRaised : -1),
    },
    {
      label: 'From PACs',
      value: c => (Number.isFinite(c.pac) ? usd(c.pac) : '—'),
      score: c => (c.tier && Number.isFinite(c.pac) ? -c.pac / c.totalRaised : -Infinity),
    },
    {
      label: 'People who gave half the big money',
      value: c => (c.nakamoto > 0 ? count(c.nakamoto) : '—'),
      score: c => (c.nakamoto > 0 ? c.nakamoto : -1),
    },
  ];
  return (
    <div className="scroll-x">
      <table className="compare">
        <caption className="eyebrow">Side by side · 2025–26 election cycle</caption>
        <thead>
          <tr>
            <td />
            {cands.map(c => (
              <th key={c.candidateId} scope="col">
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
                    key={c.candidateId}
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
              Your ballot · {raceSeat(race)}
            </p>
            <h1
              id="race-title"
              className="display display-xl"
              style={{ fontSize: 'clamp(48px, 7.4vw, 104px)' }}
            >
              {(NUMBER_WORDS[cands.length] || `${cands.length} people`) + ' want this seat.'}{' '}
              Here&apos;s who pays them.
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
              key={c.candidateId}
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
                <li key={c.candidateId}>
                  <Link to={candidatePerson(c).href}>{displayName(c.name)}</Link>
                  <span className="muted small"> · {partyName(c.party)}</span>
                  <span className="leader" aria-hidden="true" />
                  <span className="mono small">
                    {usd(c.totalRaised)} · {c.tier || 'not graded'}
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
                The short version
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
                Bold marks the more people-funded figure in each row. We grade money, not positions.
                {notInCongress &&
                  " Grades for people not in Congress come from the FEC's bulk files and are double-checked record by record afterwards."}
                {race.office === 'H' &&
                  ' Some states drew new district lines for this election. If yours did, your House race may have a different number: check at vote.gov.'}
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
                              key={c.candidateId}
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
                You know who pays them. Now go vote.
              </p>
              <div className="row" style={{ marginTop: 20 }}>
                <a href="https://vote.gov" className="btn btn-light">
                  Check you&apos;re registered
                </a>
              </div>
              <p className="small" style={{ marginTop: 14, color: 'var(--on-dark-2)' }}>
                vote.gov is the US government&apos;s official voter site.
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
            Your ballot · Election day {ELECTION_DAY_TEXT}
          </p>
          <h1 className="display display-xl" style={{ fontSize: 'clamp(48px, 7.4vw, 104px)' }}>
            Your ballot, side by side. Arriving {RACES_ARRIVE_TEXT}.
          </h1>
          <p className="lede" style={{ marginTop: 22, color: 'var(--on-dark)' }}>
            Everyone running for Congress where you live, graded the same way as the people already
            there. Candidates file their last money reports before the election on October 22; their
            receipts appear here the next day.
          </p>
          <div className="row" style={{ marginTop: 28 }}>
            <Link to="/" className="btn btn-big btn-light">
              See your representatives now
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
        <h1 className="display display-l">We can&apos;t find that race</h1>
        <p className="lede" style={{ marginTop: 16 }}>
          <Link to="/ballot">See the races where you live</Link>.
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
              Your ballot · {ELECTION_DAY_TEXT}
            </p>
            <h1 className="display display-xl" style={{ fontSize: 'clamp(48px, 7.4vw, 104px)' }}>
              {place
                ? `No races for Congress found in ${stateName(place.state)}`
                : 'Where do you vote?'}
            </h1>
            <Lookup
              idPrefix="ballot"
              submitLabel="Show my ballot"
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
