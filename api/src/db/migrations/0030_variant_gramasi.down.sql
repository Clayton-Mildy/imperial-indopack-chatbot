-- Manual rollback of 0030 (not in the journal, never run automatically). Refuses when a product has
-- more than one gramasi: the same size under two gramasi (the old index allows one row per size name),
-- or different gramasi on different sizes (the description below keeps only one gramasi per product).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM product_variants GROUP BY product_id, name HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM product_variants WHERE gsm IS NOT NULL GROUP BY product_id HAVING count(DISTINCT gsm) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot roll back 0030: a product has more than one gramasi (the same size under two gramasi, or different gramasi on different sizes). Merge or delete those rows first.';
  END IF;
END $$;
--> statement-breakpoint
UPDATE products p SET description = 'Gramasi: ' || g.gsm || coalesce(' · ' || p.description, '')
FROM (
  SELECT product_id, min(gsm) AS gsm FROM product_variants
  WHERE gsm IS NOT NULL GROUP BY product_id HAVING count(DISTINCT gsm) = 1
) g
WHERE g.product_id = p.id;
--> statement-breakpoint
DROP INDEX IF EXISTS uq_variant_gsm_name_per_product;
--> statement-breakpoint
ALTER TABLE product_variants DROP COLUMN IF EXISTS gsm;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_variant_name_per_product ON product_variants (product_id, name);
