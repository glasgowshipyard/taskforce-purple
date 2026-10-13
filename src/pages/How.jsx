// How grades work: the method as frozen (FINAL-3, owner 2026-10-12), the
// one-page spec as written (src/lib/spec.js). A plain-English version comes
// later. Must agree with workers/tier-calculation.js (gradeFinal3).
import React from 'react';
import { useTitle } from '../lib/hooks.js';
import { SPEC } from '../lib/spec.js';

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
              The grading method, exactly as we apply it. A plain-English version is on its way.
            </p>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="wrap spec" style={{ maxWidth: '48em' }}>
          {blocks(SPEC).map((b, i) =>
            b.list ? (
              <ul key={i} style={{ margin: '0 0 20px', paddingLeft: 20, color: 'var(--ink-2)' }}>
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
      </section>
    </>
  );
}
