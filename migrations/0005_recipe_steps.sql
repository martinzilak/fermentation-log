-- Recipe steps (SPEC §15.9). Until now a recipe's steps were implied by its
-- lines, so a step without additions (a cook, the final strain) could not
-- exist. Each step now has its own row with the method as a note. The steps
-- the existing lines imply are carried over.

CREATE TABLE recipe_steps (
  recipe_id TEXT NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ferment', 'blend', 'cook', 'strain', 'rest', 'other')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL,
  PRIMARY KEY (recipe_id, step_index)
);

INSERT INTO recipe_steps (recipe_id, step_index, type, created_at, updated_at, author)
SELECT recipe_id, step_index, MIN(step_type), MIN(created_at), MAX(updated_at), MIN(author)
  FROM recipe_lines
 GROUP BY recipe_id, step_index;
