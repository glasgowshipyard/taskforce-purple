// Corrections (owner, 2026-10-23): how to report a mistake, how soon it's
// read, and every correction made, dated (lib/corrections.js)
import React, { useState } from 'react';
import FeedbackDialog from '../components/FeedbackDialog.jsx';
import { CORRECTIONS, REVIEW_DAYS } from '../lib/corrections.js';
import { useTitle } from '../lib/hooks.js';

const day = iso =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

export default function Corrections() {
  useTitle('Corrections');
  const [suggesting, setSuggesting] = useState(false);
  return (
    <div className="wrap section" style={{ maxWidth: 820 }}>
      <h1 className="display display-l">Corrections</h1>
      <p className="lede" style={{ marginTop: 16, color: 'var(--ink-2)' }}>
        Every grade comes from public FEC filings. When something here turns out to be wrong,
        it&apos;s fixed, and it&apos;s listed below with the date and what changed.
      </p>

      <section className="section-tight" aria-labelledby="report-title">
        <h2 id="report-title" className="display display-m">
          Spotted a mistake?
        </h2>
        <p style={{ marginTop: 10 }}>
          Every member, candidate and race page has a &ldquo;Something wrong?&rdquo; link. Reports
          are read within {REVIEW_DAYS} days, and each one is checked against the FEC&apos;s records
          or the state&apos;s list of candidates.{' '}
          <button type="button" className="link-button" onClick={() => setSuggesting(true)}>
            Report something else
          </button>
          .
        </p>
      </section>

      <section className="section-tight" aria-labelledby="log-title">
        <h2 id="log-title" className="display display-m">
          What&apos;s been corrected
        </h2>
        <ol className="corrections">
          {CORRECTIONS.map(c => (
            <li key={`${c.date}-${c.what}`}>
              <p className="eyebrow">
                <time dateTime={c.date}>{day(c.date)}</time>
              </p>
              <p className="corrections-what">{c.what}</p>
              <p className="corrections-detail">{c.detail}</p>
            </li>
          ))}
        </ol>
        <p className="fine" style={{ marginTop: 20 }}>
          This list starts on October 17, 2026. Grades also change after each FEC filing deadline,
          as new money is reported; those changes aren&apos;t corrections, so they aren&apos;t
          listed here.
        </p>
      </section>
      <FeedbackDialog open={suggesting} onClose={() => setSuggesting(false)} kind="suggestion" />
    </div>
  );
}
