CREATE TABLE IF NOT EXISTS plots (
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS plots_owner_updated
  ON plots (owner_hash, updated_at DESC);
