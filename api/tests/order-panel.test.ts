/**
 * order-panel.test.ts
 *
 * The right-hand panel of the dashboard's Percakapan screen: the six order details (with the size
 * flagged when the catalog has no such size, and the design row when the customer sent a file), the
 * nearest catalog item for each requested item, the files the customer sent, the current lead, and
 * the team's own notes - which neither the bot's follow-up note nor /new may touch. Real Postgres;
 * the catalog is a fixture (the panel reads the same getCatalogProducts the bot quotes from).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import type { Product, ProductVariant } from '../src/domain/types.js';
import type { PriceTier } from '../src/domain/pricing.js';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));

const TS = '2026-01-01T00:00:00.000Z';
const T = (minQty: number, priceIdr: number): PriceTier => ({ minQty, qtyUnit: 'rim', priceIdr, priceUnit: 'pcs', includesDelivery: true });
const variant = (name: string): ProductVariant => ({
  id: `v-${name}`, productId: 'p-ivory', name, sku: null, priceIdr: null, mpPriceIdr: null, isiCtn: null, isiBox: null,
  uomPriceId: null, mpUomId: null, uomCtnId: null, uomBoxId: null, minOrderQty: null, minOrderUomId: null,
  imageUrl: null, stockStatus: 'normal', isActive: true, description: null, sourceUrl: null, scrapedAt: null,
  sourceHash: null, createdAt: TS, updatedAt: TS, priceTiers: [T(5, 1900), T(10, 1500)],
});
const BOXES: Product[] = [{
  id: 'p-ivory', brandId: 'b', categoryId: null, name: 'Box Ivory 270 gsm cetak full color', description: null, fungsi: null,
  usp: null, kataKunci: null, kelengkapan: null, bahan: null, ketebalan: null, imageUrl: null, isActive: true,
  createdAt: TS, updatedAt: TS, variants: [variant('21 x 7 x 5 cm'), variant('21 x 14 x 5 cm')], referenceImageUrls: [],
}];
vi.mock('../src/services/ragQuery.js', async () => ({
  ...(await vi.importActual<typeof import('../src/services/ragQuery.js')>('../src/services/ragQuery.js')),
  getCatalogProducts: async () => BOXES,
}));

import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, contactProfiles, conversations, leads, messages, phoneNumbers } from '../src/db/schema.js';
import { setTeamNotes, updateConversationFollowUp, resetConversationContext } from '../src/repositories/conversations.js';
import { getOrderPanel } from '../src/services/orderPanel.js';
import { conversationRoutes } from '../src/routes/dashboard/conversations.js';

const PREFIX = '__order_panel__';
const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000);

const ANDI = {
  name: 'Andi Contoh',
  business_name: 'Katering Contoh Sehat',
  brands: ['imperial_indopack'],
  items: [{ product: 'Box Ivory', print: 'full color', size: '22x22x7', qty: 5000, qty_unit: 'pcs', has_design: true }],
};

const conv = { id: '', bare: '' };

async function cleanup() {
  const db = getDb();
  const ours = sql`(SELECT id FROM contacts WHERE wa_id LIKE ${`${PREFIX}%`})`;
  await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id IN ${ours})`);
  await db.execute(sql`DELETE FROM conversations WHERE contact_id IN ${ours}`);
  await db.execute(sql`DELETE FROM leads WHERE contact_id IN ${ours}`);
  await db.execute(sql`DELETE FROM contact_profiles WHERE contact_id IN ${ours}`);
  await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM phone_numbers WHERE number LIKE ${`${PREFIX}%`}`);
}

beforeAll(async () => {
  await cleanup();
  const db = getDb();
  const [number] = await db.insert(phoneNumbers).values({ number: `${PREFIX}n`, wabaId: 'test', phoneNumberId: 'test' }).returning();

  const [andi] = await db.insert(contacts).values({ waId: `${PREFIX}6281200007051`, displayName: 'Contoh WA Andi' }).returning();
  await db.insert(contactProfiles).values({ contactId: andi!.id, profile: ANDI });
  await db.insert(leads).values({ contactId: andi!.id, status: 'contacted', kind: 'lead', leadTemperature: 'hot' });
  const [c] = await db.insert(conversations).values({ contactId: andi!.id, phoneNumberId: number!.id, status: 'escalated', createdAt: ago(120) }).returning();
  conv.id = c!.id;
  const rows = [
    { role: 'user', body: 'Halo kak, saya cari box nasi 22x22x7', minAgo: 60, metadata: null },
    { role: 'user', body: '[Pelanggan mengirim foto — analisis gambar terlampir]', minAgo: 50,
      metadata: { attachmentType: 'image', mimeType: 'image/jpeg', mediaUrl: '/uploads/inbound/1700000000000_wamid_IMG1.jpg' } },
    // The bot's own reference photo: a file, but not the customer's.
    { role: 'assistant', body: '', minAgo: 45, metadata: { source: 'reference_photo', attachmentType: 'image', mediaUrl: '/uploads/images/box.jpg' } },
    { role: 'user', body: '[Pelanggan mengirim dokumen]', minAgo: 40,
      metadata: { attachmentType: 'document', filename: 'logo-katering.pdf', mediaUrl: '/uploads/inbound/1700000100000_wamid_DOC1_logo-katering.pdf' } },
  ];
  for (const r of rows) {
    await db.insert(messages).values({ conversationId: conv.id, role: r.role, body: r.body, metadata: r.metadata, createdAt: ago(r.minAgo) });
  }

  // Nothing collected, no lead, no files.
  const [bare] = await db.insert(contacts).values({ waId: `${PREFIX}6281200007052`, displayName: 'Contoh WA Kosong' }).returning();
  const [b] = await db.insert(conversations).values({ contactId: bare!.id, phoneNumberId: number!.id, status: 'active' }).returning();
  conv.bare = b!.id;
});

afterAll(cleanup);

describe('getOrderPanel', () => {
  it('lists six details, the out-of-catalog size and both customer files', async () => {
    const panel = (await getOrderPanel(conv.id))!;
    expect(panel.brands).toEqual(['imperial_indopack']);
    expect(panel.lead).toMatchObject({ status: 'contacted', kind: 'lead', temperature: 'hot' });
    expect(panel.detailsFilled).toBe(6);
    expect(panel.details.map((d) => d.key)).toEqual(['name', 'business_name', 'model', 'size', 'qty', 'design']);
    expect(panel.details.find((d) => d.key === 'size')).toEqual({ key: 'size', filled: true, value: '22x22x7', note: { kind: 'out_of_catalog' } });
    // The design row points at the newest file the customer sent.
    expect(panel.details.find((d) => d.key === 'design')).toEqual({ key: 'design', filled: true, value: 'Ada', note: { kind: 'file_sent', at: ago(40).toISOString() } });
    expect(panel.details.find((d) => d.key === 'name')).not.toHaveProperty('note');

    expect(panel.files).toHaveLength(2);
    expect(panel.files).toEqual([
      { messageId: expect.any(String), kind: 'document', url: '/uploads/inbound/1700000100000_wamid_DOC1_logo-katering.pdf', filename: 'logo-katering.pdf', at: ago(40).toISOString() },
      // No filename on an image: the saved file's own name.
      { messageId: expect.any(String), kind: 'image', url: '/uploads/inbound/1700000000000_wamid_IMG1.jpg', filename: '1700000000000_wamid_IMG1.jpg', at: ago(50).toISOString() },
    ]);

    expect(panel.nearest).toHaveLength(1);
    expect(panel.nearest[0]).toMatchObject({ productName: 'Box Ivory 270 gsm cetak full color', variantName: '21 x 14 x 5 cm', exact: false, tier: { minQty: 10, priceIdr: 1500 } });
    expect(panel.teamNotes).toEqual({ text: '', updatedAt: null, updatedBy: null });
    // Has a design: the PO form staff are offered first is cetak (poFormsForOrder).
    expect(panel.suggestedPoForms).toEqual(['cetak']);
  });

  it('a chat with nothing collected: six empty rows, no lead, no files, no notes', async () => {
    const panel = (await getOrderPanel(conv.bare))!;
    expect(panel).toMatchObject({ brands: [], lead: null, detailsFilled: 0, nearest: [], files: [], suggestedPoForms: ['cetak', 'plano'] });
    expect(panel.details.every((d) => !d.filled && d.note === undefined)).toBe(true);
  });

  it('an unknown conversation is null', async () => {
    expect(await getOrderPanel('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('team notes survive an AI follow-up write and /new', async () => {
    await setTeamNotes(conv.id, 'Sudah ditelepon, minta sampel', 'Admin QA');
    await updateConversationFollowUp(conv.id, 'AI note'); await resetConversationContext(conv.id);
    expect((await getOrderPanel(conv.id))?.teamNotes).toMatchObject({ text: 'Sudah ditelepon, minta sampel', updatedBy: 'Admin QA' });
  });

  it('setTeamNotes stamps when and who, and is null for an unknown conversation', async () => {
    const before = Date.now();
    const notes = (await setTeamNotes(conv.bare, 'Minta dihubungi sore', 'Admin Contoh'))!;
    expect(notes.text).toBe('Minta dihubungi sore');
    expect(notes.updatedBy).toBe('Admin Contoh');
    expect(Date.parse(notes.updatedAt!)).toBeGreaterThanOrEqual(before - 5_000);
    expect(await setTeamNotes('00000000-0000-0000-0000-000000000000', 'x', 'Admin Contoh')).toBeNull();
  });
});

describe('routes', () => {
  async function app() {
    const a = Fastify();
    await a.register(conversationRoutes);
    return a;
  }

  it('GET order-panel answers the panel, or 404', async () => {
    const a = await app();
    const ok = await a.inject({ method: 'GET', url: `/api/v1/conversations/${conv.id}/order-panel` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ detailsFilled: 6, files: [{ kind: 'document' }, { kind: 'image' }] });
    const missing = await a.inject({ method: 'GET', url: '/api/v1/conversations/00000000-0000-0000-0000-000000000000/order-panel' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ data: null, error: 'NOT_FOUND' });
  });

  it('PATCH team-notes saves the notes with the staff name', async () => {
    const a = await app();
    const res = await a.inject({ method: 'PATCH', url: `/api/v1/conversations/${conv.id}/team-notes`, payload: { text: 'Cek plano 79x109, pot 1:6', staffName: 'Admin QA' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ text: 'Cek plano 79x109, pot 1:6', updatedBy: 'Admin QA' });
    expect((await getOrderPanel(conv.id))?.teamNotes.text).toBe('Cek plano 79x109, pot 1:6');
  });

  it('refuses notes over 2000 characters', async () => {
    const a = await app();
    const over = await a.inject({ method: 'PATCH', url: `/api/v1/conversations/${conv.id}/team-notes`, payload: { text: 'a'.repeat(2001), staffName: 'Admin QA' } });
    expect(over.statusCode).toBe(400);
    expect(over.json()).toEqual({ data: null, error: 'VALIDATION_ERROR' });
    const exactly = await a.inject({ method: 'PATCH', url: `/api/v1/conversations/${conv.id}/team-notes`, payload: { text: 'a'.repeat(2000), staffName: 'Admin QA' } });
    expect(exactly.statusCode).toBe(200);
  });

  it('a malformed id is 404 on both routes, never a database error', async () => {
    const a = await app();
    const get = await a.inject({ method: 'GET', url: '/api/v1/conversations/bukan-uuid/order-panel' });
    expect(get.statusCode).toBe(404);
    expect(get.json()).toEqual({ data: null, error: 'NOT_FOUND' });
    const patch = await a.inject({ method: 'PATCH', url: '/api/v1/conversations/bukan-uuid/team-notes', payload: { text: 'x', staffName: 'Admin QA' } });
    expect(patch.statusCode).toBe(404);
    expect(patch.json()).toEqual({ data: null, error: 'NOT_FOUND' });
  });

  it('refuses a missing staff name, and 404s an unknown conversation', async () => {
    const a = await app();
    const noName = await a.inject({ method: 'PATCH', url: `/api/v1/conversations/${conv.id}/team-notes`, payload: { text: 'x', staffName: '  ' } });
    expect(noName.statusCode).toBe(400);
    const missing = await a.inject({ method: 'PATCH', url: '/api/v1/conversations/00000000-0000-0000-0000-000000000000/team-notes', payload: { text: 'x', staffName: 'Admin QA' } });
    expect(missing.statusCode).toBe(404);
  });
});
