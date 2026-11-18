import 'dotenv/config';
import { Pool } from 'pg';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/imperial_indopack';
const FORCE = process.argv.includes('--force');
const BATCH_SIZE = 20;
const MODEL = 'text-embedding-3-small';

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY is not set.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

function buildEmbeddingText(brandName: string, productName: string, productDescription: string | null, variants: Array<{ name: string; description: string | null }>, extra?: { fungsi?: string|null; kata_kunci?: string|null; bahan?: string|null; kelengkapan?: string|null; usp?: string|null; ketebalan?: string|null }): string {
  const parts: string[] = [`Merek: ${brandName}`, `Produk: ${productName}`];
  if (productDescription) parts.push(productDescription);
  if (extra?.fungsi) parts.push(`Fungsi: ${extra.fungsi}`);
  if (extra?.kata_kunci) parts.push(`Kata kunci: ${extra.kata_kunci}`);
  if (extra?.bahan) parts.push(`Bahan: ${extra.bahan}`);
  if (extra?.kelengkapan) parts.push(`Kelengkapan: ${extra.kelengkapan}`);
  if (extra?.usp) parts.push(`USP: ${extra.usp}`);
  if (extra?.ketebalan) parts.push(`Ketebalan: ${extra.ketebalan}`);
  for (const v of variants) {
    parts.push(v.description ? `${v.name} — ${v.description}` : v.name);
  }
  return parts.join('\n');
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: { embedding: number[]; index: number }[] };
  return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

async function main() {
  console.log('🔍 Loading products...');

  const whereClause = FORCE ? '' : 'WHERE p.embedding IS NULL';
  const { rows: productRows } = await pool.query(`
    SELECT p.id, p.brand_id, p.name, p.description, p.fungsi, p.kata_kunci, p.bahan, p.kelengkapan, p.usp, p.ketebalan
    FROM products p ${whereClause}
    ORDER BY p.name
  `);

  if (productRows.length === 0) {
    console.log('✅ All products already have embeddings. Pass --force to regenerate.');
    return;
  }
  console.log(`📦 ${productRows.length} products to embed (FORCE=${FORCE})`);

  const productIds = productRows.map((p: any) => p.id);
  const { rows: variantRows } = await pool.query(
    `SELECT product_id, name, description FROM product_variants WHERE product_id = ANY($1)`,
    [productIds]
  );
  const { rows: brandRows } = await pool.query('SELECT id, name FROM brands');

  const variantMap = new Map<string, typeof variantRows>();
  for (const v of variantRows) {
    const arr = variantMap.get(v.product_id) ?? [];
    arr.push(v);
    variantMap.set(v.product_id, arr);
  }
  const brandMap = new Map(brandRows.map((b: any) => [b.id, b.name]));

  const entries = productRows.map((p: any) => ({
    id: p.id,
    text: buildEmbeddingText(
      brandMap.get(p.brand_id) ?? '',
      p.name,
      p.description,
      (variantMap.get(p.id) ?? []).map((v: any) => ({ name: v.name, description: v.description })),
      { fungsi: p.fungsi, kata_kunci: p.kata_kunci, bahan: p.bahan, kelengkapan: p.kelengkapan, usp: p.usp, ketebalan: p.ketebalan }
    ),
  }));

  let done = 0;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    console.log(`  Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(entries.length/BATCH_SIZE)} (${batch.length} products)...`);
    const embeddings = await embedBatch(batch.map(e => e.text));
    for (let j = 0; j < batch.length; j++) {
      await pool.query('UPDATE products SET embedding = $1 WHERE id = $2', [`[${embeddings[j].join(',')}]`, batch[j].id]);
    }
    done += batch.length;
    console.log(`  ✓ ${done}/${entries.length}`);
    if (i + BATCH_SIZE < entries.length) await new Promise(r => setTimeout(r, 200));
  }

  const { rows: [{ count }] } = await pool.query("SELECT COUNT(*) FROM products WHERE embedding IS NOT NULL");
  console.log(`\n✅ Done. ${count} products now have embeddings.`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); }).finally(() => pool.end());
