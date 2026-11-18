/**
 * Excel -> catalog, reading the single-sheet tier template (catalogTemplate.ts).
 *
 * Identity is by NAME, never UUID. Update in place, never wipe: brands, products and variants
 * are found or created by name, a variant's tiers are REPLACED by the rows in the file, and
 * anything not in the file is left alone and counted as `untouched`.
 *
 * A row with a problem is reported by its Excel row number and skipped; the valid rows still
 * apply. A variant with any bad row is skipped whole (parseTemplateRows), so a typo can never
 * replace its tiers with a partial set.
 */

import readXlsxFile from 'read-excel-file/node';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { brands, products, productVariants } from '../db/schema.js';
import { InvalidXlsxError } from './leadImport.js';
import { refreshEmbeddingsSequential } from './embeddings.js';
import { invalidateCatalogCache } from './ragQuery.js';
import { parseTemplateRows, TEMPLATE_SHEET } from './catalogTemplate.js';
import { replaceVariantTiers } from '../repositories/priceTiers.js';

export { InvalidXlsxError };

export interface CatalogImportResult {
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  lookupsCreated: number;
  skipped: number;
  untouched: number;
  errors: { row: number; reason: string }[];
}

export async function importCatalogFromXlsx(buffer: Buffer): Promise<CatalogImportResult> {
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    sheets = await readXlsxFile(buffer);
  } catch (err) {
    throw new InvalidXlsxError(err);
  }
  const sheet = sheets.find((s) => s.sheet.trim().toLowerCase() === TEMPLATE_SHEET.toLowerCase()) ?? sheets[0];
  const parsed = parseTemplateRows((sheet?.data ?? []) as unknown[][]);

  const result: CatalogImportResult = {
    productsCreated: 0,
    productsUpdated: 0,
    variantsCreated: 0,
    variantsUpdated: 0,
    lookupsCreated: 0,
    skipped: parsed.errors.length,
    untouched: 0,
    errors: parsed.errors.map((e) => ({ row: e.row, reason: e.message })),
  };
  if (parsed.variants.length === 0) return result;

  const db = getDb();
  const changed = new Set<string>();

  await db.transaction(async (tx) => {
    const brandMap = new Map((await tx.select({ id: brands.id, name: brands.name }).from(brands)).map((b) => [b.name.toLowerCase(), b.id]));
    const productRows = await tx.select({ id: products.id, name: products.name }).from(products);
    const productMap = new Map(productRows.map((p) => [p.name.toLowerCase(), p.id]));
    const touchedProducts = new Set<string>();

    for (const v of parsed.variants) {
      let brandId = brandMap.get(v.brand.toLowerCase());
      if (!brandId) {
        const [row] = await tx.insert(brands).values({ name: v.brand }).returning({ id: brands.id });
        brandId = row!.id;
        brandMap.set(v.brand.toLowerCase(), brandId);
        result.lookupsCreated++;
      }

      // A blank cell means "no change": only fields the file actually fills are written.
      const blankless = {
        ...(v.description !== null ? { description: v.description } : {}),
        ...(v.fungsi !== null ? { fungsi: v.fungsi } : {}),
      };
      let productId = productMap.get(v.product.toLowerCase());
      if (productId === undefined) {
        const [row] = await tx
          .insert(products)
          .values({ name: v.product, brandId, ...blankless })
          .returning({ id: products.id });
        productId = row!.id;
        productMap.set(v.product.toLowerCase(), productId);
        touchedProducts.add(productId);
        result.productsCreated++;
      } else {
        await tx
          .update(products)
          .set({ brandId, ...blankless, updatedAt: new Date() })
          .where(eq(products.id, productId));
        if (!touchedProducts.has(productId)) {
          touchedProducts.add(productId);
          result.productsUpdated++;
        }
      }
      changed.add(productId);

      const lowest = Math.min(...v.tiers.map((t) => t.priceIdr));
      const [existing] = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(and(eq(productVariants.productId, productId), sql`lower(${productVariants.name}) = ${v.size.toLowerCase()}`));
      let variantId: string;
      if (existing) {
        variantId = existing.id;
        await tx
          .update(productVariants)
          .set({ priceIdr: String(lowest), isActive: true, updatedAt: new Date() })
          .where(eq(productVariants.id, variantId));
        result.variantsUpdated++;
      } else {
        const [row] = await tx
          .insert(productVariants)
          .values({ productId, name: v.size, priceIdr: String(lowest), isActive: true })
          .returning({ id: productVariants.id });
        variantId = row!.id;
        result.variantsCreated++;
      }
      await replaceVariantTiers(tx, variantId, v.tiers);
    }

    result.untouched = productRows.length - result.productsUpdated;
  });

  invalidateCatalogCache();
  // After commit; one at a time, see refreshEmbeddingsSequential.
  void refreshEmbeddingsSequential([...changed]);

  return result;
}
