-- Task Force Purple - Donor Transaction Storage Schema
-- Purpose: Store raw itemized donor data for analytical queries

-- Individual transactions (raw FEC Schedule A data)
CREATE TABLE IF NOT EXISTS itemized_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bioguide_id TEXT NOT NULL,
  committee_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,

  -- Donor information
  contributor_first_name TEXT,
  contributor_last_name TEXT,
  contributor_state TEXT,
  contributor_zip TEXT,
  contributor_employer TEXT,
  contributor_occupation TEXT,

  -- Transaction details
  amount REAL NOT NULL,
  contribution_receipt_date TEXT,
  contribution_receipt_amount REAL,

  -- Metadata
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_bioguide ON itemized_transactions(bioguide_id);
CREATE INDEX IF NOT EXISTS idx_committee ON itemized_transactions(committee_id);
CREATE INDEX IF NOT EXISTS idx_cycle ON itemized_transactions(cycle);
CREATE INDEX IF NOT EXISTS idx_donor_lookup ON itemized_transactions(bioguide_id, contributor_first_name, contributor_last_name, contributor_state, contributor_zip);

-- Pre-aggregated donor totals (for fast Gini/concentration queries)
CREATE TABLE IF NOT EXISTS donor_aggregates (
  bioguide_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  donor_key TEXT NOT NULL,

  -- Donor identification
  first_name TEXT,
  last_name TEXT,
  state TEXT,
  zip TEXT,

  -- Aggregated amounts
  total_amount REAL NOT NULL,
  transaction_count INTEGER NOT NULL,
  min_amount REAL,
  max_amount REAL,
  avg_amount REAL,

  -- Metadata
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (bioguide_id, cycle, donor_key)
);

-- Collection metadata (track progress and completion)
CREATE TABLE IF NOT EXISTS collection_metadata (
  bioguide_id TEXT NOT NULL,
  committee_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,

  -- Progress tracking
  status TEXT NOT NULL, -- 'in_progress', 'complete', 'failed'
  total_transactions INTEGER DEFAULT 0,
  unique_donors INTEGER DEFAULT 0,
  total_amount REAL DEFAULT 0,

  -- FEC reconciliation
  fec_reported_total REAL,
  fec_transaction_count INTEGER,
  reconciliation_diff_percent REAL,

  -- Timestamps
  started_at TEXT,
  completed_at TEXT,
  last_updated TEXT DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (bioguide_id, cycle)
);

-- Calculated metrics (cached results from analytical queries)
CREATE TABLE IF NOT EXISTS calculated_metrics (
  bioguide_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  metric_name TEXT NOT NULL,

  -- Metric value and metadata
  metric_value REAL NOT NULL,
  calculation_method TEXT,
  parameters TEXT, -- JSON blob for threshold values, etc.

  -- Timestamps
  calculated_at TEXT DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (bioguide_id, cycle, metric_name)
);
