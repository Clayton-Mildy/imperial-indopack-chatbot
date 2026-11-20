import { asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { productPhotos, products } from '../db/schema.js';

export const MAX_PRODUCT_PHOTOS_PER_PRODUCT = 3;

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * products.image_url always equals the product's first photo (lowest sort, then oldest), or null when it
 * has none: referenceImageUrl, the "any photos?" check and searchActiveProducts({ withPhoto }) read it.
 */
async function syncPrimaryImage(tx: Tx, productId: string): Promise<void> {
  const [first] = await tx
    .select({ imageUrl: productPhotos.imageUrl })
    .from(productPhotos)
    .where(eq(productPhotos.productId, productId))
    .orderBy(asc(productPhotos.sort), asc(productPhotos.createdAt))
    .limit(1);
  await tx.update(products).set({ imageUrl: first?.imageUrl ?? null, updatedAt: sql`now()` }).where(eq(products.id, productId));
}

/** Product photos per product id, first photo first, at most 3 each. */
export async function listProductPhotos(productIds: string[]): Promise<Map<string, { id: string; imageUrl: string; sort: number }[]>> {
  const out = new Map<string, { id: string; imageUrl: string; sort: number }[]>();
  if (productIds.length === 0) return out;
  const rows = await getDb()
    .select()
    .from(productPhotos)
    .where(inArray(productPhotos.productId, productIds))
    .orderBy(asc(productPhotos.sort), asc(productPhotos.createdAt));
  for (const r of rows) {
    const arr = out.get(r.productId) ?? [];
    if (arr.length < MAX_PRODUCT_PHOTOS_PER_PRODUCT) arr.push({ id: r.id, imageUrl: r.imageUrl, sort: r.sort });
    out.set(r.productId, arr);
  }
  return out;
}

/** Product photo URLs per product id, first photo first. */
export async function listProductPhotoUrls(productIds: string[]): Promise<Map<string, string[]>> {
  const rows = await listProductPhotos(productIds);
  return new Map([...rows].map(([id, photos]) => [id, photos.map((p) => p.imageUrl)]));
}

export async function addProductPhoto(productId: string, imageUrl: string): Promise<{ id: string }> {
  return getDb().transaction(async (tx) => {
    const existing = await tx.select({ sort: productPhotos.sort }).from(productPhotos).where(eq(productPhotos.productId, productId));
    const sort = existing.length === 0 ? 0 : Math.max(...existing.map((e) => e.sort)) + 1;
    const [row] = await tx.insert(productPhotos).values({ productId, imageUrl, sort }).returning({ id: productPhotos.id });
    await syncPrimaryImage(tx, productId);
    return { id: row!.id };
  });
}

/** True when a photo with this id existed and is gone; the product's image_url follows its next photo. */
export async function deleteProductPhoto(id: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const rows = await tx.delete(productPhotos).where(eq(productPhotos.id, id)).returning({ productId: productPhotos.productId });
    if (rows.length === 0) return false;
    await syncPrimaryImage(tx, rows[0]!.productId);
    return true;
  });
}

export async function countProductPhotos(productId: string): Promise<number> {
  const rows = await getDb().select({ id: productPhotos.id }).from(productPhotos).where(eq(productPhotos.productId, productId));
  return rows.length;
}

/** The bulk filename import: this file becomes the product's first photo (the sort-0 row is replaced, else added). */
export async function setFirstProductPhoto(productId: string, imageUrl: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [zero] = await tx
      .select({ id: productPhotos.id })
      .from(productPhotos)
      .where(sql`${productPhotos.productId} = ${productId} AND ${productPhotos.sort} = 0`)
      .orderBy(asc(productPhotos.createdAt))
      .limit(1);
    if (zero) await tx.update(productPhotos).set({ imageUrl }).where(eq(productPhotos.id, zero.id));
    else await tx.insert(productPhotos).values({ productId, imageUrl, sort: 0 });
    await syncPrimaryImage(tx, productId);
  });
}
