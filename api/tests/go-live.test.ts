/**
 * go-live.test.ts - credentialsSet per transport, the WhatsApp status and the go-live issues
 * (services/goLive.ts), plus the two settings routes. Needs DATABASE_URL. Saves and restores the
 * PO link and each brand's catalog_file_url; its demo product is removed again.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import Fastify from 'fastify';
import { eq, inArray, like } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { brands, products, productVariants, variantPriceTiers } from '../src/db/schema.js';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));
let transportOverride: string | null = null;
vi.mock('../src/config.js', async (orig) => {
  const actual = await orig<typeof import('../src/config.js')>();
  return { ...actual, getConfig: () => ({ ...actual.getConfig(), ...(transportOverride ? { WHATSAPP_TRANSPORT: transportOverride } : {}) }) };
});

const { credentialsSet, getWhatsAppStatus, getGoLiveIssues } = await import('../src/services/goLive.js');
const { getConfig } = await import('../src/config.js');
const { getPoFormUrl, setPoFormUrl } = await import('../src/repositories/appSettings.js');
const { settingsRoutes } = await import('../src/routes/dashboard/settings.js');
const { loadDemoCatalog, purgeDemoCatalog } = await import('../src/services/demoCatalog.js');
const { brandSlugOfName } = await import('../src/domain/brands.js');

const CFG = getConfig();
const codes = async () => (await getGoLiveIssues()).map((i) => i.code);

describe('credentialsSet', () => {
  it('credentials per transport', () => {
    expect(credentialsSet({ ...CFG, WHATSAPP_TRANSPORT: 'chakra', CHAKRA_ACCESS_TOKEN: 't', CHAKRA_PLUGIN_ID: 'p', CHAKRA_WEBHOOK_SECRET: 's' })).toBe(true);
    expect(credentialsSet({ ...CFG, WHATSAPP_TRANSPORT: 'chakra', CHAKRA_ACCESS_TOKEN: 't', CHAKRA_PLUGIN_ID: '', CHAKRA_WEBHOOK_SECRET: 's' })).toBe(false);
    expect(credentialsSet({ ...CFG, WHATSAPP_TRANSPORT: 'meta', META_ACCESS_TOKEN: 't' })).toBe(false);
    expect(credentialsSet({ ...CFG, WHATSAPP_TRANSPORT: 'meta', META_ACCESS_TOKEN: 't', META_WEBHOOK_SECRET: 's', META_WEBHOOK_VERIFY_TOKEN: 'v' })).toBe(true);
    expect(credentialsSet({ ...CFG, WHATSAPP_TRANSPORT: 'capture', CHAKRA_ACCESS_TOKEN: 't', CHAKRA_PLUGIN_ID: 'p', CHAKRA_WEBHOOK_SECRET: 's' })).toBe(false);
  });
});

describe('brandSlugOfName', () => {
  it('is case-insensitive and null for other brands', () => {
    expect(brandSlugOfName('kertas supreme')).toBe('kertas_supreme');
    expect(brandSlugOfName(' Imperial Indopack ')).toBe('imperial_indopack');
    expect(brandSlugOfName('Other')).toBeNull();
  });
});

describe('go-live issues', () => {
  const app = Fastify();
  let savedPo: string;
  let hadDemo = false;
  const savedUrls = new Map<string, string | null>();
  const DEMO = '__go_live_test__ Box (CONTOH)';

  beforeAll(async () => {
    await app.register(settingsRoutes);
    // Independent of the dev DB: a loaded demo catalog would make catalog_demo true whatever this test does.
    hadDemo = (await getDb().select().from(products).where(like(products.name, '%(CONTOH)'))).length > 0;
    await purgeDemoCatalog();
    savedPo = await getPoFormUrl();
    const db = getDb();
    for (const slug of ['Kertas Supreme', 'Imperial Indopack']) {
      const [row] = await db.select().from(brands).where(eq(brands.name, slug));
      if (row) savedUrls.set(row.id, row.catalogFileUrl);
      else {
        const [made] = await db.insert(brands).values({ name: slug }).returning();
        savedUrls.set(made!.id, 'DELETE');
      }
    }
  });

  afterAll(async () => {
    const db = getDb();
    transportOverride = null;
    await setPoFormUrl(savedPo);
    await db.delete(products).where(like(products.name, '__go_live_test__%'));
    for (const [id, url] of savedUrls) {
      if (url === 'DELETE') await db.delete(brands).where(eq(brands.id, id));
      else await db.update(brands).set({ catalogFileUrl: url }).where(eq(brands.id, id));
    }
    if (hadDemo) await loadDemoCatalog();
  });

  it('flags the placeholder PO link until a real one is saved', async () => {
    await setPoFormUrl('https://forms.gle/REPLACE-ME');
    expect(await codes()).toContain('po_form_placeholder');
    await setPoFormUrl('https://forms.gle/x');
    expect(await codes()).not.toContain('po_form_placeholder');
  });

  it('the placeholder written another way is still the placeholder', async () => {
    for (const variant of ['HTTPS://FORMS.GLE/REPLACE-ME', 'https://forms.gle/REPLACE-ME/']) {
      await setPoFormUrl(variant);
      expect(await codes()).toContain('po_form_placeholder');
    }
  });

  it('flags a brand with no price list', async () => {
    const db = getDb();
    await db.update(brands).set({ catalogFileUrl: null }).where(eq(brands.name, 'Kertas Supreme'));
    expect(await getGoLiveIssues()).toContainEqual({ code: 'price_list_missing', brand: 'kertas_supreme' });
    await db.update(brands).set({ catalogFileUrl: 'https://cdn.example/ks.pdf' }).where(eq(brands.name, 'Kertas Supreme'));
    expect(await getGoLiveIssues()).not.toContainEqual({ code: 'price_list_missing', brand: 'kertas_supreme' });
  });

  it('capture is never connected', async () => {
    transportOverride = 'capture';
    const status = await getWhatsAppStatus();
    expect(status.transport).toBe('capture');
    expect(status.connected).toBe(false);
    expect(await codes()).toContain('whatsapp_not_connected');
    transportOverride = null;
  });

  it('reports catalog_demo (right after catalog_empty) while a (CONTOH) product is active', async () => {
    const db = getDb();
    const [brand] = await db.select().from(brands).where(eq(brands.name, 'Imperial Indopack'));
    expect(await codes()).not.toContain('catalog_demo'); // baseline: no demo product at all
    const [p] = await db.insert(products).values({ name: DEMO, brandId: brand!.id }).returning();
    const [v] = await db.insert(productVariants).values({ productId: p!.id, name: '1x1x1' }).returning();
    const noTier = await codes();
    expect(noTier).toContain('catalog_demo');
    await db.insert(variantPriceTiers).values({ variantId: v!.id, minQty: 1, qtyUnit: 'pcs', priceIdr: '999', priceUnit: 'pcs' });
    const all = await codes();
    expect(all).toContain('catalog_demo');
    expect(all).not.toContain('catalog_empty');
    const order = ['po_form_placeholder', 'whatsapp_not_connected', 'catalog_empty', 'catalog_demo', 'price_list_missing'];
    expect(all.map((c) => order.indexOf(c))).toEqual([...all.map((c) => order.indexOf(c))].sort((a, b) => a - b));
    await db.update(productVariants).set({ isActive: false }).where(eq(productVariants.id, v!.id));
    expect(await codes()).not.toContain('catalog_demo');
    await db.delete(products).where(eq(products.id, p!.id));
  });

  it('an inactive product neither fills the catalog nor counts as demo', async () => {
    const db = getDb();
    const [brand] = await db.select().from(brands).where(eq(brands.name, 'Imperial Indopack'));
    const tiered = async (name: string) => {
      const [p] = await db.insert(products).values({ name, brandId: brand!.id, isActive: false }).returning();
      const [v] = await db.insert(productVariants).values({ productId: p!.id, name: '1x1x1' }).returning();
      await db.insert(variantPriceTiers).values({ variantId: v!.id, minQty: 1, qtyUnit: 'pcs', priceIdr: '999', priceUnit: 'pcs' });
      return p!.id;
    };
    // Every other product switched off for the duration, so catalog_empty depends on this test's rows only.
    const othersOn = (await db.select({ id: products.id }).from(products).where(eq(products.isActive, true))).map((r) => r.id);
    try {
      if (othersOn.length > 0) await db.update(products).set({ isActive: false }).where(inArray(products.id, othersOn));
      const real = await tiered('__go_live_test__ Box Nonaktif');
      const demo = await tiered(DEMO);
      let now = await codes();
      expect(now).toContain('catalog_empty');
      expect(now).not.toContain('catalog_demo');
      await db.update(products).set({ isActive: true }).where(eq(products.id, real));
      expect(await codes()).not.toContain('catalog_empty');
      await db.update(products).set({ isActive: true }).where(eq(products.id, demo));
      now = await codes();
      expect(now).toContain('catalog_demo');
      await db.update(products).set({ isActive: false }).where(eq(products.id, demo));
      expect(await codes()).not.toContain('catalog_demo');
    } finally {
      if (othersOn.length > 0) await db.update(products).set({ isActive: true }).where(inArray(products.id, othersOn));
      await db.delete(products).where(like(products.name, '__go_live_test__%'));
    }
  });

  it('serves both routes', async () => {
    const s = await app.inject({ method: 'GET', url: '/api/v1/settings/whatsapp-status' });
    expect(s.statusCode).toBe(200);
    expect(s.json().data).toEqual(expect.objectContaining({ transport: expect.any(String), connected: expect.any(Boolean) }));
    const g = await app.inject({ method: 'GET', url: '/api/v1/settings/go-live' });
    expect(Array.isArray(g.json().data.issues)).toBe(true);
  });
});
