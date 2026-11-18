-- Products: add product-knowledge fields for RAG search and AI context
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS fungsi text,
  ADD COLUMN IF NOT EXISTS usp text,
  ADD COLUMN IF NOT EXISTS kata_kunci text,
  ADD COLUMN IF NOT EXISTS kelengkapan text,
  ADD COLUMN IF NOT EXISTS bahan text,
  ADD COLUMN IF NOT EXISTS ketebalan text,
  ADD COLUMN IF NOT EXISTS is_shind boolean NOT NULL DEFAULT false;

-- product_variants: add min-order fields
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS min_order_qty integer,
  ADD COLUMN IF NOT EXISTS min_order_uom_id uuid REFERENCES uom(id);
