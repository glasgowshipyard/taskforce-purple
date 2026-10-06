-- 2026-10-06. Records fetched from the FEC to fill the bulk file's gaps, kept
-- in full (owner's choice) but Brotli-packed per committee (lib/gap-store.mjs):
-- about 50 bytes a record instead of about 4,000. Until now each record was an
-- uncompressed row in gap_records, which filled D1's 500 MB on 2026-10-05.
-- Then: node scripts/migrations/2026-10-06-pack-gap-records.mjs (--apply, --drop)
-- Apply once: npx wrangler d1 execute tfp-results --remote --file scripts/refresh/migrations/2026-10-06-gap-packs.sql
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
