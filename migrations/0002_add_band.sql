ALTER TABLE plots ADD COLUMN band TEXT NOT NULL DEFAULT '未分類';

CREATE INDEX IF NOT EXISTS plots_band_updated
  ON plots (band COLLATE NOCASE, updated_at DESC);
