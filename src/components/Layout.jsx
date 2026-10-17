import React, { useState } from 'react';
import { Info, LayoutGrid, Receipt, Vote } from 'lucide-react';
import FeedbackDialog from './FeedbackDialog.jsx';
import { Link } from '../lib/router.js';
import { MOTTO } from '../lib/research.js';

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

export function Footer() {
  const [suggesting, setSuggesting] = useState(false);
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div style={{ maxWidth: '42em' }}>
          <p className="footer-motto">{MOTTO}</p>
          {/* Who runs it and what's kept (owner, 2026-10-17: one person, no
              campaign or PAC money; "we" left the site the same day) */}
          <p>
            Task Force Purple is one person, with friends and family who test it and send feedback.
            It isn&apos;t connected to any party or campaign, has no ads and takes no money from
            campaigns or PACs. Grades are based on public FEC filings and Congress.gov data, and
            they&apos;re updated after each FEC filing deadline. The code and the method are public.
          </p>
          <p className="footer-privacy">
            Privacy: your ZIP code and location stay on your device. If you send feedback,
            Cloudflare checks you&apos;re a person, and only what you wrote is kept, plus a code
            that changes every day to stop spam.
          </p>
        </div>
        <p>
          <Link to="/how">How grades work</Link> ·{' '}
          <a href="https://github.com/glasgowshipyard/taskforce-purple">Open source</a> ·{' '}
          <button type="button" className="link-button" onClick={() => setSuggesting(true)}>
            Suggest something
          </button>
        </p>
        <FeedbackDialog open={suggesting} onClose={() => setSuggesting(false)} kind="suggestion" />
      </div>
    </footer>
  );
}
