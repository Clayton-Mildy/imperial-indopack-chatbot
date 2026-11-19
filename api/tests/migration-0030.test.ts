/** Migration 0030: gramasi moves from the product description to its size rows. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { eq, like, sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { brands, products, productVariants } from '../src/db/schema.js';

const P = '__mig0030__';
const FILE = new URL('../src/db/migrations/0030_variant_gramasi.sql', import.meta.url);
const DOWN = new URL('../src/db/migrations/0030_variant_gramasi.down.sql', import.meta.url);

async function runMigration() {
  const db = getDb();
  for (const stmt of readFileSync(FILE, 'utf8').split('--> statement-breakpoint')) {
    if (stmt.replace(/--.*$/gm, '').trim()) await db.execute(sql.raw(stmt));
  }
}

describe('migration 0030 (gramasi on size rows)', () => {
  let brandId: string;
  let p1: string;
  let p2: string;

  beforeAll(async () => {
    const db = getDb();
    const [b] = await db.insert(brands).values({ name: `${P}brand` }).returning({ id: brands.id });
    brandId = b!.id;
    const [a] = await db
      .insert(products)
      .values({ brandId, name: `${P}a`, description: 'Gramasi: 270 gsm · Cetak: 1 warna · Teks bebas' })
      .returning({ id: products.id });
    p1 = a!.id;
    const [c] = await db
      .insert(products)
      .values({ brandId, name: `${P}b`, description: 'Gramasi: 64 gsm' })
      .returning({ id: products.id });
    p2 = c!.id;
    await db.insert(productVariants).values([
      { productId: p1, name: '20x20x7' },
      { productId: p1, name: '30x30x10' },
      { productId: p2, name: '10x10' },
    ]);
    await runMigration();
    await runMigration(); // idempotent
  });

  afterAll(async () => {
    const db = getDb();
    for (const id of [p1, p2]) await db.delete(productVariants).where(eq(productVariants.productId, id));
    await db.delete(products).where(like(products.name, `${P}%`));
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  it('copies the description gramasi to every size row and rewrites the description', async () => {
    const db = getDb();
    const rows = await db.select().from(productVariants).where(eq(productVariants.productId, p1));
    expect(rows.map((r) => r.gsm)).toEqual(['270 gsm', '270 gsm']);
    const [prod] = await db.select().from(products).where(eq(products.id, p1));
    expect(prod!.description).toBe('Cetak: 1 warna · Teks bebas');
  });

  it('leaves null when only the gramasi segment was there', async () => {
    const db = getDb();
    const [prod] = await db.select().from(products).where(eq(products.id, p2));
    expect(prod!.description).toBeNull();
    const [v] = await db.select().from(productVariants).where(eq(productVariants.productId, p2));
    expect(v!.gsm).toBe('64 gsm');
  });

  it('allows the same size under another gsm but not a duplicate', async () => {
    const db = getDb();
    await db.insert(productVariants).values({ productId: p1, name: '20x20x7', gsm: '300 gsm' });
    await expect(
      db.insert(productVariants).values({ productId: p1, name: '20x20x7', gsm: '270 gsm' })
    ).rejects.toThrow();
  });
});

// Final review M-a: the manual rollback keeps one gramasi per product (in its description), so it must
// refuse a product with several - the same size under two gramasi, or different gramasi on different
// sizes. Only its first statement (the refusal) runs, against a temporary product_variants that shadows
// the real one inside a rolled-back transaction: the test DB keeps its schema and its rows.
describe('migration 0030 rollback refusal', () => {
  const refusal = readFileSync(DOWN, 'utf8').split('--> statement-breakpoint')[0]!;
  class Rollback extends Error {}
  const errorText = (e: unknown): string => {
    const err = e as { message?: string; cause?: { message?: string } };
    return `${err.message ?? ''} ${err.cause?.message ?? ''}`;
  };

  /** The refusal's error text for these rows, or null when it lets the rollback go on. */
  async function refusalFor(rows: { product: string; name: string; gsm: string | null }[]): Promise<string | null> {
    let refused: string | null = null;
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`CREATE TEMP TABLE product_variants (LIKE public.product_variants INCLUDING DEFAULTS) ON COMMIT DROP`);
      for (const r of rows) await tx.execute(sql`INSERT INTO product_variants (product_id, name, gsm) VALUES (${r.product}::uuid, ${r.name}, ${r.gsm})`);
      try {
        await tx.execute(sql.raw(refusal));
      } catch (e) {
        refused = errorText(e);
      }
      throw new Rollback();
    }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
    return refused;
  }

  const A = '00000000-0000-4000-8000-000000000a01';
  const B = '00000000-0000-4000-8000-000000000b01';

  it('refuses a product with different gramasi on different sizes', async () => {
    const msg = await refusalFor([{ product: A, name: '20x20x7', gsm: '270 gsm' }, { product: A, name: '30x30x10', gsm: '310 gsm' }]);
    expect(msg).toMatch(/Cannot roll back 0030: a product has more than one gramasi/);
  });

  it('still refuses the same size under two gramasi', async () => {
    const msg = await refusalFor([{ product: A, name: '20x20x7', gsm: '270 gsm' }, { product: A, name: '20x20x7', gsm: '310 gsm' }]);
    expect(msg).toMatch(/Cannot roll back 0030/);
  });

  it('lets one gramasi per product, or none, roll back', async () => {
    expect(await refusalFor([
      { product: A, name: '20x20x7', gsm: '300 gsm' }, { product: A, name: '30x30x10', gsm: '300 gsm' },
      { product: B, name: '10x10', gsm: null }, { product: B, name: '12x12', gsm: null },
    ])).toBeNull();
  });
});
