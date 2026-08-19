CREATE TABLE IF NOT EXISTS events (
  dedup_key TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  record_type TEXT NOT NULL DEFAULT '',
  cost REAL NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  entries INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_acct_date ON events (account_id, date, record_type);
