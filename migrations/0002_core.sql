-- Core domain tables (SPEC §6). IDs are client-generated UUIDs, weights are
-- grams, timestamps are ISO 8601 UTC, dates are YYYY-MM-DD. JSON columns hold
-- arrays or objects validated by the shared valibot schemas.

CREATE TABLE varieties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  species TEXT,
  local_names TEXT NOT NULL DEFAULT '[]',
  shu_min REAL,
  shu_max REAL,
  shu_source TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL
);
CREATE UNIQUE INDEX varieties_name ON varieties (name COLLATE NOCASE);

CREATE TABLE pepper_lots (
  id TEXT PRIMARY KEY,
  variety_id TEXT NOT NULL REFERENCES varieties (id),
  season INTEGER NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('grown', 'bought', 'gift')),
  propagation TEXT CHECK (propagation IN ('seed', 'sapling')),
  supplier TEXT,
  acquired_on TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL,
  CHECK (propagation IS NULL OR origin = 'grown')
);
CREATE INDEX pepper_lots_variety ON pepper_lots (variety_id);

CREATE TABLE catalog_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL
);
CREATE UNIQUE INDEX catalog_items_name ON catalog_items (name COLLATE NOCASE);

CREATE TABLE vessels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL
);

CREATE TABLE bottle_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  volume_ml REAL NOT NULL CHECK (volume_ml > 0),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL
);

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes_md TEXT NOT NULL DEFAULT '',
  heat_target_shu REAL,
  created_from_batch_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL
);

CREATE TABLE recipe_lines (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN ('ferment', 'blend', 'cook', 'strain', 'rest', 'other')),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  variety_id TEXT REFERENCES varieties (id),
  catalog_id TEXT REFERENCES catalog_items (id),
  mode TEXT NOT NULL CHECK (mode IN ('grams', 'percent', 'remainder')),
  grams REAL,
  percent REAL,
  base TEXT CHECK (base IN ('peppers', 'solids', 'ferment_total', 'mash', 'sauce')),
  solve_for_heat INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL
);
CREATE INDEX recipe_lines_recipe ON recipe_lines (recipe_id, step_index, position);

CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  name TEXT,
  color TEXT,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'fermenting', 'processing', 'bottled', 'archived')),
  -- 1 when the status was set by hand in the edit screen; automatic
  -- transitions (SPEC §6.3) leave it alone until it is reset.
  status_manual INTEGER NOT NULL DEFAULT 0,
  recipe_id TEXT REFERENCES recipes (id) ON DELETE SET NULL,
  notes_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL
);

CREATE TABLE steps (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ferment', 'blend', 'cook', 'strain', 'rest', 'other')),
  date TEXT,
  params TEXT NOT NULL DEFAULT '{}',
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL
);
CREATE INDEX steps_batch ON steps (batch_id, position);

CREATE TABLE ingredient_lines (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  step_id TEXT NOT NULL REFERENCES steps (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  local_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN (
    'pepper', 'vegetable', 'fruit', 'aromatic', 'herb', 'water', 'salt',
    'mash', 'brine', 'acid', 'sweetener', 'thickener', 'other')),
  grams REAL,
  planned_g REAL,
  lot_id TEXT REFERENCES pepper_lots (id),
  catalog_id TEXT REFERENCES catalog_items (id),
  shu_min REAL,
  shu_max REAL,
  shu_source TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL
);
CREATE INDEX ingredient_lines_step ON ingredient_lines (step_id, position);
CREATE INDEX ingredient_lines_batch ON ingredient_lines (batch_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  step_id TEXT REFERENCES steps (id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN (
    'note', 'photo', 'voice', 'ph', 'burp', 'weigh', 'issue', 'tasting', 'bottled')),
  occurred_at TEXT NOT NULL,
  text TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL
);
CREATE INDEX events_batch ON events (batch_id, occurred_at);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('photo', 'audio')),
  file TEXT NOT NULL,
  thumb TEXT,
  taken_at TEXT,
  duration_s REAL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL,
  author TEXT NOT NULL
);
CREATE INDEX attachments_event ON attachments (event_id);

-- In the owner's notes a bare "ocot" always means this vinegar (SPEC §6.2).
INSERT INTO catalog_items (id, name, kind, aliases, notes, created_at, updated_at, author)
VALUES (
  '0cc364e2-813e-4b83-8b6d-41b8fb7d9272',
  'Ocot kvasný liehový 8 %',
  'acid',
  '["ocot"]',
  'Distilled spirit vinegar',
  '2026-10-29T00:00:00.000Z',
  '2026-10-29T00:00:00.000Z',
  'system'
);
