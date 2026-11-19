/**
 * The product editor behind the dashboard's Katalog "Tambah Produk / Ubah Produk" screens: a product
 * with its sizes (product_variants) and each size's quantity price tiers, switched on or off, deleted,
 * and every save written to catalog_audit as a list of CatalogChange.
 *
 * The pure half (ProductDraftSchema, validateProductDraft, diffProduct) runs without a database. Every
 * write is one transaction and invalidates the bot's cached catalog on commit, so a switched-off or
 * deleted product is gone from the catalog block and hitung_harga on the very next turn.
 */
import { z } from 'zod';
import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { getDb, type DbOrTx } from '../db/client.js';
import { brands, leads, messages, productReferenceImages, productVariants, products } from '../db/schema.js';
import { BRAND_NAME, brandSlugOfName } from '../domain/brands.js';
import { normalizeSize, type BrandSlug } from '../domain/orderProfile.js';
import { lowestTier, toPcs, type PriceTier, type QtyUnit } from '../domain/pricing.js';
import { formatProductSpec, parseProductSpec } from '../domain/productSpec.js';
import type { Product, ProductVariant } from '../domain/types.js';
import { listTiersByVariant, replaceVariantTiers } from '../repositories/priceTiers.js';
import { MAX_REFERENCE_IMAGES_PER_PRODUCT } from '../repositories/referenceImages.js';
import { recordCatalogChange } from '../repositories/catalogAudit.js';
import { refreshEmbeddingAsync } from './embeddings.js';
import { formatProducts, invalidateCatalogCache } from './ragQuery.js';

// ─── Draft and validation (pure) ─────────────────────────────────────────────

const UnitSchema = z.enum(['rim', 'pcs']);

/** Business caps on one tier. min_qty is a Postgres integer (max 2,147,483,647); this stays far below it. */
export const MAX_TIER_QTY = 10_000_000;
/** Rp per pcs or per rim. price_idr is numeric, so this is a sanity cap that keeps every total a safe integer. */
export const MAX_TIER_PRICE_IDR = 1_000_000_000;
/** Text caps: a huge name or size would otherwise fail its unique btree index with a 500. */
export const MAX_TEXT_LENGTH = 200;
export const MAX_USE_LENGTH = 500;

// Any finite number (or null = not filled in yet) gets through the schema, so that a fractional, zero,
// negative or out-of-range quantity or price comes back from validateProductDraft by size and tier index -
// the form can mark the field - instead of as a bare schema 400. Nothing unchecked reaches the database.
const DraftTierSchema = z.object({
  minQty: z.number().nullable(),
  qtyUnit: UnitSchema,
  priceIdr: z.number().nullable(),
  priceUnit: UnitSchema,
  includesDelivery: z.boolean(),
});

const shortText = z.string().max(MAX_TEXT_LENGTH);

export const ProductDraftSchema = z.object({
  brand: z.enum(['kertas_supreme', 'imperial_indopack']),
  name: shortText,
  gsm: shortText.nullable(),
  print: shortText.nullable(),
  finishing: shortText.nullable(),
  use: z.string().max(MAX_USE_LENGTH),
  isActive: z.boolean(),
  sizes: z.array(
    z.object({
      // The variant id from GET; absent (or null) for a size added in the form.
      id: z.string().uuid().nullish(),
      size: shortText,
      tiers: z.array(DraftTierSchema),
    })
  ),
});
export type ProductDraft = z.infer<typeof ProductDraftSchema>;

export interface ProductInput {
  brand: BrandSlug;
  name: string;
  gsm: string | null;
  print: string | null;
  finishing: string | null;
  use: string;
  isActive: boolean;
  sizes: { id?: string; size: string; tiers: PriceTier[] }[];
}

export type ProductInputErrorCode =
  | 'name_required'
  | 'use_required'
  | 'no_sizes'
  | 'size_required'
  | 'duplicate_size'
  | 'no_tiers'
  | 'qty_missing'
  | 'qty_invalid'
  | 'price_missing'
  | 'price_invalid'
  | 'duplicate_tier'
  | 'tier_order';

export interface ProductInputError {
  code: ProductInputErrorCode;
  sizeIndex?: number;
  tierIndex?: number;
}

/** null = missing; anything but a whole number from 1 to `max` = invalid. */
const checkWhole = (n: number | null, max: number): 'ok' | 'missing' | 'invalid' =>
  n === null ? 'missing' : Number.isSafeInteger(n) && n > 0 && n <= max ? 'ok' : 'invalid';
const optionalText = (v: string | null): string | null => v?.trim() || null;
const tierKey = (t: { minQty: number; qtyUnit: QtyUnit }): string => `${t.minQty} ${t.qtyUnit}`;

/**
 * Trimmed, checked input, or every problem by size and tier index. A quantity or price that is null is
 * "missing"; one that is fractional, zero, negative or above MAX_TIER_QTY / MAX_TIER_PRICE_IDR is
 * "invalid". Tiers must rise strictly in pcs in the order given: "5 rim" then "2500 pcs" is one threshold
 * twice and is tier_order, reported once per size on the first offending tier; the very same
 * (minQty, unit) twice is duplicate_tier. Order and duplicates are judged on valid quantities only.
 */
export function validateProductDraft(d: ProductDraft): { ok: true; input: ProductInput } | { ok: false; errors: ProductInputError[] } {
  const errors: ProductInputError[] = [];
  const name = d.name.trim();
  const use = d.use.trim();
  if (!name) errors.push({ code: 'name_required' });
  if (!use) errors.push({ code: 'use_required' });
  if (d.sizes.length === 0) errors.push({ code: 'no_sizes' });

  const seenSizes = new Set<string>();
  const sizes: ProductInput['sizes'] = d.sizes.map((s, sizeIndex) => {
    const size = s.size.trim();
    if (!size) {
      errors.push({ code: 'size_required', sizeIndex });
    } else {
      const key = normalizeSize(size);
      if (seenSizes.has(key)) errors.push({ code: 'duplicate_size', sizeIndex });
      seenSizes.add(key);
    }
    if (s.tiers.length === 0) errors.push({ code: 'no_tiers', sizeIndex });

    const seenTiers = new Set<string>();
    let highestPcs = 0;
    let orderReported = false;
    const tiers: PriceTier[] = [];
    s.tiers.forEach((t, tierIndex) => {
      const qty = checkWhole(t.minQty, MAX_TIER_QTY);
      const price = checkWhole(t.priceIdr, MAX_TIER_PRICE_IDR);
      if (qty !== 'ok') errors.push({ code: qty === 'missing' ? 'qty_missing' : 'qty_invalid', sizeIndex, tierIndex });
      if (price !== 'ok') errors.push({ code: price === 'missing' ? 'price_missing' : 'price_invalid', sizeIndex, tierIndex });
      if (qty !== 'ok') return;
      const key = tierKey({ minQty: t.minQty!, qtyUnit: t.qtyUnit });
      if (seenTiers.has(key)) {
        errors.push({ code: 'duplicate_tier', sizeIndex, tierIndex });
        return;
      }
      seenTiers.add(key);
      const pcs = toPcs(t.minQty!, t.qtyUnit);
      if (pcs <= highestPcs && !orderReported) {
        errors.push({ code: 'tier_order', sizeIndex, tierIndex });
        orderReported = true;
      }
      highestPcs = Math.max(highestPcs, pcs);
      if (price === 'ok') tiers.push({ minQty: t.minQty!, qtyUnit: t.qtyUnit, priceIdr: t.priceIdr!, priceUnit: t.priceUnit, includesDelivery: t.includesDelivery });
    });
    return { ...(s.id ? { id: s.id } : {}), size, tiers };
  });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      brand: d.brand,
      name,
      gsm: optionalText(d.gsm),
      print: optionalText(d.print),
      finishing: optionalText(d.finishing),
      use,
      isActive: d.isActive,
      sizes,
    },
  };
}

// ─── Diff (pure) ─────────────────────────────────────────────────────────────

export type CatalogChange =
  | { kind: 'created'; via: 'form' | 'import'; fileName?: string }
  | { kind: 'field'; field: 'name' | 'brand' | 'gsm' | 'print' | 'finishing' | 'use'; from: string | null; to: string | null }
  | { kind: 'active'; to: boolean }
  | { kind: 'size_added' | 'size_removed'; size: string }
  | { kind: 'size_renamed'; from: string; to: string }
  | { kind: 'tier_added' | 'tier_removed'; size: string; minQty: number; qtyUnit: QtyUnit }
  | { kind: 'tier_price'; size: string; minQty: number; qtyUnit: QtyUnit; priceUnit: QtyUnit; from: number; to: number }
  | { kind: 'delivery'; size: string; minQty: number; qtyUnit: QtyUnit; to: boolean };

/**
 * For each `after` size, the index of the `before` size it is (or -1 for a new one): first by id, then,
 * for a size sent without one (or with an id that is not among `before`), by normalizeSize among the
 * sizes still unclaimed. The save and the diff both use this, so history says what the save did.
 */
function matchSizes(before: { id?: string; size: string }[], after: { id?: string; size: string }[]): number[] {
  const claimed = new Set<number>();
  const match = after.map(() => -1);
  after.forEach((s, i) => {
    if (!s.id) return;
    const j = before.findIndex((b, k) => !claimed.has(k) && b.id === s.id);
    if (j >= 0) {
      match[i] = j;
      claimed.add(j);
    }
  });
  after.forEach((s, i) => {
    if (match[i] !== -1) return;
    const key = normalizeSize(s.size);
    const j = before.findIndex((b, k) => !claimed.has(k) && normalizeSize(b.size) === key);
    if (j >= 0) {
      match[i] = j;
      claimed.add(j);
    }
  });
  return match;
}

function diffTiers(before: PriceTier[], after: PriceTier[], size: string): CatalogChange[] {
  const out: CatalogChange[] = [];
  const beforeByKey = new Map(before.map((t) => [tierKey(t), t]));
  const afterKeys = new Set(after.map(tierKey));
  for (const t of before) {
    if (!afterKeys.has(tierKey(t))) out.push({ kind: 'tier_removed', size, minQty: t.minQty, qtyUnit: t.qtyUnit });
  }
  for (const t of after) {
    const b = beforeByKey.get(tierKey(t));
    if (!b) {
      out.push({ kind: 'tier_added', size, minQty: t.minQty, qtyUnit: t.qtyUnit });
      continue;
    }
    if (b.priceIdr !== t.priceIdr || b.priceUnit !== t.priceUnit) {
      out.push({ kind: 'tier_price', size, minQty: t.minQty, qtyUnit: t.qtyUnit, priceUnit: t.priceUnit, from: b.priceIdr, to: t.priceIdr });
    }
    if (b.includesDelivery !== t.includesDelivery) {
      out.push({ kind: 'delivery', size, minQty: t.minQty, qtyUnit: t.qtyUnit, to: t.includesDelivery });
    }
  }
  return out;
}

/** Fields, the active flag, sizes removed / added / renamed, then each kept size's tiers (named as after). */
export function diffProduct(before: ProductInput, after: ProductInput): CatalogChange[] {
  const out: CatalogChange[] = [];
  const fields = ['name', 'brand', 'gsm', 'print', 'finishing', 'use'] as const;
  for (const field of fields) {
    if (before[field] !== after[field]) out.push({ kind: 'field', field, from: before[field], to: after[field] });
  }
  if (before.isActive !== after.isActive) out.push({ kind: 'active', to: after.isActive });

  const match = matchSizes(before.sizes, after.sizes);
  const kept = new Set(match.filter((j) => j >= 0));
  before.sizes.forEach((s, j) => {
    if (!kept.has(j)) out.push({ kind: 'size_removed', size: s.size });
  });
  after.sizes.forEach((s, i) => {
    if (match[i] === -1) out.push({ kind: 'size_added', size: s.size });
  });
  after.sizes.forEach((s, i) => {
    const b = before.sizes[match[i]!];
    if (b && b.size !== s.size) out.push({ kind: 'size_renamed', from: b.size, to: s.size });
  });
  after.sizes.forEach((s, i) => {
    const b = before.sizes[match[i]!];
    if (b) out.push(...diffTiers(b.tiers, s.tiers, s.size));
  });
  return out;
}

// ─── Preview (pure) ──────────────────────────────────────────────────────────

/** The form's "what the bot reads" panel. */
export interface ProductPreview {
  botText: string;
  /** Sizes left out of botText because the validator has something against them, as typed. */
  hiddenSizes: string[];
  errors: ProductInputError[];
  /** What saving this draft over the stored product would record; [] for a new product or an invalid draft. */
  changes: CatalogChange[];
}

/**
 * How the bot would read the draft once saved: the catalog block's own lines (formatProducts) over
 * every size no validation error names. Over a stored product it shows what the save keeps that the
 * form does not carry - each re-sent tier's Excel note (matched as writeSizes matches it) and the
 * reference photos - and the changes the save would record.
 */
export function previewProduct(draft: ProductDraft, stored: CatalogProduct | null): ProductPreview {
  const checked = validateProductDraft(draft);
  const errors = checked.ok ? [] : checked.errors;
  const flagged = new Set(errors.flatMap((e) => (e.sizeIndex === undefined ? [] : [e.sizeIndex])));
  const match = stored
    ? matchSizes(stored.sizes, draft.sizes.map((s) => ({ ...(s.id ? { id: s.id } : {}), size: s.size.trim() })))
    : draft.sizes.map(() => -1);
  const now = new Date().toISOString();

  const hiddenSizes: string[] = [];
  const variants: ProductVariant[] = [];
  draft.sizes.forEach((s, i) => {
    // A size with no tiers is no_tiers, so every size shown here has whole, in-range numbers throughout.
    if (flagged.has(i)) {
      hiddenSizes.push(s.size);
      return;
    }
    const notes = new Map((stored?.sizes[match[i]!]?.tiers ?? []).map((t) => [tierKey(t), t.note ?? null]));
    const priceTiers: PriceTier[] = s.tiers.map((t) => {
      const tier = { minQty: t.minQty!, qtyUnit: t.qtyUnit, priceIdr: t.priceIdr!, priceUnit: t.priceUnit, includesDelivery: t.includesDelivery };
      return { ...tier, note: notes.get(tierKey(tier)) ?? null };
    });
    variants.push({
      id: s.id ?? `preview-${i}`, productId: stored?.id ?? 'preview', name: s.size.trim(), sku: null, priceIdr: lowestTier(priceTiers)!.priceIdr,
      mpPriceIdr: null, isiCtn: null, isiBox: null, uomPriceId: null, mpUomId: null, uomCtnId: null, uomBoxId: null, minOrderQty: null,
      minOrderUomId: null, priceTiers, imageUrl: null, stockStatus: 'normal', isActive: true, description: null, gsm: null, sourceUrl: null,
      scrapedAt: null, sourceHash: null, createdAt: now, updatedAt: now,
    });
  });

  const product: Product = {
    id: stored?.id ?? 'preview', brandId: '', categoryId: null, name: draft.name.trim(),
    description: formatProductSpec(draft), fungsi: draft.use.trim() || null, usp: null, kataKunci: null, kelengkapan: null,
    bahan: null, ketebalan: null, imageUrl: null, isActive: draft.isActive, createdAt: now, updatedAt: now,
    brand: { id: '', name: BRAND_NAME[draft.brand], description: null, catalogFileUrl: null, catalogFileName: null, catalogFileUploadedAt: null, brandType: 'own', createdAt: now },
    category: null,
    variants,
    referenceImageUrls: (stored?.referenceImages ?? []).slice(0, MAX_REFERENCE_IMAGES_PER_PRODUCT).map((r) => r.imageUrl),
  };
  return {
    botText: formatProducts([product]),
    hiddenSizes,
    errors,
    changes: stored && checked.ok ? diffProduct(stored, checked.input) : [],
  };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface CatalogProduct extends Omit<ProductInput, 'sizes'> {
  id: string;
  sizes: { id: string; size: string; tiers: PriceTier[] }[];
  referenceImages: { id: string; imageUrl: string; sort: number }[];
  updatedAt: string;
}

export interface Actor {
  staffId: string | null;
  name: string;
}

export class ProductNameTakenError extends Error {
  constructor(name?: string) {
    super(name ? `A product named "${name}" already exists` : 'A product with this name already exists');
    this.name = 'ProductNameTakenError';
  }
}

/**
 * Products of the two brands, as the editor shows them. Sizes in the order they were added (one save's
 * new sizes keep the order they were typed; an import's share a timestamp and fall back to their names).
 * A product under any other brand row is not the editor's and is left out.
 */
async function loadCatalogProducts(db: DbOrTx, where?: SQL): Promise<CatalogProduct[]> {
  const rows = await db
    .select({ p: products, brandName: brands.name })
    .from(products)
    .innerJoin(brands, eq(brands.id, products.brandId))
    .where(where)
    .orderBy(asc(products.name));
  const known = rows.flatMap((r) => {
    const brand = brandSlugOfName(r.brandName);
    return brand ? [{ p: r.p, brand }] : [];
  });
  if (known.length === 0) return [];
  const ids = known.map((r) => r.p.id);
  const [variantRows, imageRows] = await Promise.all([
    db.select().from(productVariants).where(inArray(productVariants.productId, ids)),
    db
      .select()
      .from(productReferenceImages)
      .where(inArray(productReferenceImages.productId, ids))
      .orderBy(asc(productReferenceImages.sort), asc(productReferenceImages.createdAt)),
  ]);
  variantRows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.name.localeCompare(b.name, 'id', { numeric: true }));
  const tierMap = await listTiersByVariant(variantRows.map((v) => v.id), db);

  return known.map(({ p, brand }) => {
    const spec = parseProductSpec(p.description);
    return {
      id: p.id,
      brand,
      name: p.name,
      gsm: spec.gsm,
      print: spec.print,
      finishing: spec.finishing,
      use: p.fungsi ?? '',
      isActive: p.isActive,
      sizes: variantRows.filter((v) => v.productId === p.id).map((v) => ({ id: v.id, size: v.name, tiers: tierMap.get(v.id) ?? [] })),
      referenceImages: imageRows.filter((i) => i.productId === p.id).map((i) => ({ id: i.id, imageUrl: i.imageUrl, sort: i.sort })),
      updatedAt: p.updatedAt.toISOString(),
    };
  });
}

/** One product as the editor shows it, read through `db` (a caller's transaction, or the pool). */
export async function loadOne(db: DbOrTx, id: string): Promise<CatalogProduct | null> {
  return (await loadCatalogProducts(db, eq(products.id, id)))[0] ?? null;
}

/**
 * The Katalog list. The search matches the name, the use text (Kegunaan) or a size. `counts` are per
 * brand tab: they follow the search and status filters but not the brand filter, so every tab shows
 * what it would list.
 */
export async function listCatalogProducts(f: {
  brand?: BrandSlug;
  search?: string;
  status?: 'active' | 'inactive';
}): Promise<{ items: CatalogProduct[]; counts: Record<'all' | BrandSlug, number> }> {
  const q = f.search?.trim().toLowerCase() ?? '';
  const qSize = normalizeSize(q);
  const matches = (await loadCatalogProducts(getDb())).filter(
    (p) =>
      (!q ||
        p.name.toLowerCase().includes(q) ||
        p.use.toLowerCase().includes(q) ||
        p.sizes.some((s) => s.size.toLowerCase().includes(q) || (qSize !== '' && normalizeSize(s.size).includes(qSize)))) &&
      (!f.status || p.isActive === (f.status === 'active'))
  );
  const counts: Record<'all' | BrandSlug, number> = { all: matches.length, kertas_supreme: 0, imperial_indopack: 0 };
  for (const p of matches) counts[p.brand]++;
  return { items: f.brand ? matches.filter((p) => p.brand === f.brand) : matches, counts };
}

export async function getCatalogProduct(id: string): Promise<CatalogProduct | null> {
  return loadOne(getDb(), id);
}

// ─── Writing ─────────────────────────────────────────────────────────────────

function isNameUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: string; constraint?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === '23505' && e.constraint === 'products_name_unique') return true;
  }
  return false;
}

/** One transaction per save. Editor saves take one advisory lock, so the case-insensitive name check holds. */
async function save<T>(work: (tx: DbOrTx) => Promise<T>): Promise<T> {
  try {
    return await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('catalog_editor'))`);
      return work(tx);
    });
  } catch (err) {
    if (isNameUniqueViolation(err)) throw new ProductNameTakenError();
    throw err;
  }
}

/** After a commit: the bot reads the new catalog on its next turn, and the product's embedding follows. */
function afterWrite(productId: string, embed: boolean): void {
  invalidateCatalogCache();
  if (embed) refreshEmbeddingAsync(productId);
}

async function assertNameFree(tx: DbOrTx, name: string, exceptId?: string): Promise<void> {
  const taken = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(sql`lower(${products.name}) = lower(${name})`, exceptId ? ne(products.id, exceptId) : undefined))
    .limit(1);
  if (taken.length > 0) throw new ProductNameTakenError(name);
}

/** The brand row for a slug (by name, case-insensitive, first by name as getBrandRowsBySlug picks), read
 *  inside the save's transaction; created when missing. */
async function brandIdFor(tx: DbOrTx, brand: BrandSlug): Promise<string> {
  const rows = await tx.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name));
  const existing = rows.find((b) => brandSlugOfName(b.name) === brand);
  if (existing) return existing.id;
  const [made] = await tx.insert(brands).values({ name: BRAND_NAME[brand] }).onConflictDoNothing().returning({ id: brands.id });
  if (made) return made.id;
  const [row] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.name, BRAND_NAME[brand]));
  return row!.id;
}

/**
 * Brings a product's variants in line with `sizes`: matched variants are updated (renamed too), the
 * rest inserted, unmatched variants deleted (their tiers go with them), then each size's tiers are
 * replaced. A tier the form re-sends keeps the note its (minQty, unit) had: the form has no note field,
 * and an Excel note must survive an edit.
 */
async function writeSizes(
  tx: DbOrTx,
  productId: string,
  sizes: ProductInput['sizes'],
  existing: CatalogProduct['sizes']
): Promise<void> {
  const match = matchSizes(existing, sizes);
  const keptIds = new Set(match.flatMap((j) => (j >= 0 ? [existing[j]!.id] : [])));
  const gone = existing.filter((v) => !keptIds.has(v.id)).map((v) => v.id);
  if (gone.length > 0) await tx.delete(productVariants).where(inArray(productVariants.id, gone));

  // A rename goes through the variant's own id as a placeholder name first, so two sizes trading names
  // never collide on uq_variant_name_per_product halfway through.
  for (const [i, s] of sizes.entries()) {
    const v = existing[match[i]!];
    if (v && v.size !== s.size) await tx.update(productVariants).set({ name: v.id }).where(eq(productVariants.id, v.id));
  }

  const t0 = Date.now();
  for (const [i, s] of sizes.entries()) {
    const priceIdr = String(lowestTier(s.tiers)!.priceIdr);
    const v = existing[match[i]!];
    let variantId: string;
    if (v) {
      variantId = v.id;
      await tx.update(productVariants).set({ name: s.size, priceIdr, isActive: true, updatedAt: new Date() }).where(eq(productVariants.id, variantId));
    } else {
      const [row] = await tx
        .insert(productVariants)
        .values({ productId, name: s.size, priceIdr, isActive: true, createdAt: new Date(t0 + i) })
        .returning({ id: productVariants.id });
      variantId = row!.id;
    }
    const notes = new Map((v?.tiers ?? []).map((t) => [tierKey(t), t.note ?? null]));
    await replaceVariantTiers(
      tx,
      variantId,
      s.tiers.map((t) => ({ ...t, note: t.note ?? notes.get(tierKey(t)) ?? null }))
    );
  }
}

export async function createCatalogProduct(input: ProductInput, actor: Actor): Promise<CatalogProduct> {
  const id = await save(async (tx) => {
    await assertNameFree(tx, input.name);
    const brandId = await brandIdFor(tx, input.brand);
    const [row] = await tx
      .insert(products)
      .values({ brandId, name: input.name, description: formatProductSpec(input), fungsi: input.use, isActive: input.isActive })
      .returning({ id: products.id });
    await writeSizes(tx, row!.id, input.sizes, []);
    await recordCatalogChange(tx, row!.id, 'created', [{ kind: 'created', via: 'form' }], actor);
    return row!.id;
  });
  afterWrite(id, true);
  return (await getCatalogProduct(id))!;
}

/**
 * Saves the whole form. The description is rewritten only when gramasi, cetak or finishing changed, so
 * free text an older product keeps there survives an edit of its prices. A save that changes nothing
 * writes no history row.
 */
export async function updateCatalogProduct(id: string, input: ProductInput, actor: Actor): Promise<CatalogProduct | null> {
  const done = await save(async (tx) => {
    const before = await loadOne(tx, id);
    if (!before) return false;
    await assertNameFree(tx, input.name, id);
    const brandId = await brandIdFor(tx, input.brand);
    const specChanged = before.gsm !== input.gsm || before.print !== input.print || before.finishing !== input.finishing;
    await tx
      .update(products)
      .set({
        brandId,
        name: input.name,
        fungsi: input.use,
        isActive: input.isActive,
        updatedAt: new Date(),
        ...(specChanged ? { description: formatProductSpec(input) } : {}),
      })
      .where(eq(products.id, id));
    await writeSizes(tx, id, input.sizes, before.sizes);
    const changes = diffProduct(before, input);
    if (changes.length > 0) await recordCatalogChange(tx, id, 'updated', changes, actor);
    return true;
  });
  if (!done) return null;
  afterWrite(id, true);
  return getCatalogProduct(id);
}

/** Switch a product on or off. Setting what it already is changes nothing and writes no history. */
export async function setCatalogProductActive(id: string, isActive: boolean, actor: Actor): Promise<CatalogProduct | null> {
  const found = await save(async (tx) => {
    const before = await loadOne(tx, id);
    if (!before) return false;
    if (before.isActive !== isActive) {
      await tx.update(products).set({ isActive, updatedAt: new Date() }).where(eq(products.id, id));
      await recordCatalogChange(tx, id, isActive ? 'activated' : 'deactivated', [{ kind: 'active', to: isActive }], actor);
    }
    return true;
  });
  if (!found) return null;
  afterWrite(id, false);
  return getCatalogProduct(id);
}

/**
 * Deletes the product; its sizes, tiers and reference photos go with it (cascade). The history stays,
 * ending in a 'deleted' row that carries the product's name.
 */
export async function deleteCatalogProduct(id: string, actor: Actor): Promise<{ sizes: number; tiers: number } | null> {
  const result = await save(async (tx) => {
    const before = await loadOne(tx, id);
    if (!before) return null;
    // Legacy column with a plain foreign key: another product pointing here would block the delete.
    await tx.update(products).set({ upsellProductId: null }).where(eq(products.upsellProductId, id));
    await tx.delete(products).where(eq(products.id, id));
    await recordCatalogChange(tx, id, 'deleted', [{ kind: 'field', field: 'name', from: before.name, to: null }], actor);
    return { sizes: before.sizes.length, tiers: before.sizes.reduce((n, s) => n + s.tiers.length, 0) };
  });
  if (result) afterWrite(id, false);
  return result;
}

// ─── Usage ───────────────────────────────────────────────────────────────────

const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * How the product is used in conversations: assistant replies in the last 30 days whose hitung_harga
 * calls named it (messages.metadata.priceCalls[].productName), and won leads whose item lines mention it.
 */
export async function getProductUsage(productName: string): Promise<{ quotedLast30Days: number; wonLeads: number }> {
  const db = getDb();
  const [quoted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.role, 'assistant'),
        sql`${messages.createdAt} > now() - interval '30 days'`,
        sql`${messages.metadata}->'priceCalls' @> ${JSON.stringify([{ productName }])}::jsonb`
      )
    );
  const [won] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.status, 'won'), sql`${leads.items}::text ILIKE ${`%${likeEscape(productName)}%`}`));
  return { quotedLast30Days: quoted?.n ?? 0, wonLeads: won?.n ?? 0 };
}
