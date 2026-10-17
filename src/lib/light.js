// Which kind of money is lit up on a member's page, shared by the graph's
// strips and the "Why" steps (owner, 2026-10-17). It breathes only while
// someone's looking: while the pointer is on it, or for a few breaths after a
// tap. Tapping anywhere else (outside a strip or a step) puts it out.
import { useCallback, useEffect, useRef, useState } from 'react';

const TAP_BREATHS_MS = 5100;
// Strips and steps carry this; a tap on anything else clears the light
const LIGHT_ATTRIBUTE = 'data-light';

/** [light, setLight]: light is { key, breathing }; setLight(key, 'hover' | 'tap'), or (null) */
export function useLight() {
  const [light, setState] = useState({ key: null, breathing: false });
  const timer = useRef(null);
  const setLight = useCallback((key, how = 'hover') => {
    clearTimeout(timer.current);
    if (!key) {
      setState({ key: null, breathing: false });
      return;
    }
    setState({ key, breathing: true });
    if (how === 'tap') {
      timer.current = setTimeout(
        () => setState(s => (s.key === key ? { key, breathing: false } : s)),
        TAP_BREATHS_MS
      );
    }
  }, []);
  useEffect(() => {
    const away = e => {
      if (e.pointerType !== 'mouse' && !e.target.closest?.(`[${LIGHT_ATTRIBUTE}], .ppi`)) {
        setLight(null);
      }
    };
    document.addEventListener('pointerdown', away);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('pointerdown', away);
    };
  }, [setLight]);
  return [light, setLight];
}

/** The pointer handlers for something that lights `key` (a "Why" step) */
export function lightHandlers(key, setLight) {
  return {
    [LIGHT_ATTRIBUTE]: key,
    onPointerEnter: e => e.pointerType === 'mouse' && setLight(key, 'hover'),
    onPointerLeave: e => e.pointerType === 'mouse' && setLight(null),
    onPointerDown: e => e.pointerType !== 'mouse' && setLight(key, 'tap'),
  };
}
