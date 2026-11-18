import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { productReferenceImages, products } from '../db/schema.js';

export const MAX_REFERENCE_IMAGES_PER_PRODUCT = 3;

/** Reference photo URLs per product id, ordered by sort, at most 3 each. */
export async function listReferenceImageUrls(productIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (productIds.length === 0) return out;
  const rows = await getDb()
    .select()
    .from(productReferenceImages)
    .where(inArray(productReferenceImages.productId, productIds))
    .orderBy(asc(productReferenceImages.sort), asc(productReferenceImages.createdAt));
  for (const r of rows) {
    const arr = out.get(r.productId) ?? [];
    if (arr.length < MAX_REFERENCE_IMAGES_PER_PRODUCT) arr.push(r.imageUrl);
    out.set(r.productId, arr);
  }
  return out;
}

export async function addReferenceImage(productId: string, imageUrl: string): Promise<{ id: string }> {
  const db = getDb();
  const existing = await db
    .select({ sort: productReferenceImages.sort })
    .from(productReferenceImages)
    .where(eq(productReferenceImages.productId, productId));
  const sort = existing.length === 0 ? 0 : Math.max(...existing.map((e) => e.sort)) + 1;
  const [row] = await db.insert(productReferenceImages).values({ productId, imageUrl, sort }).returning({ id: productReferenceImages.id });
  return { id: row.id };
}

export async function deleteReferenceImage(id: string): Promise<void> {
  await getDb().delete(productReferenceImages).where(eq(productReferenceImages.id, id));
}

export async function countReferenceImages(productId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: productReferenceImages.id })
    .from(productReferenceImages)
    .where(eq(productReferenceImages.productId, productId));
  return rows.length;
}

export async function productExists(productId: string): Promise<boolean> {
  const rows = await getDb().select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
  return rows.length > 0;
}

/** True when a photo with this id existed and is gone. */
export async function deleteReferenceImageIfExists(id: string): Promise<boolean> {
  const rows = await getDb().delete(productReferenceImages).where(eq(productReferenceImages.id, id)).returning({ id: productReferenceImages.id });
  return rows.length > 0;
}
