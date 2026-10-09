import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import Lookup from '../components/Lookup.jsx';
import Receipt from '../components/Receipt.jsx';
import { Stamp } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { ELECTION_DAY_TEXT, RACES_ARRIVE_TEXT } from '../lib/election.js';
import { GRADES, LETTERS } from '../lib/grades.js';
import { useAsync, useTitle } from '../lib/hooks.js';
import { displayName, fractionWords, memberPerson, seatLabel } from '../lib/people.js';
import { repsFor, savePlace, savedPlace } from '../lib/place.js';
import { Link, memberPath } from '../lib/router.js';
import { DELEGATE_ONLY, stateByCode } from '../lib/states.js';

function placeLabel(place) {
  const name = stateByCode[place.state]?.name || place.state;
  if (place.district === null) {
    return name;
  }
  if (DELEGATE_ONLY.has(place.state)) {
    return `${name} · Delegate`;
  }
  return place.district ? `${name} · House district ${place.district}` : `${name} · One House seat`;
}

// `arrived`: the visitor just looked themselves up, so take them to their
// receipts; a remembered place on a return visit leaves the page where it is
function YourReps({ members, place, onChange, arrived }) {
  const headingRef = useRef(null);
  const { senators, house } = repsFor(members, place);
  const shown = place.district === null ? senators : [...house, ...senators];
  const details = useAsync(
    () =>
      Promise.allSettled(shown.map(m => api.memberDetail(m.bioguideId))).then(rs =>
        Object.fromEntries(shown.map((m, i) => [m.bioguideId, rs[i].value]))
      ),
    [shown.map(m => m.bioguideId).join()]
  );

  useEffect(() => {
    if (!arrived) {
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [arrived, place.state, place.district]);

  const title =
    place.district === null
      ? 'Your senators'
      : DELEGATE_ONLY.has(place.state)
        ? 'Your delegate'
        : 'Your representatives';
  const intro = DELEGATE_ONLY.has(place.state)
    ? 'Your delegate to the House. The grade is based only on where their campaign money comes from, and has nothing to do with how they vote.'
    : place.district === null
      ? 'To see your member of the House as well, look up your ZIP code above.'
      : 'Your member of the House and your two senators. Each grade is based only on where their campaign money comes from, and has nothing to do with how they vote.';

  return (
    <section id="reps" className="section" aria-labelledby="reps-title">
      <div className="wrap">
        <div className="section-head">
          <div>
            <p className="eyebrow" style={{ marginBottom: 10 }}>
              {placeLabel(place)} ·{' '}
              <button
                type="button"
                className="link-button"
                style={{
                  padding: 0,
                  fontFamily: 'inherit',
                  fontSize: 'inherit',
                  letterSpacing: 'inherit',
                }}
                onClick={onChange}
              >
                CHANGE
              </button>
            </p>
            <h2 id="reps-title" className="display display-l" tabIndex={-1} ref={headingRef}>
              {title}
            </h2>
          </div>
          <p>{intro}</p>
        </div>
        <div className="reps-grid">
          {place.district !== null && house.length === 0 && (
            <div className="receipt">
              <p className="eyebrow">House</p>
              <p className="receipt-name">This seat is vacant</p>
              <p className="small muted">
                Nobody holds this House seat right now. We&apos;ll grade the next member once
                they&apos;re sworn in.
              </p>
            </div>
          )}
          {shown.map((m, i) => (
            <Receipt
              key={m.bioguideId}
              person={memberPerson(m, details.data?.[m.bioguideId])}
              delay={i * 0.12}
            />
          ))}
        </div>
        {place.district === null && house.length > 0 && (
          <div className="panel" style={{ marginTop: 24 }}>
            <h3>Members of the House from {stateByCode[place.state]?.name}</h3>
            <ul className="ranked" style={{ fontFamily: 'var(--body)', fontSize: 16 }}>
              {house
                .sort((a, b) => Number(a.district) - Number(b.district))
                .map(m => (
                  <li key={m.bioguideId}>
                    <Link to={memberPath(m.bioguideId)}>{displayName(m.name)}</Link>
                    <span className="leader" aria-hidden="true" />
                    <span className="mono small">
                      {seatLabel(m).split(' · ')[1]} · {m.tier}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function CongressDots({ members }) {
  const graded = members.filter(m => LETTERS.includes(m.tier));
  const counts = Object.fromEntries(LETTERS.map(l => [l, graded.filter(m => m.tier === l).length]));
  const low = counts.D + counts.E + counts.F;
  const words = fractionWords(low / graded.length);
  const unchecked = members.length - graded.length;
  return (
    <section
      id="congress"
      className="section"
      aria-labelledby="dots-title"
      style={{ paddingTop: 0 }}
    >
      <div className="wrap">
        <div className="dots-card">
          <div className="section-head">
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <p className="eyebrow" style={{ marginBottom: 10 }}>
                All of Congress · one dot for each member
              </p>
              <h2 id="dots-title" className="display display-l">
                {words
                  ? `${words} get a D or worse`
                  : `${low} of ${graded.length} get a D or worse`}
              </h2>
            </div>
            <p style={{ flex: '1 1 320px' }}>
              {low} of the {graded.length} members we&apos;ve graded rely mostly on PACs or on a few
              wealthy donors. Only {counts.S} are funded mainly by ordinary people.
              {unchecked > 0 &&
                ` ${unchecked} more aren't graded yet while we confirm their records.`}{' '}
              Click a grade to see who&apos;s in it. <Link to="/how#pacs">What&apos;s a PAC?</Link>
            </p>
          </div>
          <div className="dots">
            {LETTERS.map(l => (
              <Link
                key={l}
                to={`/congress?grade=${l}`}
                className="dots-col"
                style={{ '--g': GRADES[l].color }}
                aria-label={`${counts[l]} members graded ${l}, ${GRADES[l].name}`}
              >
                <span className="dot-grid" aria-hidden="true">
                  {Array.from({ length: counts[l] }, (_, i) => (
                    <span key={i} />
                  ))}
                </span>
                <span className="dots-key" aria-hidden="true">
                  <b>{l}</b>
                  <span className="mono" style={{ fontWeight: 600 }}>
                    {counts[l]}
                  </span>
                </span>
                <span className="small muted" aria-hidden="true">
                  {GRADES[l].name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function HowSteps() {
  return (
    <div className="steps">
      <div className="step">
        <p className="step-num">01</p>
        <h3>We add up their money</h3>
        <p>
          We count everything raised in the member&apos;s name, including their campaign, their
          leadership PAC and any joint fundraising committees. Donations from individuals count in
          their favor, whether the check is for $5 or $5,000. Money from PACs doesn&apos;t.
        </p>
      </div>
      <div className="step">
        <p className="step-num">02</p>
        <h3>We check how many people gave it</h3>
        <p>
          Large donations don&apos;t hurt a grade when thousands of different people make them. If
          half of the large-donation money comes from a few dozen people, part of it stops counting
          and the grade goes down.
        </p>
      </div>
      <div className="step">
        <p className="step-num">03</p>
        <h3>We check every donation</h3>
        <p>
          We grade from the FEC&apos;s bulk data files first, then check each donation against the
          FEC&apos;s own records. Until that&apos;s finished, the member&apos;s page says the grade
          is still being checked.
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  useTitle(null);
  const members = useAsync(() => api.members(), []);
  const races = useAsync(() => api.races().catch(() => null), []);
  const [place, setPlace] = useState(savedPlace);
  const [arrived, setArrived] = useState(false);
  const list = members.data?.members || [];

  const found = p => {
    savePlace(p);
    setPlace(p);
    setArrived(true);
  };
  const change = () => {
    savePlace(null);
    setPlace(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => document.getElementById('home-zip')?.focus(), 300);
  };

  return (
    <>
      <section className="hero dark on-dark" aria-labelledby="hero-title">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <p className="eyebrow" style={{ marginBottom: 20, fontSize: 14 }}>
              2026 election
              {list.length
                ? ` · ${list.filter(m => LETTERS.includes(m.tier)).length} members graded`
                : ''}
            </p>
            <h1 id="hero-title" className="display display-xl">
              Who&apos;s paying your representatives?
            </h1>
            <p className="lede">
              We grade every member of Congress on where their campaign money comes from. Members
              funded by lots of ordinary donors get high grades. Members who rely on PACs or a small
              group of wealthy donors get low grades. All the figures come from public FEC filings.
            </p>
          </div>
          <div className="hero-stamps" aria-hidden="true">
            <div className="stamp-cluster">
              <div style={{ position: 'absolute', right: '45%', top: '3%' }}>
                <Stamp tier="S" size="var(--s-big)" rot={-12} dark animate delay={0.2} />
              </div>
              <div style={{ position: 'absolute', right: '6%', top: '23%' }}>
                <Stamp tier="C" size="var(--s-small)" rot={9} dark animate delay={0.45} />
              </div>
              <div style={{ position: 'absolute', right: '33%', top: '50%' }}>
                <Stamp tier="F" size="var(--s-small)" rot={-4} dark animate delay={0.7} />
              </div>
            </div>
          </div>
          <div className="hero-lookup">
            <Lookup onFound={found} idPrefix="home" />
          </div>
        </div>
      </section>

      {members.error && (
        <div className="wrap section-tight">
          <p className="notice notice-warn">
            <strong>We couldn&apos;t load the grades just now.</strong> Check your connection and
            reload the page.
          </p>
        </div>
      )}

      {place && list.length > 0 && (
        <YourReps members={list} place={place} onChange={change} arrived={arrived} />
      )}

      {list.length > 0 && (
        <div style={place ? undefined : { paddingTop: 'clamp(48px, 7vw, 80px)' }}>
          <CongressDots members={list} />
        </div>
      )}

      <section className="section" aria-labelledby="how-title" style={{ paddingTop: 24 }}>
        <div className="wrap">
          <h2 id="how-title" className="display display-l" style={{ marginBottom: 28 }}>
            How we grade
          </h2>
          <HowSteps />
          <p style={{ marginTop: 24 }}>
            <Link to="/how">Read the full method</Link>
          </p>
        </div>
      </section>

      <section className="cta band on-dark" aria-labelledby="ballot-title">
        <div className="wrap">
          <div style={{ flex: '1 1 520px', minWidth: 0 }}>
            <p className="eyebrow" style={{ marginBottom: 12, fontSize: 14 }}>
              Election day is {ELECTION_DAY_TEXT}
            </p>
            <h2
              id="ballot-title"
              className="display display-l"
              style={{ fontSize: 'clamp(40px, 6vw, 80px)' }}
            >
              The candidates on your ballot
            </h2>
            <p className="lede" style={{ marginTop: 18 }}>
              {races.data
                ? 'We grade everyone running for Congress the same way we grade current members. See who is paying each candidate in your district and state.'
                : `Candidates for Congress file their last campaign finance reports before the election on October 22. We'll grade every candidate by ${RACES_ARRIVE_TEXT}, using the same method we use for current members.`}
            </p>
          </div>
          {races.data ? (
            <Link to="/ballot" className="btn btn-big btn-light">
              See my ballot <ArrowRight size={22} aria-hidden="true" />
            </Link>
          ) : (
            <p className="btn btn-big btn-outline" style={{ cursor: 'default' }}>
              Available {RACES_ARRIVE_TEXT}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
