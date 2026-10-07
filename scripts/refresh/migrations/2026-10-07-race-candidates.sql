-- 2026-10-07 (ROADMAP Phase E). Candidates in November's general election who
-- aren't sitting members, graded like members from the FEC's bulk files.
-- Sitting members' grades stay in `results`. Lookups are by primary key.
-- Apply once: npx wrangler d1 execute tfp-results --remote --file scripts/refresh/migrations/2026-10-07-race-candidates.sql
CREATE TABLE IF NOT EXISTS race_candidates (
  candidate_id TEXT NOT NULL,  -- the FEC's candidate ID: the identity, nothing inferred
  cycle INTEGER NOT NULL,
  office TEXT NOT NULL,        -- H | S
  state TEXT NOT NULL,
  district TEXT,               -- House: '01'.. ('00' at-large); Senate: ''
  name TEXT NOT NULL,          -- as the FEC has it
  party TEXT,
  ici TEXT,                    -- I incumbent | C challenger | O open seat (FEC)
  computed_at TEXT NOT NULL,
  pool TEXT,                   -- JSON: committees and money trail
  analysis TEXT,               -- JSON: donors, concentration, conduits, FARA
  grade TEXT,                  -- JSON: tier, figures, evidenceChecked
  status TEXT NOT NULL,        -- provisional | complete | pending
  PRIMARY KEY (candidate_id, cycle)
);
