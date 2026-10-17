// "Why this matters" on the home page (owner's mockup, 2026-10-17): what
// recent research says about who pays for Congress, every claim linked to
// its source (lib/research.js). The chart is how many Americans say each
// side has too much say, the gap between them filled with the graphs'
// people-to-influence gradient.
import React from 'react';
import { GRAPH_GRADIENT } from '../lib/grades.js';
import { CAVEAT, FINDINGS, SAY, STUDIES, withSources } from '../lib/research.js';

const PEOPLE = GRAPH_GRADIENT[0];
const DONORS = GRAPH_GRADIENT[GRAPH_GRADIENT.length - 1];

function Note({ n }) {
  return (
    <sup className="note">
      <a href={`#study-${n}`} aria-label={`Source ${n}`}>
        {n}
      </a>
    </sup>
  );
}

function SayChart() {
  return (
    <figure className="say">
      <figcaption>
        <h3>Who has too much say over Congress?</h3>
        <p className="small muted">
          The share of Americans who say each has too much influence over what members of Congress
          decide
        </p>
      </figcaption>
      <div
        className="say-plot"
        role="img"
        aria-label={`${SAY.people}% say the people a member represents have too much say. ${SAY.donors}% say people who give a lot to campaigns do.`}
      >
        <div className="say-stats" aria-hidden="true">
          <p style={{ '--c': PEOPLE }}>
            <b>{SAY.people}%</b>
            <span>The people they represent</span>
          </p>
          <p className="is-end" style={{ '--c': DONORS }}>
            <b>{SAY.donors}%</b>
            <span>People who give a lot to campaigns</span>
          </p>
        </div>
        <div className="say-track" aria-hidden="true">
          <span
            className="say-gap"
            style={{
              left: `${SAY.people}%`,
              width: `${SAY.donors - SAY.people}%`,
              background: `linear-gradient(90deg, ${GRAPH_GRADIENT.join(', ')})`,
            }}
          />
          <span className="say-dot" style={{ left: `${SAY.people}%`, '--c': PEOPLE }} />
          <span className="say-dot" style={{ left: `${SAY.donors}%`, '--c': DONORS }} />
        </div>
        <div className="say-scale mono" aria-hidden="true">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
      <p className="small muted">
        Republicans ({SAY.donorsByParty.republicans}%) and Democrats ({SAY.donorsByParty.democrats}
        %) agree about donors. Pew Research Center, {SAY.when}.
        <Note n={1} />
      </p>
    </figure>
  );
}

export default function WhyItMatters() {
  return (
    <section
      className="section why-matters"
      aria-labelledby="matters-title"
      style={{ paddingTop: 0 }}
    >
      <div className="wrap">
        <div className="section-head">
          <div style={{ flex: '1 1 420px', minWidth: 0 }}>
            <p className="eyebrow" style={{ marginBottom: 10 }}>
              Why it matters
            </p>
            <h2 id="matters-title" className="display display-l">
              Why this matters to all of us
            </h2>
          </div>
          <p style={{ flex: '1 1 320px' }}>
            The grades show who pays for Congress. Here&apos;s what recent research says about why
            that matters.
          </p>
        </div>
        <div className="matters-grid">
          <SayChart />
          <div className="matters-findings">
            {FINDINGS.map(f => (
              <div key={f.source} className="finding">
                <h3>
                  {f.head}
                  <Note n={f.source} />
                </h3>
                <p>{f.text}</p>
              </div>
            ))}
            <p className="matters-caveat">
              {withSources(CAVEAT).map((p, i) =>
                p.source ? (
                  <Note key={i} n={p.source} />
                ) : (
                  <React.Fragment key={i}>{p.text}</React.Fragment>
                )
              )}
            </p>
          </div>
        </div>
        <div className="studies">
          <h3 className="eyebrow">Don&apos;t take our word for it</h3>
          <ol>
            {STUDIES.map(s => (
              <li key={s.n} id={`study-${s.n}`}>
                {s.cite}, <a href={s.url}>{s.title}</a>. {s.detail}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
