import React, { useState } from 'react';
import { Info, LayoutGrid, Receipt, Vote } from 'lucide-react';
import FeedbackDialog from './FeedbackDialog.jsx';
import { Link } from '../lib/router.js';
import { MOTTO } from '../lib/research.js';
import { THEMES, useTheme } from '../lib/theme.js';

const NAV = [
  { to: '/', label: 'Your reps', short: 'Your reps', icon: Receipt, pages: ['home', 'member'] },
  {
    to: '/races',
    label: 'Races',
    short: 'Races',
    icon: Vote,
    pages: ['races', 'ballot', 'race', 'candidate'],
  },
  {
    to: '/congress',
    label: 'All of Congress',
    short: 'Congress',
    icon: LayoutGrid,
    pages: ['congress'],
  },
  { to: '/how', label: 'How grades work', short: 'How it works', icon: Info, pages: ['how'] },
];

export function Header({ page }) {
  return (
    <header className="site-header on-dark">
      <div className="wrap">
        <Link to="/" className="brand" aria-label="Task Force Purple, home">
          <span className="brand-mark" aria-hidden="true">
            TFP
          </span>
          <span className="brand-word" aria-hidden="true">
            TASK FORCE PURPLE
          </span>
        </Link>
        <nav className="top-nav" aria-label="Main">
          {NAV.map(n => (
            <Link key={n.to} to={n.to} aria-current={n.pages.includes(page) ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function TabBar({ page }) {
  return (
    <nav className="tabbar" aria-label="Main">
      {NAV.map(({ to, short, icon: Icon, pages }) => (
        <Link key={to} to={to} aria-current={pages.includes(page) ? 'page' : undefined}>
          <Icon size={22} aria-hidden="true" />
          {short}
        </Link>
      ))}
    </nav>
  );
}

/** Device / Light / Dark, remembered on this device */
function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Colour scheme">
      {THEMES.map(t => (
        <button
          key={t.value}
          type="button"
          aria-pressed={theme === t.value}
          onClick={() => setTheme(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Footer() {
  const [suggesting, setSuggesting] = useState(false);
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div style={{ maxWidth: '42em' }}>
          <p className="footer-motto">{MOTTO}</p>
          {/* Who runs it and what's kept: the owner's words (2026-10-18, 2026-10-24) */}
          <p>
            Task Force Purple is one person and a cat. Friends and family test and provide feedback.
            The site is ad free, takes <em>no money</em>, and is{' '}
            <em>not connected to a party, campaign or PAC</em>.
          </p>
          <p className="footer-privacy">
            Grades are calculated from public FEC filings and updated after each FEC filing
            deadline.{' '}
            <a href="https://github.com/glasgowshipyard/taskforce-purple">
              Code and method are public
            </a>
            .
          </p>
          <p className="footer-privacy">
            Privacy: ZIP code and location data stay on your device. No data other than feedback is
            retained.
          </p>
        </div>
        <p>
          <Link to="/how">How grades work</Link> ·{' '}
          <Link to="/corrections">Corrections and updates</Link> ·{' '}
          <a href="https://github.com/glasgowshipyard/taskforce-purple">Open source</a> ·{' '}
          <button type="button" className="link-button" onClick={() => setSuggesting(true)}>
            Suggest something
          </button>
        </p>
        <ThemeToggle />
        <FeedbackDialog open={suggesting} onClose={() => setSuggesting(false)} kind="suggestion" />
      </div>
    </footer>
  );
}
