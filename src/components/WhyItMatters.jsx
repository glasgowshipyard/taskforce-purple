// "Why this matters" on the home page (owner's mockup, 2026-10-17): what
// research says about who pays for Congress, every claim linked to its
// source (lib/research.js), in plain words for anyone (owner: "a plain
// English thesis, not a paper"). The chart is Gilens and Page's finding,
// drawn from the figures the study gives, in the owner's mockup's words;
// the gap where the wealthy get their way is filled with the graphs'
// people-to-influence gradient.
import React from 'react';
import { GRAPH_GRADIENT } from '../lib/grades.js';
import { FINDINGS, LEAD, STUDIES, WISHES, withSources } from '../lib/research.js';

function Note({ n }) {
  return (
    <sup className="note">
      <a href={`#study-${n}`} aria-label={`Source ${n}`}>
        {n}
      </a>
    </sup>
  );
}

/** Text with its source marks */
function Sourced({ text }) {
  return withSources(text).map((p, i) =>
    p.source ? <Note key={i} n={p.source} /> : <React.Fragment key={i}>{p.text}</React.Fragment>
  );
}

// The chart's frame: 0% at the base, 50% at the top
const X = { few: 70, most: 300 };
const BASE = 180;
const y = v => BASE - v * 2.8;

function WishesChart() {
  const { average: avg, richest: rich } = WISHES;
  // Where the wealthy's line crosses the middle class's: from there on, the
  // wealthy get their way more often
  const t = (avg.few - rich.few) / (rich.most - rich.few - (avg.most - avg.few));
  const cross = X.few + t * (X.most - X.few);
  const study = STUDIES[0];
  return (
    <figure className="wishes">
      <figcaption>
        <h3>How wealth influences policy</h3>
        <p className="small muted">
          The chance a proposed policy becomes law, depending on who wants it
        </p>
      </figcaption>
      <svg
        viewBox="0 0 360 212"
        role="img"
        aria-label={`When the middle class wanted a policy, it had about a ${avg.few}% chance of becoming law, whether few or most of them wanted it. When the wealthy wanted it, the chance rose from about ${rich.few}% to ${rich.most}%.`}
      >
        <defs>
          <linearGradient id="wishes-gap" gradientUnits="userSpaceOnUse" x1={cross} x2={X.most}>
            {GRAPH_GRADIENT.map((c, i) => (
              <stop key={c} offset={i / (GRAPH_GRADIENT.length - 1)} stopColor={c} />
            ))}
          </linearGradient>
        </defs>
        <line x1={X.few - 6} x2={X.most + 6} y1={BASE} y2={BASE} className="wishes-base" />
        <polygon
          points={`${cross},${y(avg.few)} ${X.most},${y(rich.most)} ${X.most},${y(avg.most)}`}
          fill="url(#wishes-gap)"
          className="wishes-gap"
        />
        <line
          x1={X.few}
          x2={X.most}
          y1={y(avg.few)}
          y2={y(avg.most)}
          className="wishes-line is-average"
        />
        <line
          x1={X.few}
          x2={X.most}
          y1={y(rich.few)}
          y2={y(rich.most)}
          className="wishes-line is-richest"
        />
        {[
          [X.few, y(avg.few), 'is-average'],
          [X.most, y(avg.most), 'is-average'],
          [X.few, y(rich.few), 'is-richest'],
          [X.most, y(rich.most), 'is-richest'],
        ].map(([cx, cy, kind]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={5} className={`wishes-dot ${kind}`} />
        ))}
        <text x={X.few - 12} y={BASE + 4} textAnchor="end" className="wishes-axis">
          0%
        </text>
        <text x={X.few - 12} y={y(avg.few) + 5} textAnchor="end" className="wishes-value">
          {avg.few}%
        </text>
        <text x={X.few - 12} y={y(rich.few) + 5} textAnchor="end" className="wishes-value">
          {rich.few}%
        </text>
        <text x={X.most + 6} y={y(rich.most) - 14} textAnchor="end" className="wishes-label">
          Wealthy <tspan className="wishes-value">{rich.most}%</tspan> chance
        </text>
        <text x={X.most + 6} y={y(avg.most) + 24} textAnchor="end" className="wishes-label">
          Middle class <tspan className="wishes-value">{avg.most}%</tspan> chance
        </text>
        <text x={X.few} y={BASE + 22} textAnchor="middle" className="wishes-axis">
          Few want it
        </text>
        <text x={X.most} y={BASE + 22} textAnchor="middle" className="wishes-axis">
          Most want it
        </text>
      </svg>
      <p className="small muted">
        Source: <a href={study.url}>{study.cite}</a>
        <Note n={study.n} />
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
        <h2 id="matters-title" className="display display-l">
          Why this matters to all of us
        </h2>
        <p className="lede matters-lead">
          <Sourced text={LEAD} />
        </p>
        <div className="matters-grid">
          <WishesChart />
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
          </div>
        </div>
        <div className="studies">
          <h3 className="eyebrow">Don&apos;t take our word for it</h3>
          <ol>
            {STUDIES.map(s => (
              <li key={s.n} id={`study-${s.n}`}>
                {s.cite}, <a href={s.url}>{s.title}</a>. {s.detail}
                {s.note && (
                  <>
                    {' '}
                    <a href={s.note.url}>{s.note.text}</a>
                  </>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
