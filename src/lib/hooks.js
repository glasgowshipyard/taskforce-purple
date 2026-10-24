import { useEffect, useState } from 'react';

/** { data, error, loading } for a promise-returning function, rerun on deps. */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(fn)
      .then(
        data => live && setState({ data, error: null, loading: false }),
        error => live && setState({ data: undefined, error, loading: false })
      );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** The page's <title> */
export function useTitle(title) {
  useEffect(() => {
    document.title = title
      ? `${title} · Task Force Purple`
      : "Task Force Purple: who's paying your representatives?";
  }, [title]);
}

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * True once the element has scrolled into view (and stays true), for things
 * that fill in as they arrive. Straight away when motion is turned down, or
 * where IntersectionObserver doesn't exist.
 */
export function useInView(ref, margin = '0px 0px -10% 0px') {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) {
      return undefined;
    }
    if (reduceMotion() || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, margin]);
  return seen;
}

/** A number counting up to `target` over `ms` once `run` is true */
export function useCountUp(target, run, ms = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!run) {
      return undefined;
    }
    if (reduceMotion()) {
      setValue(target);
      return undefined;
    }
    let frame;
    const start = performance.now();
    const tick = t => {
      const k = Math.min(1, (t - start) / ms);
      // Ease out: fast at first, settling on the figure
      setValue(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, run, ms]);
  return value;
}
