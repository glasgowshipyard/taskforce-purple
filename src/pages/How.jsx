// How grades work, in plain English. Must agree with
// GRASSROOTS_CALCULATION_GUIDE.md and workers/tier-calculation.js.
import React from 'react';
import { Stamp } from '../components/ui.jsx';
import { GRADES, LETTERS } from '../lib/grades.js';
import { useTitle } from '../lib/hooks.js';
import { HowSteps } from './Home.jsx';

const PANELS = [
  {
    title: 'Which committees we count',
    text: "We count every committee raising money for a member, not just their campaign. That includes their leadership PAC, which politicians use to give money to each other, and joint fundraising committees, which let a donor write one large check that's split among several committees. Money moved between a member's own committees is only counted once.",
  },
  {
    title: 'Large donations',
    text: 'A $2,000 donation from a supporter still counts as support from a person. What matters is how many different people give large amounts. If half of the large-donor money comes from a few dozen people, the amount above a set allowance stops counting. A member with thousands of large donors gets a bigger allowance than one with a handful.',
  },
  {
    title: 'What "still being checked" means',
    text: "We grade each member from the FEC's bulk data files first. Those files contain over 99% of the records. We then check every donation against the FEC's own records. Most grades don't change. If one does, we keep a record of the change.",
  },
  {
    title: "When we don't show a grade",
    text: "If we can't confirm that the campaign records we found belong to the member, or our totals don't match the FEC's, we don't show a grade or any figures. That means there's a problem with our records, not that we found anything about the member.",
  },
  {
    title: 'Where the data comes from',
    text: "Campaign finance filings from the Federal Election Commission (fec.gov), the list of members from Congress.gov, and the Justice Department's register of foreign agents. We update grades after each FEC filing deadline. Each committee on a member's page links to its filings.",
  },
  {
    title: "What we don't grade",
    text: "We don't look at votes, positions or party, and the same rules apply to every member. The site has no ads and no tracking, and the code is open source.",
  },
];

export default function How() {
  useTitle('How grades work');
  return (
    <>
      <section className="hero dark on-dark" style={{ paddingBottom: 'clamp(48px, 7vw, 72px)' }}>
        <div className="wrap">
          <div className="hero-copy">
            <p className="eyebrow" style={{ marginBottom: 20 }}>
              The method
            </p>
            <h1 className="display display-xl" style={{ fontSize: 'clamp(48px, 7.4vw, 104px)' }}>
              How grades work
            </h1>
            <p className="lede">
              Each grade answers one question: does a member&apos;s campaign money mostly come from
              a large number of ordinary donors, or from PACs and a small group of wealthy ones?
              This page explains how we work that out.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="display display-l" style={{ marginBottom: 28 }}>
            The three steps
          </h2>
          <HowSteps />
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }} aria-labelledby="scale-title">
        <div className="wrap">
          <h2 id="scale-title" className="display display-l" style={{ marginBottom: 12 }}>
            The grades
          </h2>
          <p style={{ maxWidth: '44em', color: 'var(--ink-2)', marginBottom: 28 }}>
            A grade is based on the share of a member&apos;s money that counts as coming from
            ordinary people, after we&apos;ve checked how many people gave it. Money from super
            PACs, leadership PACs and lobbyists&apos; PACs makes every grade harder to reach. The
            more of it a member takes, the higher the share they need.
          </p>
          <ul
            className="member-rows"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}
          >
            {LETTERS.map(l => (
              <li key={l} className="member-row" style={{ alignItems: 'flex-start' }}>
                <Stamp tier={l} size={72} rot={-6} word={false} />
                <span className="member-row-body">
                  <span className="member-row-name">
                    {l}: {GRADES[l].name}
                  </span>
                  <span className="count-line">{GRADES[l].range} people-funded</span>
                  <span className="small" style={{ color: 'var(--ink-2)' }}>
                    {GRADES[l].meaning}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap panels">
          {PANELS.map(p => (
            <div className="panel" key={p.title}>
              <h3>{p.title}</h3>
              <p style={{ color: 'var(--ink-2)' }}>{p.text}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
