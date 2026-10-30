-- Reminders (SPEC §9). A subscription is one device's push endpoint; a nudge
-- is sent once per batch and ferment day. The schedule lives in settings.

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL
);

CREATE TABLE nudges_sent (
  batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, day)
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('nudge_hour', '18'),
  ('nudge_day0_photo', '1'),
  ('nudge_checks', '1'),
  ('nudge_burp', '0'),
  ('nudge_ready_days', '14');
