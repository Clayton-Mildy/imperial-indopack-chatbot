/**
 * demo-catalog.test.ts - loading the demo catalog is idempotent and goes through the real import;
 * purging deletes only "(CONTOH)" products. Needs DATABASE_URL. Puts the demo back afterwards if
 * the dev DB had it loaded.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { eq, like, inArray } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { brands, products, productVariants, variantPriceTiers } from '../src/db/schema.js';
import { loadDemoCatalog, purgeDemoCatalog } from '../src/services/demoCatalog.js';

const KEEP = '__demo_test__ Produk Asli';
const demoRows = () => getDb().select().from(products).where(like(products.name, '%(CONTOH)'));

describe('demo catalog', () => {
  let hadDemo = false;
  let keepId: string;

  beforeAll(async () => {
    hadDemo = (await demoRows()).length > 0;
    await purgeDemoCatalog();
    const db = getDb();
    const [brand] = await db.insert(brands).values({ name: '__demo_test__ Brand' }).onConflictDoNothing().returning();
    const brandId = brand?.id ?? (await db.select().from(brands).where(eq(brands.name, '__demo_test__ Brand')))[0]!.id;
    const [p] = await db.insert(products).values({ name: KEEP, brandId }).returning();
    keepId = p!.id;
    const [v] = await db.insert(productVariants).values({ productId: keepId, name: '1x1' }).returning();
    await db.insert(variantPriceTiers).values({ variantId: v!.id, minQty: 1, qtyUnit: 'pcs', priceIdr: '500', priceUnit: 'pcs' });
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(products).where(eq(products.id, keepId));
    await db.delete(brands).where(eq(brands.name, '__demo_test__ Brand'));
    if (hadDemo) await loadDemoCatalog();
  });

  it('loads 4 products, two of them with two gramasi; loading twice does not duplicate', async () => {
    const first = await loadDemoCatalog();
    expect(first.errors).toEqual([]);
    expect((await demoRows()).map((p) => p.name).every((n) => n.endsWith(' (CONTOH)'))).toBe(true);
    const ids = (await demoRows()).map((p) => p.id);
    const demoNames = new Map((await demoRows()).map((p) => [p.id, p.name]));
    expect(ids).toHaveLength(4);
    const variants = await getDb().select().from(productVariants).where(inArray(productVariants.productId, ids));
    expect(variants).toHaveLength(10);
    const gsmOf = (n: string) => variants.filter((v) => ids.includes(v.productId) && demoNames.get(v.productId)?.startsWith(n)).map((v) => v.gsm);
    expect(new Set(gsmOf('Box Makan Ivory')).size).toBe(2);
    expect(new Set(gsmOf('Kertas Nasi')).size).toBe(2);
    expect(new Set(gsmOf('Kertas Burger')).size).toBe(1);
    expect(variants.every((v) => v.gsm)).toBe(true);
    const tiers = () => getDb().select().from(variantPriceTiers).where(inArray(variantPriceTiers.variantId, variants.map((v) => v.id)));
    expect(await tiers()).toHaveLength(30);
    await loadDemoCatalog();
    expect(await demoRows()).toHaveLength(4);
    expect(await tiers()).toHaveLength(30);
  });

  it('purge deletes demo products with their variants and tiers, and never anything else', async () => {
    const r = await purgeDemoCatalog();
    expect(r).toEqual({ products: 4, variants: 10, tiers: 30 });
    expect(await demoRows()).toHaveLength(0);
    const [kept] = await getDb().select().from(products).where(eq(products.id, keepId));
    expect(kept?.name).toBe(KEEP);
    expect(await getDb().select().from(productVariants).where(eq(productVariants.productId, keepId))).toHaveLength(1);
    expect(await purgeDemoCatalog()).toEqual({ products: 0, variants: 0, tiers: 0 });
  });
});
