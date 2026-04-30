-- Seed the two pass series: ACS_2601–2660 and CIN25_001–060.
-- Insert only — do not overwrite rows that already have a name assigned.

INSERT INTO passholders (barcode, name, email, synced_at)
SELECT
  'ACS_' || lpad(n::text, 4, '0') AS barcode,
  '' AS name,
  NULL AS email,
  now() AS synced_at
FROM generate_series(2601, 2660) AS n
ON CONFLICT (barcode) DO NOTHING;

INSERT INTO passholders (barcode, name, email, synced_at)
SELECT
  'CIN25_' || lpad(n::text, 3, '0') AS barcode,
  '' AS name,
  NULL AS email,
  now() AS synced_at
FROM generate_series(1, 60) AS n
ON CONFLICT (barcode) DO NOTHING;
