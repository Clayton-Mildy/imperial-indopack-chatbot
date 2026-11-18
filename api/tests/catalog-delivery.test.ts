/**
 * catalog-delivery.test.ts
 * Which price-list files a message earns (services/catalogDelivery.ts, spec 7.3). A price question
 * asked before the profile holds an item with product, size and quantity gets the price list of each
 * brand the profile or the message names - once per conversation per brand, unless the customer
 * asks for it again. No brand known: nothing is sent and the bot asks what they pack.
 *
 * Mocked profile and brands - no DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CATALOG_SENT_MARKER } from '../src/domain/constants.js';

const mockGetContactProfile = vi.fn();
const mockListBrands = vi.fn();
vi.mock('../src/repositories/contactProfiles.js', () => ({ getContactProfile: mockGetContactProfile }));
vi.mock('../src/repositories/products.js', () => ({ listBrands: mockListBrands }));

const C = 'contact-1';
const IMPERIAL_PDF = 'https://cdn.example/daftar-harga-imperial.pdf';
const SUPREME_PDF = 'https://cdn.example/daftar-harga-supreme.pdf';
const BRANDS = [
  { id: 'b1', name: 'Imperial Indopack', catalogFileUrl: IMPERIAL_PDF },
  { id: 'b2', name: 'Kertas Supreme', catalogFileUrl: SUPREME_PDF },
];
const PRICED_ITEM = { product: 'Kertas Supreme 64 gsm', size: '30x30', qty: 10, qty_unit: 'rim' };
const UNKNOWN_BRAND_NOTE = 'Merek belum jelas: tanyakan dulu barang apa yang mau dikemas, JANGAN bilang daftar harga sudah dikirim.';

/** A fresh module per test: the once-per-conversation record lives in it. */
async function load() {
  vi.resetModules();
  return import('../src/services/catalogDelivery.js');
}
/** null = no contact_profiles row yet (a brand-new customer). */
const withFacts = (facts: Record<string, unknown> | null) =>
  mockGetContactProfile.mockResolvedValue(facts && { contactId: C, customerType: null, profile: facts });
const urls = (d: { files: { url: string }[] }) => d.files.map((f) => f.url);

beforeEach(() => {
  vi.clearAllMocks();
  mockListBrands.mockResolvedValue(BRANDS);
  withFacts(null);
});

describe('the price list goes to a price question, by brand', () => {
  // Review focus 4: the ad's own text, before anything else is known.
  it('the bare ad text sends the Kertas Supreme price list from an empty profile', async () => {
    const { resolveCatalogDelivery } = await load();
    const d = await resolveCatalogDelivery(C, 'berapa harga kertas supreme?');
    expect(d.files.map((f) => f.url)).toEqual([SUPREME_PDF]);
    expect(d.files[0]!.filename).toBe('Price List Kertas Supreme.pdf');
    expect(d.note.startsWith(CATALOG_SENT_MARKER)).toBe(true);
    expect(d.note).toContain('Daftar harga Kertas Supreme sudah dikirim');
  });

  it('both brands in the profile send both files', async () => {
    const { resolveCatalogDelivery } = await load();
    withFacts({ brands: ['kertas_supreme', 'imperial_indopack'] });
    const d = await resolveCatalogDelivery(C, 'minta pricelist nya dong kak');
    expect(urls(d)).toEqual([SUPREME_PDF, IMPERIAL_PDF]);
    expect(d.note).toContain('Daftar harga Kertas Supreme, Imperial Indopack sudah dikirim');
  });

  it('a brand named in the message joins the ones in the profile', async () => {
    const { resolveCatalogDelivery } = await load();
    withFacts({ brands: ['kertas_supreme'] });
    expect(urls(await resolveCatalogDelivery(C, 'kalau dus makanan berapa harganya?'))).toEqual([SUPREME_PDF, IMPERIAL_PDF]);
  });

  it('the brands this very turn recorded count (the model-flagged path runs after the reply)', async () => {
    const { resolveCatalogDelivery } = await load();
    const d = await resolveCatalogDelivery(C, 'buat nasi padang kak', { fresh: { facts: { brands: ['kertas_supreme'] } } });
    expect(urls(d)).toEqual([SUPREME_PDF]);
  });

  it('an unknown brand sends nothing and asks what they pack', async () =>
    expect((await (await load()).resolveCatalogDelivery(C, 'berapa harganya kak?')).note).toMatch(/barang apa yang mau dikemas/));

  it('an unknown brand says so in the fixed words, with no file', async () => {
    const { resolveCatalogDelivery } = await load();
    const d = await resolveCatalogDelivery(C, 'berapa harganya kak?');
    expect(d.files).toEqual([]);
    expect(d.note).toContain(UNKNOWN_BRAND_NOTE);
    expect(d.note).not.toContain(CATALOG_SENT_MARKER);
    expect(mockListBrands).not.toHaveBeenCalled();
  });

  it('a priced item sends no file', async () => {
    const { resolveCatalogDelivery } = await load();
    withFacts({ brands: ['kertas_supreme'], items: [PRICED_ITEM] });
    const d = await resolveCatalogDelivery(C, 'berapa harga kertas supreme nya?');
    expect(d.files).toEqual([]);
    expect(d.note).toContain('hitung_harga');
    expect(d.note).not.toContain(CATALOG_SENT_MARKER);
  });

  it('a priced item given in this very message also sends no file', async () => {
    const { resolveCatalogDelivery } = await load();
    const d = await resolveCatalogDelivery(C, 'kertas supreme 30x30 10 rim berapa?', { fresh: { facts: { items: [PRICED_ITEM] } } });
    expect(d.files).toEqual([]);
  });

  it('an item still missing its size or quantity does not stop the price list', async () => {
    const { resolveCatalogDelivery } = await load();
    withFacts({ items: [{ product: 'Kertas Supreme 64 gsm', qty: 10 }] });
    expect(urls(await resolveCatalogDelivery(C, 'berapa harga kertas supreme?'))).toEqual([SUPREME_PDF]);
  });

  it('a brand with no file uploaded yet sends nothing and says so', async () => {
    const { resolveCatalogDelivery } = await load();
    mockListBrands.mockResolvedValue([{ id: 'b2', name: 'Kertas Supreme', catalogFileUrl: null }]);
    const d = await resolveCatalogDelivery(C, 'berapa harga kertas supreme?');
    expect(d.files).toEqual([]);
    expect(d.note).toMatch(/Daftar harga Kertas Supreme belum tersedia/);
    expect(d.note).toContain('JANGAN bilang daftar harga Kertas Supreme sudah dikirim');
    expect(d.note).not.toContain(CATALOG_SENT_MARKER);
  });

  it('finds the brand row whatever its case or spacing', async () => {
    const { resolveCatalogDelivery } = await load();
    mockListBrands.mockResolvedValue([{ id: 'b2', name: ' kertas supreme ', catalogFileUrl: SUPREME_PDF }]);
    expect(urls(await resolveCatalogDelivery(C, 'berapa harga kertas supreme?'))).toEqual([SUPREME_PDF]);
  });

  it('reads malformed profile facts as empty', async () => {
    const { resolveCatalogDelivery } = await load();
    withFacts({ brands: 'kertas_supreme', items: 'banyak' });
    expect((await resolveCatalogDelivery(C, 'berapa harganya?')).note).toContain(UNKNOWN_BRAND_NOTE);
    withFacts({ brands: ['legacy', 42, null] });
    expect((await resolveCatalogDelivery(C, 'berapa harganya?')).note).toContain(UNKNOWN_BRAND_NOTE);
  });
});

describe('once per conversation per brand', () => {
  it('the same brand is not resent in the same conversation', async () => {
    const { resolveCatalogDelivery } = await load();
    expect(urls(await resolveCatalogDelivery(C, 'berapa harga kertas supreme?'))).toEqual([SUPREME_PDF]);
    const again = await resolveCatalogDelivery(C, 'kertas supreme harganya berapa ya?');
    expect(again.files).toEqual([]);
    expect(again.note).toMatch(/Daftar harga Kertas Supreme sudah dikirim sebelumnya/);
    expect(again.note).not.toContain(CATALOG_SENT_MARKER);
    // Another customer is another conversation.
    expect(urls(await resolveCatalogDelivery('contact-2', 'berapa harga kertas supreme?'))).toEqual([SUPREME_PDF]);
  });

  it('only the brand not sent yet goes out', async () => {
    const { resolveCatalogDelivery } = await load();
    await resolveCatalogDelivery(C, 'berapa harga kertas supreme?');
    const d = await resolveCatalogDelivery(C, 'kalau box berapa harganya?', { fresh: { facts: { brands: ['kertas_supreme'] } } });
    expect(urls(d)).toEqual([IMPERIAL_PDF]);
    expect(d.note.startsWith(CATALOG_SENT_MARKER)).toBe(true);
  });

  it('the customer asking for it again resends it', async () => {
    const { resolveCatalogDelivery } = await load();
    await resolveCatalogDelivery(C, 'berapa harga kertas supreme?');
    expect(urls(await resolveCatalogDelivery(C, 'kirim ulang price list kertas supreme dong', { explicit: true }))).toEqual([SUPREME_PDF]);
  });

  it('a fresh start (/new) may send it again', async () => {
    const { resolveCatalogDelivery, forgetSentPriceLists } = await load();
    await resolveCatalogDelivery(C, 'berapa harga kertas supreme?');
    forgetSentPriceLists(C);
    expect(urls(await resolveCatalogDelivery(C, 'berapa harga kertas supreme?'))).toEqual([SUPREME_PDF]);
  });
});

describe('the helpers', () => {
  it('reads the brand from the words the customer uses', async () => {
    const { brandsInText } = await load();
    expect(brandsInText('berapa harga kertas supreme?')).toEqual(['kertas_supreme']);
    expect(brandsInText('kertas nasi ada?')).toEqual(['kertas_supreme']);
    expect(brandsInText('kertas bungkus burger')).toEqual(['kertas_supreme']);
    expect(brandsInText('Greaseproof paper')).toEqual(['kertas_supreme']);
    expect(brandsInText('dus makanan')).toEqual(['imperial_indopack']);
    expect(brandsInText('kardus kue')).toEqual(['imperial_indopack']);
    expect(brandsInText('Lunch BOX')).toEqual(['imperial_indopack']);
    expect(brandsInText('karton')).toEqual(['imperial_indopack']);
    expect(brandsInText('box dan kertas nasi')).toEqual(['kertas_supreme', 'imperial_indopack']);
    expect(brandsInText('halo kak')).toEqual([]);
  });

  it('a priced item has product, size and quantity', async () => {
    const { hasPricedItem } = await load();
    expect(hasPricedItem([PRICED_ITEM])).toBe(true);
    expect(hasPricedItem([{ product: 'box', size: '20x20x5', qty: '1000 pcs' }])).toBe(true);
    expect(hasPricedItem([{ product: 'box' }, PRICED_ITEM])).toBe(true);
    expect(hasPricedItem([{ product: 'box', size: '20x20x5' }])).toBe(false);
    expect(hasPricedItem([{ product: 'box', qty: 1000 }])).toBe(false);
    expect(hasPricedItem([{ product: ' ', size: '20x20', qty: 1000 }])).toBe(false);
    expect(hasPricedItem([{ product: 'box', size: '20x20', qty: 0 }])).toBe(false);
    for (const junk of [undefined, null, 'box', 42, {}, [null], ['box']]) expect(hasPricedItem(junk)).toBe(false);
  });

  it('knows a price question', async () => {
    const { isPriceRequest } = await load();
    for (const t of ['berapa harganya?', 'minta pricelist', 'ada price list?', 'Harga box?', 'BERAPA kak']) expect(isPriceRequest(t)).toBe(true);
    for (const t of ['halo kak', 'ada kertas nasi?', 'saya mau order']) expect(isPriceRequest(t)).toBe(false);
  });
});
