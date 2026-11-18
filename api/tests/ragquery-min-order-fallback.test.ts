/**
 * ragquery-min-order-fallback.test.ts
 * AC-6: when minOrderQty is null, catalog block must fall back to isiBox (+ uomBox name)
 * instead of omitting MIN ORDER entirely.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { getDb } from '../src/db/client.js';
import { brands, products, productVariants, uomTable } from '../src/db/schema.js';
import { buildCatalogContext } from '../src/services/ragQuery.js';
import { inArray } from 'drizzle-orm';

const TEST_PREFIX = '__ac6_min_order_test__';

describe('AC-6 — MIN ORDER falls back to isiBox when minOrderQty is null', () => {
  let testBrandId: string;
  let testProductId: string;
  let boxUomId: string;

  beforeAll(async () => {
    const db = getDb();

    const [uom] = await db
      .insert(uomTable)
      .values({ name: `${TEST_PREFIX}Box` })
      .returning({ id: uomTable.id });
    boxUomId = uom!.id;

    const [brand] = await db
      .insert(brands)
      .values({ name: `${TEST_PREFIX}brand` })
      .returning({ id: brands.id });
    testBrandId = brand!.id;

    const [product] = await db
      .insert(products)
      .values({
        brandId: testBrandId,
        name: `${TEST_PREFIX}Grendel Fallback`,
      })
      .returning({ id: products.id });
    testProductId = product!.id;

    // minOrderQty is null on purpose — isiBox must be the fallback
    await db.insert(productVariants).values({
      productId: testProductId,
      name: 'Grendel Fallback Standard',
      isActive: true,
      stockStatus: 'normal',
      priceIdr: '10000',
      minOrderQty: null,
      isiBox: 5,
      uomBoxId: boxUomId,
    });
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(productVariants).where(inArray(productVariants.productId, [testProductId]));
    await db.delete(products).where(inArray(products.id, [testProductId]));
    await db.delete(brands).where(inArray(brands.id, [testBrandId]));
    await db.delete(uomTable).where(inArray(uomTable.id, [boxUomId]));
  });

  it('renders MIN ORDER using isiBox + uomBox name when minOrderQty is null', async () => {
    const block = await buildCatalogContext(`${TEST_PREFIX}Grendel Fallback`);
    expect(block).toContain(`[MIN ORDER: 5 ${TEST_PREFIX}Box]`);
  });
});
