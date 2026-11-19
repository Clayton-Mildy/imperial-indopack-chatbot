import pg from 'pg';
import { compareGsm } from '../domain/gramasi.js';

const OPENAI_MODEL = 'text-embedding-3-small';

function buildEmbeddingText(
  brandName: string,
  productName: string,
  productDescription: string | null,
  variants: Array<{ name: string; description: string | null; gsm?: string | null }>,
  extra?: {
    fungsi?: string | null;
    kataKunci?: string | null;
    bahan?: string | null;
    kelengkapan?: string | null;
    usp?: string | null;
    ketebalan?: string | null;
  }
): string {
  const parts = [`Merek: ${brandName}`, `Produk: ${productName}`];
  if (productDescription) parts.push(productDescription);
  if (extra?.fungsi) parts.push(`Fungsi: ${extra.fungsi}`);
  if (extra?.kataKunci) parts.push(`Kata kunci: ${extra.kataKunci}`);
  if (extra?.bahan) parts.push(`Bahan: ${extra.bahan}`);
  if (extra?.kelengkapan) parts.push(`Kelengkapan: ${extra.kelengkapan}`);
  if (extra?.usp) parts.push(`USP: ${extra.usp}`);
  if (extra?.ketebalan) parts.push(`Ketebalan: ${extra.ketebalan}`);
  for (const v of variants) {
    parts.push(v.description ? `${v.name} — ${v.description}` : v.name);
  }
  const gramasi = [...new Set(variants.map((v) => v.gsm).filter((g): g is string => !!g))].sort(compareGsm);
  if (gramasi.length > 0) parts.push(`Gramasi: ${gramasi.join(', ')}`);
  return parts.join('\n');
}

async function getEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_MODEL, input: text }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { data: [{ embedding: number[] }] };
    return data.data[0].embedding;
  } catch {
    return null;
  }
}

/**
 * Regenerate the embedding for a product in the background.
 * Non-blocking — caller gets a response immediately; embedding updates asynchronously.
 * Safe to call after any product or variant write.
 */
export function refreshEmbeddingAsync(productId: string): void {
  void refreshEmbedding(productId);
}

/**
 * An import touches hundreds of products at once. Each refresh opens its OWN pg.Client and its
 * own OpenAI call, so firing them all in parallel is a self-DoS on both - they are drained one
 * at a time instead. Still background work: the caller does not await it.
 */
export async function refreshEmbeddingsSequential(productIds: string[]): Promise<void> {
  for (const id of productIds) await refreshEmbedding(id);
}

async function refreshEmbedding(productId: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/imperial_indopack';
  {
    const client = new pg.Client({ connectionString: dbUrl });
    try {
      await client.connect();

      const { rows: [product] } = await client.query<{
        id: string; name: string; description: string | null; brand_id: string;
        fungsi: string | null; kata_kunci: string | null; bahan: string | null;
        kelengkapan: string | null; usp: string | null; ketebalan: string | null;
      }>('SELECT id, name, description, brand_id, fungsi, kata_kunci, bahan, kelengkapan, usp, ketebalan FROM products WHERE id = $1', [productId]);
      if (!product) return;

      const { rows: variants } = await client.query<{ name: string; description: string | null; gsm: string | null }>(
        'SELECT name, description, gsm FROM product_variants WHERE product_id = $1 AND is_active = true ORDER BY name',
        [productId]
      );

      const { rows: [brand] } = await client.query<{ name: string }>(
        'SELECT name FROM brands WHERE id = $1', [product.brand_id]
      );

      const text = buildEmbeddingText(brand?.name ?? '', product.name, product.description, variants, {
        fungsi: product.fungsi,
        kataKunci: product.kata_kunci,
        bahan: product.bahan,
        kelengkapan: product.kelengkapan,
        usp: product.usp,
        ketebalan: product.ketebalan,
      });
      const embedding = await getEmbedding(text);
      if (!embedding) return;

      await client.query('UPDATE products SET embedding = $1 WHERE id = $2', [
        `[${embedding.join(',')}]`,
        productId,
      ]);
    } catch {
      // Non-fatal — embedding refresh is best-effort
    } finally {
      await client.end();
    }
  }
}
