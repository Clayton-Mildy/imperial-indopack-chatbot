/**
 * catalog-preview-routes.test.ts - the product form's "what the bot reads" preview and the price check
 * (catalogPreviewRoutes in routes/dashboard/catalogProducts.ts), and each brand's price-list PDF
 * (routes/dashboard/brandPriceLists.ts), against real Postgres through Fastify inject. Needs DATABASE_URL.
 *
 * Products are named __qa_preview__...; afterAll deletes them with their audit rows. Both brands'
 * price-list columns are saved in beforeAll and cleared for the run (so no route here ever deletes a
 * developer's real file), then restored in afterAll; every PDF this file uploads is deleted from
 * uploads/catalogs, and a brand row this file had to create goes once nothing uses it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { eq, ilike, inArray } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { brands, catalogAudit, products, variantPriceTiers } from '../src/db/schema.js';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));
vi.mock('../src/services/embeddings.js', () => ({
  refreshEmbeddingsSequential: vi.fn(async () => {}),
  refreshEmbeddingAsync: vi.fn(),
}));

const { catalogProductRoutes, catalogPreviewRoutes } = await import('../src/routes/dashboard/catalogProducts.js');
const { brandPriceListRoutes } = await import('../src/routes/dashboard/brandPriceLists.js');
const { resolveCatalogDelivery } = await import('../src/services/catalogDelivery.js');
const { brandSlugOfName } = await import('../src/domain/brands.js');

const P = '__qa_preview__';
const SUPREME_NAME = `${P}Kertas Supreme 64 gsm cetak 1 warna`;
const IVORY_NAME = `${P}Box Ivory 270 gsm cetak full color`;
const ACTOR = { staffName: 'Admin QA' };
const C = randomUUID(); // a contact with no profile: what the bot knows of a brand-new customer
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

type Unit = 'rim' | 'pcs';
const tier = (minQty: number | null, priceIdr: number | null, qtyUnit: Unit = 'rim', priceUnit: Unit = 'rim', includesDelivery = false) =>
  ({ minQty, qtyUnit, priceIdr, priceUnit, includesDelivery });
const supremeDraft = (size35Price: number | null) => ({
  brand: 'kertas_supreme',
  name: SUPREME_NAME,
  gsm: '64 gsm',
  print: '1 warna',
  finishing: 'Laminasi food grade',
  use: 'bungkus nasi padang, kebab, burger',
  isActive: true,
  sizes: [
    { size: '30 x 30 cm', tiers: [tier(5, 185000), tier(10, 165000), tier(20, 160000)] },
    { size: '35 x 35 cm', tiers: [tier(5, size35Price)] },
  ],
});
const SUPREME_DRAFT_WITH_EMPTY_35 = supremeDraft(null);
const ivoryDraft = (price: number, sizeId?: string) => ({
  brand: 'imperial_indopack',
  name: IVORY_NAME,
  gsm: '270 gsm',
  print: 'Full color',
  finishing: 'Non laminasi',
  use: 'box kue, cookies, snack, bento kecil',
  isActive: true,
  sizes: [{ ...(sizeId ? { id: sizeId } : {}), size: '21 x 14 x 5 cm', tiers: [tier(10, price, 'rim', 'pcs')] }],
});

/** One file as the dashboard's form sends it. */
async function multipartBody(file: { name: string; type: string; bytes: Buffer } | null) {
  const fd = new FormData();
  if (file) fd.append('file', new Blob([file.bytes], { type: file.type }), file.name);
  else fd.append('note', 'no file');
  const req = new Request('http://local/', { method: 'POST', body: fd });
  return { payload: Buffer.from(await req.arrayBuffer()), headers: { 'content-type': req.headers.get('content-type')! } };
}
const pdf = (name: string) => ({ name, type: 'application/pdf', bytes: PDF_BYTES });
const onDisk = (url: string) => join(process.cwd(), url);

describe('product preview, price check and brand price lists', () => {
  const app = Fastify();
  const productIds = new Set<string>();
  const brandsBefore = new Set<string>();
  /** Each brand row's price-list columns as they were, restored in afterAll. */
  const saved: { id: string; url: string | null; name: string | null; at: Date | null }[] = [];
  const uploaded = new Set<string>();
  const SENTINEL = '/uploads/__qa_preview_keep__.pdf';
  let ivoryId: string;
  let ivorySizeId: string;
  let supremeId: string;

  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
  const upload = async (slug: string, file: Parameters<typeof multipartBody>[0], a = app) => {
    const res = await a.inject({ method: 'POST', url: `/api/v1/brands/${slug}/price-list`, ...(await multipartBody(file)) });
    const url = res.json().data?.url as string | undefined;
    if (url) uploaded.add(url);
    return res;
  };
  const priceLists = async () => (await app.inject({ method: 'GET', url: '/api/v1/brands/price-lists' })).json().data;
  const brandRow = async (name: string) => (await getDb().select().from(brands).where(eq(brands.name, name)))[0];

  async function cleanupProducts() {
    const db = getDb();
    const mine = await db.select({ id: products.id }).from(products).where(ilike(products.name, `${P}%`));
    for (const p of mine) productIds.add(p.id);
    if (productIds.size > 0) await db.delete(catalogAudit).where(inArray(catalogAudit.itemId, [...productIds]));
    await db.delete(products).where(ilike(products.name, `${P}%`));
  }

  beforeAll(async () => {
    await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });
    await app.register(catalogProductRoutes);
    await app.register(catalogPreviewRoutes);
    await app.register(brandPriceListRoutes);
    await cleanupProducts();
    const db = getDb();
    for (const b of await db.select().from(brands)) {
      brandsBefore.add(b.name);
      if (!brandSlugOfName(b.name)) continue;
      saved.push({ id: b.id, url: b.catalogFileUrl, name: b.catalogFileName, at: b.catalogFileUploadedAt });
      await db.update(brands).set({ catalogFileUrl: null, catalogFileName: null, catalogFileUploadedAt: null }).where(eq(brands.id, b.id));
    }
  });

  afterAll(async () => {
    await cleanupProducts();
    const db = getDb();
    for (const s of saved) {
      await db.update(brands).set({ catalogFileUrl: s.url, catalogFileName: s.name, catalogFileUploadedAt: s.at }).where(eq(brands.id, s.id));
    }
    for (const b of await db.select().from(brands)) {
      if (brandsBefore.has(b.name)) continue;
      const used = await db.select({ id: products.id }).from(products).where(eq(products.brandId, b.id)).limit(1);
      if (used.length === 0) await db.delete(brands).where(eq(brands.id, b.id));
    }
    for (const url of [...uploaded, SENTINEL]) await unlink(onDisk(url)).catch(() => {});
    await app.close();
  });

  // ─── Preview ──────────────────────────────────────────────────────────────

  it('preview shows tier lines exactly as the bot reads them and hides an incomplete size', async () => {
    const res = await post('/api/v1/catalog/products/preview', { draft: SUPREME_DRAFT_WITH_EMPTY_35 });
    expect(res.statusCode).toBe(200);
    const p = res.json().data;
    expect(p.botText).toContain('  • mulai 5 rim (2.500 pcs): Rp 185.000/rim, belum termasuk ongkir');
    expect(p.hiddenSizes).toEqual(['35 x 35 cm']);
    expect(p.errors).toEqual([{ code: 'price_missing', sizeIndex: 1, tierIndex: 0 }]);
    expect(p.changes).toEqual([]);
    expect(p.botText).toContain('Merek: Kertas Supreme');
    expect(p.botText).toContain(`Produk: ${SUPREME_NAME} — Gramasi: 64 gsm · Cetak: 1 warna · Finishing: Laminasi food grade`);
    expect(p.botText).toContain('Kegunaan: bungkus nasi padang, kebab, burger');
    expect(p.botText).toContain('  - Ukuran: 30 x 30 cm');
    expect(p.botText).toContain('  • mulai 20 rim (10.000 pcs): Rp 160.000/rim, belum termasuk ongkir');
    expect(p.botText).not.toContain('35 x 35');
    // A preview saves nothing.
    expect(await getDb().select().from(products).where(eq(products.name, SUPREME_NAME))).toEqual([]);
  });

  it('a shown size is trimmed as the save trims it, a hidden one is listed as typed; a malformed body is a 400', async () => {
    const draft = { ...SUPREME_DRAFT_WITH_EMPTY_35, sizes: [{ size: '  30 x 30 cm ', tiers: [tier(5, 185000)] }, { size: ' 40 x 40 ', tiers: [] }] };
    const p = (await post('/api/v1/catalog/products/preview', { draft })).json().data;
    expect(p.botText).toContain('  - Ukuran: 30 x 30 cm\n');
    expect(p.hiddenSizes).toEqual([' 40 x 40 ']);
    expect(p.errors).toEqual([{ code: 'no_tiers', sizeIndex: 1 }]);

    expect((await post('/api/v1/catalog/products/preview', { draft: { ...draft, brand: 'lain' } })).statusCode).toBe(400);
    expect((await post('/api/v1/catalog/products/preview', { productId: 'nope', draft })).statusCode).toBe(400);
  });

  it('preview of a stored product lists the unsaved change', async () => {
    const created = await post('/api/v1/catalog/products', { draft: ivoryDraft(1500), ...ACTOR });
    expect(created.statusCode).toBe(201);
    ivoryId = created.json().data.id;
    productIds.add(ivoryId);
    ivorySizeId = created.json().data.sizes[0].id;

    const res = await post('/api/v1/catalog/products/preview', { productId: ivoryId, draft: ivoryDraft(1450, ivorySizeId) });
    expect(res.statusCode).toBe(200);
    const p = res.json().data;
    expect(p.changes).toEqual([{ kind: 'tier_price', size: '21 x 14 x 5 cm', minQty: 10, qtyUnit: 'rim', priceUnit: 'pcs', from: 1500, to: 1450 }]);
    expect(p.errors).toEqual([]);
    expect(p.hiddenSizes).toEqual([]);
    expect(p.botText).toContain('Merek: Imperial Indopack');
    expect(p.botText).toContain('  • mulai 10 rim (5.000 pcs): Rp 1.450/pcs, belum termasuk ongkir');
    // Nothing was saved: the bot still has 1.500.
    const stored = (await app.inject({ method: 'GET', url: `/api/v1/catalog/products/${ivoryId}` })).json().data.product;
    expect(stored.sizes[0].tiers[0].priceIdr).toBe(1500);
  });

  it('preview of a stored product keeps what the save keeps: an Excel note on a tier, the reference photos', async () => {
    await getDb().update(variantPriceTiers).set({ note: 'cetak 1 sisi' }).where(eq(variantPriceTiers.variantId, ivorySizeId));
    const p = (await post('/api/v1/catalog/products/preview', { productId: ivoryId, draft: ivoryDraft(1450, ivorySizeId) })).json().data;
    expect(p.botText).toContain('  • mulai 10 rim (5.000 pcs): Rp 1.450/pcs, belum termasuk ongkir (cetak 1 sisi)');
    // The same draft without the product id is a new product: it has no note yet.
    const fresh = (await post('/api/v1/catalog/products/preview', { draft: ivoryDraft(1450) })).json().data;
    expect(fresh.botText).not.toContain('cetak 1 sisi');
  });

  it('preview of a stored product with an invalid draft has no changes, and an unknown product is a 404', async () => {
    const bad = { ...ivoryDraft(1450, ivorySizeId), name: '  ' };
    const p = (await post('/api/v1/catalog/products/preview', { productId: ivoryId, draft: bad })).json().data;
    expect(p.errors).toEqual([{ code: 'name_required' }]);
    expect(p.changes).toEqual([]);
    const missing = await post('/api/v1/catalog/products/preview', { productId: randomUUID(), draft: ivoryDraft(1450) });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ data: null, error: 'NOT_FOUND' });
  });

  // ─── Price check ──────────────────────────────────────────────────────────

  it('price check answers what the bot would', async () => {
    const created = await post('/api/v1/catalog/products', { draft: supremeDraft(245000), ...ACTOR });
    expect(created.statusCode).toBe(201);
    supremeId = created.json().data.id;
    productIds.add(supremeId);

    const res = await post('/api/v1/catalog/price-check', { product: SUPREME_NAME, size: '30x30', qty: 12, unit: 'rim' });
    expect(res.statusCode).toBe(200);
    const { text, call } = res.json().data;
    expect(text).toMatch(/^HARGA:/);
    expect(call.outcome).toBe('quote');
    expect(call.quote.totalIdr).toBe(1980000);
    expect(call.productName).toBe(SUPREME_NAME);
    expect(Object.keys(res.json().data).sort()).toEqual(['call', 'text']);
  });

  it('price check reads the live catalog: a switched-off product is not priced', async () => {
    const off = await app.inject({ method: 'PATCH', url: `/api/v1/catalog/products/${supremeId}/active`, payload: { isActive: false, ...ACTOR } });
    expect(off.statusCode).toBe(200);
    const res = await post('/api/v1/catalog/price-check', { product: SUPREME_NAME, size: '30x30', qty: 12, unit: 'rim' });
    expect(res.json().data.text).toMatch(/^TIDAK_ADA_DI_KATALOG:/);
    expect(res.json().data.call.outcome).toBe('not_in_catalog');
    expect((await post('/api/v1/catalog/price-check', { product: SUPREME_NAME, size: '30x30', qty: 12, unit: 'lusin' })).statusCode).toBe(400);
  });

  // ─── Brand price lists ────────────────────────────────────────────────────

  it('uploads a price list with name and date; GET lists both brands', async () => {
    const before = Date.now();
    const res = await upload('kertas_supreme', pdf('Daftar Harga KS QA.pdf'));
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({ brand: 'kertas_supreme', fileName: 'Daftar Harga KS QA.pdf' });
    expect(data.url).toMatch(/^\/uploads\/catalogs\/[0-9a-f-]{36}\.pdf$/);
    expect(Date.parse(data.uploadedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(readFileSync(onDisk(data.url)).equals(PDF_BYTES)).toBe(true);

    expect(await priceLists()).toEqual([
      data,
      { brand: 'imperial_indopack', url: null, fileName: null, uploadedAt: null },
    ]);
  });

  it('refuses a PNG', async () => {
    const res = await upload('kertas_supreme', { name: 'harga.png', type: 'image/png', bytes: PNG_BYTES });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ data: null, error: 'UNSUPPORTED_MIME_TYPE' });
    // Named and typed as a PDF but not one inside.
    const fake = await upload('kertas_supreme', { name: 'harga.pdf', type: 'application/pdf', bytes: PNG_BYTES });
    expect(fake.statusCode).toBe(400);
    expect(fake.json()).toEqual({ data: null, error: 'UNSUPPORTED_MIME_TYPE' });
    expect((await priceLists())[0].fileName).toBe('Daftar Harga KS QA.pdf');

    expect((await upload('kertas_supreme', null)).json()).toEqual({ data: null, error: 'NO_FILE' });
    const unknown = await upload('brand_lain', pdf('x.pdf'));
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ data: null, error: 'NOT_FOUND' });
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/brands/brand_lain/price-list' })).statusCode).toBe(404);
  });

  it('the bot sends the uploaded file name', async () => {
    const d = await resolveCatalogDelivery(C, 'berapa harga kertas supreme?');
    const [ks] = await priceLists();
    expect(d.files).toEqual([{ url: ks.url, filename: 'Daftar Harga KS QA.pdf', brand: 'Kertas Supreme' }]);
  });

  it('replacing a price list deletes the old file; a name without .pdf gets it', async () => {
    const [old] = await priceLists();
    const res = await upload('kertas_supreme', pdf('harga terbaru'));
    expect(res.statusCode).toBe(200);
    const now = res.json().data;
    expect(now.fileName).toBe('harga terbaru.pdf');
    expect(now.url).not.toBe(old.url);
    expect(existsSync(onDisk(now.url))).toBe(true);
    expect(existsSync(onDisk(old.url))).toBe(false);
  });

  it('a file another brand still uses is kept until neither does', async () => {
    const [ks] = await priceLists();
    await getDb().update(brands).set({ catalogFileUrl: ks.url, catalogFileName: 'Bersama.pdf' }).where(eq(brands.name, 'Imperial Indopack'));
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/brands/kertas_supreme/price-list' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ brand: 'kertas_supreme', url: null, fileName: null, uploadedAt: null });
    expect(existsSync(onDisk(ks.url))).toBe(true);

    const gone = await app.inject({ method: 'DELETE', url: '/api/v1/brands/imperial_indopack/price-list' });
    expect(gone.json().data).toEqual({ brand: 'imperial_indopack', url: null, fileName: null, uploadedAt: null });
    expect(existsSync(onDisk(ks.url))).toBe(false);
    expect((await brandRow('Imperial Indopack'))?.catalogFileName ?? null).toBeNull();
  });

  it('after a delete the bot sends nothing for that brand and says so', async () => {
    const d = await resolveCatalogDelivery(randomUUID(), 'berapa harga kertas supreme?');
    expect(d.files).toEqual([]);
    expect(d.note).toMatch(/Daftar harga Kertas Supreme belum tersedia/);
  });

  it('never deletes a file outside uploads/catalogs', async () => {
    await mkdir(join(process.cwd(), 'uploads'), { recursive: true });
    await writeFile(onDisk(SENTINEL), PDF_BYTES);
    for (const url of ['/uploads/catalogs/../__qa_preview_keep__.pdf', SENTINEL]) {
      await getDb().update(brands).set({ catalogFileUrl: url }).where(eq(brands.name, 'Kertas Supreme'));
      const res = await app.inject({ method: 'DELETE', url: '/api/v1/brands/kertas_supreme/price-list' });
      expect(res.statusCode).toBe(200);
      expect(existsSync(onDisk(SENTINEL))).toBe(true);
    }
  });

  it('a file over the upload limit is a 413', async () => {
    const small = Fastify();
    await small.register(multipart, { limits: { fileSize: 16 } });
    await small.register(brandPriceListRoutes);
    const res = await upload('kertas_supreme', pdf('besar.pdf'), small);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ data: null, error: 'FILE_TOO_LARGE' });
    await small.close();
    expect((await priceLists())[0].url).toBeNull();
  });
});
