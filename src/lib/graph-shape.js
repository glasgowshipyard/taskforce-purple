// Curve or bars: how every graph on the site is drawn for this visitor
// (owner, 2026-10-17: some readers want plain bars, since People, Power and
// Influence are three separate parts). Chosen on a member's page, remembered
// on this device only, and every graph on the page follows at once.
import { useSyncExternalStore } from 'react';

const KEY = 'tfp:graph-shape';
const listeners = new Set();

function stored() {
  try {
    return window.localStorage.getItem(KEY) === 'bars' ? 'bars' : 'curve';
  } catch {
    // Private browsing, or no window: the curve
    return 'curve';
  }
}

let shape = typeof window === 'undefined' ? 'curve' : stored();

export function setGraphShape(next) {
  shape = next === 'bars' ? 'bars' : 'curve';
  try {
    window.localStorage.setItem(KEY, shape);
  } catch {
    // Not remembered; the page still switches
  }
  listeners.forEach(l => l());
}

/** 'curve' or 'bars', updating every graph when it changes */
export function useGraphShape() {
  return useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => shape,
    () => 'curve'
  );
}
