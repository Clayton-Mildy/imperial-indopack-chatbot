/**
 * turn-output.test.ts
 * What respond_to_customer returns each turn (spec 7.3): no buyer type, the PO form as a flag the code
 * turns into the link from settings, and up to three reference photo urls copied from the catalog
 * block. The PO setting cases need DATABASE_URL.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { extractFromToolInput, RESPOND_FIELD_DESC, RESPOND_TOOL, RESPOND_SHAPE } from '../src/services/aiLayer.js';
import { poFormMessage } from '../src/domain/constants.js';
import { formatProducts, REFERENCE_PHOTOS_MARKER } from '../src/services/ragQuery.js';
import { getDb } from '../src/db/client.js';
import { appSettings } from '../src/db/schema.js';
import { PO_FORM_PLACEHOLDER_URL, getPoFormUrl, setPoFormUrl } from '../src/repositories/appSettings.js';
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
    expect(props.properties).not.toHaveProperty('customer_type');
    expect(props.properties).not.toHaveProperty('image_url');
    expect(props.required).toEqual(['message', 'confidence', 'fit_basis']);
  });

  it('the Agent SDK shape has the same fields', () => {
    expect(Object.keys(RESPOND_SHAPE).sort()).toEqual(Object.keys(props.properties).sort());
    expect(RESPOND_SHAPE.image_urls.safeParse(['/a', '/b', '/c', '/d']).success).toBe(false);
    expect(RESPOND_SHAPE.send_po_form.safeParse(undefined).success).toBe(true);
  });

  it('describes the new fields in the plan\'s words', () => {
    expect(RESPOND_FIELD_DESC.send_po_form).toBe('true only on the turn the customer clearly agrees to buy at the quoted price');
    expect(RESPOND_FIELD_DESC.image_urls).toBe('reference photo urls of the product you recommend, copied from the catalog block');
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

describe('the PO form message', () => {
  it('is the fixed line with the link under it', () =>
    expect(poFormMessage('https://forms.gle/abc')).toBe('Untuk pemesanannya, silakan isi form PO berikut ya kak 🙏\nhttps://forms.gle/abc'));
});

describe('the PO form link setting', () => {
  const KEY = 'po_form_url';
  let saved: unknown = undefined;

  beforeAll(async () => {
    const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, KEY));
    saved = row?.value;
  });
  afterAll(async () => {
    await getDb().delete(appSettings).where(eq(appSettings.key, KEY));
    if (saved !== undefined) await getDb().insert(appSettings).values({ key: KEY, value: saved });
  });

  it('is the placeholder until staff set it', async () => {
    expect(PO_FORM_PLACEHOLDER_URL).toBe('https://forms.gle/REPLACE-ME');
    await getDb().delete(appSettings).where(eq(appSettings.key, KEY));
    expect(await getPoFormUrl()).toBe(PO_FORM_PLACEHOLDER_URL);
  });

  it('stores an https link', async () => {
    await setPoFormUrl('https://forms.gle/imperial-po');
    expect(await getPoFormUrl()).toBe('https://forms.gle/imperial-po');
    await setPoFormUrl('  https://docs.google.com/forms/d/e/abc/viewform  ');
    expect(await getPoFormUrl()).toBe('https://docs.google.com/forms/d/e/abc/viewform');
  });

  it('refuses anything that is not an https link', async () => {
    for (const bad of ['http://forms.gle/x', 'forms.gle/x', '', 'javascript:alert(1)', 'https://']) {
      await expect(setPoFormUrl(bad)).rejects.toThrow();
    }
  });

  it('a stored value that is not an https link reads as the placeholder', async () => {
    await getDb().insert(appSettings).values({ key: KEY, value: 42 })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: 42 } });
    expect(await getPoFormUrl()).toBe(PO_FORM_PLACEHOLDER_URL);
  });
});
