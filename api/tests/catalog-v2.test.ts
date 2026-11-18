/**
 * catalog-v2.test.ts
 * kwMatch unit tests: verify that the pv.description ILIKE clause finds variants
 * by description content, covering Vane's LOTUS MSN 60cm example.
 *
 * Variant descriptions now carry the per-variant specs that regroup-catalog.py
 * rescues from the Excel when a family merge would otherwise flatten them
 * ("Bahan: Stainless Steel"), so this search path still matters.
 *
 * The reseed-v2 integration checks were removed with the website-scrape pipeline —
 * the catalog is sourced solely from the Excel price list.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { getDb } from '../src/db/client.js';
import { brands, products, productVariants } from '../src/db/schema.js';
import { searchActiveProducts } from '../src/repositories/products.js';
import { eq, inArray, sql } from 'drizzle-orm';

// ─── kwMatch unit tests ─────────────────────────────────────────────────────

const TEST_PREFIX = '__catalog_v2_test__';

describe('kwMatch — variant description ILIKE clause', () => {
  let testBrandId: string;
  let testProductId: string;
  let only45cmProductId: string;

  beforeAll(async () => {
    const db = getDb();

    const [brand] = await db
      .insert(brands)
      .values({ name: `${TEST_PREFIX}brand` })
      .returning({ id: brands.id });
    testBrandId = brand!.id;

    // Product with two variants: MSN has "60cm" in description, GOTHIC has only "45cm"
    const [product] = await db
      .insert(products)
      .values({
        brandId: testBrandId,
        name: `${TEST_PREFIX}Door Pull Vintage`,
        description: null, // no product-level description — hits must come from pv.description
      })
      .returning({ id: products.id });
    testProductId = product!.id;

    // LOTUS MSN: 60cm in description
    await db.insert(productVariants).values({
      productId: testProductId,
      name: 'LOTUS MSN',
      description: 'Tinggi: 60cm\nWarna: MSN\nBahan: Logam',
      isActive: true,
      stockStatus: 'normal',
    });

    // LOTUS GOTHIC: only 45cm in description
    await db.insert(productVariants).values({
      productId: testProductId,
      name: 'LOTUS GOTHIC',
      description: 'Tinggi: 45cm\nWarna: Gothic\nBahan: Logam',
      isActive: true,
      stockStatus: 'normal',
    });

    // A second product with ONLY a 45cm variant — used to confirm "60cm" doesn't match it
    const [p2] = await db
      .insert(products)
      .values({
        brandId: testBrandId,
        name: `${TEST_PREFIX}Only45cm`,
        description: null,
      })
      .returning({ id: products.id });
    only45cmProductId = p2!.id;

    await db.insert(productVariants).values({
      productId: only45cmProductId,
      name: 'VARIANT 45CM ONLY',
      description: 'Tinggi: 45cm',
      isActive: true,
      stockStatus: 'normal',
    });
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(productVariants).where(eq(productVariants.productId, testProductId));
    await db.delete(productVariants).where(eq(productVariants.productId, only45cmProductId));
    await db.delete(products).where(eq(products.id, testProductId));
    await db.delete(products).where(eq(products.id, only45cmProductId));
    await db.delete(brands).where(eq(brands.id, testBrandId));
  });

  it('kwMatch("60cm") returns the test product (MSN variant has 60cm in description)', async () => {
    const results = await searchActiveProducts({
      keywords: ['60cm'],
      brandFilter: `${TEST_PREFIX}brand`,
    });
    const productIds = results.map((p) => p.id);
    expect(productIds).toContain(testProductId);
  });

  it('kwMatch("60cm") matches via pv.description — product.description is null', async () => {
    const db = getDb();
    const [p] = await db.select({ description: products.description }).from(products).where(eq(products.id, testProductId));
    // Confirm no product-level description — the hit must come from pv.description
    expect(p!.description).toBeNull();

    const results = await searchActiveProducts({
      keywords: ['60cm'],
      brandFilter: `${TEST_PREFIX}brand`,
    });
    expect(results.some((p) => p.id === testProductId)).toBe(true);
  });

  it('kwMatch("60cm") does NOT match the 45cm-only product', async () => {
    const results = await searchActiveProducts({
      keywords: ['60cm'],
      brandFilter: `${TEST_PREFIX}brand`,
    });
    expect(results.some((p) => p.id === only45cmProductId)).toBe(false);
  });

  it('kwMatch("45cm") finds the test product (GOTHIC variant has 45cm in description)', async () => {
    const results = await searchActiveProducts({
      keywords: ['45cm'],
      brandFilter: `${TEST_PREFIX}brand`,
    });
    expect(results.some((p) => p.id === testProductId)).toBe(true);
  });

  it('kwMatch("45cm") also finds the 45cm-only product', async () => {
    const results = await searchActiveProducts({
      keywords: ['45cm'],
      brandFilter: `${TEST_PREFIX}brand`,
    });
    expect(results.some((p) => p.id === only45cmProductId)).toBe(true);
  });
});
