-- Normalized ingredients in English (SPEC §15.3). Every line refers to a
-- catalog item or, for a pepper, a variety; the Slovak names of the existing
-- record become aliases, so typing "soľ" still finds Salt and the seed files
-- import unchanged. The data step (linkLines) then points each line at its
-- entry and copies the entry's name onto it.

ALTER TABLE varieties ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ingredient_lines ADD COLUMN variety_id TEXT REFERENCES varieties (id);
CREATE INDEX ingredient_lines_variety ON ingredient_lines (variety_id);
CREATE INDEX ingredient_lines_catalog ON ingredient_lines (catalog_id);

UPDATE ingredient_lines SET variety_id = (SELECT variety_id FROM pepper_lots WHERE id = lot_id) WHERE lot_id IS NOT NULL;

-- A rename is skipped if the English name exists already; the catalog screen
-- can merge the two.
UPDATE catalog_items
   SET name = 'Spirit vinegar 8 %', aliases = json_array('Ocot kvasný liehový 8 %', 'ocot')
 WHERE id = '0cc364e2-813e-4b83-8b6d-41b8fb7d9272'
   AND NOT EXISTS (SELECT 1 FROM catalog_items WHERE name = 'Spirit vinegar 8 %' COLLATE NOCASE);

INSERT OR IGNORE INTO catalog_items (id, name, kind, aliases, created_at, updated_at, author) VALUES
  ('637b4653-fea6-4891-aff2-ac4387d602d5', 'Agave syrup', 'sweetener', json_array('Agáve sirup'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('88a9a21e-895e-4d0f-9708-d9e21a42b4b6', 'Pineapple', 'fruit', json_array('Ananás'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('1dc9c70f-055e-4a7e-a331-fca0c2bdf60a', 'Garlic', 'aromatic', json_array('Cesnak'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('d9ab59f4-648c-46e7-89af-75f92a930810', 'White onion', 'vegetable', json_array('Cibuľa biela'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('7feae388-6cfd-4dc6-806b-e711d4cebe6a', 'Red onion', 'vegetable', json_array('Cibuľa červená', 'Červená cibuľa'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('e5dcc748-3dab-4416-b8c4-81a71571b925', 'Yellow onion', 'vegetable', json_array('Cibuľa žltá'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('b4e88c7a-de88-466b-8c79-ebad9e5bacb8', 'Gala apple', 'fruit', json_array('Jablko Gala'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('7c16c32b-5ce6-47aa-92f6-6c2f76d3bb1c', 'Apple cider vinegar', 'acid', json_array('Jablčný ocot'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('0c554b77-4703-4bdc-bbf8-a3a9597c19b4', 'Coriander', 'herb', json_array('Koriander'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('282e837b-0812-46f9-bae9-65d92aefac4e', 'Lime juice', 'acid', json_array('Limetková šťava'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('4c2d06d5-f8db-43e6-8baf-9a5e4c4c448a', 'Honey', 'sweetener', json_array('Med'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('d976178f-ac75-47e2-b460-43481b2ac697', 'Carrot', 'vegetable', json_array('Mrkva'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('95717aaf-336f-432d-a36b-c03fb9c46846', 'Rice vinegar', 'acid', json_array('Ryžový ocot'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('c24af6dc-8826-4907-8ec8-43c249d1f710', 'Salt', 'salt', json_array('Soľ'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('a8d94610-098d-44a2-8ca0-eb5b76e6f185', 'Cane sugar', 'sweetener', json_array('Trstinový cukor'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('bd0cdb4d-0a2e-42ed-8a14-32ea8b04eeeb', 'Water', 'water', json_array('Voda'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('e28238e5-c82f-4d53-8f73-308f68ca47ef', 'Xanthan gum', 'thickener', json_array('Xantanová guma'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system'),
  ('cf17ecef-ee23-4392-ae3c-d9dfaf01a2a7', 'Ginger', 'aromatic', json_array('Zázvor'), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system');

-- Varieties: rename the imported Slovak names, then add any that weren't there.
CREATE TEMP TABLE variety_names (old TEXT NOT NULL, name TEXT NOT NULL, id TEXT NOT NULL);
INSERT INTO temp.variety_names (old, name, id) VALUES
  ('California červená', 'California Red', '029cdb43-303f-42a7-9d87-0da61e17c5ae'),
  ('Jalapeno zelené', 'Jalapeño Green', 'bfe04196-85f8-4719-bab1-876ad176dde7'),
  ('Jalapeno červené', 'Jalapeño Red', '10d2f3bb-9ede-434f-96b8-c0e585ff7dab'),
  ('Kozí roh biely', 'Goat Horn White', '05ae2097-5b22-4cf2-9bae-973b1c3f6171'),
  ('Kápia červená', 'Kapia Red', 'f403d662-a931-44f0-a079-9eeb3c270ff8'),
  ('Palermo červená', 'Palermo Red', '4090d70d-7c18-4702-a65a-45e3cd701119'),
  ('Sweet Amy biela', 'Sweet Amy White', '64c0f4a6-5dca-4a80-805e-28a320e8d68f');

UPDATE varieties
   SET name = (SELECT n.name FROM temp.variety_names n WHERE n.old = varieties.name COLLATE NOCASE),
       aliases = json_array((SELECT n.old FROM temp.variety_names n WHERE n.old = varieties.name COLLATE NOCASE))
 WHERE name COLLATE NOCASE IN (SELECT old FROM temp.variety_names)
   AND NOT EXISTS (
     SELECT 1 FROM temp.variety_names n JOIN varieties v ON v.name = n.name COLLATE NOCASE
      WHERE n.old = varieties.name COLLATE NOCASE);

INSERT OR IGNORE INTO varieties (id, name, aliases, created_at, updated_at, author)
SELECT id, name, json_array(old), '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'system' FROM temp.variety_names;

DROP TABLE temp.variety_names;
