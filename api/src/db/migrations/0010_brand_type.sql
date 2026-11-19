-- Replace product-level is_shind flag with a brand-level brand_type classification.
-- brand_type values: 'own' (the company's own brands) | 'distributed' (third-party brands).
-- New distributed brands just need an entry in the brands table — no schema change required.

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS brand_type text NOT NULL DEFAULT 'own';

ALTER TABLE products
  DROP COLUMN IF EXISTS is_shind;
