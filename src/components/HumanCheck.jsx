// Cloudflare Turnstile, the free bot check on the feedback forms. Its script
// loads only when a form opens. It shows a box to tick only when Cloudflare
// isn't sure; otherwise it passes on its own and hands back a token.
import React, { useEffect, useRef } from 'react';
import { TURNSTILE_SITE_KEY } from '../lib/feedback.js';

const SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=tfpTurnstileReady';
let loading = null;

function turnstile() {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }
  loading ||= new Promise((resolve, reject) => {
    window.tfpTurnstileReady = () => resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('Turnstile did not load'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** onToken(token or null): null when the token expires or the check fails */
export default function HumanCheck({ onToken, resetKey = 0 }) {
  const box = useRef(null);
  useEffect(() => {
    let id = null;
    let gone = false;
    turnstile()
      .then(t => {
        if (gone || !box.current) {
          return;
        }
        id = t.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          appearance: 'interaction-only',
          callback: token => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      gone = true;
      if (id !== null) {
        window.turnstile?.remove(id);
      }
    };
    // A new resetKey draws a fresh check (after a send)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  return <div ref={box} className="human-check" />;
}
