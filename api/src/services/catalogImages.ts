import { eq, sql } from 'drizzle-orm';
import { storeUploadedImage } from './imageStorage.js';
import { getDb } from '../db/client.js';
import { products, productVariants } from '../db/schema.js';

/**
 * Bulk import of catalog photos: the team picks a folder of images named after the product
 * ("GEMBOK BULAT PUTIH.jpg") or the variant code ("LS2140 L.jpg", "HP8250.png"), and each file is
 * matched, shrunk and set as that product's or variant's image_url.
 *
 * Matching is by name, never fuzzy: a file that fits nothing, or fits more than one row, is
 * reported back and left alone, because a wrong photo on a product is worse than none - the AI
 * compares customer photos against these (services/photoMatch.ts).
 *
 * The dashboard sends the folder in small batches rather than one archive: ~470 phone photos run to
 * hundreds of MB, past the request limit of the tunnel the dashboard is served through.
 */

export type ImageTarget = { kind: 'product' | 'variant'; id: string; label: string };

export type ImageFileResult =
  | { file: string; status: 'matched'; target: ImageTarget }
  | { file: string; status: 'unmatched' }
  | { file: string; status: 'ambiguous'; options: string[] }
  | { file: string; status: 'rejected'; reason: string };

/** Case, spacing and punctuation never decide a match: "LS2140 L", "ls2140-l" and "LS2140L" are one key. */
export function imageKey(name: string): string {
  return name.normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function stripExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.[a-z0-9]{2,5}$/i, '');
}

/**
 * Every name a photo may be filed under. A variant answers to its SKU, to its code - the part of
 * its name before " - " ("LS2140 L" of "LS2140 L - 40MM") - and to its full name.
 */
export function buildImageIndex(rows: {
  products: { id: string; name: string }[];
  variants: { id: string; name: string; sku: string | null; productName: string }[];
}): Map<string, ImageTarget[]> {
  const index = new Map<string, ImageTarget[]>();
  const add = (key: string, target: ImageTarget) => {
    if (!key) return;
    const list = index.get(key) ?? [];
    if (!list.some((t) => t.kind === target.kind && t.id === target.id)) list.push(target);
    index.set(key, list);
  };
  for (const p of rows.products) add(imageKey(p.name), { kind: 'product', id: p.id, label: p.name });
  for (const v of rows.variants) {
    const target: ImageTarget = { kind: 'variant', id: v.id, label: `${v.productName} / ${v.name}` };
    if (v.sku) add(imageKey(v.sku), target);
    add(imageKey(v.name.split(' - ')[0] ?? v.name), target);
    add(imageKey(v.name), target);
  }
  return index;
}

export function matchImageFile(filename: string, index: Map<string, ImageTarget[]>): ImageFileResult {
  const targets = index.get(imageKey(stripExtension(filename))) ?? [];
  if (targets.length === 1) return { file: filename, status: 'matched', target: targets[0]! };
  if (targets.length === 0) return { file: filename, status: 'unmatched' };
  return { file: filename, status: 'ambiguous', options: targets.map((t) => t.label) };
}

async function loadIndex(): Promise<Map<string, ImageTarget[]>> {
  const db = getDb();
  const [productRows, variantRows] = await Promise.all([
    db.select({ id: products.id, name: products.name }).from(products),
    db
      .select({ id: productVariants.id, name: productVariants.name, sku: productVariants.sku, productName: products.name })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId)),
  ]);
  return buildImageIndex({ products: productRows, variants: variantRows });
}

export async function importCatalogImages(files: { filename: string; buffer: Buffer }[]): Promise<ImageFileResult[]> {
  const index = await loadIndex();
  const db = getDb();

  const results: ImageFileResult[] = [];
  for (const { filename, buffer } of files) {
    const match = matchImageFile(filename, index);
    if (match.status !== 'matched') {
      results.push(match);
      continue;
    }
    let url: string;
    try {
      url = await storeUploadedImage(buffer);
    } catch {
      results.push({ file: filename, status: 'rejected', reason: 'bukan file gambar yang bisa dibaca' });
      continue;
    }
    const { kind, id } = match.target;
    if (kind === 'product') {
      await db.update(products).set({ imageUrl: url, updatedAt: sql`now()` }).where(eq(products.id, id));
    } else {
      await db.update(productVariants).set({ imageUrl: url, updatedAt: sql`now()` }).where(eq(productVariants.id, id));
    }
    results.push(match);
  }
  return results;
}
