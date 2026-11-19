/**
 * catalog-images.test.ts
 *
 * Bulk import of catalog photos (services/catalogImages.ts): a picked folder of files named after a
 * product or a variant code. Matching is by name and never fuzzy - a wrong photo on a product is
 * worse than none, because the AI compares customer photos against these.
 *
 * The matcher is pure; the import itself runs against real Postgres (needs DATABASE_URL) and writes
 * real files, both removed afterwards.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { eq, inArray, like } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { brands, products, productVariants } from '../src/db/schema.js';
import { buildImageIndex, imageKey, importCatalogImages, matchImageFile } from '../src/services/catalogImages.js';

describe('matching a file name to a product or variant', () => {
  const index = buildImageIndex({
    products: [
      { id: 'p1', name: 'BOX KUE IVORY 20X20' },
      { id: 'p2', name: 'LUNCH BOX KRAFT SEKAT' },
      { id: 'p3', name: 'PAPER BAG KRAFT TALI – UK. M' },
    ],
    variants: [
      { id: 'v1', name: 'BK2020 - 20X20', sku: null, productName: 'BOX KUE IVORY 20X20' },
      { id: 'v2', name: 'LB1812 K - 18X12', sku: null, productName: 'LUNCH BOX KRAFT SEKAT' },
      { id: 'v3', name: 'UK 30 X 30', sku: null, productName: 'PAPER BAG KRAFT TALI – UK. M' },
      { id: 'v4', name: 'UK 30 X 30', sku: null, productName: 'KERTAS LAIN' },
      { id: 'v5', name: 'Cokelat Doff', sku: 'SKU-777', productName: 'BOX X' },
    ],
  });

  it('ignores case, spaces, dashes and the extension', () => {
    expect(imageKey('lb1812-k')).toBe(imageKey('LB1812 K'));
    expect(matchImageFile('lb1812-k.JPG', index)).toMatchObject({ status: 'matched', target: { kind: 'variant', id: 'v2' } });
  });

  it('matches a product by its name, punctuation and all', () => {
    expect(matchImageFile('Box Kue Ivory 20x20.png', index)).toMatchObject({ status: 'matched', target: { kind: 'product', id: 'p1' } });
    expect(matchImageFile('PAPER BAG KRAFT TALI - UK. M.jpg', index)).toMatchObject({ status: 'matched', target: { id: 'p3' } });
  });

  it('matches a variant by its code, its full name, or its SKU', () => {
    expect(matchImageFile('BK2020.jpg', index)).toMatchObject({ status: 'matched', target: { id: 'v1' } });
    expect(matchImageFile('BK2020 - 20X20.jpeg', index)).toMatchObject({ status: 'matched', target: { id: 'v1' } });
    expect(matchImageFile('sku-777.webp', index)).toMatchObject({ status: 'matched', target: { id: 'v5' } });
  });

  it('a size under two gramasi indexes to both rows, labelled with the gramasi', () => {
    const idx = buildImageIndex({
      products: [{ id: 'p9', name: 'Box Makan Ivory' }],
      variants: [
        { id: 'g1', name: '20 x 20 x 7 cm', gsm: '270 gsm', sku: null, productName: 'Box Makan Ivory' },
        { id: 'g2', name: '20 x 20 x 7 cm', gsm: '300 gsm', sku: null, productName: 'Box Makan Ivory' },
      ],
    });
    const r = matchImageFile('20x20x7 cm.jpg', idx);
    expect(r.status).toBe('ambiguous');
    expect(r.status === 'ambiguous' && r.options).toEqual([
      'Box Makan Ivory / 270 gsm / 20 x 20 x 7 cm',
      'Box Makan Ivory / 300 gsm / 20 x 20 x 7 cm',
    ]);
  });

  it('reports a name two rows share instead of guessing', () => {
    const r = matchImageFile('UK 30 X 30.jpg', index);
    expect(r.status).toBe('ambiguous');
    expect(r.status === 'ambiguous' && r.options).toHaveLength(2);
  });

  it('reports a name that fits nothing', () => {
    expect(matchImageFile('IMG_20261009_101112.jpg', index).status).toBe('unmatched');
    expect(matchImageFile('BOX KUE IVORY 20X20 (1).jpg', index).status).toBe('unmatched');
  });
});

describe('importing the files', () => {
  const P = '__catimg_test__';
  let productId: string;
  let variantId: string;
  const written: string[] = [];
  const png = () => sharp({ create: { width: 1600, height: 900, channels: 3, background: '#888' } }).png().toBuffer();

  beforeAll(async () => {
    const db = getDb();
    const [brand] = await db.insert(brands).values({ name: `${P}brand` }).returning();
    const [product] = await db.insert(products).values({ brandId: brand!.id, name: `${P}BOX TEST` }).returning();
    productId = product!.id;
    const [variant] = await db.insert(productVariants).values({ productId, name: `${P}ZZ9040 L - 40MM`, isActive: true, priceIdr: '1000' }).returning();
    variantId = variant!.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(productVariants).where(eq(productVariants.productId, productId));
    await db.delete(products).where(eq(products.id, productId));
    await db.delete(brands).where(like(brands.name, `${P}%`));
    await Promise.all(written.map((u) => rm(join(process.cwd(), u), { force: true })));
  });

  it('sets the product and variant photos, shrunk to JPEG, and reports the rest', async () => {
    const results = await importCatalogImages([
      { filename: `${P}BOX TEST.png`, buffer: await png() },
      { filename: `${P}ZZ9040 L.png`, buffer: await png() },
      { filename: 'tidak-ada-yang-cocok.png', buffer: await png() },
      { filename: `${P}BOX TEST.jpg`, buffer: Buffer.from('not an image') },
    ]);
    expect(results.map((r) => r.status)).toEqual(['matched', 'matched', 'unmatched', 'rejected']);

    const db = getDb();
    const [p] = await db.select().from(products).where(eq(products.id, productId));
    const [v] = await db.select().from(productVariants).where(inArray(productVariants.id, [variantId]));
    for (const url of [p!.imageUrl!, v!.imageUrl!]) {
      written.push(url);
      expect(url).toMatch(/^\/uploads\/images\/[0-9a-f-]+\.jpg$/);
      expect(existsSync(join(process.cwd(), url))).toBe(true);
      const meta = await sharp(join(process.cwd(), url)).metadata();
      expect(meta.format).toBe('jpeg');
      expect(Math.max(meta.width!, meta.height!)).toBe(1200);
    }
  });
});
