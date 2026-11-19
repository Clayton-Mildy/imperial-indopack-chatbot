/**
 * Excel -> catalog, reading the single-sheet tier template (catalogTemplate.ts).
 *
 * Identity is by NAME, never UUID. Update in place, never wipe: brands, products and variants
 * are found or created by name, a variant's tiers are REPLACED by the rows in the file, and
 * anything not in the file is left alone and counted as `untouched`. Sizes match by normalizeSize
 * (case, spaces, "cm", "x" vs "×"), the same way the product editor matches them.
 *
 * A row with a problem is reported by its Excel row number and skipped; the valid rows still
 * apply. A variant with any bad row is skipped whole (parseTemplateRows), so a typo can never
 * replace its tiers with a partial set.
 */

import readXlsxFile from 'read-excel-file/node';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { brands, products, productVariants } from '../db/schema.js';
import { brandSlugOfName } from '../domain/brands.js';
import { normalizeSize } from '../domain/orderProfile.js';
import { parseProductSpec } from '../domain/productSpec.js';
import { diffProduct, loadOne, type Actor, type CatalogChange, type ProductInput } from './catalogEditor.js';
import { recordCatalogChange } from '../repositories/catalogAudit.js';
import { InvalidXlsxError } from './leadImport.js';
import { refreshEmbeddingsSequential } from './embeddings.js';
import { invalidateCatalogCache } from './ragQuery.js';
import { parseTemplateRows, TEMPLATE_SHEET, type TemplateVariant } from './catalogTemplate.js';
import { sameGsm } from '../domain/gramasi.js';
import { listTiersByVariant, replaceVariantTiers } from '../repositories/priceTiers.js';
import { lowestTier, toPcs, type PriceTier } from '../domain/pricing.js';

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

export interface ImportPreview {
  newProducts: number;
  newSizes: number;
  changedPrices: number;
  unchanged: number;
  validRows: number;
  totalRows: number;
  errors: { row: number; message: string }[];
}

async function parseWorkbook(buffer: Buffer) {
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    sheets = await readXlsxFile(buffer);
  } catch (err) {
    throw new InvalidXlsxError(err);
  }
  const sheet = sheets.find((s) => s.sheet.trim().toLowerCase() === TEMPLATE_SHEET.toLowerCase()) ?? sheets[0];
  return parseTemplateRows((sheet?.data ?? []) as unknown[][]);
}

/**
 * A product is all-gramasi or no-gramasi. A product whose file rows disagree with its stored size rows on
 * that is refused whole: one error naming its first file row, none of its variants applied.
 */
function gramasiClashes(
  variants: TemplateVariant[],
  storedGsm: (productKey: string) => (string | null)[] | undefined
): { errors: { row: number; message: string }[]; refused: Set<string> } {
  const errors: { row: number; message: string }[] = [];
  const refused = new Set<string>();
  for (const v of variants) {
    const key = v.product.toLowerCase();
    if (refused.has(key)) continue;
    const stored = storedGsm(key);
    if (!stored || stored.length === 0) continue;
    const fileHas = v.gsm !== null;
    const storedHas = stored.some((g) => g !== null);
    if (fileHas === storedHas) continue;
    refused.add(key);
    errors.push({
      row: Math.min(...v.tierRows),
      message: fileHas
        ? `Produk "${v.product}" di katalog tidak punya gramasi, tapi file ini mengisinya. Tidak ada yang diimpor untuk produk ini.`
        : `Produk "${v.product}" di katalog punya gramasi, tapi file ini mengosongkannya. Tidak ada yang diimpor untuk produk ini.`,
    });
  }
  return { errors, refused };
}

const sameTier = (a: PriceTier, b: PriceTier) =>
  a.priceIdr === b.priceIdr && a.priceUnit === b.priceUnit && a.includesDelivery === b.includesDelivery;

/**
 * What importing this file would do, counted against the database. Writes nothing and touches no cache.
 * Counts per product / size / tier row, over variants that survive parsing (a variant with a bad row is
 * skipped whole, so its rows change nothing). A row that only changes the description or use text, or
 * whose variant drops tiers the file omits, is not counted as a change.
 */
export async function previewCatalogImport(buffer: Buffer): Promise<ImportPreview> {
  const parsed = await parseWorkbook(buffer);
  const preview: ImportPreview = {
    newProducts: 0,
    newSizes: 0,
    changedPrices: 0,
    unchanged: 0,
    validRows: parsed.validRows,
    totalRows: parsed.totalRows,
    errors: parsed.errors,
  };
  if (parsed.variants.length === 0) {
    preview.unchanged = parsed.validRows;
    return preview;
  }

  const db = getDb();
  const productRows = await db.select({ id: products.id, name: products.name }).from(products);
  const productIds = new Map(productRows.map((p) => [p.name.toLowerCase(), p.id]));
  const variantRows = await db.select({ id: productVariants.id, productId: productVariants.productId, name: productVariants.name, gsm: productVariants.gsm }).from(productVariants);
  const tierMap = await listTiersByVariant(variantRows.map((v) => v.id), db);

  const clash = gramasiClashes(parsed.variants, (k) => {
    const id = productIds.get(k);
    return id === undefined ? undefined : variantRows.filter((r) => r.productId === id).map((r) => r.gsm);
  });
  if (clash.refused.size > 0) {
    const dropped = parsed.variants.filter((v) => clash.refused.has(v.product.toLowerCase())).reduce((n, v) => n + v.tiers.length, 0);
    preview.errors = [...preview.errors, ...clash.errors].sort((a, b) => a.row - b.row);
    preview.validRows = Math.max(0, preview.validRows - dropped);
  }

  const newProducts = new Set<string>();
  const newSizes = new Set<string>();
  let changedRows = 0;
  for (const v of parsed.variants) {
    if (clash.refused.has(v.product.toLowerCase())) continue;
    const productKey = v.product.toLowerCase();
    const productId = productIds.get(productKey);
    if (productId === undefined) {
      newProducts.add(productKey);
      changedRows += v.tiers.length;
      continue;
    }
    const existing = variantRows.find((r) => r.productId === productId && sameGsm(r.gsm, v.gsm) && normalizeSize(r.name) === normalizeSize(v.size));
    if (!existing) {
      newSizes.add(`${productKey}\u0000${v.gsm ?? ''}\u0000${normalizeSize(v.size)}`);
      changedRows += v.tiers.length;
      continue;
    }
    const stored = new Map((tierMap.get(existing.id) ?? []).map((t) => [toPcs(t.minQty, t.qtyUnit), t]));
    v.tiers.forEach((t) => {
      const was = stored.get(toPcs(t.minQty, t.qtyUnit));
      if (!was || !sameTier(was, t)) {
        preview.changedPrices++;
        changedRows++;
      }
    });
  }
  preview.newProducts = newProducts.size;
  preview.newSizes = newSizes.size;
  preview.unchanged = Math.max(0, parsed.validRows - changedRows);
  return preview;
}

export async function importCatalogFromXlsx(
  buffer: Buffer,
  opts: { fileName?: string; actor?: Actor } = {}
): Promise<CatalogImportResult> {
  const parsed = await parseWorkbook(buffer);
  const actor: Actor = opts.actor ?? { staffId: null, name: 'Sistem' };

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
    // The editor's lock: its case-insensitive name check and this import never interleave.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('catalog_editor'))`);
    const brandMap = new Map((await tx.select({ id: brands.id, name: brands.name }).from(brands)).map((b) => [b.name.toLowerCase(), b.id]));
    const productRows = await tx.select({ id: products.id, name: products.name }).from(products);
    const productMap = new Map(productRows.map((p) => [p.name.toLowerCase(), p.id]));
    const touchedProducts = new Set<string>();
    // For history: each existing product as it was, and as the file leaves it.
    const before = new Map<string, ProductInput>();
    const after = new Map<string, ProductInput>();
    const created = new Set<string>();

    const storedSizes = await tx.select({ productId: productVariants.productId, gsm: productVariants.gsm }).from(productVariants);
    const clash = gramasiClashes(parsed.variants, (k) => {
      const id = productMap.get(k);
      return id === undefined ? undefined : storedSizes.filter((r) => r.productId === id).map((r) => r.gsm);
    });
    for (const e of clash.errors) result.errors.push({ row: e.row, reason: e.message });
    result.skipped += clash.errors.length;

    for (const v of parsed.variants) {
      if (clash.refused.has(v.product.toLowerCase())) continue;
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
        created.add(productId);
        result.productsCreated++;
      } else {
        if (!created.has(productId) && !before.has(productId)) {
          const was = await loadOne(tx, productId);
          if (was) {
            const { id: _id, referenceImages: _r, updatedAt: _u, ...input } = was;
            before.set(productId, input);
            after.set(productId, structuredClone(input));
          }
        }
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

      // The smallest-quantity tier's price, the rule the product editor uses too.
      const basePrice = lowestTier(v.tiers)!.priceIdr;
      const sizeRows = await tx
        .select({ id: productVariants.id, name: productVariants.name, gsm: productVariants.gsm })
        .from(productVariants)
        .where(eq(productVariants.productId, productId));
      const existing = sizeRows.find((r) => sameGsm(r.gsm, v.gsm) && normalizeSize(r.name) === normalizeSize(v.size));
      let variantId: string;
      if (existing) {
        variantId = existing.id;
        await tx
          .update(productVariants)
          .set({ priceIdr: String(basePrice), isActive: true, updatedAt: new Date() })
          .where(eq(productVariants.id, variantId));
        result.variantsUpdated++;
      } else {
        const [row] = await tx
          .insert(productVariants)
          .values({ productId, name: v.size, gsm: v.gsm, priceIdr: String(basePrice), isActive: true })
          .returning({ id: productVariants.id });
        variantId = row!.id;
        result.variantsCreated++;
      }
      await replaceVariantTiers(tx, variantId, v.tiers);

      const next = after.get(productId);
      if (next) {
        next.brand = brandSlugOfName(v.brand)!;
        if (v.description !== null) {
          const spec = parseProductSpec(v.description);
          next.gsm = spec.gsm;
          next.print = spec.print;
          next.finishing = spec.finishing;
        }
        if (v.fungsi !== null) next.use = v.fungsi;
        const slot = next.sizes.find((s) => s.id === variantId);
        if (slot) slot.tiers = v.tiers;
        else next.sizes.push({ id: variantId, size: v.size, tiers: v.tiers });
      }
    }

    for (const id of created) {
      const changes: CatalogChange[] = [{ kind: 'created', via: 'import', ...(opts.fileName ? { fileName: opts.fileName } : {}) }];
      await recordCatalogChange(tx, id, 'created', changes, actor);
    }
    for (const [id, was] of before) {
      const changes = diffProduct(was, after.get(id)!);
      if (changes.length > 0) await recordCatalogChange(tx, id, 'imported', changes, actor);
    }

    result.untouched = productRows.length - result.productsUpdated;
  });

  invalidateCatalogCache();
  // After commit; one at a time, see refreshEmbeddingsSequential.
  void refreshEmbeddingsSequential([...changed]);

  return result;
}
