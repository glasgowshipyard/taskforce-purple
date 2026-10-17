// Which kind of money the pointer is on, on a member's page, shared by the
// graph's strips and the "Why" steps (owner, 2026-10-17). Lit strips breathe
// while the pointer is on them; an open step lights and breathes its strips
// too (Member.jsx). Nothing else: no timers, nothing that keeps going.
import { useCallback, useState } from 'react';

/** [key, setKey]: the kind of money under the pointer, or null */
export function useLight() {
  const [key, setState] = useState(null);
  const setKey = useCallback(next => setState(next || null), []);
  return [key, setKey];
}

/** The pointer handlers for something that lights `key` (a "Why" step) */
export function lightHandlers(key, setKey) {
  return {
    'data-light': key,
    onPointerEnter: e => e.pointerType === 'mouse' && setKey(key),
    onPointerLeave: e => e.pointerType === 'mouse' && setKey(null),
  };
}
