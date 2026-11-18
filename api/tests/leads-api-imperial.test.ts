/**
 * leads-api-imperial.test.ts - Imperial Indopack leads API: brand filter, brands/items edit and lock,
 * PO form link, reopen months and the reference photos. Through Fastify inject; needs DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { appSettings, brands, contacts, contactProfiles, leads, productReferenceImages, productVariants, products } from '../src/db/schema.js';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));
let photoN = 0;
vi.mock('../src/services/imageStorage.js', () => ({ storeUploadedImage: async () => `/uploads/images/test-${++photoN}.jpg` }));

const { leadRoutes } = await import('../src/routes/dashboard/leads.js');
const { settingsRoutes } = await import('../src/routes/dashboard/settings.js');
const { catalogRoutes } = await import('../src/routes/dashboard/catalog.js');
const { getLeadReopenAfterDays } = await import('../src/repositories/appSettings.js');
const { applyLeadOrderSnapshot, resetLeadsForContact, getLeadById } = await import('../src/repositories/leads.js');
const { getFullCatalogBlock } = await import('../src/services/ragQuery.js');
const { buildLeadsSheet } = await import('../src/services/leadsExport.js');

const P = '__leadsimperial_test__';

describe('leads API for Imperial Indopack', () => {
  const app = Fastify();
  let leadA: string;
  let leadB: string;
  let contactA: string;
  let productId: string;
  const saved = new Map<string, { had: boolean; value: unknown }>();

  const inject = (method: 'GET' | 'PATCH', url: string, payload?: unknown) =>
    app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });

  async function upload(id: string) {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('x')], { type: 'image/jpeg' }), 'ref.jpg');
    const req = new Request('http://local/', { method: 'POST', body: fd });
    return app.inject({
      method: 'POST',
      url: `/api/v1/products/${id}/reference-images`,
      payload: Buffer.from(await req.arrayBuffer()),
      headers: { 'content-type': req.headers.get('content-type')! },
    });
  }

  async function cleanup() {
    const db = getDb();
    await db.execute(sql`DELETE FROM leads WHERE contact_id IN (SELECT id FROM contacts WHERE wa_id LIKE ${`${P}%`})`);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${P}%`}`);
    await db.execute(sql`DELETE FROM products WHERE name LIKE ${`${P}%`}`);
  }

  beforeAll(async () => {
    await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });
    await app.register(leadRoutes);
    await app.register(settingsRoutes);
    await app.register(catalogRoutes);
    await cleanup();
    const db = getDb();
    for (const key of ['lead_reopen_after_days', 'po_form_url']) {
      const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
      saved.set(key, { had: !!row, value: row?.value });
    }
    const [cA] = await db.insert(contacts).values({ waId: `${P}a`, displayName: 'A' }).returning();
    const [cB] = await db.insert(contacts).values({ waId: `${P}b`, displayName: 'B' }).returning();
    contactA = cA!.id;
    await db.insert(contactProfiles).values({ contactId: contactA, profile: { name: 'Budi', business_name: 'RM Siang' } });
    const [a] = await db.insert(leads).values({ contactId: contactA, brands: ['imperial_indopack'], items: [{ product: 'Box Nasi', size: '10x10x5', qty: 100, qty_unit: 'pcs' }] }).returning();
    const [b] = await db.insert(leads).values({ contactId: cB!.id, brands: ['kertas_supreme'] }).returning();
    leadA = a!.id;
    leadB = b!.id;
    const [brand] = await db.select().from(brands).limit(1);
    const [p] = await db.insert(products).values({ brandId: brand!.id, name: `${P}prod` }).returning();
    productId = p!.id;
    await db.insert(productVariants).values({ productId, name: '10x10x5', isActive: true });
  });

  afterAll(async () => {
    const db = getDb();
    for (const [key, s] of saved) {
      if (s.had) await db.update(appSettings).set({ value: s.value }).where(eq(appSettings.key, key));
      else await db.delete(appSettings).where(eq(appSettings.key, key));
    }
    await cleanup();
    await app.close();
  });

  it('filters leads by brand and returns brands, items, name and company', async () => {
    const res = await inject('GET', `/api/v1/leads?brand=imperial_indopack&search=${P}`);
    expect(res.statusCode).toBe(200);
    const rows = res.json().data;
    expect(rows.map((r: { id: string }) => r.id)).toEqual([leadA]);
    expect(rows[0].brands).toEqual(['imperial_indopack']);
    expect(rows[0].items[0].product).toBe('Box Nasi');
    expect(rows[0].name).toBe('Budi');
    expect(rows[0].company).toBe('RM Siang');
    expect('customerType' in rows[0]).toBe(false);
    const other = await inject('GET', `/api/v1/leads?brand=kertas_supreme&search=${P}`);
    expect(other.json().data.map((r: { id: string }) => r.id)).toEqual([leadB]);
    expect((await inject('GET', '/api/v1/leads?brand=nope')).statusCode).toBe(400);
  });

  it('staff PATCH replaces items and brands, and the AI lead pass no longer merges into them', async () => {
    const res = await inject('PATCH', `/api/v1/leads/${leadA}`, {
      brands: ['kertas_supreme'],
      items: [{ product: 'Kertas Supreme 64 gsm', size: '30x30', qty: 5, qty_unit: 'rim' }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.brands).toEqual(['kertas_supreme']);
    expect(res.json().data.items).toHaveLength(1);
    expect(res.json().data.orderFieldsSetAt).not.toBeNull();

    await applyLeadOrderSnapshot(leadA, { brands: ['imperial_indopack'], items: [{ product: 'Box Nasi', size: '10x10x5' }] });
    const after = await getLeadById(leadA);
    expect(after!.brands).toEqual(['kertas_supreme']);
    expect(after!.items.map((i) => i.product)).toEqual(['Kertas Supreme 64 gsm']);

    expect((await inject('PATCH', `/api/v1/leads/${leadA}`, { brands: ['nope'] })).statusCode).toBe(400);
  });

  // Task 13 carry: staff items are stored the way the lead pass stores them.
  it('staff PATCH takes a gsm typed as a number, trims product and size, and lists a brand once', async () => {
    const res = await inject('PATCH', `/api/v1/leads/${leadA}`, {
      brands: ['kertas_supreme', 'kertas_supreme', 'imperial_indopack'],
      items: [{ product: '  Kertas Supreme  ', size: ' 30x30 ', gsm: 64, qty: 5, qty_unit: 'rim' }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.brands).toEqual(['kertas_supreme', 'imperial_indopack']);
    expect(res.json().data.items).toEqual([{ product: 'Kertas Supreme', size: '30x30', gsm: '64', qty: 5, qty_unit: 'rim' }]);
  });

  it('the PATCH item schema: gsm as text or number, blanks dropped, no other gsm types', async () => {
    const { PatchLeadBodySchema } = await import('../src/domain/schemas.js');
    const items = (body: unknown) => PatchLeadBodySchema.parse({ items: [body] }).items;
    expect(items({ product: 'Box', gsm: ' 270 ' })).toEqual([{ product: 'Box', gsm: '270' }]);
    expect(items({ product: 'Box', gsm: 64.5 })).toEqual([{ product: 'Box', gsm: '64.5' }]);
    expect(items({ product: '   ', size: '20x20' })).toEqual([{ product: undefined, size: '20x20' }]);
    for (const gsm of [true, -64, Number.NaN, {}]) {
      expect(PatchLeadBodySchema.safeParse({ items: [{ product: 'Box', gsm }] }).success, String(gsm)).toBe(false);
    }
  });

  it('/new clears the lock, so the lead pass can merge again', async () => {
    await resetLeadsForContact(contactA);
    expect((await getLeadById(leadA))!.orderFieldsSetAt).toBeNull();
    await applyLeadOrderSnapshot(leadA, { brands: ['imperial_indopack'], items: [] });
    expect((await getLeadById(leadA))!.brands.sort()).toEqual(['imperial_indopack', 'kertas_supreme']);
  });

  it('po-form-url round-trips and refuses http', async () => {
    expect((await inject('PATCH', '/api/v1/settings/po-form-url', { url: 'http://x' })).statusCode).toBe(400);
    expect((await inject('PATCH', '/api/v1/settings/po-form-url', { url: 'not a url' })).statusCode).toBe(400);
    const ok = await inject('PATCH', '/api/v1/settings/po-form-url', { url: 'https://forms.example.test/po' });
    expect(ok.statusCode).toBe(200);
    expect((await inject('GET', '/api/v1/settings/po-form-url')).json().data.url).toBe('https://forms.example.test/po');
  });

  it('reopen months store as days', async () => {
    await inject('PATCH', '/api/v1/settings/lead-reopen-months', { months: 3 });
    expect(await getLeadReopenAfterDays()).toBe(90);
    expect((await inject('GET', '/api/v1/settings/lead-reopen-months')).json().data.months).toBe(3);
    expect((await inject('PATCH', '/api/v1/settings/lead-reopen-months', { months: 13 })).statusCode).toBe(400);
    expect((await inject('PATCH', '/api/v1/settings/lead-reopen-months', { months: 0 })).statusCode).toBe(400);
    // the days route keeps working
    await inject('PATCH', '/api/v1/settings/lead-reopen-days', { days: 45 });
    expect((await inject('GET', '/api/v1/settings/lead-reopen-days')).json().data.days).toBe(45);
  });

  it('defaults to 90 days with no row', async () => {
    await getDb().delete(appSettings).where(eq(appSettings.key, 'lead_reopen_after_days'));
    expect(await getLeadReopenAfterDays()).toBe(90);
    expect((await inject('GET', '/api/v1/settings/lead-reopen-months')).json().data.months).toBe(3);
  });

  it('uploads up to three reference photos and refuses a fourth', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await upload(productId);
      expect(res.statusCode).toBe(201);
      expect(res.json().data.id).toBeTruthy();
      expect(res.json().data.imageUrl).toMatch(/^\/uploads\/images\//);
    }
    expect((await upload(productId)).statusCode).toBe(409);
    expect((await upload('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });

  it('deleting a reference photo removes it from the catalog block', async () => {
    const db = getDb();
    const [row] = await db.select().from(productReferenceImages).where(eq(productReferenceImages.productId, productId)).limit(1);
    expect(await getFullCatalogBlock()).toContain(row!.imageUrl);
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/reference-images/${row!.id}` });
    expect(res.statusCode).toBe(204);
    expect(await getFullCatalogBlock()).not.toContain(row!.imageUrl);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/reference-images/${row!.id}` })).statusCode).toBe(404);
  });

  it('the export has Merek, Barang, Nama and Usaha and no customer type', async () => {
    const { items } = await (await import('../src/repositories/leads.js')).listLeads({ page: 1, limit: 10, search: P });
    const rows = buildLeadsSheet(items)[0]!.data;
    const header = (rows[0] as { value: string }[]).map((c) => c.value);
    expect(header).toEqual(expect.arrayContaining(['Merek', 'Barang', 'Nama', 'Usaha']));
    expect(header).not.toContain('tipe_pelanggan');
  });
});
