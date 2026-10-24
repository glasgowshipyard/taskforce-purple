// A small router on the History API: the site has seven pages, which doesn't
// justify a dependency. Cloudflare Pages serves a pre-built page where there
// is one (scripts/site/prerender.mjs) and index.html for every other path
// (its single-page-app fallback: there is no 404.html), so deep links work.
import { createElement, useEffect, useState } from 'react';

const listeners = new Set();

function notify() {
  listeners.forEach(l => l());
}

export function navigate(to, { replace = false, keepScroll = false } = {}) {
  const here = window.location.pathname + window.location.search;
  if (to === here) {
    return;
  }
  window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
  notify();
  if (!keepScroll) {
    window.scrollTo(0, 0);
  }
}

/** The current location, re-rendering on every navigation. */
export function useLocation() {
  const read = () => ({ path: window.location.pathname, search: window.location.search });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const update = () => setLoc(read());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return loc;
}

/** Which page a path is, and its parameters. */
export function matchRoute(path) {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) {
    return { page: 'home' };
  }
  const [first, second] = parts;
  if (first === 'member' && second) {
    return { page: 'member', id: second };
  }
  if (first === 'candidate' && second) {
    return { page: 'candidate', id: second };
  }
  if (first === 'congress' && !second) {
    return { page: 'congress' };
  }
  if (first === 'corrections' && !second) {
    return { page: 'corrections' };
  }
  if (first === 'races' && !second) {
    return { page: 'races' };
  }
  if (first === 'ballot' && !second) {
    return { page: 'ballot' };
  }
  // /race/2026/S-AK; /race/S-AK (and /race/S-AK-) are the current cycle's
  if (first === 'race' && /^\d{4}$/.test(second || '') && parts[2]) {
    return { page: 'race', cycle: Number(second), key: parts[2] };
  }
  if (first === 'race' && second) {
    return { page: 'race', cycle: null, key: second };
  }
  if (first === 'how' && !second) {
    return { page: 'how' };
  }
  return { page: 'missing' };
}

/** An <a> that navigates in-app, and behaves like a link for everything else. */
export function Link({ to, onClick, ...props }) {
  return createElement('a', {
    href: to,
    onClick: e => {
      onClick?.(e);
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        props.target
      ) {
        return;
      }
      e.preventDefault();
      navigate(to);
    },
    ...props,
  });
}

export const memberPath = id => `/member/${encodeURIComponent(id)}`;
// A race's address carries its cycle, so the same seat in another year gets
// its own (/race/2026/S-AK). Older addresses still work (pages/Ballot.jsx)
export const racePath = (key, cycle) =>
  `/race/${cycle ? `${cycle}/` : ''}${encodeURIComponent(key.replace(/-$/, ''))}`;

/** A race key from an address, as the races list writes it, old forms included */
export const findRaceByKey = (races, key) => {
  const k = String(key || '').replace(/-$/, '');
  return (
    races.find(r => r.key === k) ||
    races.find(r => r.key === `${k}-`) ||
    races.find(r => r.key === `${k}-special`) ||
    null
  );
};
