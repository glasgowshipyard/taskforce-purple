// How grades work, in plain English. Must agree with
// GRASSROOTS_CALCULATION_GUIDE.md and workers/tier-calculation.js.
import React from 'react';
import { Stamp } from '../components/ui.jsx';
import { GRADES, LETTERS } from '../lib/grades.js';
import { useTitle } from '../lib/hooks.js';
import { CREDIT_WORDS, PAC_TYPES } from '../lib/pacs.js';
import { HowSteps } from './Home.jsx';

// What the PAC rule does across Congress (#57): F grades under each credit,
// and grades raised by party. From the simulation of 2026-10-09 (refresh
// --report, run 38006203182, version A); update with any change to the rule.
const PAC_RULE_EFFECT = {
  fWithout: 151,
  fQuarter: 105,
  fHalf: 45,
  fAll: 7,
  raisedD: 156,
  ofD: 261,
  raisedR: 133,
  ofR: 273,
  unionToD: 86,
};

const People = () => (
  <svg viewBox="0 0 44 26" aria-hidden="true">
    {[4, 15, 26, 37].map((x, i) => (
      <g key={x} fill="currentColor" opacity={i % 2 ? 0.75 : 1}>
        <circle cx={x + 3.5} cy="7" r="4" />
        <path d={`M${x - 2} 25 a5.5 6.5 0 0 1 11 0z`} />
      </g>
    ))}
  </svg>
);

const Box = () => (
  <svg viewBox="0 0 44 26" aria-hidden="true">
    <rect
      x="11"
      y="4"
      width="22"
      height="18"
      rx="3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    />
    <path d="M17 13h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const Person = () => (
  <svg viewBox="0 0 44 26" aria-hidden="true">
    <g fill="currentColor">
      <circle cx="22" cy="7" r="5" />
      <path d="M14 26 a8 8.5 0 0 1 16 0z" />
    </g>
  </svg>
);

function Flow({ steps }) {
  return (
    <div className="flow-row">
      {steps.map((st, i) => (
        <React.Fragment key={st.title}>
          {i > 0 && (
            <span className="flow-arrow" aria-hidden="true">
              →
            </span>
          )}
          <div className={`flow-node is-${st.kind}${st.checked ? ' is-checked' : ''}`}>
            {st.kind === 'people' ? <People /> : st.kind === 'member' ? <Person /> : <Box />}
            <b>{st.title}</b>
            <span>{st.text}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

// A $1,000 gift split into what counts, what traces to people but isn't
// counted, and what can't be traced
function MoneyBar({ counted, traced, label }) {
  const untraced = 1000 - counted - traced;
  const parts = [
    ['is-counted', counted, 'var(--small)', `Counts toward the grade: $${counted}`],
    ['is-traced', traced, 'var(--big)', `Traces back to people, not counted: $${traced}`],
    ['is-untraced', untraced, 'var(--line-2)', `Can't be traced back to people: $${untraced}`],
  ].filter(p => p[1] > 0);
  return (
    <>
      <div
        className="flow-bar"
        role="img"
        aria-label={`${label}: ${parts.map(p => p[3]).join(', ')}`}
      >
        {parts.map(([cls, v]) => (
          <span key={cls} className={cls} style={{ width: `${v / 10}%` }} />
        ))}
      </div>
      <ul className="flow-key">
        {parts.map(([cls, , color, text]) => (
          <li key={cls}>
            <span className="swatch" style={{ '--c': color }} aria-hidden="true" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function PacRule() {
  const e = PAC_RULE_EFFECT;
  return (
    <>
      <h3 className="display" style={{ fontSize: 28, margin: '36px 0 12px' }}>
        How PAC money counts
      </h3>
      <p style={{ maxWidth: '44em', color: 'var(--ink-2)', marginBottom: 20 }}>
        A PAC isn&apos;t good or bad by itself. What matters is who gave it the money. So we look
        through each PAC to the people who funded it, and check them the same way we check a
        member&apos;s own donors.
      </p>
      <div className="flow-figs">
        <figure className="flow">
          <h3>Looking through a PAC</h3>
          <Flow
            steps={[
              { kind: 'people', title: 'People', text: 'give to a PAC', checked: true },
              { kind: 'pac', title: 'The PAC', text: 'pools the money' },
              { kind: 'member', title: 'The member', text: 'gets $1,000' },
            ]}
          />
          <p className="flow-note">
            Say thousands of people gave this PAC its money, so $800 of the $1,000 traces back to
            them. We count {CREDIT_WORDS} of that.
          </p>
          <MoneyBar counted={400} traced={400} label="A PAC funded by many people" />
        </figure>
        <figure className="flow">
          <h3>One level deeper</h3>
          <Flow
            steps={[
              { kind: 'people', title: 'People', text: 'give to a committee', checked: true },
              { kind: 'pac', title: 'Committee', text: 'gives to a PAC' },
              { kind: 'pac', title: 'The PAC', text: 'passes it on' },
              { kind: 'member', title: 'The member', text: 'gets $1,000' },
            ]}
          />
          <p className="flow-note">
            Some PACs get most of their money from other committees, not from people. Looking only
            at this PAC, $200 of the $1,000 traces back to people. Looking one step further back, at
            who gave the committee its money, $600 does. We count {CREDIT_WORDS} of that. Anything
            we still can&apos;t trace back to people doesn&apos;t count.
          </p>
          <MoneyBar counted={300} traced={300} label="A PAC funded through another committee" />
        </figure>
      </div>
      <div className="panels" style={{ marginBottom: 28 }}>
        <div className="panel">
          <h3>Why only {CREDIT_WORDS}?</h3>
          <p style={{ color: 'var(--ink-2)' }}>
            When people give to a PAC, the PAC&apos;s leaders decide which candidates get the money,
            not the people who gave it. So it counts, but less than a donation made straight to the
            member. How much less is a judgement call, so we checked how much it matters.
            {` Counting ${CREDIT_WORDS}, ${e.fHalf} members get an F. Counting a quarter, ${e.fQuarter} would. Counting all of it, ${e.fAll} would. Counting none of it, ${e.fWithout} would.`}
          </p>
        </div>
        <div className="panel">
          <h3>Few big donors count less, here too</h3>
          <p style={{ color: 'var(--ink-2)' }}>
            A PAC funded by a handful of executives gets the same test as a member&apos;s big
            donors. If half its big donations came from a few people, most of them don&apos;t count.
          </p>
        </div>
        <div className="panel">
          <h3>Why this rule affects some members more</h3>
          <p style={{ color: 'var(--ink-2)' }}>
            By law, a company PAC may only ask the company&apos;s managers, shareholders and their
            families for money, while a union PAC can ask all its members. So company PACs tend to
            have fewer, bigger donors, and less of their money passes the test. In our tests this
            rule raised the grades of {e.raisedD} of {e.ofD} Democrats and {e.raisedR} of {e.ofR}{' '}
            Republicans, because {e.unionToD}% of union PAC money goes to Democrats. That comes from
            the law on who PACs may ask, not from anything we chose.
          </p>
        </div>
        <div className="panel">
          <h3>Outside spending isn&apos;t in the grade</h3>
          <p style={{ color: 'var(--ink-2)' }}>
            Super PACs and other groups can spend unlimited money on ads for or against a member.
            That money never goes to the member&apos;s own committees, so it isn&apos;t part of the
            grade.
          </p>
        </div>
      </div>
      <h3 className="display" style={{ fontSize: 28, margin: '8px 0 12px' }}>
        Kinds of PAC
      </h3>
      <p style={{ maxWidth: '44em', color: 'var(--ink-2)', marginBottom: 20 }}>
        We tell PACs apart using the codes the FEC gives every committee. Money from super PACs and
        other politicians&apos; PACs also makes every grade harder to reach: the more of it, the
        higher the line for each grade.
      </p>
    </>
  );
}

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
    text: "We only show a grade worked out from this election's FEC records. If we can't confirm the records we found belong to the member, can't find a campaign committee for them, or our totals don't match the FEC's, we show a ? and no figures. That means there's a problem with the records, not that we found anything about the member.",
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
            A grade is based on how much of a member&apos;s money counts as coming from ordinary
            people, after we&apos;ve checked how many people gave it. The names describe the money,
            not the member. &ldquo;Big money&rdquo; means PACs and small groups of wealthy donors.
            Money from super PACs and other politicians&apos; PACs makes every grade harder to
            reach.
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
                  <span className="count-line">{GRADES[l].range} of every $100 counts</span>
                  <span className="small" style={{ color: 'var(--ink-2)' }}>
                    {GRADES[l].meaning}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="pacs" className="section" style={{ paddingTop: 0 }} aria-labelledby="pacs-title">
        <div className="wrap">
          <h2 id="pacs-title" className="display display-l" style={{ marginBottom: 12 }}>
            What&apos;s a PAC?
          </h2>
          <p style={{ maxWidth: '44em', color: 'var(--ink-2)', marginBottom: 12 }}>
            A PAC (political action committee) pools money and gives it to candidates. Some are run
            by companies, unions or trade groups, some by causes, and some by other politicians.
          </p>
          <PacRule />
          <ul
            className="member-rows"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}
          >
            {Object.entries(PAC_TYPES).map(([key, t]) => (
              <li key={key} className="member-row" style={{ alignItems: 'flex-start' }}>
                <span className="member-row-body">
                  <span className="member-row-name">{t.label}</span>
                  <span className="small" style={{ color: 'var(--ink-2)' }}>
                    {t.why}
                  </span>
                  {t.heavier && (
                    <span className="pac-chip is-heavier" style={{ alignSelf: 'flex-start' }}>
                      Counts more against the grade
                    </span>
                  )}
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
