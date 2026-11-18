-- The marketplace price: what an end user is quoted, replacing the computed pricelist x 1.30.
-- It is NOT derivable from price_idr - the vendor rounds it up to the nearest 500 and, on rows
-- priced per lusin, divides by 12 first - so it is stored, not calculated.
--
-- mp_uom_id is separate from uom_price_id for exactly that reason: "Rp 46.000/Lsn" and
-- "Rp 5.500/Pcs" are the same row.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS mp_price_idr NUMERIC;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS mp_uom_id UUID REFERENCES uom(id);
