-- Several photos per product (max 3, enforced by the API): the same box assembled and flat, so the bot
-- recognises either in a customer's photo. products.image_url stays, always equal to the first photo.
CREATE TABLE IF NOT EXISTS product_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_product_photos_product ON product_photos (product_id, sort);
--> statement-breakpoint
-- Every product that has a photo today gets it as its first photo.
INSERT INTO product_photos (product_id, image_url, sort)
SELECT p.id, p.image_url, 0 FROM products p
WHERE coalesce(p.image_url, '') <> ''
  AND NOT EXISTS (SELECT 1 FROM product_photos pp WHERE pp.product_id = p.id);
