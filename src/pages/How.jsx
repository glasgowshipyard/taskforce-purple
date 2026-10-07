// How grades work, in plain English. Must agree with
// GRASSROOTS_CALCULATION_GUIDE.md and workers/tier-calculation.js.
import React from 'react';
import { Stamp } from '../components/ui.jsx';
import { GRADES, LETTERS } from '../lib/grades.js';
import { useTitle } from '../lib/hooks.js';
import { HowSteps } from './Home.jsx';

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
              One question: does this person&apos;s money come from lots of regular people, or from
              PACs and a few big donors? Here&apos;s exactly how we answer it.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="display display-l" style={{ marginBottom: 28 }}>
            Three steps
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
            Each grade is the share of someone&apos;s money that counts as coming from regular
            people, after the check on how few donors gave it. Super PAC, leadership PAC and
            lobbyist money raises the bar for every grade: the more of it, the higher the share
            needed.
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
          <div className="panel">
            <h3>Whose money counts</h3>
            <p style={{ color: 'var(--ink-2)' }}>
              The person, not one committee. We add up their campaign, their leadership PAC (the
              fund politicians use to give money to each other) and their joint funds (which let one
              donor write one big check that&apos;s split across several committees). Money moved
              between their own committees is counted once.
            </p>
          </div>
          <div className="panel">
            <h3>Big checks aren&apos;t bad</h3>
            <p style={{ color: 'var(--ink-2)' }}>
              A $2,000 check from a supporter is still a person supporting them. What matters is how
              many people write them. If half the big-check money comes from a few dozen donors, the
              part above a set allowance stops counting. Thousands of donors get a bigger allowance
              than a dinner party.
            </p>
          </div>
          <div className="panel">
            <h3>&ldquo;Being double-checked&rdquo;</h3>
            <p style={{ color: 'var(--ink-2)' }}>
              Every grade starts from the FEC&apos;s bulk download, which holds over 99% of the
              records. Then every donation is checked against the FEC&apos;s own records. Most
              grades don&apos;t move; if one does, the change is kept on record.
            </p>
          </div>
          <div className="panel">
            <h3>When we won&apos;t grade</h3>
            <p style={{ color: 'var(--ink-2)' }}>
              If we can&apos;t confirm the money on file is really theirs, or our figures don&apos;t
              add up against the FEC&apos;s own, we show no grade and no figures. That&apos;s about
              our records, not about them.
            </p>
          </div>
          <div className="panel">
            <h3>Where it comes from</h3>
            <p style={{ color: 'var(--ink-2)' }}>
              Public filings at the Federal Election Commission (fec.gov), the member list from
              Congress.gov, and the Justice Department&apos;s foreign-agent registry. Figures update
              after each FEC filing deadline. Every committee on a receipt links to its filings.
            </p>
          </div>
          <div className="panel">
            <h3>What we don&apos;t do</h3>
            <p style={{ color: 'var(--ink-2)' }}>
              We don&apos;t grade votes, views or parties, and the same rules apply to everyone. No
              ads, no tracking. The code is open source.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
