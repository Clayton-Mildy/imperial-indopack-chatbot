/** Migration 0031: product_photos, backfilled from products.image_url. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { eq, like, sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { brands, productPhotos, products } from '../src/db/schema.js';

const P = '__mig0031__';
const FILE = new URL('../src/db/migrations/0031_product_photos.sql', import.meta.url);

async function runMigration() {
  const db = getDb();
  for (const stmt of readFileSync(FILE, 'utf8').split('--> statement-breakpoint')) {
    if (stmt.replace(/--.*$/gm, '').trim()) await db.execute(sql.raw(stmt));
  }
}

describe('migration 0031 (several photos per product)', () => {
  let brandId: string;
  let withPhoto: string;
  let withoutPhoto: string;
  let blankPhoto: string;

  beforeAll(async () => {
    const db = getDb();
    const [b] = await db.insert(brands).values({ name: `${P}brand` }).returning({ id: brands.id });
    brandId = b!.id;
    const make = async (name: string, imageUrl: string | null) =>
      (await db.insert(products).values({ brandId, name: `${P}${name}`, imageUrl }).returning({ id: products.id }))[0]!.id;
    withPhoto = await make('with', '/uploads/images/__mig0031__.jpg');
    withoutPhoto = await make('without', null);
    blankPhoto = await make('blank', '');
    await runMigration();
    await runMigration(); // idempotent
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(products).where(like(products.name, `${P}%`)); // photos cascade
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  it('gives every product with an image_url one first photo (sort 0), once even when run twice', async () => {
    const rows = await getDb().select().from(productPhotos).where(eq(productPhotos.productId, withPhoto));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ imageUrl: '/uploads/images/__mig0031__.jpg', sort: 0 });
  });

  it('adds nothing for a product with no photo or an empty one', async () => {
    for (const id of [withoutPhoto, blankPhoto]) {
      expect(await getDb().select().from(productPhotos).where(eq(productPhotos.productId, id))).toHaveLength(0);
    }
  });

  it('photos go when the product does (on delete cascade)', async () => {
    const db = getDb();
    await db.delete(products).where(eq(products.id, withPhoto));
    expect(await db.select().from(productPhotos).where(eq(productPhotos.productId, withPhoto))).toHaveLength(0);
  });
});
