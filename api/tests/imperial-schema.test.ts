/**
 * imperial-schema.test.ts
 * Migration 0026: price tiers, reference images, lead brands/items, Imperial brands.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import {
  brands,
  products,
  productVariants,
  variantPriceTiers,
  contacts,
  leads,
} from '../src/db/schema.js';

const TEST_PREFIX = '__imperial_schema_test__';

describe('imperial schema (migration 0026)', () => {
  let brandId: string;
  let productId: string;
  let variantId: string;
  let contactId: string;

  beforeAll(async () => {
    const db = getDb();
    const [b] = await db.insert(brands).values({ name: `${TEST_PREFIX}brand` }).returning({ id: brands.id });
    brandId = b!.id;
    const [p] = await db
      .insert(products)
      .values({ brandId, name: `${TEST_PREFIX}product` })
      .returning({ id: products.id });
    productId = p!.id;
    const [v] = await db
      .insert(productVariants)
      .values({ productId, name: `${TEST_PREFIX}variant` })
      .returning({ id: productVariants.id });
    variantId = v!.id;
    const [c] = await db
      .insert(contacts)
      .values({ waId: `${TEST_PREFIX}wa` })
      .returning({ id: contacts.id });
    contactId = c!.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(leads).where(eq(leads.contactId, contactId));
    await db.delete(contacts).where(eq(contacts.id, contactId));
    await db.delete(variantPriceTiers).where(eq(variantPriceTiers.variantId, variantId));
    await db.delete(productVariants).where(eq(productVariants.productId, productId));
    await db.delete(products).where(eq(products.id, productId));
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  it('stores a tier and rejects a unit that is not rim or pcs', async () => {
    const db = getDb();
    await db.insert(variantPriceTiers).values({
      variantId,
      minQty: 5,
      qtyUnit: 'rim',
      priceIdr: '2000',
      priceUnit: 'pcs',
      includesDelivery: true,
    });
    const rows = await db.select().from(variantPriceTiers).where(eq(variantPriceTiers.variantId, variantId));
    expect(rows).toHaveLength(1);
    await expect(
      db.insert(variantPriceTiers).values({ variantId, minQty: 1, qtyUnit: 'box', priceIdr: '1', priceUnit: 'pcs' })
    ).rejects.toThrow();
  });

  it('gives a new lead empty brands and items', async () => {
    const db = getDb();
    const [l] = await db.insert(leads).values({ contactId }).returning();
    expect(l!.brands).toEqual([]);
    expect(l!.items).toEqual([]);
  });

  it('seeds both brands', async () => {
    const db = getDb();
    const names = (await db.select({ n: brands.name }).from(brands)).map((r) => r.n);
    expect(names).toEqual(expect.arrayContaining(['Imperial Indopack', 'Kertas Supreme']));
  });
});
