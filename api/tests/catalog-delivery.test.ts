/**
 * catalog-delivery.test.ts
 * Which catalog files a message earns (services/catalogDelivery.ts), client rules of 2026-10-16:
 * the company catalogue (KATALOG LEGACY 2026, no prices) to anyone who asks; the brand price lists
 * (reseller prices) only to a CONFIRMED reseller or project buyer - the point at which the chat may
 * quote pricelist, not merely "dijual lagi".
 *
 * Mocked profile and brands - no DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetContactProfile = vi.fn();
const mockListBrands = vi.fn();
vi.mock('../src/repositories/contactProfiles.js', () => ({ getContactProfile: mockGetContactProfile }));
vi.mock('../src/repositories/products.js', () => ({ listBrands: mockListBrands }));

const CATALOGUE = 'https://chakra-public-media.example/katalog-2026.pdf';
const BRANDS = [
  { id: 'b1', name: 'Vintage', catalogFileUrl: 'https://chakra-public-media.example/vintage.pdf' },
  { id: 'b2', name: 'Blossom', catalogFileUrl: 'https://chakra-public-media.example/blossom.pdf' },
];
const STORE = { business_name: 'Toko Jaya', city: 'Sidoarjo' };

/** null = CATALOG_FILE_URL unset. */
async function load(catalogueUrl: string | null = CATALOGUE) {
  vi.resetModules();
  if (catalogueUrl === null) delete process.env.CATALOG_FILE_URL;
  else process.env.CATALOG_FILE_URL = catalogueUrl;
  return import('../src/services/catalogDelivery.js');
}
const as = (customerType: string | null, profile: Record<string, unknown> = {}) =>
  mockGetContactProfile.mockResolvedValue({ customerType, profile });
const urls = (d: { files: { url: string }[] }) => d.files.map((f) => f.url.split('/').pop());

beforeEach(() => { vi.clearAllMocks(); mockListBrands.mockResolvedValue(BRANDS); });
afterEach(() => { delete process.env.CATALOG_FILE_URL; });

describe('the company catalogue goes to anyone who asks', () => {
  // Live 2026-10-16: the team reported "AI-nya belum berhasil kirim katalog" - end users got no file.
  it('an end user gets the catalogue, never a price list, and is pointed at the store for prices', async () => {
    const { resolveCatalogDelivery } = await load();
    as('end_user');
    const d = await resolveCatalogDelivery('c1', 'minta katalog vintage dong');
    expect(urls(d)).toEqual(['katalog-2026.pdf']);
    expect(d.files[0]!.filename).toBe('Katalog Legacy.pdf');
    expect(d.note).toMatch(/^KATALOG: file terkirim\./);
    expect(d.note).toContain('tanpa harga');
    expect(d.note).toContain('https://shopee.co.id/vintage_indo');
    expect(d.note).not.toMatch(/pengguna akhir|khusus untuk reseller/);
  });

  it('an unknown buyer gets it too, and the buyer-type question still comes', async () => {
    const { resolveCatalogDelivery } = await load();
    as(null);
    const d = await resolveCatalogDelivery('c1', 'ada katalog?');
    expect(urls(d)).toEqual(['katalog-2026.pdf']);
    expect(d.note).toMatch(/tipe pembeli belum diketahui/i);
    expect(d.note).toContain('JANGAN menyebut price list');
  });

  it('an end user asking for the "price list" gets the catalogue, not the reseller prices', async () => {
    const { resolveCatalogDelivery } = await load();
    as('end_user');
    expect(urls(await resolveCatalogDelivery('c1', 'boleh minta price list vintage?'))).toEqual(['katalog-2026.pdf']);
  });

  it('with no catalogue configured - or the old local path - nothing goes out, and the reply says nothing was sent', async () => {
    for (const url of [null, '/uploads/catalogs/catalog.pdf']) {
      const { resolveCatalogDelivery } = await load(url);
      as('end_user');
      const d = await resolveCatalogDelivery('c1', 'minta katalog');
      expect(d.files).toEqual([]);
      expect(d.note).toContain('JANGAN katakan katalog sudah dikirim');
    }
  });
});

describe('the brand price lists go only to a confirmed reseller or project buyer', () => {
  it('a reseller who has not given the store details gets the catalogue and the identity questions', async () => {
    const { resolveCatalogDelivery } = await load();
    as('reseller');
    const d = await resolveCatalogDelivery('c1', 'saya mau jual lagi, minta price list vintage');
    expect(urls(d)).toEqual(['katalog-2026.pdf']);
    expect(d.note).toContain('Daftar harga per merek BELUM dikirim');
    expect(d.note).toMatch(/nama toko, kota\/lokasi, dan alamat/);
  });

  it('a store name alone is not enough; name plus city or address is', async () => {
    const { priceListConfirmed } = await load();
    expect(priceListConfirmed('reseller', { business_name: 'Toko Jaya' })).toBe(false);
    expect(priceListConfirmed('reseller', STORE)).toBe(true);
    expect(priceListConfirmed('reseller', { business_name: 'Toko Jaya', store_address: 'Jl. Raya 1' })).toBe(true);
    expect(priceListConfirmed('reseller', { business_type: 'freelance, jual handle di shopee' })).toBe(true);
    expect(priceListConfirmed('project', {})).toBe(false);
    expect(priceListConfirmed('project', { company_name: 'PT Bangun' })).toBe(true);
    expect(priceListConfirmed('end_user', STORE)).toBe(false);
  });

  it('a confirmed reseller asking for a brand price list gets only that price list', async () => {
    const { resolveCatalogDelivery } = await load();
    as('reseller', STORE);
    const d = await resolveCatalogDelivery('c1', 'minta price list vintage');
    expect(urls(d)).toEqual(['vintage.pdf']);
    expect(d.files[0]!.filename).toBe('Price List Vintage.pdf');
    expect(d.note).toContain('Daftar harga Vintage sudah dikirim');
  });

  it('a confirmed reseller asking for "katalog" gets the catalogue and is asked which brand price list', async () => {
    const { resolveCatalogDelivery } = await load();
    as('reseller', STORE);
    const d = await resolveCatalogDelivery('c1', 'minta katalog dong');
    expect(urls(d)).toEqual(['katalog-2026.pdf']);
    expect(d.note).toContain('merek belum disebut');
    expect(d.note).toContain('Vintage, Blossom');
  });

  it('"semua" sends the catalogue and every price list', async () => {
    const { resolveCatalogDelivery } = await load();
    as('project', { company_name: 'PT Bangun' });
    expect(urls(await resolveCatalogDelivery('c1', 'boleh minta katalog semua merek?'))).toEqual(['katalog-2026.pdf', 'vintage.pdf', 'blossom.pdf']);
  });

  // The model-flagged path runs after the reply: what the customer said in that same message counts.
  it('store details given in this very message open the price list', async () => {
    const { resolveCatalogDelivery } = await load();
    as('reseller');
    const d = await resolveCatalogDelivery('c1', 'Toko Jaya di Sidoarjo, price list vintage ya', { explicit: false, fresh: { facts: STORE } });
    expect(urls(d)).toContain('vintage.pdf');
  });
});

describe('the 35 MB catalogue is not resent on a model-flagged follow-up', () => {
  it('skips it within the window when the model flagged the request, resends when the customer asks again', async () => {
    const { resolveCatalogDelivery } = await load();
    as('reseller', STORE);
    expect(urls(await resolveCatalogDelivery('c1', 'minta katalog'))).toEqual(['katalog-2026.pdf']);
    expect(urls(await resolveCatalogDelivery('c1', 'yang vintage', { explicit: false }))).toEqual(['vintage.pdf']);
    expect(urls(await resolveCatalogDelivery('c1', 'kirim ulang katalognya dong'))).toEqual(['katalog-2026.pdf']);
  });
});
