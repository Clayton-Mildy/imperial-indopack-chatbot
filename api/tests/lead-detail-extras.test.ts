/** Lead detail extras: ad vs direct source, PO-form time, closing minutes, quoted price. Needs DATABASE_URL. */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, leads, phoneNumbers, conversations, messages } from '../src/db/schema.js';
import type { Product } from '../src/domain/types.js';
import { CANNED_PO_FORM_FROM_TEAM, poFormsMessage } from '../src/domain/constants.js';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));

const TS = '2026-01-01T00:00:00.000Z';
const CATALOG: Product[] = [{
  id: 'p-ks', brandId: 'b', categoryId: null, name: 'Kertas Supreme 64 gsm', description: null, fungsi: null, usp: null, kataKunci: null,
  kelengkapan: null, bahan: null, ketebalan: null, imageUrl: null, isActive: true, createdAt: TS, updatedAt: TS, referenceImageUrls: [],
  variants: [{
    id: 'v1', productId: 'p-ks', name: '35x35', sku: null, priceIdr: null, mpPriceIdr: null, isiCtn: null, isiBox: null,
    uomPriceId: null, mpUomId: null, uomCtnId: null, uomBoxId: null, minOrderQty: null, minOrderUomId: null,
    imageUrl: null, stockStatus: 'normal', isActive: true, description: null, sourceUrl: null, scrapedAt: null, sourceHash: null,
    createdAt: TS, updatedAt: TS,
    priceTiers: [{ minQty: 5, qtyUnit: 'rim', priceIdr: 185_000, priceUnit: 'rim', includesDelivery: false }, { minQty: 10, qtyUnit: 'rim', priceIdr: 165_000, priceUnit: 'rim', includesDelivery: false }],
  }],
} as unknown as Product];
const gv = (gsm: string, id: string) => ({ ...CATALOG[0]!.variants![0]!, id, productId: 'p-gr', name: '20x20x7', gsm });
CATALOG.push({ ...CATALOG[0]!, id: 'p-gr', name: 'Box Gramasi Contoh', variants: [gv('300 gsm', 'g300'), gv('350 gsm', 'g350')] });
vi.mock('../src/services/ragQuery.js', () => ({ getCatalogProducts: async () => CATALOG }));

const { leadRoutes } = await import('../src/routes/dashboard/leads.js');

const P = '__leadextras_test__';
const wib = (s: string) => new Date(`${s}+07:00`);

describe('lead detail extras', () => {
  const app = Fastify();
  const ids: Record<string, string> = {};
  let phoneId: string;

  async function cleanup() {
    const db = getDb();
    const mine = sql`(SELECT id FROM contacts WHERE wa_id LIKE ${`${P}%`})`;
    await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id IN ${mine})`);
    await db.execute(sql`DELETE FROM conversations WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE contact_id IN ${mine})`);
    await db.execute(sql`DELETE FROM leads WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${P}%`}`);
    await db.execute(sql`DELETE FROM phone_numbers WHERE number = ${`${P}n`}`);
  }

  async function mk(key: string, lead: Partial<typeof leads.$inferInsert>, msgs: { role: 'user' | 'assistant'; at: string; body: string; metadata?: Record<string, unknown>; status?: 'sent' | 'saved' }[]) {
    const db = getDb();
    const [c] = await db.insert(contacts).values({ waId: `${P}${key}`, displayName: `Contoh ${key}` }).returning();
    const [l] = await db.insert(leads).values({ contactId: c!.id, utmCampaign: P, ...lead }).returning();
    ids[key] = l!.id;
    const [cv] = await db.insert(conversations).values({ contactId: c!.id, phoneNumberId: phoneId }).returning();
    for (const m of msgs) await db.insert(messages).values({ conversationId: cv!.id, role: m.role, body: m.body, createdAt: wib(m.at), metadata: m.metadata ?? {}, status: m.status ?? null });
  }

  const quote = (tierPrice: number, total: number) => ({
    kind: 'quote', tier: { minQty: 10, qtyUnit: 'rim', priceIdr: tierPrice, priceUnit: 'rim', includesDelivery: false },
    qtyInPriceUnit: 10, unitPriceIdr: tierPrice, totalIdr: total, includesDelivery: false, nextTier: null,
  });
  const call = (variantName: string, outcome: string, unit: number) => ({
    input: {}, outcome, productId: 'p-ks', productName: 'Kertas Supreme 64 gsm', variantName, quote: outcome === 'quote' ? quote(unit, unit * 10) : null,
  });

  beforeAll(async () => {
    await app.register(leadRoutes);
    await cleanup();
    const [ph] = await getDb().insert(phoneNumbers).values({ number: `${P}n`, wabaId: 't', phoneNumberId: 't' }).returning();
    phoneId = ph!.id;
    await mk('AD', {
      status: 'won', submittedAt: wib('2020-04-01T09:00:00'), firstContactAt: wib('2020-04-01T09:00:00'), closedAt: wib('2020-04-01T09:18:00'),
      items: [{ product: 'Kertas Supreme 64 gsm', size: '35x35', qty: 10, qty_unit: 'rim' }, { product: 'Box Custom', size: '10x10x5', qty: 100 }],
    }, [
      { role: 'user', at: '2020-04-01T09:00:00', body: 'halo', metadata: { referral: { sourceType: 'ad', sourceId: '1', headline: 'Kertas Supreme cetak logo' } } },
      { role: 'assistant', at: '2020-04-01T09:02:00', body: 'harga', metadata: { priceCalls: [call('35x35', 'quote', 185_000)] } },
      { role: 'assistant', at: '2020-04-01T09:05:00', body: 'harga lagi', metadata: { priceCalls: [call('35x35', 'below_minimum', 0), call('35x35', 'quote', 165_000)] } },
      { role: 'assistant', at: '2020-04-01T09:06:00', body: 'tim akan kirim form', metadata: { source: 'po_form' }, status: 'sent' },
      { role: 'assistant', at: '2020-04-01T09:10:00', body: 'ini formnya https://forms.example/x', metadata: { source: 'po_form' }, status: 'sent' },
      // Sent again later, but the provider refused it ('saved'): it never reached the customer.
      { role: 'assistant', at: '2020-04-01T09:12:00', body: 'ini formnya https://forms.example/x', metadata: { source: 'po_form' }, status: 'saved' },
    ]);
    // The same size in two gramasi, quoted at different prices: each item takes its own gramasi's quote.
    const gcall = (gsm: string, unit: number) => ({ ...call('20x20x7', 'quote', unit), productId: 'p-gr', productName: 'Box Gramasi Contoh', gsm });
    await mk('GSM', {
      status: 'quoted', submittedAt: wib('2020-04-05T09:00:00'),
      items: [
        { product: 'Box Gramasi Contoh', size: '20x20x7', gsm: '350', qty: 10, qty_unit: 'rim' },
        { product: 'Box Gramasi Contoh', size: '20x20x7', gsm: '300 gsm', qty: 10, qty_unit: 'rim' },
        { product: 'Box Gramasi Contoh', size: '20x20x7', qty: 10, qty_unit: 'rim' },
      ],
    }, [
      { role: 'user', at: '2020-04-05T09:00:00', body: 'halo' },
      { role: 'assistant', at: '2020-04-05T09:02:00', body: 'harga', metadata: { priceCalls: [gcall('300 gsm', 150_000), gcall('350 gsm', 170_000)] } },
    ]);
    await mk('DIRECT', { status: 'new', submittedAt: wib('2020-04-02T09:00:00') }, [
      { role: 'user', at: '2020-04-02T09:00:00', body: 'halo' },
      { role: 'assistant', at: '2020-04-02T09:01:00', body: CANNED_PO_FORM_FROM_TEAM, metadata: { source: 'po_form' }, status: 'sent' },
    ]);
    // Design unknown: one message carrying both forms (cetak and plano) is a form sent too.
    await mk('BOTH', { status: 'new', submittedAt: wib('2020-04-03T09:00:00') }, [
      { role: 'user', at: '2020-04-03T09:00:00', body: 'oke saya ambil' },
      { role: 'assistant', at: '2020-04-03T09:04:00', body: poFormsMessage(['cetak', 'plano'], { cetak: 'https://forms.gle/ContohCetak', plano: 'https://forms.gle/ContohPlano' }), metadata: { source: 'po_form' }, status: 'sent' },
    ]);
    // The only PO link went out refused: no form reached the customer.
    await mk('REFUSED', { status: 'new', submittedAt: wib('2020-04-04T09:00:00') }, [
      { role: 'user', at: '2020-04-04T09:00:00', body: 'oke saya ambil' },
      { role: 'assistant', at: '2020-04-04T09:03:00', body: 'ini formnya https://forms.example/x', metadata: { source: 'po_form' }, status: 'saved' },
    ]);
  });
  afterAll(async () => { await cleanup(); await app.close(); });

  const get = async (key: string) => (await app.inject({ method: 'GET', url: `/api/v1/leads/${ids[key]}` })).json().data.extras;

  it('ad source, PO time (the last form that reached the customer), closing minutes and the quoted price', async () => {
    const x = await get('AD');
    expect(x.source).toEqual({ kind: 'ad', headline: 'Kertas Supreme cetak logo' });
    expect(x.closingMinutes).toBe(18);
    expect(x.poFormSentAt).toBe(wib('2020-04-01T09:10:00').toISOString());
    expect(x.quotedPrices).toHaveLength(2);
    expect(x.quotedPrices[0]).toMatchObject({ unitPriceIdr: 165_000, priceUnit: 'rim', totalIdr: 1_650_000 });
    expect(x.quotedPrices[1]).toBeNull();
  });

  it("a quoted price is matched to the item's gramasi", async () => {
    const x = await get('GSM');
    expect(x.quotedPrices[0]).toMatchObject({ unitPriceIdr: 170_000 });
    expect(x.quotedPrices[1]).toMatchObject({ unitPriceIdr: 150_000 });
    // No gramasi chosen and two exist: no single price to show.
    expect(x.quotedPrices[2]).toBeNull();
  });

  it('direct source without a referral, and the placeholder PO line is not a form sent', async () => {
    const x = await get('DIRECT');
    expect(x.source).toEqual({ kind: 'direct', headline: null });
    expect(x.poFormSentAt).toBeNull();
    expect(x.closingMinutes).toBeNull();
    expect(x.quotedPrices).toEqual([]);
  });

  it('the both-forms PO message counts as a form sent', async () => {
    expect((await get('BOTH')).poFormSentAt).toBe(wib('2020-04-03T09:04:00').toISOString());
  });

  it('a PO link the provider refused (saved) is not a form sent', async () => {
    expect((await get('REFUSED')).poFormSentAt).toBeNull();
  });
});
