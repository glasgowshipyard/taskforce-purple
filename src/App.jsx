import React, { useEffect, useRef } from 'react';
import { Footer, Header, TabBar } from './components/Layout.jsx';
import Ballot from './pages/Ballot.jsx';
import Congress from './pages/Congress.jsx';
import Home from './pages/Home.jsx';
import How from './pages/How.jsx';
import Member from './pages/Member.jsx';
import { Link, matchRoute, useLocation } from './lib/router.js';
import { useTitle } from './lib/hooks.js';

function Missing() {
  useTitle('Page not found');
  return (
    <div className="wrap section">
      <h1 className="display display-l">No receipt here</h1>
      <p className="lede" style={{ marginTop: 16 }}>
        That page doesn&apos;t exist. <Link to="/">Find your representatives</Link>.
      </p>
    </div>
  );
}

export default function App() {
  const { path, search } = useLocation();
  const route = matchRoute(path);
  const main = useRef(null);
  const lastPath = useRef(path);

  // A new page: move focus to it, as a full page load would (screen readers
  // otherwise stay on the link that was clicked). Not on the first load.
  useEffect(() => {
    if (lastPath.current === path) {
      return;
    }
    lastPath.current = path;
    main.current?.focus({ preventScroll: true });
  }, [path]);

  let page;
  switch (route.page) {
    case 'home':
      page = <Home />;
      break;
    case 'member':
      page = <Member key={route.id} id={route.id} />;
      break;
    case 'candidate':
      page = <Member key={route.id} id={route.id} kind="candidate" />;
      break;
    case 'congress':
      page = <Congress search={search} />;
      break;
    case 'ballot':
      page = <Ballot key="ballot" />;
      break;
    case 'race':
      page = <Ballot key={route.key} raceKey={route.key} />;
      break;
    case 'how':
      page = <How />;
      break;
    default:
      page = <Missing />;
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header page={route.page} />
      <main id="main" ref={main} tabIndex={-1} style={{ outline: 'none' }}>
        {page}
      </main>
      <Footer />
      <TabBar page={route.page} />
    </>
  );
}
