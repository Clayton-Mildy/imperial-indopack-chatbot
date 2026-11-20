/**
 * turn-output.test.ts
 * What respond_to_customer returns each turn (spec 7.3): no buyer type, the PO form as a flag the code
 * turns into the link from settings, and up to three reference photo urls copied from the catalog
 * block. The PO setting cases need DATABASE_URL.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { extractFromToolInput, RESPOND_FIELD_DESC, RESPOND_TOOL, RESPOND_SHAPE, catalogPhotoUrls, withCatalogPhotosOnly } from '../src/services/aiLayer.js';
import { poFormMessage, PO_FORM_PLACEHOLDER_URL as CONSTANTS_PLACEHOLDER } from '../src/domain/constants.js';
import { formatProducts, REFERENCE_PHOTOS_MARKER } from '../src/services/ragQuery.js';
import { getDb } from '../src/db/client.js';
import { appSettings } from '../src/db/schema.js';
import { PO_FORM_PLACEHOLDER_URL, getPoFormUrls, setPoFormUrl } from '../src/repositories/appSettings.js';
import { SUPREME } from './price-fixtures.js';

const BASE = { message: 'x', confidence: 'high', fit_basis: [] };

describe('respond_to_customer output', () => {
  it('keeps at most three image urls and ignores non-urls', () =>
    expect(extractFromToolInput({ message: 'x', confidence: 'high', fit_basis: [], image_urls: ['/a','/b','/c','/d','javascript:x'] }).imageUrls).toEqual(['/a','/b','/c']));

  it('keeps http(s) urls in order, drops repeats, blanks and non-strings', () =>
    expect(extractFromToolInput({ ...BASE, image_urls: [42, '', 'https://cdn.example/1.jpg', 'https://cdn.example/1.jpg', 'ftp://x', 'http://cdn.example/2.jpg'] }).imageUrls)
      .toEqual(['https://cdn.example/1.jpg', 'http://cdn.example/2.jpg']));

  it('no photo urls means none', () => {
    expect(extractFromToolInput(BASE).imageUrls).toBeUndefined();
    expect(extractFromToolInput({ ...BASE, image_urls: '/a' }).imageUrls).toBeUndefined();
    expect(extractFromToolInput({ ...BASE, image_urls: ['javascript:x'] }).imageUrls).toBeUndefined();
  });

  it('sends the PO form only on a real true', () => {
    expect(extractFromToolInput({ ...BASE, send_po_form: true }).sendPoForm).toBe(true);
    expect(extractFromToolInput({ ...BASE, send_po_form: 'true' }).sendPoForm).toBeUndefined();
    expect(extractFromToolInput({ ...BASE, send_po_form: false }).sendPoForm).toBeUndefined();
    expect(extractFromToolInput(BASE).sendPoForm).toBeUndefined();
  });

  // Review fix (Task 10 I1): no design and no reference photos - the team sends examples.
  it('asks the team for design examples only on a real true', () => {
    expect(extractFromToolInput({ ...BASE, examples_for_team: true }).examplesForTeam).toBe(true);
    expect(extractFromToolInput({ ...BASE, examples_for_team: 'true' }).examplesForTeam).toBeUndefined();
    expect(extractFromToolInput({ ...BASE, examples_for_team: false }).examplesForTeam).toBeUndefined();
    expect(extractFromToolInput(BASE).examplesForTeam).toBeUndefined();
  });

  it('no longer reads a buyer type or a single image url', () => {
    const r = extractFromToolInput({ ...BASE, customer_type: 'reseller', image_url: '/a.jpg' });
    expect(r).not.toHaveProperty('customerType');
    expect(r).not.toHaveProperty('imageUrl');
    expect(r.imageUrls).toBeUndefined();
  });
});

describe('the respond tool contract', () => {
  const props = (RESPOND_TOOL.input_schema as { properties: Record<string, Record<string, unknown>>; required: string[] });

  it('asks for send_po_form and image_urls, never the buyer type', () => {
    expect(props.properties['send_po_form']).toMatchObject({ type: 'boolean', description: RESPOND_FIELD_DESC.send_po_form });
    expect(props.properties['image_urls']).toMatchObject({ type: 'array', items: { type: 'string' }, maxItems: 3, description: RESPOND_FIELD_DESC.image_urls });
    expect(props.properties['examples_for_team']).toMatchObject({ type: 'boolean', description: RESPOND_FIELD_DESC.examples_for_team });
    expect(props.properties).not.toHaveProperty('customer_type');
    expect(props.properties).not.toHaveProperty('image_url');
    expect(props.required).toEqual(['message', 'confidence', 'fit_basis']);
  });

  it('the Agent SDK shape has the same fields', () => {
    expect(Object.keys(RESPOND_SHAPE).sort()).toEqual(Object.keys(props.properties).sort());
    expect(RESPOND_SHAPE.image_urls.safeParse(['/a', '/b', '/c', '/d']).success).toBe(false);
    expect(RESPOND_SHAPE.send_po_form.safeParse(undefined).success).toBe(true);
    expect(RESPOND_SHAPE.examples_for_team.safeParse(true).success).toBe(true);
    expect(RESPOND_SHAPE.examples_for_team.safeParse(undefined).success).toBe(true);
  });

  it('describes the new fields in the plan\'s words', () => {
    expect(RESPOND_FIELD_DESC.send_po_form.startsWith('true only on the turn the customer clearly agrees to buy at the quoted price')).toBe(true);
    // QA 2026-11-19 A6: "oke deal kak" with no design on record got a design question and no form.
    expect(RESPOND_FIELD_DESC.send_po_form).toContain('also when the design is still unknown');
    expect(RESPOND_FIELD_DESC.image_urls).toBe('reference photo urls of the product you recommend, copied exactly from the product\'s [FOTO REFERENSI TERSEDIA] line, at most 3');
    expect(RESPOND_FIELD_DESC.examples_for_team).toBe('true when the customer has no design and the product has no reference photos, so the team sends examples');
  });

  it('no field asks for the buyer type or for arithmetic the price tool does', () => {
    const all = Object.values(RESPOND_FIELD_DESC).join('\n');
    expect(all).not.toMatch(/customer_type|buyer type|compute it yourself|quantity x/i);
    expect(RESPOND_FIELD_DESC.total_for_team).toContain('hitung_harga cannot price the order');
    expect(RESPOND_FIELD_DESC.profile_update).toContain('brands');
    expect(RESPOND_FIELD_DESC.profile_update).toContain('items');
  });
});

describe('the catalog block carries the photo urls to copy', () => {
  it('prints each product\'s reference photo urls after the marker, in order', () => {
    const block = formatProducts([{ ...SUPREME, referenceImageUrls: ['/uploads/ref/1.jpg', '/uploads/ref/2.jpg'] }]);
    expect(block).toContain(`${REFERENCE_PHOTOS_MARKER} /uploads/ref/1.jpg /uploads/ref/2.jpg`);
  });
});

// Review fix 3: a photo url is sent only when this turn's catalog block printed it.
describe('only the catalog\'s own reference photos are sent', () => {
  const block = formatProducts([
    { ...SUPREME, referenceImageUrls: ['/uploads/ref/1.jpg', 'https://cdn.example/ref/2.jpg'] },
    { ...SUPREME, id: 'p-x', name: 'Box Ivory', referenceImageUrls: ['/uploads/ref/3.jpg'] },
  ]);

  it('reads the urls off every marker line', () =>
    expect([...catalogPhotoUrls(block)]).toEqual(['/uploads/ref/1.jpg', 'https://cdn.example/ref/2.jpg', '/uploads/ref/3.jpg']));

  it('drops a customer-pasted link and a made-up upload path, keeps the catalog\'s', () => {
    const r = withCatalogPhotosOnly({
      message: 'x', confidence: 'high',
      imageUrls: ['https://customer.example/foto.jpg', '/uploads/ref/1.jpg', '/uploads/ref/made-up.jpg', '/uploads/ref/3.jpg'],
    }, block);
    expect(r.imageUrls).toEqual(['/uploads/ref/1.jpg', '/uploads/ref/3.jpg']);
  });

  it('no catalog block, or none of its photos, means no photos', () => {
    expect(withCatalogPhotosOnly({ message: 'x', confidence: 'high', imageUrls: ['/uploads/ref/1.jpg'] }, '').imageUrls).toBeUndefined();
    expect(withCatalogPhotosOnly({ message: 'x', confidence: 'high', imageUrls: ['/uploads/x.jpg'] }, block).imageUrls).toBeUndefined();
  });

  // Final review M8: the reply promised photos ("contohnya saya kirim ya") and none of them could go - the
  // promise is the team's to keep now.
  it('hands the examples to the team when every photo url was dropped', () => {
    const r = withCatalogPhotosOnly({ message: 'Contohnya saya kirim ya kak', confidence: 'high', imageUrls: ['/uploads/ref/made-up.jpg'] }, block);
    expect(r.imageUrls).toBeUndefined();
    expect(r.examplesForTeam).toBe(true);
  });

  it('does not when some photo goes, or when none was asked for', () => {
    expect(withCatalogPhotosOnly({ message: 'x', confidence: 'high', imageUrls: ['/uploads/ref/1.jpg', '/uploads/x.jpg'] }, block).examplesForTeam).toBeUndefined();
    expect(withCatalogPhotosOnly({ message: 'x', confidence: 'high' }, block).examplesForTeam).toBeUndefined();
  });

  it('a url that only appears elsewhere in the block does not count', () =>
    expect(catalogPhotoUrls('Produk: Box /uploads/ref/9.jpg\n[FOTO REFERENSI TERSEDIA] /uploads/ref/1.jpg').has('/uploads/ref/9.jpg')).toBe(false));
});

describe('the PO form message', () => {
  it('is the fixed line with the link under it', () =>
    expect(poFormMessage('https://forms.gle/abc')).toBe('Untuk pemesanannya, silakan isi form PO berikut ya kak 🙏\nhttps://forms.gle/abc'));
});

describe('the PO form link settings (cetak and plano)', () => {
  const KEYS = ['po_form_url', 'po_form_url_cetak', 'po_form_url_plano'];
  const saved = new Map<string, unknown>();
  const setRow = async (key: string, value: unknown) => {
    await getDb().delete(appSettings).where(eq(appSettings.key, key));
    if (value !== undefined) await getDb().insert(appSettings).values({ key, value });
  };
  const clear = async () => { for (const key of KEYS) await setRow(key, undefined); };

  beforeAll(async () => {
    for (const key of KEYS) {
      const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, key));
      if (row) saved.set(key, row.value);
    }
  });
  afterAll(async () => {
    for (const key of KEYS) await setRow(key, saved.get(key));
  });

  it('both are the placeholder until staff set them', async () => {
    expect(PO_FORM_PLACEHOLDER_URL).toBe('https://forms.gle/REPLACE-ME');
    expect(PO_FORM_PLACEHOLDER_URL).toBe(CONSTANTS_PLACEHOLDER);
    await clear();
    expect(await getPoFormUrls()).toEqual({ cetak: PO_FORM_PLACEHOLDER_URL, plano: PO_FORM_PLACEHOLDER_URL });
  });

  it('stores an https link per form, each on its own', async () => {
    await clear();
    await setPoFormUrl('cetak', 'https://forms.gle/ContohCetak');
    expect(await getPoFormUrls()).toEqual({ cetak: 'https://forms.gle/ContohCetak', plano: PO_FORM_PLACEHOLDER_URL });
    await setPoFormUrl('plano', '  https://docs.google.com/forms/d/e/contoh-plano/viewform  ');
    expect(await getPoFormUrls()).toEqual({ cetak: 'https://forms.gle/ContohCetak', plano: 'https://docs.google.com/forms/d/e/contoh-plano/viewform' });
  });

  it('the old single link reads as cetak while cetak is unset, and never as plano', async () => {
    await clear();
    await setRow('po_form_url', 'https://forms.gle/ContohLama');
    expect(await getPoFormUrls()).toEqual({ cetak: 'https://forms.gle/ContohLama', plano: PO_FORM_PLACEHOLDER_URL });
    // Once cetak is set it wins.
    await setPoFormUrl('cetak', 'https://forms.gle/ContohCetak');
    expect((await getPoFormUrls()).cetak).toBe('https://forms.gle/ContohCetak');
  });

  it('an old single link that is the placeholder (or not a link) is no fallback', async () => {
    await clear();
    await setRow('po_form_url', 'HTTPS://FORMS.GLE/REPLACE-ME/');
    expect((await getPoFormUrls()).cetak).toBe(PO_FORM_PLACEHOLDER_URL);
    await setRow('po_form_url', 'http://forms.gle/x');
    expect((await getPoFormUrls()).cetak).toBe(PO_FORM_PLACEHOLDER_URL);
  });

  it('refuses anything that is not an https link, and an unknown form', async () => {
    for (const bad of ['http://forms.gle/x', 'forms.gle/x', '', 'javascript:alert(1)', 'https://']) {
      await expect(setPoFormUrl('cetak', bad)).rejects.toThrow();
      await expect(setPoFormUrl('plano', bad)).rejects.toThrow();
    }
    await expect(setPoFormUrl('lainnya' as 'cetak', 'https://forms.gle/x')).rejects.toThrow();
  });

  it('a stored value that is not an https link reads as the placeholder', async () => {
    await clear();
    await setRow('po_form_url_cetak', 42);
    await setRow('po_form_url_plano', 'ftp://forms.gle/x');
    expect(await getPoFormUrls()).toEqual({ cetak: PO_FORM_PLACEHOLDER_URL, plano: PO_FORM_PLACEHOLDER_URL });
  });
});
