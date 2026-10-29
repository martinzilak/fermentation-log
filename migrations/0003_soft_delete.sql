-- Soft delete for batches (SPEC §15.2): a deleted batch keeps its rows so Undo
-- can restore it, and its number can be used again. SQLite can't drop the
-- inline UNIQUE on number, so the table is rebuilt with a partial index.

CREATE TABLE batches_new (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  name TEXT,
  color TEXT,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'fermenting', 'processing', 'bottled', 'archived')),
  -- 1 when the status was set by hand in the edit screen; automatic
  -- transitions (SPEC §6.3) leave it alone until it is reset.
  status_manual INTEGER NOT NULL DEFAULT 0,
  recipe_id TEXT REFERENCES recipes (id) ON DELETE SET NULL,
  notes_md TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL
);

INSERT INTO batches_new (id, number, name, color, status, status_manual, recipe_id, notes_md, created_at, updated_at, author)
SELECT id, number, name, color, status, status_manual, recipe_id, notes_md, created_at, updated_at, author FROM batches;

DROP TABLE batches;
ALTER TABLE batches_new RENAME TO batches;

CREATE UNIQUE INDEX batches_number ON batches (number) WHERE deleted_at IS NULL;
