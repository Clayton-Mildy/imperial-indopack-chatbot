/**
 * rag-scoring.test.ts
 * Relevance ranking in searchActiveProducts: a product matching more keywords
 * (and in higher-weight fields) must outrank an alphabetically-earlier product
 * matching fewer — the old OR-fallback ordered purely by name, which let
 * single-keyword matches crowd out the actually-relevant family.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { getDb } from '../src/db/client.js';
import { brands, products, productVariants } from '../src/db/schema.js';
import { searchActiveProducts } from '../src/repositories/products.js';
import { eq } from 'drizzle-orm';

const TEST_PREFIX = '__rag_scoring_test__';
// Unique tokens that cannot collide with real catalog content
const KW1 = 'zzxboxzz';
const KW2 = 'zzxkertaszz';

describe('searchActiveProducts — relevance scoring', () => {
  let testBrandId: string;
  let weakProductId: string; // alphabetically first, matches KW1 in fungsi only
  let strongProductId: string; // alphabetically last, matches KW1 in name + KW2 in fungsi

  beforeAll(async () => {
    const db = getDb();

    const [brand] = await db
      .insert(brands)
      .values({ name: `${TEST_PREFIX}brand` })
      .returning({ id: brands.id });
    testBrandId = brand!.id;

    const [weak] = await db
      .insert(products)
      .values({
        brandId: testBrandId,
        name: `${TEST_PREFIX}AAA weak match`,
        fungsi: `sering dipakai bersama ${KW1}`,
      })
      .returning({ id: products.id });
    weakProductId = weak!.id;

    const [strong] = await db
      .insert(products)
      .values({
        brandId: testBrandId,
        name: `${TEST_PREFIX}ZZZ ${KW1} utama`,
        fungsi: `sebagai ${KW2} andalan`,
      })
      .returning({ id: products.id });
    strongProductId = strong!.id;

    for (const productId of [weakProductId, strongProductId]) {
      await db.insert(productVariants).values({
        productId,
        name: 'Standard',
        isActive: true,
        stockStatus: 'normal',
      });
    }
  });

  afterAll(async () => {
    const db = getDb();
    for (const id of [weakProductId, strongProductId]) {
      await db.delete(productVariants).where(eq(productVariants.productId, id));
      await db.delete(products).where(eq(products.id, id));
    }
    await db.delete(brands).where(eq(brands.id, testBrandId));
  });

  it('multi-keyword name match outranks alphabetically-earlier single-keyword fungsi match', async () => {
    const results = await searchActiveProducts({ keywords: [KW1, KW2], limit: 5 });
    const ids = results.map((p) => p.id);
    expect(ids).toContain(strongProductId);
    expect(ids).toContain(weakProductId);
    expect(ids.indexOf(strongProductId)).toBeLessThan(ids.indexOf(weakProductId));
  });

  it('an off-catalog keyword does not suppress results (contributes 0, not AND-failure)', async () => {
    const results = await searchActiveProducts({
      keywords: [KW1, KW2, 'zzznonexistentzzz'],
      limit: 5,
    });
    expect(results.map((p) => p.id)).toContain(strongProductId);
  });
});
