// Updates and corrections, at /updates (owner, 2026-10-23; updates, RSS and
// the address 2026-10-25): every major update and correction, dated and
// labelled, and how to report a mistake (lib/corrections.js)
import React, { useState } from 'react';
import FeedbackDialog from '../components/FeedbackDialog.jsx';
import { CORRECTIONS, KINDS, REVIEW_DAYS, inOrder } from '../lib/corrections.js';
import { useTitle } from '../lib/hooks.js';

const day = iso =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

export default function Corrections() {
  useTitle('Updates and corrections');
  const [suggesting, setSuggesting] = useState(false);
  return (
    <div className="wrap section" style={{ maxWidth: 820 }}>
      <h1 className="display display-l">Updates and corrections</h1>
      <p className="lede" style={{ marginTop: 16, color: 'var(--ink-2)' }}>
        New features and fixed mistakes are listed here, newest first.{' '}
        <a href="/updates.xml">Follow by RSS</a>.
      </p>

      <section className="section-tight" aria-label="What's changed">
        {CORRECTIONS.length === 0 && <p>None so far.</p>}
        <ol className="corrections">
          {inOrder().map(c => (
            <li key={c.id} id={c.id}>
              <p className="eyebrow">
                <span className={`change-kind is-${c.kind}`}>{KINDS[c.kind]}</span>{' '}
                <time dateTime={c.date}>{day(c.date)}</time>
              </p>
              <p className="corrections-what">{c.what}</p>
              <p className="corrections-detail">{c.detail}</p>
            </li>
          ))}
        </ol>
        <p className="fine" style={{ marginTop: 20 }}>
          Grades also change as new FEC filings come in. Those changes aren&apos;t listed here.
        </p>
      </section>

      <section className="section-tight" aria-labelledby="report-title">
        <h2 id="report-title" className="display display-m">
          Spotted a mistake?
        </h2>
        <p style={{ marginTop: 10 }}>
          Every page has a &ldquo;Something wrong?&rdquo; link, and reports are read within{' '}
          {REVIEW_DAYS} days.{' '}
          <button type="button" className="link-button" onClick={() => setSuggesting(true)}>
            Report something else
          </button>
          .
        </p>
      </section>
      <FeedbackDialog open={suggesting} onClose={() => setSuggesting(false)} kind="suggestion" />
    </div>
  );
}
