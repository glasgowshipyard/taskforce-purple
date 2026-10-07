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
