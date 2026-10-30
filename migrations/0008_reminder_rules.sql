-- Reminders as a list of rules (SPEC §15.11): an action, the ferment day it
-- starts on (the start date is Day 1), how often it repeats and the hour.
-- The fixed schedule in settings becomes rules at its hour: the start photo,
-- a weekly photo, the pH check when deciding to end the ferment (every 3 days
-- from the old "ready" day) and the daily burp, which only reaches batches
-- whose container needs burping.

CREATE TABLE reminder_rules (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('photo', 'burp', 'ph', 'custom')),
  text TEXT,
  first_day INTEGER NOT NULL CHECK (first_day >= 1),
  every_days INTEGER NOT NULL CHECK (every_days >= 0),
  hour INTEGER NOT NULL CHECK (hour BETWEEN 8 AND 21),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL
);

CREATE TEMP TABLE old AS SELECT
  COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'nudge_hour'), 18) AS hour,
  COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'nudge_day0_photo'), 1) AS start_photo,
  COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'nudge_checks'), 1) AS checks,
  COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'nudge_ready_days'), 14) AS ready,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now;

INSERT INTO reminder_rules (id, position, action, text, first_day, every_days, hour, created_at, updated_at, author)
SELECT '891d01a4-2615-473a-8382-16158987125c', 0, 'photo', NULL, 1, 0, hour, now, now, 'system' FROM old WHERE start_photo <> 0
UNION ALL
SELECT '0d7bcbc4-e06b-4f1b-a35b-6879aa560df3', 1, 'photo', NULL, 8, 7, hour, now, now, 'system' FROM old WHERE checks <> 0
UNION ALL
SELECT 'aa31f540-9f39-4e86-b1f6-dd66a6edcc54', 2, 'ph', NULL, ready + 1, 3, hour, now, now, 'system' FROM old WHERE ready > 0
UNION ALL
SELECT 'e2930504-0045-46b5-976f-21203e28efaa', 3, 'burp', NULL, 2, 1, hour, now, now, 'system' FROM old;

DROP TABLE old;
DELETE FROM settings WHERE key LIKE 'nudge\_%' ESCAPE '\';

-- A rule goes out once per batch and day; rules due at the same hour share
-- one notification.
DROP TABLE nudges_sent;
CREATE TABLE reminders_sent (
  batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, rule_id, day)
);
