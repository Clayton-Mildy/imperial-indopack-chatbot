ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tier TEXT,
  ADD COLUMN IF NOT EXISTS related_product_ids JSONB,
  ADD COLUMN IF NOT EXISTS upsell_product_id UUID REFERENCES products(id);
