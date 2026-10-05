-- 2026-10-05. Loading a checked committee's fetched records looked them up
-- by committee_id, which had no index: every lookup scanned the whole table.
-- On 2026-10-05 that read 18.8M rows and D1 refused reads on the whole
-- account (the owner's other projects included) until midnight UTC.
-- The ledger now also counts rows read, so the job stops well short of the
-- 5M-a-day limit.
-- Apply once: npx wrangler d1 execute tfp-results --remote --file scripts/refresh/migrations/2026-10-05-gap-index-and-reads.sql
CREATE INDEX IF NOT EXISTS idx_gap_records_committee ON gap_records (committee_id, cycle);
ALTER TABLE d1_write_budget ADD COLUMN rows_read INTEGER NOT NULL DEFAULT 0;
