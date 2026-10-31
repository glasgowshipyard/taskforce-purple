// States whose House district lines changed for the 2026 election
// (mid-decade redistricting: https://en.wikipedia.org/wiki/2025%E2%80%932026_United_States_redistricting,
// "Redistricting plan in effect for 2026 elections", read 2026-10-31). The
// district lookup files (public/geo) hold the lines Congress was elected on
// in 2024 (Census Bureau, 119th Congress), so for the races they can't say
// which 2026 district someone is in. Each state's official voter lookup,
// and how many districts it has (unchanged by the redraw).
export const REDRAWN_2026 = {
  AL: { districts: 7, lookup: 'https://myinfo.alabamavotes.gov/VoterView' },
  CA: { districts: 52, lookup: 'https://voterstatus.sos.ca.gov/' },
  FL: { districts: 28, lookup: 'https://registration.elections.myflorida.com/CheckVoterStatus' },
  LA: { districts: 6, lookup: 'https://voterportal.sos.la.gov/' },
  NC: { districts: 14, lookup: 'https://vt.ncsbe.gov/RegLkup/' },
  OH: { districts: 15, lookup: 'https://voterlookup.ohiosos.gov/voterlookup.aspx' },
  TN: { districts: 9, lookup: 'https://tnmap.tn.gov/voterlookup/' },
  TX: { districts: 38, lookup: 'https://teamrv-mvp.sos.texas.gov/MVP/mvp.do' },
  UT: {
    districts: 4,
    lookup: 'https://votesearch.utah.gov/voter-search/search/search-by-voter/voter-info',
  },
};

/** True when this state's lines changed for 2026 (the lookup files are older). */
export const redrawn = state => Boolean(REDRAWN_2026[state]);
