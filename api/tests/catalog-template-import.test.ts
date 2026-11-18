/**
 * Imports the Imperial template against real Postgres (needs DATABASE_URL); rows removed afterwards.
 * First DB coverage of replaceVariantTiers + listTiersByVariant.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import writeExcelFile from 'write-excel-file/node';
import { eq, like } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { brands, products, productVariants } from '../src/db/schema.js';
import { importCatalogFromXlsx } from '../src/services/catalogImport.js';
import { listTiersByVariant } from '../src/repositories/priceTiers.js';
import { TEMPLATE_COLUMNS, TEMPLATE_SHEET } from '../src/services/catalogTemplate.js';

vi.mock('../src/services/embeddings.js', () => ({
  refreshEmbeddingsSequential: vi.fn(async () => {}),
  refreshEmbeddingAsync: vi.fn(),
}));

const P = '__tpl_import_test__';
const BRAND = `${P}Brand`;
const PROD = `${P}Kertas 64 gsm`;
const OTHER = `${P}Produk Lain`;
const SIZE = '30 x 30 cm';

const row = (product: string, minQty: number, qtyUnit: string, price: number, extra: Partial<Record<'gramasi' | 'kegunaan', string>> = {}) => [
  BRAND, product, SIZE, extra.gramasi ?? null, null, null, extra.kegunaan ?? null,
  minQty, qtyUnit, price, 'rim', 'tidak', null,
];
const xlsxOf = (rows: unknown[][]) =>
  writeExcelFile([{ sheet: TEMPLATE_SHEET, data: [[...TEMPLATE_COLUMNS], ...rows] as never }]).toBuffer();

async function variantOf(productName: string) {
  const db = getDb();
  const [p] = await db.select().from(products).where(eq(products.name, productName));
  const [v] = await db.select().from(productVariants).where(eq(productVariants.productId, p!.id));
  return { p: p!, v: v! };
}

async function cleanup() {
  const db = getDb();
  await db.delete(products).where(like(products.name, `${P}%`));
  await db.delete(brands).where(like(brands.name, `${P}%`));
}

describe('importCatalogFromXlsx with the Imperial template', () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it('creates brand, product, variant and tiers; a second import replaces tiers without duplicating', async () => {
    // Out of order on purpose; 600 pcs is below 5 rim although 600 > 5.
    const first = await importCatalogFromXlsx(
      await xlsxOf([row(PROD, 10, 'rim', 165000, { gramasi: '64 gsm', kegunaan: 'Bungkus' }), row(PROD, 5, 'rim', 185000), row(PROD, 600, 'pcs', 190000)])
    );
    expect(first.errors).toEqual([]);
    expect(first).toMatchObject({ productsCreated: 1, variantsCreated: 1, lookupsCreated: 1 });

    let { p, v } = await variantOf(PROD);
    expect(p.description).toBe('Gramasi: 64 gsm');
    expect(p.fungsi).toBe('Bungkus');
    expect(Number(v.priceIdr)).toBe(165000);
    expect(v.isActive).toBe(true);
    let tiers = (await listTiersByVariant([v.id])).get(v.id)!;
    expect(tiers.map((t) => `${t.minQty} ${t.qtyUnit}`)).toEqual(['600 pcs', '5 rim', '10 rim']); // sorted by pcs threshold, not insert order

    const second = await importCatalogFromXlsx(await xlsxOf([row(PROD, 20, 'rim', 150000)]));
    expect(second).toMatchObject({ productsCreated: 0, productsUpdated: 1, variantsCreated: 0, variantsUpdated: 1, lookupsCreated: 0 });
    ({ v } = await variantOf(PROD));
    tiers = (await listTiersByVariant([v.id])).get(v.id)!;
    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toMatchObject({ minQty: 20, priceIdr: 150000 });
    expect(Number(v.priceIdr)).toBe(150000);
    const all = await getDb().select().from(productVariants).where(eq(productVariants.productId, p.id));
    expect(all).toHaveLength(1);
  });

  it('leaves products that are not in the file untouched,', async () => {
    await importCatalogFromXlsx(await xlsxOf([row(OTHER, 5, 'rim', 99000)]));
    const before = await variantOf(OTHER);
    await importCatalogFromXlsx(await xlsxOf([row(PROD, 20, 'rim', 150000)]));
    const after = await variantOf(OTHER);
    expect(after.v.updatedAt).toEqual(before.v.updatedAt);
    expect((await listTiersByVariant([after.v.id])).get(after.v.id)).toHaveLength(1);

  });

  it('reports a bad row by number and leaves that variant as it was', async () => {
    const r = await importCatalogFromXlsx(await xlsxOf([row(PROD, 20, 'box', 1)]));
    expect(r.errors).toEqual([{ row: 2, reason: expect.stringMatching(/Satuan Qty/) }]);
    const { v } = await variantOf(PROD);
    expect((await listTiersByVariant([v.id])).get(v.id)).toHaveLength(1);
  });
});
