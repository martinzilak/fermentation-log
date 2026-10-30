-- A clean start for the 2026 season (SPEC §15.9). The batches made in the app
-- so far were tests: every batch the import didn't create goes, with
-- everything under it. Foreign keys are off while a migration runs, so the
-- children are deleted here rather than by cascade. Their photo and voice
-- files stay in media/. The data step then adds the planned recipes.

CREATE TEMP TABLE gone AS SELECT id FROM batches WHERE author <> 'import';

DELETE FROM attachments WHERE event_id IN (SELECT id FROM events WHERE batch_id IN (SELECT id FROM temp.gone));
DELETE FROM events WHERE batch_id IN (SELECT id FROM temp.gone);
DELETE FROM ingredient_lines WHERE batch_id IN (SELECT id FROM temp.gone);
DELETE FROM steps WHERE batch_id IN (SELECT id FROM temp.gone);
UPDATE recipes SET created_from_batch_id = NULL WHERE created_from_batch_id IN (SELECT id FROM temp.gone);
DELETE FROM batches WHERE id IN (SELECT id FROM temp.gone);

DROP TABLE temp.gone;
