-- 2026-10-24. A member's grade history (DATABASE_REFERENCE.md: WHERE
-- bioguide_id = ...) had no index, so the lookup scanned the whole table.
-- Small (890 rows), but every D1 lookup must use an index (CLAUDE.md).
-- Apply once: npx wrangler d1 execute tfp-results --remote --file scripts/refresh/migrations/2026-10-24-grade-history-index.sql
CREATE INDEX IF NOT EXISTS idx_grade_history_member ON grade_history (bioguide_id, cycle);
