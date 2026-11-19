/**
 * quick-send.test.ts
 *
 * The Percakapan screen's one-click sends: a brand's price-list PDF, a product's reference photos, or
 * the PO form link, sent to the customer through whatsappSender and stored as the staff member's
 * rows; the first one that goes out hands the chat to that staff member. The placeholder PO link is
 * never sent. Real Postgres with the capture transport (every send lands in a temp JSONL file).
 * Saves and restores both brands' price-list columns and the PO link setting.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));

// Every send still goes through the real whatsappSender (capture transport); `fail` makes the
// provider refuse, to see what a failed send leaves behind.
const gate = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/services/whatsappSender.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/whatsappSender.js')>();
  const refuse = () => Promise.reject(new Error('provider refused (test)'));
  return {
    ...actual,
    sendTextMessage: (...a: Parameters<typeof actual.sendTextMessage>) => (gate.fail ? refuse() : actual.sendTextMessage(...a)),
    sendImageMessage: (...a: Parameters<typeof actual.sendImageMessage>) => (gate.fail ? refuse() : actual.sendImageMessage(...a)),
    sendDocumentMessage: (...a: Parameters<typeof actual.sendDocumentMessage>) => (gate.fail ? refuse() : actual.sendDocumentMessage(...a)),
  };
});

const DIR = mkdtempSync(join(tmpdir(), 'quick-send-'));
const LOG = join(DIR, 'whatsapp-capture.jsonl');
const savedEnv = { WHATSAPP_TRANSPORT: process.env['WHATSAPP_TRANSPORT'], CAPTURE_LOG_PATH: process.env['CAPTURE_LOG_PATH'] };
process.env['WHATSAPP_TRANSPORT'] = 'capture';
process.env['CAPTURE_LOG_PATH'] = LOG;

const Fastify = (await import('fastify')).default;
const { and, asc, eq, sql } = await import('drizzle-orm');
const { getDb } = await import('../src/db/client.js');
const { appSettings, brands, contacts, contactProfiles, conversations, messages, phoneNumbers, products, productReferenceImages } =
  await import('../src/db/schema.js');
const { readCaptured } = await import('../src/services/captureClient.js');
const { conversationRoutes } = await import('../src/routes/dashboard/conversations.js');
const { poFormMessage, PO_FORM_PLACEHOLDER_URL } = await import('../src/domain/constants.js');
const { BRAND_NAME, BRAND_SLUGS } = await import('../src/domain/brands.js');
const { getBrandRowsBySlug, setBrandPriceList } = await import('../src/repositories/products.js');
const { setPoFormUrl } = await import('../src/repositories/appSettings.js');

const PREFIX = '__quick_send__';
const STAFF = 'Admin QA';
const REAL_PO = 'https://forms.gle/qa-imperial-form';
const KS_FILE = { url: `/uploads/catalogs/${PREFIX}ks.pdf`, fileName: 'Daftar Harga Contoh Kertas Supreme.pdf' };
const II_FILE = { url: `/uploads/catalogs/${PREFIX}ii.pdf`, fileName: 'Daftar Harga Contoh Imperial Indopack.pdf' };
const PHOTO = (n: number) => `/uploads/images/${PREFIX}photo-${n}.jpg`;

const app = Fastify();
const inject = (method: 'POST', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object });
const quickSend = (convId: string, action: unknown, staffName: string = STAFF) =>
  inject('POST', `/api/v1/conversations/${convId}/quick-send`, { action, staffName });

let numberId = '';
const ids = { productTwo: '', productFour: '', productBare: '', brandII: '' };
type BrandColumns = { id: string; catalogFileUrl: string | null; catalogFileName: string | null; catalogFileUploadedAt: Date | null };
const savedBrands: BrandColumns[] = [];
const createdBrandIds: string[] = [];
let savedPo: { value: unknown; updatedAt: Date } | null = null;

async function cleanup() {
  const db = getDb();
  const ours = sql`(SELECT id FROM contacts WHERE wa_id LIKE ${`${PREFIX}%`})`;
  await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id IN ${ours})`);
  await db.execute(sql`DELETE FROM conversations WHERE contact_id IN ${ours}`);
  await db.execute(sql`DELETE FROM contact_profiles WHERE contact_id IN ${ours}`);
  await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM phone_numbers WHERE number LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM products WHERE name LIKE ${`${PREFIX}%`}`);
}

/** A customer with its own chat (status `active`), its profile holding `brands` when given. */
async function chat(nn: string, brandSlugs?: string[]): Promise<{ id: string; to: string }> {
  const db = getDb();
  const to = `62812000070${nn}`;
  const [c] = await db.insert(contacts).values({ waId: `${PREFIX}${to}`, displayName: `Contoh WA ${nn}` }).returning();
  if (brandSlugs) await db.insert(contactProfiles).values({ contactId: c!.id, profile: { name: `Contoh ${nn}`, brands: brandSlugs } });
  const [conv] = await db.insert(conversations).values({ contactId: c!.id, phoneNumberId: numberId, status: 'active' }).returning();
  return { id: conv!.id, to };
}

const rowsOf = (convId: string) =>
  getDb().select().from(messages).where(eq(messages.conversationId, convId)).orderBy(asc(messages.createdAt), asc(messages.id));
const statusOf = async (convId: string) =>
  (await getDb().select().from(conversations).where(eq(conversations.id, convId)))[0]!;

beforeAll(async () => {
  await cleanup();
  const db = getDb();
  await app.register(conversationRoutes);

  // Both brand rows, their price-list columns saved as they are (a row made here is deleted again).
  const rows = await getBrandRowsBySlug();
  for (const slug of BRAND_SLUGS) {
    let id = rows[slug]?.id;
    if (!id) {
      const [made] = await db.insert(brands).values({ name: BRAND_NAME[slug] }).returning();
      id = made!.id;
      createdBrandIds.push(id);
    }
    const [raw] = await db.select().from(brands).where(eq(brands.id, id));
    savedBrands.push({ id, catalogFileUrl: raw!.catalogFileUrl, catalogFileName: raw!.catalogFileName, catalogFileUploadedAt: raw!.catalogFileUploadedAt });
    if (slug === 'imperial_indopack') ids.brandII = id;
  }
  const [po] = await db.select().from(appSettings).where(eq(appSettings.key, 'po_form_url'));
  savedPo = po ? { value: po.value, updatedAt: po.updatedAt } : null;

  const [number] = await db.insert(phoneNumbers).values({ number: `${PREFIX}n`, wabaId: 'test', phoneNumberId: 'test-quick-send' }).returning();
  numberId = number!.id;

  // Two photos stored out of order: sort decides, not insertion. Four photos: only three go.
  const [two] = await db.insert(products).values({ brandId: ids.brandII, name: `${PREFIX} Box Contoh Dua Foto` }).returning();
  ids.productTwo = two!.id;
  await db.insert(productReferenceImages).values({ productId: two!.id, imageUrl: PHOTO(2), sort: 1 });
  await db.insert(productReferenceImages).values({ productId: two!.id, imageUrl: PHOTO(1), sort: 0 });
  const [four] = await db.insert(products).values({ brandId: ids.brandII, name: `${PREFIX} Box Contoh Empat Foto` }).returning();
  ids.productFour = four!.id;
  for (const n of [10, 11, 12, 13]) await db.insert(productReferenceImages).values({ productId: four!.id, imageUrl: PHOTO(n), sort: n });
  // A catalog photo of its own, but no reference photos: the bot never sends image_url to a customer.
  const [bare] = await db.insert(products).values({ brandId: ids.brandII, name: `${PREFIX} Box Contoh Tanpa Foto`, imageUrl: PHOTO(99) }).returning();
  ids.productBare = bare!.id;
});

afterAll(async () => {
  const db = getDb();
  await cleanup();
  for (const b of savedBrands) {
    if (createdBrandIds.includes(b.id)) await db.delete(brands).where(eq(brands.id, b.id));
    else await db.update(brands).set({ catalogFileUrl: b.catalogFileUrl, catalogFileName: b.catalogFileName, catalogFileUploadedAt: b.catalogFileUploadedAt }).where(eq(brands.id, b.id));
  }
  if (savedPo) {
    await db.insert(appSettings).values({ key: 'po_form_url', ...savedPo })
      .onConflictDoUpdate({ target: appSettings.key, set: savedPo });
  } else {
    await db.delete(appSettings).where(eq(appSettings.key, 'po_form_url'));
  }
  await app.close();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(DIR, { recursive: true, force: true });
});

describe('POST /api/v1/conversations/:id/quick-send - price list', () => {
  it('sends both price lists when the profile has both brands', async () => {
    await setBrandPriceList('kertas_supreme', KS_FILE);
    await setBrandPriceList('imperial_indopack', II_FILE);
    const conv = await chat('61', ['imperial_indopack', 'kertas_supreme']);

    const res = await quickSend(conv.id, { kind: 'price_list' });
    expect(res.statusCode).toBe(200);
    const { sent } = res.json().data as { sent: { messageId: string; kind: string }[] };
    expect(sent.map((s) => s.kind)).toEqual(['document', 'document']);

    const captured = readCaptured(LOG, { to: conv.to });
    expect(captured.map((c) => [c.kind, c.path, c.filename])).toEqual([
      ['document', KS_FILE.url, KS_FILE.fileName],
      ['document', II_FILE.url, II_FILE.fileName],
    ]);

    // Each one is the staff member's row, under its wamid, tagged like the bot's own price-list rows.
    const rows = (await rowsOf(conv.id)).filter((r) => r.role === 'assistant');
    expect(rows.map((r) => r.id)).toEqual(sent.map((s) => s.messageId));
    expect(rows[0]).toMatchObject({
      senderName: STAFF, status: 'sent', waMessageId: captured[0]!.id, body: KS_FILE.fileName,
      metadata: { source: 'price_list', brand: 'Kertas Supreme', attachmentType: 'document', mediaUrl: KS_FILE.url, filename: KS_FILE.fileName, mimeType: 'application/pdf' },
    });
    expect(rows[1]).toMatchObject({
      senderName: STAFF, status: 'sent', waMessageId: captured[1]!.id,
      metadata: { source: 'price_list', brand: 'Imperial Indopack', filename: II_FILE.fileName },
    });
  });

  it('a brand given sends only that list, under the default name when the file has none', async () => {
    await setBrandPriceList('imperial_indopack', II_FILE);
    await getDb().update(brands).set({ catalogFileName: null }).where(eq(brands.id, ids.brandII));
    const conv = await chat('62', ['kertas_supreme']);

    const res = await quickSend(conv.id, { kind: 'price_list', brand: 'imperial_indopack' });
    expect(res.statusCode).toBe(200);
    expect(readCaptured(LOG, { to: conv.to }).map((c) => c.filename)).toEqual(['Daftar Harga Imperial Indopack.pdf']);
  });

  it('BRAND_UNKNOWN when no brand is known and none is given', async () => {
    await setBrandPriceList('kertas_supreme', KS_FILE);
    const conv = await chat('63');
    const before = readCaptured(LOG).length;

    const res = await quickSend(conv.id, { kind: 'price_list' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ data: null, error: 'BRAND_UNKNOWN' });
    expect(readCaptured(LOG)).toHaveLength(before);
    expect(await rowsOf(conv.id)).toHaveLength(0);
  });

  it('NO_PRICE_LIST for a brand without a file', async () => {
    await setBrandPriceList('kertas_supreme', null);
    const conv = await chat('64', ['kertas_supreme']);
    const before = readCaptured(LOG).length;

    for (const action of [{ kind: 'price_list', brand: 'kertas_supreme' }, { kind: 'price_list' }]) {
      const res = await quickSend(conv.id, action);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('NO_PRICE_LIST');
    }
    expect(readCaptured(LOG)).toHaveLength(before);
    expect(await rowsOf(conv.id)).toHaveLength(0);
    expect((await statusOf(conv.id)).status).toBe('active');
  });

  it('of two brands, the one with a file is sent', async () => {
    await setBrandPriceList('kertas_supreme', null);
    await setBrandPriceList('imperial_indopack', II_FILE);
    const conv = await chat('65', ['kertas_supreme', 'imperial_indopack']);

    expect((await quickSend(conv.id, { kind: 'price_list' })).statusCode).toBe(200);
    expect(readCaptured(LOG, { to: conv.to }).map((c) => c.filename)).toEqual([II_FILE.fileName]);
  });
});

describe('POST /api/v1/conversations/:id/quick-send - PO form', () => {
  it('refuses the placeholder PO link and sends nothing', async () => {
    await setPoFormUrl(PO_FORM_PLACEHOLDER_URL);
    const conv = await chat('66');
    const before = readCaptured(LOG).length;

    const res = await quickSend(conv.id, { kind: 'po_form' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ data: null, error: 'PO_FORM_PLACEHOLDER' });
    expect(readCaptured(LOG)).toHaveLength(before);
    expect(await rowsOf(conv.id)).toHaveLength(0);
    expect((await statusOf(conv.id)).status).toBe('active');
  });

  it('sends the PO message once a real link is set', async () => {
    await setPoFormUrl(REAL_PO);
    const conv = await chat('67');

    const res = await quickSend(conv.id, { kind: 'po_form' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sent).toEqual([{ messageId: expect.any(String), kind: 'text' }]);

    const captured = readCaptured(LOG, { to: conv.to });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ kind: 'text', text: poFormMessage(REAL_PO), phoneNumberId: 'test-quick-send' });

    const [row] = (await rowsOf(conv.id)).filter((r) => r.role === 'assistant');
    expect(row).toMatchObject({
      id: res.json().data.sent[0].messageId, body: poFormMessage(REAL_PO), senderName: STAFF, status: 'sent',
      waMessageId: captured[0]!.id, metadata: { source: 'po_form' },
    });
  });

  it('a send the provider refuses is stored as saved, and the chat stays with the AI', async () => {
    await setPoFormUrl(REAL_PO);
    const conv = await chat('68');
    gate.fail = true;
    try {
      const res = await quickSend(conv.id, { kind: 'po_form' });
      expect(res.statusCode).toBe(200);
    } finally {
      gate.fail = false;
    }
    expect(readCaptured(LOG, { to: conv.to })).toHaveLength(0);
    const rows = await rowsOf(conv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'assistant', status: 'saved', waMessageId: null, senderName: STAFF, metadata: { source: 'po_form' } });
    expect((await statusOf(conv.id)).status).toBe('active');
  });
});

describe('POST /api/v1/conversations/:id/quick-send - reference photos', () => {
  it('sends reference photos in order and hands the chat to the staff member', async () => {
    const conv = await chat('69');

    const res = await quickSend(conv.id, { kind: 'reference_photos', productId: ids.productTwo });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sent.map((s: { kind: string }) => s.kind)).toEqual(['image', 'image']);

    const captured = readCaptured(LOG, { to: conv.to });
    expect(captured.map((c) => [c.kind, c.path])).toEqual([['image', PHOTO(1)], ['image', PHOTO(2)]]);

    const photoRows = (await rowsOf(conv.id)).filter((r) => r.role === 'assistant');
    expect(photoRows.map((r) => (r.metadata as { mediaUrl: string }).mediaUrl)).toEqual([PHOTO(1), PHOTO(2)]);
    expect(photoRows[0]).toMatchObject({
      senderName: STAFF, status: 'sent', body: '[Foto]', waMessageId: captured[0]!.id,
      metadata: { source: 'reference_photo', productId: ids.productTwo, attachmentType: 'image', mimeType: 'image/jpeg' },
    });

    const after = await statusOf(conv.id);
    expect(after.status).toBe('needs_human');
    expect(after.assignedAgent).toBe(STAFF);
    const notes = await getDb().select().from(messages).where(and(eq(messages.conversationId, conv.id), eq(messages.role, 'system_note')));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain(STAFF);
  });

  it('at most three photos go', async () => {
    const conv = await chat('70');
    expect((await quickSend(conv.id, { kind: 'reference_photos', productId: ids.productFour })).statusCode).toBe(200);
    expect(readCaptured(LOG, { to: conv.to }).map((c) => c.path)).toEqual([PHOTO(10), PHOTO(11), PHOTO(12)]);
  });

  it('NO_REFERENCE_PHOTOS for a product without any, even with a catalog photo of its own', async () => {
    const conv = await chat('71');
    const before = readCaptured(LOG).length;
    const res = await quickSend(conv.id, { kind: 'reference_photos', productId: ids.productBare });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('NO_REFERENCE_PHOTOS');
    expect(readCaptured(LOG)).toHaveLength(before);
    expect(await rowsOf(conv.id)).toHaveLength(0);
  });

  it('an unknown product is 404', async () => {
    const conv = await chat('72');
    const res = await quickSend(conv.id, { kind: 'reference_photos', productId: '00000000-0000-4000-8000-000000000000' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/conversations/:id/quick-send - request', () => {
  it('404 for a malformed or unknown conversation id', async () => {
    await setPoFormUrl(REAL_PO);
    expect((await quickSend('not-a-uuid', { kind: 'po_form' })).statusCode).toBe(404);
    const res = await quickSend('00000000-0000-4000-8000-000000000000', { kind: 'po_form' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ data: null, error: 'NOT_FOUND' });
  });

  it('400 for an unknown action, a bad brand or a missing staff name', async () => {
    const conv = await chat('73');
    const before = readCaptured(LOG).length;
    for (const body of [
      { action: { kind: 'katalog' }, staffName: STAFF },
      { action: { kind: 'price_list', brand: 'lainnya' }, staffName: STAFF },
      { action: { kind: 'reference_photos', productId: 'x' }, staffName: STAFF },
      { action: { kind: 'po_form' }, staffName: '   ' },
      { action: { kind: 'po_form' } },
    ]) {
      const res = await inject('POST', `/api/v1/conversations/${conv.id}/quick-send`, body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('VALIDATION_ERROR');
    }
    expect(readCaptured(LOG)).toHaveLength(before);
  });

  it('the staff name is trimmed and capped at 100 characters', async () => {
    await setPoFormUrl(REAL_PO);
    const conv = await chat('74');
    expect((await quickSend(conv.id, { kind: 'po_form' }, `  ${'A'.repeat(150)}  `)).statusCode).toBe(200);
    const [row] = (await rowsOf(conv.id)).filter((r) => r.role === 'assistant');
    expect(row!.senderName).toBe('A'.repeat(100));
    expect((await statusOf(conv.id)).assignedAgent).toBe('A'.repeat(100));
  });
});
