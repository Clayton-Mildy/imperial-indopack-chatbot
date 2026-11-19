/**
 * catalog-import-preview.test.ts - the import dialog's dry run, the apply step's history and the template
 * download, through Fastify inject against real Postgres (needs DATABASE_URL). Products are named
 * __imp_prev__...; afterAll deletes them with their audit rows.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import writeExcelFile from 'write-excel-file/node';
import readXlsxFile from 'read-excel-file/node';
import { eq, ilike, inArray } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { catalogAudit, products, productVariants } from '../src/db/schema.js';
import { TEMPLATE_COLUMNS, TEMPLATE_SHEET } from '../src/services/catalogTemplate.js';
import { listTiersByVariant } from '../src/repositories/priceTiers.js';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));
vi.mock('../src/services/embeddings.js', () => ({
  refreshEmbeddingsSequential: vi.fn(async () => {}),
  refreshEmbeddingAsync: vi.fn(),
}));
const mockInvalidate = vi.fn();
vi.mock('../src/services/ragQuery.js', () => ({ invalidateCatalogCache: mockInvalidate, getFullCatalogBlock: async () => '' }));

const { catalogRoutes } = await import('../src/routes/dashboard/catalog.js');
const { previewCatalogImport, importCatalogFromXlsx } = await import('../src/services/catalogImport.js');

const P = '__imp_prev__';
const EXISTING = `${P}Kertas Lama`;
const FRESH = `${P}Kertas Baru`;
const SIZE = '30 x 30 cm';
const BRAND = 'Kertas Supreme';

const row = (product: string, minQty: unknown, qtyUnit: string, price: unknown, o: { size?: string; brand?: string } = {}) =>
  [o.brand ?? BRAND, product, o.size ?? SIZE, null, null, null, null, minQty, qtyUnit, price, 'rim', 'tidak', null];
const xlsxOf = (rows: unknown[][]) => writeExcelFile([{ sheet: TEMPLATE_SHEET, data: [[...TEMPLATE_COLUMNS], ...rows] as never }]).toBuffer();

async function app() {
  const a = Fastify();
  await a.register(multipart);
  await a.register(catalogRoutes);
  return a;
}
async function post(a: Awaited<ReturnType<typeof app>>, buffer: Buffer, query = '') {
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), 'katalog-november.xlsx');
  const req = new Request('http://local/', { method: 'POST', body: fd });
  return a.inject({
    method: 'POST',
    url: `/api/v1/catalog/import${query}`,
    payload: Buffer.from(await req.arrayBuffer()),
    headers: { 'content-type': req.headers.get('content-type')! },
  });
}
async function priceOf(name: string, minQty: number): Promise<number | undefined> {
  const [p] = await getDb().select().from(products).where(eq(products.name, name));
  if (!p) return undefined;
  const vs = await getDb().select().from(productVariants).where(eq(productVariants.productId, p.id));
  const tiers = (await listTiersByVariant(vs.map((v) => v.id))).get(vs[0]!.id) ?? [];
  return tiers.find((t) => t.minQty === minQty)?.priceIdr;
}
async function historyOf(name: string) {
  const [p] = await getDb().select().from(products).where(eq(products.name, name));
  if (!p) return [];
  return getDb().select().from(catalogAudit).where(eq(catalogAudit.itemId, p.id));
}
async function cleanup() {
  const db = getDb();
  const ids = (await db.select({ id: products.id }).from(products).where(ilike(products.name, `${P}%`))).map((p) => p.id);
  if (ids.length) await db.delete(catalogAudit).where(inArray(catalogAudit.itemId, ids));
  await db.delete(products).where(ilike(products.name, `${P}%`));
}

// 1 new product (row 2), 1 changed price (row 3), 1 unchanged (row 4), 3 bad rows (5, 6, 7).
const FILE = () =>
  xlsxOf([
    row(FRESH, 5, 'rim', 120000),
    row(EXISTING, 10, 'rim', 150000),
    row(EXISTING, 20, 'rim', 140000),
    row(`${P}Salah A`, 5, 'box', 1),
    row(`${P}Salah B`, 5, 'rim', 0),
    row(`${P}Salah C`, 5, 'rim', 100, { brand: 'Merek Lain' }),
  ]);

describe('catalog import preview and apply', () => {
  beforeAll(async () => {
    await cleanup();
    await importCatalogFromXlsx(await xlsxOf([row(EXISTING, 10, 'rim', 165000), row(EXISTING, 20, 'rim', 140000)]));
    mockInvalidate.mockClear();
  });
  afterAll(cleanup);

  it('dry run counts, lists errors and writes nothing', async () => {
    const a = await app();
    const res = await post(a, await FILE(), '?dryRun=1');
    expect(res.statusCode).toBe(200);
    const { preview, result } = res.json().data;
    expect(result).toBeUndefined();
    expect(preview).toMatchObject({ newProducts: 1, newSizes: 0, changedPrices: 1, unchanged: 1, totalRows: 6, validRows: 3 });
    expect(preview.errors.map((e: { row: number }) => e.row)).toEqual([5, 6, 7]);
    expect(preview.errors.map((e: { message: string }) => e.message)).toEqual([
      'Satuan "box" tidak dikenal. Pakai rim atau pcs.',
      'Harga 0. Harga harus lebih dari 0.',
      'Merek "Merek Lain" tidak dikenal. Isi Kertas Supreme atau Imperial Indopack.',
    ]);
    expect(await priceOf(EXISTING, 10)).toBe(165000);
    expect(await priceOf(FRESH, 5)).toBeUndefined();
    expect((await historyOf(EXISTING)).filter((h) => h.changeType === 'imported')).toHaveLength(0);
    expect(mockInvalidate).not.toHaveBeenCalled();
    await a.close();
  });

  it('a dry run does not invalidate the catalog cache, a real import does', async () => {
    const a = await app();
    await post(a, await FILE(), '?dryRun=1');
    await new Promise((r) => setTimeout(r, 50)); // onResponse hooks run after the reply
    expect(mockInvalidate).not.toHaveBeenCalled();
    await post(a, await xlsxOf([row(`${P}Cache`, 5, 'rim', 90000)]));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockInvalidate).toHaveBeenCalled();
    await a.close();
  });

  it('apply records history with the file name and the staff name', async () => {
    const a = await app();
    const res = await post(a, await FILE(), '?fileName=katalog-november.xlsx&staffName=Sari%20Contoh');
    expect(res.statusCode).toBe(200);
    const { preview, result } = res.json().data;
    expect(preview.newProducts).toBe(1);
    expect(result).toMatchObject({ productsCreated: 1, productsUpdated: 1 });

    const fresh = await historyOf(FRESH);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ changeType: 'created', actorName: 'Sari Contoh' });
    expect((fresh[0]!.diff as unknown[])[0]).toEqual({ kind: 'created', via: 'import', fileName: 'katalog-november.xlsx' });

    const changed = (await historyOf(EXISTING)).filter((h) => h.changeType === 'imported');
    expect(changed).toHaveLength(1);
    expect(changed[0]!.diff).toEqual([{ kind: 'tier_price', size: SIZE, minQty: 10, qtyUnit: 'rim', priceUnit: 'rim', from: 165000, to: 150000 }]);
    expect(await priceOf(EXISTING, 10)).toBe(150000);
    await a.close();
  });

  it('without a staff name the history actor is Sistem; an unchanged re-import writes no history; a name matches case-insensitively', async () => {
    const a = await app();
    await post(a, await xlsxOf([row(EXISTING.toUpperCase(), 10, 'rim', 150000, { size: '30X30' }), row(EXISTING, 20, 'rim', 130000)]));
    // historyOf has no order (a bare select), so pick rows by what they say, not by position. The earlier
    // test's import carries a staff name, and the setup import is 'created', so one row is ours.
    const added = (await historyOf(EXISTING)).filter((h) => h.changeType === 'imported' && h.actorName === 'Sistem');
    expect(added).toHaveLength(1);
    expect(added[0]!.diff).toEqual([{ kind: 'tier_price', size: SIZE, minQty: 20, qtyUnit: 'rim', priceUnit: 'rim', from: 140000, to: 130000 }]);
    const all = await getDb().select().from(products).where(ilike(products.name, `${EXISTING}`));
    expect(all).toHaveLength(1);
    const before = (await historyOf(EXISTING)).length;
    await post(a, await xlsxOf([row(EXISTING, 10, 'rim', 150000), row(EXISTING, 20, 'rim', 130000)]));
    expect((await historyOf(EXISTING)).length).toBe(before);
    await a.close();
  });

  it('a new size on an existing product is counted as a new size', async () => {
    const p = await previewCatalogImport(await xlsxOf([row(EXISTING, 5, 'rim', 99000, { size: '50 x 50 cm' })]));
    expect(p).toMatchObject({ newProducts: 0, newSizes: 1, changedPrices: 0, unchanged: 0, validRows: 1, totalRows: 1 });
  });

  it('two spellings of one size in a file merge: no tier lost, one variant, one size counted', async () => {
    const NAME = `${P}Dua Ejaan`;
    const file = () => xlsxOf([row(NAME, 5, 'rim', 185000, { size: '30x30' }), row(NAME, 10, 'rim', 165000, { size: '30 x 30 cm' })]);
    expect(await previewCatalogImport(await file())).toMatchObject({ newProducts: 1, totalRows: 2 });
    await importCatalogFromXlsx(await file());
    const [p] = await getDb().select().from(products).where(eq(products.name, NAME));
    const vs = await getDb().select().from(productVariants).where(eq(productVariants.productId, p!.id));
    expect(vs).toHaveLength(1);
    expect((await listTiersByVariant([vs[0]!.id])).get(vs[0]!.id)!.map((t) => t.minQty)).toEqual([5, 10]);
    // On an existing product, a new spelling of its size is not a new size.
    const again = await previewCatalogImport(await xlsxOf([row(NAME, 20, 'rim', 150000, { size: '30X30 CM' })]));
    expect(again.newSizes).toBe(0);
  });

  it('an over-long staff name is a 400', async () => {
    const a = await app();
    const res = await post(a, await FILE(), `?staffName=${'x'.repeat(101)}`);
    expect(res.statusCode).toBe(400);
    await a.close();
  });

  it('the template download is exactly the template header', async () => {
    const a = await app();
    const res = await a.inject({ method: 'GET', url: '/api/v1/catalog/template' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="template-katalog.xlsx"');
    const sheets = await readXlsxFile(res.rawPayload);
    expect(sheets[0]!.data).toEqual([[...TEMPLATE_COLUMNS]]);
    await a.close();
  });
});
