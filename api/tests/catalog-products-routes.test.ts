/**
 * catalog-products-routes.test.ts - the product editor API (routes/dashboard/catalogProducts.ts over
 * services/catalogEditor.ts) against real Postgres, through Fastify inject. Needs DATABASE_URL.
 * Every product is named __qa_editor__...; afterAll deletes them with their audit rows, the usage
 * fixtures (contact, number, conversation, lead) and any brand row this file had to create.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import Fastify from 'fastify';
import { and, eq, ilike, inArray } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import {
  brands,
  catalogAudit,
  contacts,
  conversations,
  leads,
  messages,
  phoneNumbers,
  productVariants,
  products,
  variantPriceTiers,
} from '../src/db/schema.js';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));
vi.mock('../src/services/embeddings.js', () => ({
  refreshEmbeddingsSequential: vi.fn(async () => {}),
  refreshEmbeddingAsync: vi.fn(),
}));

const { catalogProductRoutes } = await import('../src/routes/dashboard/catalogProducts.js');
const { catalogRoutes } = await import('../src/routes/dashboard/catalog.js');
const { getFullCatalogBlock } = await import('../src/services/ragQuery.js');
const { runPriceTool } = await import('../src/services/priceTool.js');
const { listCatalogHistory } = await import('../src/repositories/catalogAudit.js');
const { searchActiveProducts } = await import('../src/repositories/products.js');

const P = '__qa_editor__';
const NAME = `${P}Kertas Supreme 64 gsm cetak 1 warna`;
const USAGE_NAME = `${P}Box Ivory 270 gsm`;
const WA_ID = '6281200007061';
const ACTOR = { staffName: 'Admin QA' };

type Unit = 'rim' | 'pcs';
const tier = (minQty: number, priceIdr: number, qtyUnit: Unit = 'rim', priceUnit: Unit = 'rim', includesDelivery = false) =>
  ({ minQty, qtyUnit, priceIdr, priceUnit, includesDelivery });
const draft = (over: Record<string, unknown> = {}) => ({
  brand: 'kertas_supreme',
  name: NAME,
  gsm: '64 gsm',
  print: '1 warna',
  finishing: 'Laminasi food grade',
  use: 'bungkus nasi padang, kebab, burger',
  isActive: true,
  sizes: [
    { size: '30 x 30 cm', tiers: [tier(5, 185000), tier(10, 165000), tier(20, 160000)] },
    { size: '35 x 35 cm', tiers: [tier(5, 245000)] },
  ],
  ...over,
});
const priceQuery = { product: NAME, size: '30x30', qty: 5, unit: 'rim' as const };

describe('product editor routes', () => {
  const app = Fastify();
  const productIds = new Set<string>();
  const brandsBefore = new Set<string>();
  let id: string;
  let sizeIds: string[];

  const post = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/catalog/products', payload });
  const put = (pid: string, payload: object) => app.inject({ method: 'PUT', url: `/api/v1/catalog/products/${pid}`, payload });
  const patch = (url: string, payload: object) => app.inject({ method: 'PATCH', url, payload });
  const get = async (pid: string) => (await app.inject({ method: 'GET', url: `/api/v1/catalog/products/${pid}` })).json().data;
  const list = async (query: string) =>
    (await app.inject({ method: 'GET', url: `/api/v1/catalog/products?${query}` })).json() as { data: { id: string }[]; meta: { counts: Record<string, number> } };

  async function cleanup() {
    const db = getDb();
    const mine = await db.select({ id: products.id }).from(products).where(ilike(products.name, `${P}%`));
    for (const p of mine) productIds.add(p.id);
    if (productIds.size > 0) await db.delete(catalogAudit).where(inArray(catalogAudit.itemId, [...productIds]));
    await db.delete(products).where(ilike(products.name, `${P}%`));
    const [c] = await db.select().from(contacts).where(eq(contacts.waId, WA_ID));
    if (c) {
      await db.delete(leads).where(eq(leads.contactId, c.id));
      const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, c.id));
      if (convs.length > 0) await db.delete(messages).where(inArray(messages.conversationId, convs.map((x) => x.id)));
      await db.delete(conversations).where(eq(conversations.contactId, c.id));
      await db.delete(contacts).where(eq(contacts.id, c.id));
    }
    await db.delete(phoneNumbers).where(eq(phoneNumbers.number, `${P}n`));
    await db.delete(brands).where(ilike(brands.name, `${P}%`));
  }

  beforeAll(async () => {
    await app.register(catalogProductRoutes);
    await app.register(catalogRoutes);
    await cleanup();
    for (const b of await getDb().select({ name: brands.name }).from(brands)) brandsBefore.add(b.name);
  });

  afterAll(async () => {
    await cleanup();
    // A brand row the editor had to create for this file goes too, once nothing uses it.
    const db = getDb();
    for (const b of await db.select().from(brands)) {
      if (brandsBefore.has(b.name)) continue;
      const used = await db.select({ id: products.id }).from(products).where(eq(products.brandId, b.id)).limit(1);
      if (used.length === 0) await db.delete(brands).where(eq(brands.id, b.id));
    }
    await app.close();
  });

  it('creates a two-size product and lists it under its brand', async () => {
    const res = await post({ draft: draft(), ...ACTOR });
    expect(res.statusCode).toBe(201);
    const product = res.json().data;
    id = product.id;
    productIds.add(id);
    sizeIds = product.sizes.map((s: { id: string }) => s.id);
    expect(product).toMatchObject({ brand: 'kertas_supreme', name: NAME, gsm: '64 gsm', print: '1 warna', finishing: 'Laminasi food grade', use: 'bungkus nasi padang, kebab, burger', isActive: true });
    expect(product.sizes.map((s: { size: string }) => s.size)).toEqual(['30 x 30 cm', '35 x 35 cm']);
    expect(product.sizes[0].tiers).toHaveLength(3);

    const ks = await list('brand=kertas_supreme');
    expect(ks.data.map((p) => p.id)).toContain(id);
    expect(ks.meta.counts.kertas_supreme).toBeGreaterThan(0);
    expect(ks.meta.counts.all).toBe(ks.meta.counts.kertas_supreme + ks.meta.counts.imperial_indopack);
    expect((await list('brand=imperial_indopack')).data.map((p) => p.id)).not.toContain(id);
    expect((await list('search=qa_editor__kertas')).data.map((p) => p.id)).toEqual([id]);

    const db = getDb();
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, sizeIds[0]!));
    expect(v!.priceIdr).toBe('185000');
    const [row] = await db.select().from(products).where(eq(products.id, id));
    expect(row).toMatchObject({ description: 'Gramasi: 64 gsm · Cetak: 1 warna · Finishing: Laminasi food grade', fungsi: 'bungkus nasi padang, kebab, burger', isActive: true });

    const detail = await get(id);
    expect(detail.history).toEqual([expect.objectContaining({ changeType: 'created', actorName: 'Admin QA', changes: [{ kind: 'created', via: 'form' }] })]);
    expect(detail.usage).toEqual({ quotedLast30Days: 0, wonLeads: 0 });
  });

  it('400 VALIDATION_ERROR with tier_order details', async () => {
    const res = await post({ draft: draft({ name: `${P}Urutan`, sizes: [{ size: '30x30', tiers: [tier(10, 165000), tier(5, 185000)] }] }), ...ACTOR });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ data: null, error: 'VALIDATION_ERROR', details: [{ code: 'tier_order', sizeIndex: 0, tierIndex: 1 }] });

    // 5 rim and 2500 pcs are one threshold: reported, never a 500 from replaceVariantTiers.
    const twin = await post({ draft: draft({ name: `${P}Kembar`, sizes: [{ size: '30x30', tiers: [tier(5, 185000), tier(2500, 370, 'pcs', 'pcs')] }] }), ...ACTOR });
    expect(twin.statusCode).toBe(400);
    expect(twin.json().details).toEqual([{ code: 'tier_order', sizeIndex: 0, tierIndex: 1 }]);

    // A fractional price never reaches the database CHECK or replaceVariantTiers.
    const frac = await post({ draft: draft({ name: `${P}Pecahan`, sizes: [{ size: '30x30', tiers: [tier(5, 1500.5)] }] }), ...ACTOR });
    expect(frac.statusCode).toBe(400);
    expect(frac.json().error).toBe('VALIDATION_ERROR');

    expect((await post({ draft: draft({ name: `${P}Tanpa Staf` }) })).statusCode).toBe(400);
    const made = await getDb().select().from(products).where(inArray(products.name, [`${P}Urutan`, `${P}Kembar`, `${P}Pecahan`, `${P}Tanpa Staf`]));
    expect(made).toEqual([]);
  });

  it('409 NAME_TAKEN for a second product with the same name in other case', async () => {
    const res = await post({ draft: draft({ name: NAME.toUpperCase() }), ...ACTOR });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ data: null, error: 'NAME_TAKEN' });
  });

  it('a price edit writes one history entry with from and to', async () => {
    const d = draft();
    d.sizes[0]!.tiers[1]!.priceIdr = 160500;
    const res = await put(id, { draft: d, ...ACTOR });
    expect(res.statusCode).toBe(200);
    // Sent without ids, the sizes matched their variants by size.
    expect(res.json().data.sizes.map((s: { id: string }) => s.id)).toEqual(sizeIds);
    const detail = await get(id);
    expect(detail.history[0]).toMatchObject({ changeType: 'updated', actorName: 'Admin QA',
      changes: [{ kind: 'tier_price', size: '30 x 30 cm', minQty: 10, qtyUnit: 'rim', priceUnit: 'rim', from: 165000, to: 160500 }] });
    expect(detail.history).toHaveLength(2);

    // Saving the same draft again changes nothing and writes no history.
    expect((await put(id, { draft: d, ...ACTOR })).statusCode).toBe(200);
    expect((await get(id)).history).toHaveLength(2);
  });

  it('renaming a size keeps its variant id', async () => {
    const d = draft();
    d.sizes[0] = { id: sizeIds[0], size: '30 × 30 cm', tiers: [tier(5, 185000), tier(10, 160500), tier(20, 160000)] } as (typeof d.sizes)[number];
    d.sizes[1] = { ...d.sizes[1]!, id: sizeIds[1] } as (typeof d.sizes)[number];
    const res = await put(id, { draft: d, ...ACTOR });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sizes[0]).toMatchObject({ id: sizeIds[0], size: '30 × 30 cm' });
    expect((await get(id)).history[0].changes).toEqual([{ kind: 'size_renamed', from: '30 x 30 cm', to: '30 × 30 cm' }]);
  });

  it('deactivating hides the product from the bot at once', async () => {
    expect(await getFullCatalogBlock()).toContain(NAME);
    expect((await runPriceTool(priceQuery)).call.outcome).toBe('quote');
    const searched = async () => (await searchActiveProducts({ keywords: ['qa_editor__kertas'] })).map((p) => p.id);
    expect(await searched()).toContain(id);

    const res = await patch(`/api/v1/catalog/products/${id}/active`, { isActive: false, staffName: 'Admin QA' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.isActive).toBe(false);
    expect(await getFullCatalogBlock()).not.toContain(NAME);
    expect((await runPriceTool({ product: NAME, size: '30x30', qty: 5, unit: 'rim' })).call.outcome).toBe('not_in_catalog');
    expect(await searched()).not.toContain(id); // the RAG and photo-match search skip it too

    expect((await get(id)).history[0]).toMatchObject({ changeType: 'deactivated', changes: [{ kind: 'active', to: false }] });
    expect((await list('status=inactive')).data.map((p) => p.id)).toContain(id);
    expect((await list('status=active')).data.map((p) => p.id)).not.toContain(id);
  });

  it('deleting removes sizes and tiers and keeps the history row', async () => {
    // Back on (an unknown staff id is kept as a name only), so the delete has something to hide.
    const on = await patch(`/api/v1/catalog/products/${id}/active`, { isActive: true, staffId: '00000000-0000-4000-8000-000000000000', staffName: 'Admin QA' });
    expect(on.statusCode).toBe(200);
    expect(await getFullCatalogBlock()).toContain(NAME);
    expect((await runPriceTool(priceQuery)).call.outcome).toBe('quote');

    const res = await app.inject({ method: 'DELETE', url: `/api/v1/catalog/products/${id}?staffName=Admin%20QA` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { sizes: 2, tiers: 4 }, error: null });
    expect(await getFullCatalogBlock()).not.toContain(NAME);
    expect((await runPriceTool(priceQuery)).call.outcome).toBe('not_in_catalog');

    expect((await app.inject({ method: 'GET', url: `/api/v1/catalog/products/${id}` })).statusCode).toBe(404);
    const db = getDb();
    expect(await db.select().from(productVariants).where(inArray(productVariants.id, sizeIds))).toEqual([]);
    expect(await db.select().from(variantPriceTiers).where(inArray(variantPriceTiers.variantId, sizeIds))).toEqual([]);
    const audit = await db.select().from(catalogAudit).where(and(eq(catalogAudit.itemId, id), eq(catalogAudit.changeType, 'deleted')));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorName: 'Admin QA', changedBy: null, diff: [{ kind: 'field', field: 'name', from: NAME, to: null }] });
    expect((await listCatalogHistory(id)).map((h) => h.changeType)).toEqual(['deleted', 'activated', 'deactivated', 'updated', 'updated', 'created']);

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/catalog/products/${id}?staffName=Admin%20QA` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/catalog/products/${id}` })).statusCode).toBe(400);
  });

  it('usage counts the bot\'s quotes in 30 days and the won leads naming the product', async () => {
    const created = await post({ draft: draft({ brand: 'imperial_indopack', name: USAGE_NAME, sizes: [{ size: '21 x 14 x 5 cm', tiers: [tier(2500, 1900, 'pcs', 'pcs', true)] }] }), ...ACTOR });
    expect(created.statusCode).toBe(201);
    const pid = created.json().data.id as string;
    productIds.add(pid);

    const db = getDb();
    const [c] = await db.insert(contacts).values({ waId: WA_ID, displayName: 'Contoh QA Editor' }).returning();
    const [n] = await db.insert(phoneNumbers).values({ number: `${P}n`, wabaId: 'test', phoneNumberId: 'test' }).returning();
    const [conv] = await db.insert(conversations).values({ contactId: c!.id, phoneNumberId: n!.id }).returning();
    const call = { input: { product: USAGE_NAME, size: '21x14x5', qty: 3000, unit: 'pcs' }, outcome: 'quote', productId: pid, productName: USAGE_NAME, variantName: '21 x 14 x 5 cm', quote: null };
    await db.insert(messages).values([
      { conversationId: conv!.id, role: 'assistant', body: 'harga', metadata: { priceCalls: [call] } },
      { conversationId: conv!.id, role: 'assistant', body: 'harga lama', metadata: { priceCalls: [call] }, createdAt: new Date(Date.now() - 40 * 86_400_000) },
      { conversationId: conv!.id, role: 'user', body: 'berapa', metadata: { priceCalls: [call] } },
    ]);
    await db.insert(leads).values({ contactId: c!.id, status: 'won', items: [{ product: USAGE_NAME, size: '21x14x5', qty: 3000, qty_unit: 'pcs' }] });

    expect((await get(pid)).usage).toEqual({ quotedLast30Days: 1, wonLeads: 1 });
  });

  it('the catalog routes still invalidate the bot\'s catalog on a write', async () => {
    const db = getDb();
    await getFullCatalogBlock(); // warm
    const [brand] = await db.select().from(brands).where(eq(brands.name, 'Kertas Supreme'));
    const [p] = await db.insert(products).values({ name: `${P}Langsung`, brandId: brand!.id }).returning();
    productIds.add(p!.id);
    await db.insert(productVariants).values({ productId: p!.id, name: '25x25' });
    expect(await getFullCatalogBlock()).not.toContain(`${P}Langsung`); // still the cached block

    const res = await app.inject({ method: 'POST', url: '/api/v1/brands', payload: { name: `${P}Merek` } });
    expect(res.statusCode).toBe(201);
    expect(await getFullCatalogBlock()).toContain(`${P}Langsung`);
  });
});
