-- Enable pgvector (idempotent — already created, but safe to re-run)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to products (1536-dim = OpenAI text-embedding-3-small)
ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW index for fast cosine similarity search
-- ef_construction=64 is good for ~200 products; bump to 128 for 10k+
CREATE INDEX IF NOT EXISTS idx_products_embedding
  ON products USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
