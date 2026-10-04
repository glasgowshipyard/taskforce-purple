-- Rounds (2026-10-04). One round is one full refresh pass, triggered by a
-- filing deadline or an event. A pass over Congress can take several job runs
-- (the FEC allows 1,000 calls an hour); each run continues the open round and
-- skips members already done in it.
-- Apply once: npx wrangler d1 execute tfp-results --remote --file scripts/refresh/migrations/2026-10-04-rounds.sql
CREATE TABLE IF NOT EXISTS rounds (
  round_id TEXT PRIMARY KEY,
  cycle INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  reason TEXT,
  finished_at TEXT
);
ALTER TABLE member_progress ADD COLUMN round_id TEXT;
ALTER TABLE committees ADD COLUMN round_id TEXT;
ALTER TABLE runs ADD COLUMN round_id TEXT;
