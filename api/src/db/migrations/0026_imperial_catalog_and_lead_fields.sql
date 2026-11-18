-- Imperial Indopack: quantity price tiers per variant, reference photos per product, and the
-- brands and item lines a lead asked about. Tiers are what the bot quotes from; qty_unit is the
-- unit of min_qty and price_unit the unit price_idr is per.
CREATE TABLE IF NOT EXISTS variant_price_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  min_qty integer NOT NULL CHECK (min_qty > 0),
  qty_unit text NOT NULL CHECK (qty_unit IN ('rim', 'pcs')),
  price_idr numeric NOT NULL CHECK (price_idr > 0),
  price_unit text NOT NULL CHECK (price_unit IN ('pcs', 'rim')),
  includes_delivery boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, min_qty, qty_unit)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS product_reference_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_product_reference_images_product ON product_reference_images (product_id, sort);
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN IF NOT EXISTS brands text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS items jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
INSERT INTO brands (name, description, brand_type) VALUES
  ('Imperial Indopack', 'Box karton (ivory, kraft) cetak untuk makanan dan produk lain', 'own'),
  ('Kertas Supreme', 'Kertas bungkus makanan cetak logo (nasi, kebab, burger)', 'own')
ON CONFLICT (name) DO NOTHING;
