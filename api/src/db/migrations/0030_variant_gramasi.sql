-- Gramasi moves from the product description ("Gramasi: 270 gsm · Cetak: ...") to the size rows, so one
-- product can offer the same size in several gramasi. Every statement is safe to run twice.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS gsm text;
--> statement-breakpoint
DROP INDEX IF EXISTS uq_variant_name_per_product;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_variant_gsm_name_per_product ON product_variants (product_id, coalesce(gsm, ''), name);
--> statement-breakpoint
-- Each size row takes its product's description gramasi (numbers become "<n> gsm").
UPDATE product_variants v SET gsm = s.g
FROM (
  SELECT DISTINCT ON (p.id) p.id AS pid,
    CASE
      WHEN raw ~* '^\d+(\.\d+)?\s*(gsm)?$' THEN regexp_replace(raw, '\s*gsm$', '', 'i') || ' gsm'
      ELSE raw
    END AS g
  FROM products p,
    LATERAL unnest(string_to_array(p.description, ' · ')) AS seg,
    LATERAL (SELECT btrim(regexp_replace((regexp_match(seg, '^\s*Gramasi:\s*(\S.*)$'))[1], '\s+', ' ', 'g')) AS raw) r
  WHERE raw IS NOT NULL
) s
WHERE v.product_id = s.pid AND v.gsm IS NULL;
--> statement-breakpoint
-- The description keeps everything except the Gramasi segment; NULL when nothing is left.
UPDATE products p SET description = NULLIF((
  SELECT string_agg(seg, ' · ' ORDER BY ord)
  FROM unnest(string_to_array(p.description, ' · ')) WITH ORDINALITY AS t(seg, ord)
  WHERE seg !~ '^\s*Gramasi:\s*\S'
), '')
WHERE p.description ~ '(^| · )\s*Gramasi:\s*\S';
