import { brandSlugOfName } from '../domain/brands.js';
import type { BrandSlug } from '../domain/orderProfile.js';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { listTiersByVariant } from './priceTiers.js';
import { listReferenceImageUrls } from './referenceImages.js';
import { getDb } from '../db/client.js';
import { brands, categories, products, productVariants, uomTable } from '../db/schema.js';
import type { Brand, Category, Product, ProductTier, ProductVariant, StockStatus, Uom } from '../domain/types.js';

// ─── Mappers ───────────────────────────────────────────────────────────────

function mapBrand(row: typeof brands.$inferSelect): Brand {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    catalogFileUrl: row.catalogFileUrl,
    brandType: row.brandType,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapCategory(row: typeof categories.$inferSelect): Category {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}

export function mapUom(row: typeof uomTable.$inferSelect): Uom {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapProduct(
  row: typeof products.$inferSelect,
  brand?: Brand,
  variants?: ProductVariant[],
  category?: Category | null
): Product {
  return {
    id: row.id,
    brandId: row.brandId,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    fungsi: row.fungsi,
    usp: row.usp,
    kataKunci: row.kataKunci,
    kelengkapan: row.kelengkapan,
    bahan: row.bahan,
    ketebalan: row.ketebalan,
    imageUrl: row.imageUrl,
    tier: (row.tier as ProductTier | null) ?? null,
    relatedProductIds: Array.isArray(row.relatedProductIds) ? (row.relatedProductIds as string[]) : null,
    upsellProductId: (row.upsellProductId as string | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(brand !== undefined ? { brand } : {}),
    ...(variants !== undefined ? { variants } : {}),
    ...(category !== undefined ? { category } : {}),
  };
}

/** Exported so ragQuery's companion lookup maps variants the same way instead of keeping a
 *  hand-rolled copy - that copy is what silently dropped every column added since it was written.
 *
 *  `uoms` resolves the five uom_*_id columns. Passing the map rather than five positional
 *  lookups keeps the call sites readable - there are five of them and they were identical. */
export function mapVariant(
  row: typeof productVariants.$inferSelect,
  uoms?: Map<string, Uom>
): ProductVariant {
  const uom = (id: string | null) => (id && uoms ? uoms.get(id) : undefined);
  const uomPrice = uom(row.uomPriceId);
  const mpUom = uom(row.mpUomId);
  const uomCtn = uom(row.uomCtnId);
  const uomBox = uom(row.uomBoxId);
  const uomMinOrder = uom(row.minOrderUomId);
  return {
    id: row.id,
    productId: row.productId,
    name: row.name,
    sku: row.sku,
    priceIdr: row.priceIdr !== null ? Number(row.priceIdr) : null,
    mpPriceIdr: row.mpPriceIdr !== null ? Number(row.mpPriceIdr) : null,
    isiCtn: row.isiCtn,
    isiBox: row.isiBox,
    uomPriceId: row.uomPriceId,
    mpUomId: row.mpUomId,
    uomCtnId: row.uomCtnId,
    uomBoxId: row.uomBoxId,
    minOrderQty: row.minOrderQty,
    minOrderUomId: row.minOrderUomId,
    imageUrl: row.imageUrl,
    stockStatus: row.stockStatus as StockStatus,
    isActive: row.isActive,
    description: row.description,
    sourceUrl: row.sourceUrl,
    scrapedAt: row.scrapedAt?.toISOString() ?? null,
    sourceHash: row.sourceHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(uomPrice !== undefined ? { uomPrice } : {}),
    ...(mpUom !== undefined ? { mpUom } : {}),
    ...(uomCtn !== undefined ? { uomCtn } : {}),
    ...(uomBox !== undefined ? { uomBox } : {}),
    ...(uomMinOrder !== undefined ? { uomMinOrder } : {}),
  };
}

// ─── UOM ───────────────────────────────────────────────────────────────────

export async function listUom(): Promise<Uom[]> {
  const db = getDb();
  const rows = await db.select().from(uomTable).orderBy(uomTable.name);
  return rows.map(mapUom);
}

export async function createUom(name: string, description?: string): Promise<Uom> {
  const db = getDb();
  const [row] = await db
    .insert(uomTable)
    .values({ name, description: description ?? null })
    .returning();
  if (!row) throw new Error('Failed to create UOM');
  return mapUom(row);
}

export async function updateUom(
  id: string,
  data: { name?: string; description?: string }
): Promise<Uom | null> {
  const db = getDb();
  const setData: Partial<typeof uomTable.$inferInsert> = { ...data };
  const [row] = await db
    .update(uomTable)
    .set(setData)
    .where(eq(uomTable.id, id))
    .returning();
  return row ? mapUom(row) : null;
}

export async function deleteUom(id: string): Promise<boolean> {
  const db = getDb();
  const refs = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(
      sql`(${productVariants.uomPriceId} = ${id} OR ${productVariants.uomCtnId} = ${id} OR ${productVariants.uomBoxId} = ${id})`
    )
    .limit(1);
  if (refs.length > 0) throw new Error('UOM_IN_USE');
  const result = await db.delete(uomTable).where(eq(uomTable.id, id)).returning({ id: uomTable.id });
  return result.length > 0;
}

// ─── Brands ────────────────────────────────────────────────────────────────

export async function listBrands(): Promise<Brand[]> {
  const db = getDb();
  const rows = await db.select().from(brands).orderBy(brands.name);
  return rows.map(mapBrand);
}

/** The two brand rows by slug (matched by name, case-insensitive); null where a row does not exist. */
export async function getBrandRowsBySlug(): Promise<Record<BrandSlug, Brand | null>> {
  const out: Record<BrandSlug, Brand | null> = { kertas_supreme: null, imperial_indopack: null };
  for (const b of await listBrands()) {
    const slug = brandSlugOfName(b.name);
    if (slug && !out[slug]) out[slug] = b;
  }
  return out;
}

export async function createBrand(name: string, description?: string): Promise<Brand> {
  const db = getDb();
  const [row] = await db
    .insert(brands)
    .values({ name, description: description ?? null })
    .returning();
  if (!row) throw new Error('Failed to create brand');
  return mapBrand(row);
}

export async function updateBrand(
  id: string,
  data: { name?: string; description?: string; catalogFileUrl?: string | null; brandType?: string }
): Promise<Brand | null> {
  const db = getDb();
  const setData: Partial<typeof brands.$inferInsert> = { ...data };
  const [row] = await db
    .update(brands)
    .set(setData)
    .where(eq(brands.id, id))
    .returning();
  return row ? mapBrand(row) : null;
}

export async function deleteBrand(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(brands).where(eq(brands.id, id)).returning({ id: brands.id });
  return result.length > 0;
}

// ─── Categories ────────────────────────────────────────────────────────────

export async function listCategories(): Promise<Category[]> {
  const db = getDb();
  const rows = await db.select().from(categories).orderBy(categories.name);
  return rows.map(mapCategory);
}

export async function createCategory(data: { name: string; description?: string | null }): Promise<Category> {
  const db = getDb();
  const [row] = await db
    .insert(categories)
    .values({ name: data.name, description: data.description ?? null })
    .returning();
  if (!row) throw new Error('Failed to create category');
  return mapCategory(row);
}

export async function updateCategory(
  id: string,
  data: Partial<{ name: string; description: string | null }>
): Promise<Category | null> {
  const db = getDb();
  const setData: Partial<typeof categories.$inferInsert> = { ...data };
  const [row] = await db
    .update(categories)
    .set(setData)
    .where(eq(categories.id, id))
    .returning();
  return row ? mapCategory(row) : null;
}

export async function deleteCategory(id: string): Promise<boolean> {
  const db = getDb();
  const refs = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.categoryId, id))
    .limit(1);
  if (refs.length > 0) throw new Error('CATEGORY_IN_USE');
  const result = await db.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id });
  return result.length > 0;
}

// ─── Helper: build UOM lookup map ──────────────────────────────────────────

async function fetchUomMap(db: ReturnType<typeof getDb>): Promise<Map<string, Uom>> {
  const rows = await db.select().from(uomTable);
  return new Map(rows.map((r) => [r.id, mapUom(r)]));
}

// ─── Products ──────────────────────────────────────────────────────────────

export async function listProducts(filters?: {
  brandId?: string;
  search?: string;
  status?: string;
  categoryId?: string;
  page?: number;
  limit?: number;
}): Promise<{ products: Product[]; total: number }> {
  const db = getDb();

  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 25;

  const conditions = [];
  if (filters?.brandId !== undefined) conditions.push(eq(products.brandId, filters.brandId));
  if (filters?.categoryId !== undefined) conditions.push(eq(products.categoryId, filters.categoryId));
  if (filters?.search !== undefined && filters.search.trim() !== '') {
    const term = '%' + filters.search.trim() + '%';
    conditions.push(sql`(${products.name} ILIKE ${term} OR EXISTS (
      SELECT 1 FROM product_variants pv
      WHERE pv.product_id = ${products.id} AND pv.name ILIKE ${term}
    ))`);
  }
  if (filters?.status !== undefined && filters.status.trim() !== '') {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM product_variants pv
      WHERE pv.product_id = ${products.id} AND pv.stock_status = ${filters.status.trim()}
    )`);
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // COUNT query for pagination meta. limit 0 fetches every row anyway, so the row count
  // IS the total — skip the extra query (the full-catalog block rebuild runs this path).
  let total = 0;
  if (limit !== 0) {
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(products)
      .where(whereClause);
    total = count ?? 0;
  }

  // Build paginated query
  let productQuery = db
    .select()
    .from(products)
    .where(whereClause)
    .orderBy(products.name)
    .$dynamic();

  if (limit !== 0) {
    const offset = (page - 1) * limit;
    productQuery = productQuery.limit(limit).offset(offset);
  }

  const productRows = await productQuery;
  if (limit === 0) total = productRows.length;

  if (productRows.length === 0) return { products: [], total };

  const productIds = productRows.map((p) => p.id);
  const brandIds = [...new Set(productRows.map((p) => p.brandId))];
  const categoryIds = [...new Set(productRows.map((p) => p.categoryId).filter((id): id is string => id !== null))];

  const [brandRows, categoryRows, variantRows, uomMap] = await Promise.all([
    db.select().from(brands).where(inArray(brands.id, brandIds)),
    categoryIds.length > 0 ? db.select().from(categories).where(inArray(categories.id, categoryIds)) : Promise.resolve([]),
    db.select().from(productVariants).where(inArray(productVariants.productId, productIds)).orderBy(productVariants.name),
    fetchUomMap(db),
  ]);
  const [tierMap, photoMap] = await Promise.all([
    listTiersByVariant(variantRows.map((v) => v.id)),
    listReferenceImageUrls(productIds),
  ]);

  const brandMap = new Map(brandRows.map((b) => [b.id, mapBrand(b)]));
  const categoryMap = new Map(categoryRows.map((c) => [c.id, mapCategory(c)]));
  const variantMap = new Map<string, ProductVariant[]>();
  for (const v of variantRows) {
    const arr = variantMap.get(v.productId) ?? [];
    arr.push({ ...mapVariant(v, uomMap), priceTiers: tierMap.get(v.id) ?? [] });
    variantMap.set(v.productId, arr);
  }

  return {
    products: productRows.map((p) => ({
      ...mapProduct(p, brandMap.get(p.brandId), variantMap.get(p.id) ?? [], p.categoryId ? categoryMap.get(p.categoryId) ?? null : null),
      referenceImageUrls: photoMap.get(p.id) ?? [],
    })),
    total,
  };
}

export async function getProduct(id: string): Promise<Product | null> {
  const db = getDb();
  const [productRow] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!productRow) return null;

  const [brandRow, categoryRow, variantRows, uomMap] = await Promise.all([
    db.select().from(brands).where(eq(brands.id, productRow.brandId)).limit(1).then((r) => r[0]),
    productRow.categoryId
      ? db.select().from(categories).where(eq(categories.id, productRow.categoryId)).limit(1).then((r) => r[0])
      : Promise.resolve(undefined),
    db.select().from(productVariants).where(eq(productVariants.productId, id)).orderBy(productVariants.name),
    fetchUomMap(db),
  ]);

  const mappedVariants = variantRows.map((v) =>
mapVariant(v, uomMap)
  );

  return mapProduct(
    productRow,
    brandRow ? mapBrand(brandRow) : undefined,
    mappedVariants,
    categoryRow ? mapCategory(categoryRow) : null
  );
}

export async function createProduct(data: {
  brandId: string;
  categoryId?: string | null;
  name: string;
  description?: string | null;
  fungsi?: string | null;
  usp?: string | null;
  kataKunci?: string | null;
  kelengkapan?: string | null;
  bahan?: string | null;
  ketebalan?: string | null;
  imageUrl?: string | null;
  tier?: string | null;
  relatedProductIds?: string[] | null;
  upsellProductId?: string | null;
}): Promise<Product> {
  const db = getDb();
  const [row] = await db
    .insert(products)
    .values({
      brandId: data.brandId,
      categoryId: data.categoryId ?? null,
      name: data.name,
      description: data.description ?? null,
      fungsi: data.fungsi ?? null,
      usp: data.usp ?? null,
      kataKunci: data.kataKunci ?? null,
      kelengkapan: data.kelengkapan ?? null,
      bahan: data.bahan ?? null,
      ketebalan: data.ketebalan ?? null,
      imageUrl: data.imageUrl ?? null,
      tier: data.tier ?? null,
      relatedProductIds: data.relatedProductIds ?? null,
      upsellProductId: data.upsellProductId ?? null,
    })
    .returning();
  if (!row) throw new Error('Failed to create product');
  return mapProduct(row);
}

export async function updateProduct(
  id: string,
  data: Partial<{
    brandId: string;
    categoryId: string | null;
    name: string;
    description: string | null;
    fungsi: string | null;
    usp: string | null;
    kataKunci: string | null;
    kelengkapan: string | null;
    bahan: string | null;
    ketebalan: string | null;
    imageUrl: string | null;
    tier: string | null;
    relatedProductIds: string[] | null;
    upsellProductId: string | null;
  }>
): Promise<Product | null> {
  const db = getDb();
  const setData: Partial<typeof products.$inferInsert> & { updatedAt: Date } = {
    ...data,
    updatedAt: new Date(),
  };
  const [row] = await db
    .update(products)
    .set(setData)
    .where(eq(products.id, id))
    .returning();
  return row ? mapProduct(row) : null;
}

export async function deleteProduct(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(products).where(eq(products.id, id)).returning({ id: products.id });
  return result.length > 0;
}

// ─── Variants ──────────────────────────────────────────────────────────────

export async function createVariant(
  productId: string,
  data: {
    name: string;
    sku?: string | null;
    priceIdr?: number | null;
    mpPriceIdr?: number | null;
    isiCtn?: number | null;
    isiBox?: number | null;
    uomPriceId?: string | null;
    mpUomId?: string | null;
    uomCtnId?: string | null;
    uomBoxId?: string | null;
    minOrderQty?: number | null;
    minOrderUomId?: string | null;
    imageUrl?: string | null;
    stockStatus?: StockStatus;
    isActive?: boolean;
    description?: string | null;
    sourceUrl?: string | null;
  }
): Promise<ProductVariant> {
  const db = getDb();
  const [row] = await db
    .insert(productVariants)
    .values({
      productId,
      name: data.name,
      sku: data.sku ?? null,
      priceIdr: data.priceIdr != null ? String(data.priceIdr) : null,
      mpPriceIdr: data.mpPriceIdr != null ? String(data.mpPriceIdr) : null,
      isiCtn: data.isiCtn ?? null,
      isiBox: data.isiBox ?? null,
      uomPriceId: data.uomPriceId ?? null,
      mpUomId: data.mpUomId ?? null,
      uomCtnId: data.uomCtnId ?? null,
      uomBoxId: data.uomBoxId ?? null,
      minOrderQty: data.minOrderQty ?? null,
      minOrderUomId: data.minOrderUomId ?? null,
      imageUrl: data.imageUrl ?? null,
      stockStatus: data.stockStatus ?? 'normal',
      isActive: data.isActive ?? true,
      description: data.description ?? null,
      sourceUrl: data.sourceUrl ?? null,
    })
    .returning();
  if (!row) throw new Error('Failed to create variant');
  return mapVariant(row);
}

export async function updateVariant(
  id: string,
  data: Partial<{
    name: string;
    sku: string | null;
    priceIdr: number | null;
    mpPriceIdr: number | null;
    isiCtn: number | null;
    isiBox: number | null;
    uomPriceId: string | null;
    mpUomId: string | null;
    uomCtnId: string | null;
    uomBoxId: string | null;
    minOrderQty: number | null;
    minOrderUomId: string | null;
    imageUrl: string | null;
    stockStatus: StockStatus;
    isActive: boolean;
    description: string | null;
    sourceUrl: string | null;
  }>
): Promise<ProductVariant | null> {
  const db = getDb();
  const { priceIdr, mpPriceIdr, ...rest } = data;
  const setData: Partial<typeof productVariants.$inferInsert> & { updatedAt: Date } = {
    ...rest,
    updatedAt: new Date(),
  };
  // Both are numeric columns, so drizzle wants strings. 'in data' rather than a null check:
  // an explicit null must clear the column, an absent key must leave it alone.
  if ('priceIdr' in data) {
    setData.priceIdr = priceIdr != null ? String(priceIdr) : null;
  }
  if ('mpPriceIdr' in data) {
    setData.mpPriceIdr = mpPriceIdr != null ? String(mpPriceIdr) : null;
  }
  const [row] = await db
    .update(productVariants)
    .set(setData)
    .where(eq(productVariants.id, id))
    .returning();
  return row ? mapVariant(row) : null;
}

export async function deleteVariant(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(productVariants)
    .where(eq(productVariants.id, id))
    .returning({ id: productVariants.id });
  return result.length > 0;
}

// ─── RAG search ────────────────────────────────────────────────────────────

export async function searchActiveProducts(params: {
  keywords: string[];
  brandFilter?: string;
  limit?: number;
  // Only products the photo comparison can use: a product photo or an active variant's.
  // Applied inside the ranking, not after it - filtering a top-N afterwards leaves almost nothing
  // when most products have no photo yet (compared 1 of 69 photographed products, 2026-10-09).
  withPhoto?: boolean;
}): Promise<Product[]> {
  const db = getDb();
  const { keywords, brandFilter, limit = 8, withPhoto = false } = params;

  let productRows: (typeof products.$inferSelect)[];

  const brandClause = brandFilter
    ? sql`EXISTS (SELECT 1 FROM brands b WHERE b.id = ${products.brandId} AND b.name ILIKE ${`%${brandFilter}%`})`
    : undefined;

  // Per-keyword relevance score. First-match-wins CASE so one keyword never
  // counts twice; name and kata_kunci outweigh prose fields because they carry
  // the product's vocabulary, while fungsi/description merely mention contexts
  // (e.g. "pagar rumah") that would otherwise flood generic-word queries.
  const kwScore = (k: string) => sql`(CASE
    WHEN ${products.name} ILIKE ${'%' + k + '%'} THEN 3
    WHEN ${products.kataKunci} ILIKE ${'%' + k + '%'} THEN 2
    WHEN (
      ${products.description} ILIKE ${'%' + k + '%'}
      OR ${products.fungsi} ILIKE ${'%' + k + '%'}
      OR ${products.bahan} ILIKE ${'%' + k + '%'}
      OR ${products.kelengkapan} ILIKE ${'%' + k + '%'}
      OR EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = ${products.id} AND pv.is_active = true AND (pv.name ILIKE ${'%' + k + '%'} OR pv.description ILIKE ${'%' + k + '%'}))
      OR EXISTS (SELECT 1 FROM categories c WHERE c.id = ${products.categoryId} AND (c.name ILIKE ${'%' + k + '%'} OR c.description ILIKE ${'%' + k + '%'}))
    ) THEN 1
    ELSE 0 END)`;

  if (keywords.length > 0) {
    // Single scored query: products matching more (and better-placed) keywords
    // rank first. Off-catalog words (e.g. "apartemen") contribute 0 instead of
    // either failing an AND pass or flooding an OR pass.
    const scoreExpr = keywords.map(kwScore).reduce((acc, c) => sql`${acc} + ${c}`);
    const photoClause = withPhoto
      ? sql` AND (${products.imageUrl} IS NOT NULL OR EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = ${products.id} AND pv.is_active = true AND pv.image_url IS NOT NULL))`
      : sql``;
    const where = brandClause
      ? sql`${brandClause} AND (${scoreExpr}) > 0${photoClause}`
      : sql`(${scoreExpr}) > 0${photoClause}`;
    // Color/type variants are modeled as separate products sharing identical
    // `fungsi` text (one print or colour per product), so without a per-family cap
    // one family fills the whole window and crowds out functional alternatives
    // (e.g. a paper bag for a takeaway query). Cap identical-fungsi groups; NULL
    // fungsi products each count as their own family.
    // ponytail: fungsi-equality as family key; a real family/category column if the catalog ever gets one
    // Not for photo matching: there the same-family products are exactly the look-alikes to compare.
    const FAMILY_CAP = withPhoto ? limit : 8;
    const rankedIds = await db.execute<{ id: string }>(sql`
      SELECT id FROM (
        SELECT ${products.id} AS id, ${products.name} AS name, (${scoreExpr}) AS score,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(${products.fungsi}, ${products.id}::text)
                 ORDER BY (${scoreExpr}) DESC, ${products.name}
               ) AS family_rank
        FROM ${products}
        WHERE ${where}
      ) ranked
      WHERE family_rank <= ${FAMILY_CAP}
      ORDER BY score DESC, name
      LIMIT ${limit}
    `);
    const orderedIds = (rankedIds.rows ?? []).map((r) => r.id);
    if (orderedIds.length > 0) {
      const rows = await db.select().from(products).where(inArray(products.id, orderedIds));
      const byId = new Map(rows.map((r) => [r.id, r]));
      productRows = orderedIds
        .map((id) => byId.get(id))
        .filter((r): r is typeof products.$inferSelect => r !== undefined);
    } else {
      productRows = [];
    }

    // Brand fallback: keywords matched nothing but a brand was named
    // (e.g. "ada produk vintage yang bagus?") — show the brand's products.
    if (productRows.length === 0 && brandClause) {
      productRows = await db
        .select()
        .from(products)
        .where(brandClause)
        .orderBy(products.name)
        .limit(limit);
    }
  } else if (brandFilter) {
    // Brand-only fallback (e.g. "ada produk Vintage?")
    productRows = await db
      .select()
      .from(products)
      .where(brandClause)
      .orderBy(products.name)
      .limit(limit);
  } else {
    // No keywords and no brand filter (e.g. a greeting like "Hi" reduces to
    // zero keywords) — surface as "no results", not an unfiltered alphabetical
    // dump of the whole catalog.
    productRows = [];
  }

  if (productRows.length === 0) return [];

  const productIds = productRows.map((p) => p.id);
  const brandIds = [...new Set(productRows.map((p) => p.brandId))];
  const catIds = [...new Set(productRows.map((p) => p.categoryId).filter((id): id is string => id !== null))];

  const [brandRows, categoryRows, variantRows, uomMap] = await Promise.all([
    db.select().from(brands).where(inArray(brands.id, brandIds)),
    catIds.length > 0 ? db.select().from(categories).where(inArray(categories.id, catIds)) : Promise.resolve([]),
    db
      .select()
      .from(productVariants)
      .where(
        and(
          inArray(productVariants.productId, productIds),
          eq(productVariants.isActive, true)
          // Include no_stock variants — AI will inform customer it exists but stock is unavailable
        )
      )
      .orderBy(productVariants.name),
    fetchUomMap(db),
  ]);

  const brandMap = new Map(brandRows.map((b) => [b.id, mapBrand(b)]));
  const categoryMap = new Map(categoryRows.map((c) => [c.id, mapCategory(c)]));
  const variantMap = new Map<string, ProductVariant[]>();
  for (const v of variantRows) {
    const arr = variantMap.get(v.productId) ?? [];
    arr.push(
mapVariant(v, uomMap)
    );
    variantMap.set(v.productId, arr);
  }

  // Keep all matched products — even those with no active variants, so the AI
  // can tell the customer the product exists but is currently unavailable,
  // rather than incorrectly saying it doesn't exist.
  return productRows
    .map((p) => mapProduct(p, brandMap.get(p.brandId), variantMap.get(p.id) ?? [], p.categoryId ? categoryMap.get(p.categoryId) ?? null : null));
}

// ─── Hybrid (vector + ILIKE) search ─────────────────────────────────────────

/**
 * Fetch products ordered by cosine similarity to the given embedding vector.
 * Falls back to empty array if no embeddings exist yet (pre-seeding).
 */
async function vectorSearchProducts(
  embedding: number[],
  limit = 20
): Promise<(typeof products.$inferSelect)[]> {
  const db = getDb();
  const vecLiteral = `[${embedding.join(',')}]`;

  // Raw SQL — drizzle doesn't have native pgvector operators yet
  const rows = await db.execute<typeof products.$inferSelect & { similarity: number }>(
    sql`
      SELECT p.*, 1 - (p.embedding <=> ${vecLiteral}::vector) AS similarity
      FROM products p
      WHERE p.embedding IS NOT NULL
      ORDER BY p.embedding <=> ${vecLiteral}::vector
      LIMIT ${limit}
    `
  );

  return (rows.rows ?? []) as unknown as (typeof products.$inferSelect)[];
}

/**
 * Merge ILIKE candidates (exact/keyword) with vector candidates (semantic),
 * dedup by product id, preserve ILIKE results first (higher precision),
 * fill remaining slots with vector results.
 */
export async function hybridSearchProducts(params: {
  keywords: string[];
  brandFilter?: string;
  queryEmbedding?: number[];
  limit?: number;
}): Promise<Product[]> {
  const { keywords, brandFilter, queryEmbedding, limit = 15 } = params;

  // Run ILIKE search and vector search in parallel
  const [ilikeResults, vectorResults] = await Promise.all([
    searchActiveProducts({ keywords, brandFilter, limit }),
    queryEmbedding
      ? vectorSearchProducts(queryEmbedding, limit)
      : Promise.resolve([]),
  ]);

  // Skip the vector merge entirely on a genuine zero-match: vector search's
  // unfiltered nearest-neighbor fallback would otherwise dump unrelated
  // "closest" products for off-catalog input (e.g. a greeting), reproducing
  // the same symptom the ILIKE zero-match fix above targets.
  if (ilikeResults.length === 0) {
    return [];
  }

  // If no vector results (embeddings not seeded yet), return ILIKE only
  if (vectorResults.length === 0) {
    return ilikeResults;
  }

  // Merge: ILIKE first (exact matches win), then fill with vector results
  const seen = new Set(ilikeResults.map((p) => p.id));
  const mergedIds: string[] = ilikeResults.map((p) => p.id);

  for (const vp of vectorResults) {
    if (!seen.has(vp.id)) {
      seen.add(vp.id);
      mergedIds.push(vp.id);
    }
    if (mergedIds.length >= limit) break;
  }

  if (mergedIds.length === 0) return [];

  // Fetch full Product objects for merged ids (with variants + brands + categories)
  const db = getDb();
  const [brandRows, productRows, variantRows, uomMap] = await Promise.all([
    db.select().from(brands),
    db.select().from(products).where(inArray(products.id, mergedIds)),
    db.select().from(productVariants)
      .where(and(inArray(productVariants.productId, mergedIds), eq(productVariants.isActive, true)))
      .orderBy(productVariants.name),
    fetchUomMap(db),
  ]);

  const catIds = [...new Set(productRows.map((p) => p.categoryId).filter((id): id is string => id !== null))];
  const categoryRows = catIds.length > 0
    ? await db.select().from(categories).where(inArray(categories.id, catIds))
    : [];

  const brandMap = new Map(brandRows.map((b) => [b.id, mapBrand(b)]));
  const categoryMap = new Map(categoryRows.map((c) => [c.id, mapCategory(c)]));
  const variantMap = new Map<string, ProductVariant[]>();
  for (const v of variantRows) {
    const arr = variantMap.get(v.productId) ?? [];
    arr.push(mapVariant(v, uomMap));
    variantMap.set(v.productId, arr);
  }

  // Return in merged order (ILIKE first, then vector additions)
  const productById = new Map(productRows.map((p) => [p.id, p]));
  return mergedIds
    .map((id) => productById.get(id))
    .filter((p): p is typeof products.$inferSelect => p !== undefined)
    .map((p) => mapProduct(p, brandMap.get(p.brandId), variantMap.get(p.id) ?? [], p.categoryId ? categoryMap.get(p.categoryId) ?? null : null));
}
