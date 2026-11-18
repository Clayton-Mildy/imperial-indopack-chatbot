-- The newest customer message the background lead-insights pass has read (leadInsights.ts). A
-- conversation is due again when a customer row is newer than this. Null = never read, which is
-- how every existing conversation gets backfilled.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS insights_extracted_at TIMESTAMPTZ;
