import React from 'react';
import { Info, LayoutGrid, Receipt, Vote } from 'lucide-react';
import { Link } from '../lib/router.js';

const NAV = [
  { to: '/', label: 'Your reps', short: 'Your reps', icon: Receipt, pages: ['home', 'member'] },
  {
    to: '/ballot',
    label: 'Your ballot',
    short: 'Ballot',
    icon: Vote,
    pages: ['ballot', 'race', 'candidate'],
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
            TP
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

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <p style={{ maxWidth: '42em' }}>
          We grade money, not views. No party, no ads. Every figure comes from public FEC filings
          and Congress.gov, and updates after each filing deadline.
        </p>
        <p>
          <Link to="/how">How grades work</Link> ·{' '}
          <a href="https://github.com/glasgowshipyard/taskforce-purple">Open source</a>
        </p>
      </div>
    </footer>
  );
}
