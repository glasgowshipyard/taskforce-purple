-- tfp-results: the refresh job's database (REBUILD_SPEC.md §7).
-- Results and history only. The full donation record is the FEC's own bulk
-- file (owner decision D6c); only records fetched from the API to fill the
-- bulk file's gaps are stored in full here.
-- Apply: npx wrangler d1 execute tfp-results --remote --file scripts/refresh/schema.sql

-- One row per job run
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger TEXT,               -- calendar | event | manual
  status TEXT NOT NULL,       -- running | done | failed
  bulk_file_date TEXT,        -- Last-Modified of the FEC bulk file used
  summary TEXT,               -- JSON: members done/pending/failed, calls, writes
  round_id TEXT
);

-- Per member per cycle: where it got to, and why it failed (for resuming and
-- retrying; nobody is ever dropped)
CREATE TABLE IF NOT EXISTS member_progress (
  bioguide_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  status TEXT NOT NULL,       -- pending | done | failed
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  updated_at TEXT NOT NULL,
  round_id TEXT,              -- the round it was last processed in
  PRIMARY KEY (bioguide_id, cycle)
);

-- Per committee per cycle: the FEC's figures and how ours compare
CREATE TABLE IF NOT EXISTS committees (
  committee_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  name TEXT,
  fec_itemized_total REAL,     -- FEC committee totals: individual itemized
  fec_individual_count INTEGER,-- API count, is_individual=true
  fec_count_exact INTEGER,
  bulk_count INTEGER,          -- rows in the bulk file
  gap_filled INTEGER,          -- records fetched from the API to fill gaps
  earmarked_extra INTEGER,     -- earmarked gifts the FEC doesn't flag individual
  our_itemized_total REAL,
  status TEXT,                 -- reconciled | reconciled-with-note | mismatch
  note TEXT,
  checked_at TEXT NOT NULL,
  round_id TEXT,
  PRIMARY KEY (committee_id, cycle)
);

-- Records fetched from the API (gap fills and earmarked gifts), in full,
-- Brotli-packed per committee (lib/gap-store.mjs; 2026-10-06). Replaces
-- gap_records, one uncompressed row per record, which filled D1's 500 MB.
CREATE TABLE IF NOT EXISTS gap_packs (
  committee_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  kind TEXT NOT NULL,          -- gap | earmarked
  pack INTEGER NOT NULL,       -- 0, 1, ... (up to 5,000 records each)
  records INTEGER NOT NULL,
  data TEXT NOT NULL,          -- base64 of Brotli-compressed JSON: the FEC's records as fetched
  saved_at TEXT NOT NULL,
  PRIMARY KEY (committee_id, cycle, kind, pack)
);

-- Candidates in November's general election who aren't sitting members
-- (2026-10-07, ROADMAP Phase E; scripts/refresh/races.mjs)
CREATE TABLE IF NOT EXISTS race_candidates (
  candidate_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  office TEXT NOT NULL,
  state TEXT NOT NULL,
  district TEXT,
  name TEXT NOT NULL,
  party TEXT,
  ici TEXT,
  computed_at TEXT NOT NULL,
  pool TEXT,
  analysis TEXT,
  grade TEXT,
  status TEXT NOT NULL,
  PRIMARY KEY (candidate_id, cycle)
);

-- The current result per member per cycle (Stage 2: computed, not published)
CREATE TABLE IF NOT EXISTS results (
  bioguide_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  bulk_file_date TEXT,
  pool TEXT NOT NULL,          -- JSON: committees and money trail
  analysis TEXT,               -- JSON: donors, concentration, conduits, FARA
  reconciliation TEXT,         -- JSON: per committee
  grade TEXT,                  -- JSON: tier and inputs, or pending + reason
  status TEXT NOT NULL,        -- complete | pending
  PRIMARY KEY (bioguide_id, cycle)
);

-- Every result that was ever current, never overwritten (history)
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY,
  bioguide_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  result TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_member ON snapshots (bioguide_id, cycle);

-- One row per published grade change (written from Stage 3)
CREATE TABLE IF NOT EXISTS grade_history (
  id INTEGER PRIMARY KEY,
  bioguide_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  changed_at TEXT NOT NULL,
  old_tier TEXT,
  new_tier TEXT,
  snapshot_id INTEGER
);

-- D1 rows written and read per UTC day, charged from D1's own figures.
-- The D1 limits (100k written, 5M read a day) are per account and shared
-- with the owner's other projects; the job stops at its own caps.
CREATE TABLE IF NOT EXISTS d1_write_budget (
  day TEXT PRIMARY KEY,
  rows_written INTEGER NOT NULL DEFAULT 0,
  rows_read INTEGER NOT NULL DEFAULT 0     -- since 2026-10-05; the read limit is 5M/day
);

-- FARA employer matches, copied from taskforce-purple-donors (D1 can't join
-- across databases)
CREATE TABLE IF NOT EXISTS fara_employer_matches (
  employer TEXT PRIMARY KEY,
  fara_firm TEXT NOT NULL,
  registration_number TEXT
);

-- One full refresh pass (see migrations/2026-10-04-rounds.sql)
CREATE TABLE IF NOT EXISTS rounds (
  round_id TEXT PRIMARY KEY,
  cycle INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  reason TEXT,
  finished_at TEXT
);
