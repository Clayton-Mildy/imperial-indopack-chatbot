-- Manual rollback of 0031 (not in the journal, never run automatically). products.image_url already
-- holds each product's first photo, so dropping the table loses only the 2nd and 3rd photos.
DROP INDEX IF EXISTS idx_product_photos_product;
--> statement-breakpoint
DROP TABLE IF EXISTS product_photos;
