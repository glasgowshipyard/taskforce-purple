// How grades work, in plain words (owner and Craig, 2026-10-13): the money
// from three sources, the grade scale, real members' graphs as examples (not
// named), and the exact method (FINAL-3, src/lib/spec.js) behind "Show the
// exact math", as written. Must agree with workers/tier-calculation.js
// (gradeFinal3).
import React from 'react';
import MoneyGraph from '../components/MoneyGraph.jsx';
import { api } from '../lib/api.js';
import { LEFT_OUT, peopleSentence } from '../lib/explain.js';
import { GRADES, LETTERS, PARTS } from '../lib/grades.js';
import { useAsync, useTitle } from '../lib/hooks.js';
import { Link } from '../lib/router.js';
import { SPEC } from '../lib/spec.js';
import { peoplePowerInfluence } from '../../workers/tier-calculation.js';

// The spec's own markdown: paragraphs, bullets, **bold** and `code`
function inline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) =>
    p.startsWith('**') ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : p.startsWith('`') ? (
      <code key={i}>{p.slice(1, -1)}</code>
    ) : (
      <React.Fragment key={i}>{p}</React.Fragment>
    )
  );
}

function blocks(md) {
  const out = [];
  let list = null;
  for (const line of md.split('\n')) {
    if (line.startsWith('- ')) {
      list ||= [];
      list.push(line.slice(2));
      continue;
    }
    if (list) {
      out.push({ list });
      list = null;
    }
    if (line.trim()) {
      out.push({ p: line });
    }
  }
  if (list) {
    out.push({ list });
  }
  return out;
}

// What each source covers, a little more fully than the graph's key
const PILES = {
  people: (
    <>
      Donations from many different people. A $5 gift and a $5,000 check are both People money, as
      long as lots of different people gave. So is part of the money from a PAC whose group is run
      by its members, like a union: the part that came from many people.
    </>
  ),
  power: (
    <>
      Big donations, over $200, when only a few donors gave most of them. We find how few donors
      gave half of the big money. The fewer they are, the more of the big money is Power.
    </>
  ),
  influence: (
    <>
      Money from PACs, politicians and parties: PACs of companies and trade groups, PACs of groups
      run by a board, other politicians&apos; PACs and joint fundraising committees, and party
      committees.
    </>
  ),
};

const EXAMPLES = ['S', 'B', 'D', 'F'];

// The middle member of each example grade, as a graph (not named: the
// page explains the method, not anyone in particular)
async function examples() {
  const list = (await api.members()).members || [];
  return Promise.all(
    EXAMPLES.map(async tier => {
      const inTier = list
        .filter(m => m.tier === tier && Number.isFinite(m.individualFundingPercent))
        .sort((a, b) => a.individualFundingPercent - b.individualFundingPercent);
      const m = inTier[Math.floor(inTier.length / 2)];
      if (!m) {
        return null;
      }
      let ppi = m.peoplePowerInfluence;
      if (!ppi) {
        const d = await api.memberDetail(m.bioguideId).catch(() => null);
        ppi = peoplePowerInfluence(d?.grade?.detail);
      }
      return ppi ? { tier, ppi } : null;
    })
  ).then(xs => xs.filter(Boolean));
}

export default function How() {
  useTitle('How grades work');
  const shown = useAsync(examples, []);
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
              Every dollar given to a member of Congress comes from one of three sources: People,
              Power and Influence. The grade is the share that comes from People.
            </p>
          </div>
        </div>
      </section>

      <section className="section how" aria-labelledby="piles-title">
        <div className="wrap" style={{ maxWidth: '56em' }}>
          <h2 id="piles-title" className="display display-m">
            Three sources
          </h2>
          <p className="how-lead">
            We add up everything given to the member: their campaigns, their leadership PAC and
            their own joint fundraising committees. Their own money, loans and transfers are left
            out. Every dollar comes from one of three sources.
          </p>
          <dl className="piles">
            {PARTS.map(p => (
              <div key={p.key} className="pile">
                <dt className={`part is-${p.key}`}>{p.label}</dt>
                <dd>{PILES[p.key]}</dd>
              </div>
            ))}
          </dl>
          <p id="left-out" className="how-note">
            <strong>What&apos;s left out?</strong> {LEFT_OUT}
          </p>
          <p id="pacs" className="how-note">
            <strong>What&apos;s a PAC?</strong> A political action committee pools money and gives
            it to candidates. A PAC&apos;s money is People money only when the group behind it is
            run by its members, who elect most of its board (a union, for example), and only the
            part of the PAC&apos;s own money that came from many people. We check who runs each
            group on its own tax return to the IRS, the Form 990.
          </p>

          <h2 className="display display-m" style={{ marginTop: 48 }}>
            The grade
          </h2>
          <p className="how-lead">The grade is the share that comes from People.</p>
          <ul className="grade-scale">
            {LETTERS.map(l => (
              <li key={l} style={{ '--g': GRADES[l].color }}>
                <b>{l}</b>
                <span>{GRADES[l].name}</span>
                <span className="mono">{GRADES[l].range}</span>
              </li>
            ))}
          </ul>

          <h2 className="display display-m" style={{ marginTop: 48 }}>
            What it looks like
          </h2>
          <p className="how-lead">
            Every member&apos;s page shows their own money this way. These are real members of
            Congress, the middle one of each grade.
          </p>
          <div className="how-examples">
            {(shown.data || []).map(x => (
              <figure key={x.tier} className="how-example">
                <figcaption>
                  <strong>A typical {x.tier}</strong>
                  <span className="muted"> · {GRADES[x.tier].name}</span>
                </figcaption>
                <MoneyGraph ppi={x.ppi} tier={x.tier} compact />
                <p className="receipt-sentence">{peopleSentence(x.ppi.people)}</p>
              </figure>
            ))}
          </div>

          <h2 className="display display-m" style={{ marginTop: 48 }}>
            Where the numbers come from
          </h2>
          <p className="how-lead">
            Every figure comes from campaign finance reports filed with the Federal Election
            Commission (FEC). We grade from the FEC&apos;s bulk data files first, then check each
            donation against the FEC&apos;s own records. Until that check is finished, the
            member&apos;s page says the grade is still being checked. Grades change only when new
            reports are filed. <Link to="/congress">See every member of Congress</Link>.
          </p>

          <details className="fold" style={{ marginTop: 40, borderTop: '2px solid var(--ink)' }}>
            <summary>
              <h2 className="fold-title">Show the exact math</h2>
            </summary>
            <div className="fold-body spec">
              {blocks(SPEC).map((b, i) =>
                b.list ? (
                  <ul
                    key={i}
                    style={{ margin: '0 0 20px', paddingLeft: 20, color: 'var(--ink-2)' }}
                  >
                    {b.list.map((item, j) => (
                      <li key={j} style={{ marginBottom: 8 }}>
                        {inline(item)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p key={i} style={{ marginBottom: 20, color: 'var(--ink-2)' }}>
                    {inline(b.p)}
                  </p>
                )
              )}
            </div>
          </details>
        </div>
      </section>
    </>
  );
}
