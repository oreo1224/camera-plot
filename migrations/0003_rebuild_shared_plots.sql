CREATE TABLE plots_shared (
  id TEXT PRIMARY KEY,
  band TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 旧実装で同名データがある場合は、更新日時が最も新しい1件を残します。
INSERT INTO plots_shared (id, band, name, data, created_at, updated_at)
SELECT p.id, p.band, p.name, p.data, p.created_at, p.updated_at
FROM plots p
WHERE p.rowid = (
  SELECT p2.rowid
  FROM plots p2
  WHERE p2.band = p.band COLLATE NOCASE
    AND p2.name = p.name COLLATE NOCASE
  ORDER BY p2.updated_at DESC, p2.rowid DESC
  LIMIT 1
);

DROP TABLE plots;
ALTER TABLE plots_shared RENAME TO plots;

CREATE INDEX plots_band_updated
  ON plots (band COLLATE NOCASE, updated_at DESC);

CREATE UNIQUE INDEX plots_band_name_unique
  ON plots (band COLLATE NOCASE, name COLLATE NOCASE);
