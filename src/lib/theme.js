// Light, dark or follow the device (owner, 2026-10-24, as Let's Find Out).
// The choice is kept on this device only; with none, the device's own
// setting applies (CSS prefers-color-scheme). index.html applies a saved
// choice before the page paints, so there's no flash.
import { useEffect, useState } from 'react';

const KEY = 'tfp:theme';
export const THEMES = [
  { value: 'system', label: 'Device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function savedTheme() {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }
}

/** [theme, setTheme]: 'system', 'light' or 'dark' */
export function useTheme() {
  const [theme, set] = useState(savedTheme);
  useEffect(() => {
    apply(theme);
    try {
      if (theme === 'system') {
        window.localStorage.removeItem(KEY);
      } else {
        window.localStorage.setItem(KEY, theme);
      }
    } catch {
      // Private browsing: it applies for this visit only
    }
  }, [theme]);
  return [theme, set];
}
