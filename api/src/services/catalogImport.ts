/**
 * Excel -> catalog, the other half of catalogExport.ts.
 *
 * Reads back the exact workbook that `GET /api/v1/catalog/export` emits, so the team can edit
 * prices and product knowledge in Excel and upload the result. Identity is by NAME, never UUID,
 * because that is what the export writes - see the contract note at the top of catalogExport.ts.
 *
 * ONE SHEET PER BRAND. Every sheet that is not `Merek` / `Kategori` / `UOM` is a brand sheet and
 * its NAME is the brand, so there is no `merek` column to disagree with it. A sheet named after
 * a brand that does not exist yet creates it - that is how a new brand is added through Excel.
 *
 * Four rules decide everything here:
 *
 *  - UPDATE IN PLACE, never wipe. scripts/seed-catalog.ts regenerates every UUID, which would
 *    orphan products.upsell_product_id (a real FK), silently empty related_product_ids (jsonb,
 *    no FK, so the loss is invisible) and null every products.embedding. Upserting by name costs
 *    nothing: products.name is unique, uq_variant_name_per_product covers (product, variant).
 *
 *  - A ROW THAT IS NOT IN THE FILE IS NOT TOUCHED. The export is always the whole catalog, but a
 *    human who filtered the sheet before saving must not thereby delete the rest of the catalog.
 *    Reported as `untouched` rather than silently ignored.
 *
 *  - COLUMN ABSENT means "leave the DB value alone"; CELL BLANK means "clear it". Without the
 *    second half there is no way to remove a description through the sheet, which breaks the
 *    whole export -> edit -> import loop. In the types below that is `undefined` vs `null`.
 */

import readXlsxFile from 'read-excel-file/node';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { brands, categories, products, productVariants, uomTable } from '../db/schema.js';
import { LOOKUP_SHEETS, PRODUCT_HEADERS, sheetNameForBrand } from './catalogExport.js';
import { InvalidXlsxError, normalizeHeader } from './leadImport.js';
import { refreshEmbeddingsSequential } from './embeddings.js';
import type { ProductTier, StockStatus } from '../domain/types.js';

export { InvalidXlsxError };

type Col = (typeof PRODUCT_HEADERS)[number];
/** `undefined` = column absent, leave the DB value alone. `null` = cell blank, clear it. */
type Cell<T> = T | null | undefined;

const MAX_ROWS = 20_000;
const MAX_ERRORS = 50;
const TIERS: ProductTier[] = ['economic', 'mid', 'premium'];
const STOCK: StockStatus[] = ['normal', 'no_stock', 'price_rise', 'price_drop'];

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

interface ParsedVariant {
  row: number;
  name: string;
  sku: Cell<string>;
  priceIdr: Cell<number>;
  uomPrice: Cell<string>;
  mpPriceIdr: Cell<number>;
  mpUom: Cell<string>;
  isiCtn: Cell<number>;
  uomCtn: Cell<string>;
  isiBox: Cell<number>;
  uomBox: Cell<string>;
  minOrderQty: Cell<number>;
  uomMinOrder: Cell<string>;
  stockStatus: StockStatus | undefined;
  isActive: boolean | undefined;
  description: Cell<string>;
  imageUrl: Cell<string>;
}

interface ParsedProduct {
  row: number;
  name: string;
  brand: string;
  category: Cell<string>;
  description: Cell<string>;
  fungsi: Cell<string>;
  usp: Cell<string>;
  kataKunci: Cell<string>;
  kelengkapan: Cell<string>;
  bahan: Cell<string>;
  ketebalan: Cell<string>;
  imageUrl: Cell<string>;
  tier: Cell<ProductTier>;
  upsell: Cell<string>;
  related: Cell<string[]>;
  variants: ParsedVariant[];
}

interface Lookup {
  name: string;
  description: Cell<string>;
  brandType?: Cell<string>;
  catalogFileUrl?: Cell<string>;
}

export interface ParsedCatalog {
  brands: Lookup[];
  categories: Lookup[];
  uoms: Lookup[];
  products: ParsedProduct[];
  errors: { row: number; reason: string }[];
  /** Structural failure: nothing may be written, not even the rows that parsed. */
  fatal: boolean;
}

export interface SheetLike {
  sheet: string;
  data: unknown[][];
}

// ─── Cell coercion ─────────────────────────────────────────────────────────

/** Deliberately NOT leadImport's cleanText: that caps at 500 chars and maps "-" to null, both of
 *  which would quietly corrupt a product description. */
function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = v instanceof Date ? v.toISOString() : String(v).trim();
  return s === '' ? null : s;
}

const BAD_NUMBER = Symbol('bad-number');

/**
 * A number cell round-trips as a real number. A cell someone retyped by hand may carry
 * Indonesian thousands separators - "116.000" is a hundred and sixteen thousand, and Number()
 * reads it as 116. Guessing wrong here silently changes a price by 1000x, so an unparseable
 * cell becomes a row error instead of a null.
 */
function num(v: unknown): number | null | typeof BAD_NUMBER {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : BAD_NUMBER;
  let s = String(v).trim().replace(/^Rp\s*/i, '').replace(/\s/g, '');
  if (s === '') return null;
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : BAD_NUMBER;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  const s = text(v)?.toLowerCase();
  if (!s) return undefined;
  if (['ya', 'yes', 'true', '1', 'aktif'].includes(s)) return true;
  if (['tidak', 'no', 'false', '0', 'nonaktif'].includes(s)) return false;
  return undefined;
}

/** Strips the `undefined`s so a drizzle .set() never clears a column whose header was absent. */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ─── Header resolution ─────────────────────────────────────────────────────

/**
 * Column indices resolved from PRODUCT_HEADERS itself, so reordering the export cannot desync
 * the import, and a column the team appends is ignored rather than shifting everything after it.
 */
function mapProductColumns(header: unknown[]): Partial<Record<Col, number>> {
  const normalized = header.map(normalizeHeader);
  const cols: Partial<Record<Col, number>> = {};
  for (const name of PRODUCT_HEADERS) {
    const i = normalized.indexOf(normalizeHeader(name));
    if (i !== -1) cols[name] = i;
  }
  // The team's workbooks accumulate price columns left to right, newest on the right - that is
  // why their sheets keep growing. So the RIGHT-most harga* column wins, not the first match.
  // "uom_harga" normalizes to "uomharga" and is deliberately not caught by the prefix.
  const lastHarga = normalized.reduce<number>((last, h, i) => (h.startsWith('harga') ? i : last), -1);
  if (lastHarga !== -1) cols.harga_idr = lastHarga;
  return cols;
}

function lookupSheet(sheets: SheetLike[], name: string): unknown[][] | null {
  const found = sheets.find((s) => s.sheet.trim().toLowerCase() === name.toLowerCase());
  return found ? found.data : null;
}

function parseLookup(rows: unknown[][] | null, extra: boolean): Lookup[] {
  if (!rows || rows.length < 2) return [];
  const header = rows[0]!.map(normalizeHeader);
  const at = (r: unknown[], key: string) => {
    const i = header.indexOf(key);
    return i === -1 ? undefined : text(r[i]);
  };
  const out: Lookup[] = [];
  for (const r of rows.slice(1)) {
    const name = at(r, 'nama');
    if (!name) continue;
    out.push({
      name,
      description: at(r, 'deskripsi'),
      ...(extra ? { brandType: at(r, 'tipe'), catalogFileUrl: at(r, 'catalogfileurl') } : {}),
    });
  }
  return out;
}

// ─── Parsing ───────────────────────────────────────────────────────────────

/** Pure. Accepts read-excel-file's output shape, and in tests buildCatalogSheets' output. */
export function parseCatalogWorkbook(sheets: SheetLike[]): ParsedCatalog {
  const result: ParsedCatalog = {
    brands: parseLookup(lookupSheet(sheets, 'Merek'), true),
    categories: parseLookup(lookupSheet(sheets, 'Kategori'), false),
    uoms: parseLookup(lookupSheet(sheets, 'UOM'), false),
    products: [],
    errors: [],
    fatal: false,
  };
  const fail = (row: number, reason: string): ParsedCatalog => {
    result.errors.push({ row, reason });
    result.fatal = true;
    return result;
  };

  const reserved = new Set<string>(LOOKUP_SHEETS.map((n) => n.toLowerCase()));
  // The brand sheet's name maps back to the exact brand name it was made from, so a name Excel
  // forced us to sanitise still resolves instead of creating a near-duplicate brand.
  const brandBySheet = new Map<string, string>(
    result.brands.map((b) => [sheetNameForBrand(b.name).toLowerCase(), b.name])
  );
  const brandSheets = sheets.filter((sh) => !reserved.has(sh.sheet.trim().toLowerCase()));
  if (brandSheets.length === 0) {
    return fail(0, 'Tidak ada sheet merek di file ini - satu sheet per merek, di luar Merek/Kategori/UOM.');
  }

  const addError = (row: number, reason: string) => {
    if (result.errors.length < MAX_ERRORS) result.errors.push({ row, reason });
  };

  const byName = new Map<string, ParsedProduct>();

  for (const sh of brandSheets) {
    const rows = sh.data;
    if (!rows || rows.length === 0) continue;
    const sheetLabel = sh.sheet.trim();
    const brandName = brandBySheet.get(sheetLabel.toLowerCase()) ?? sheetLabel;

    const header = rows[0]!;
    const cols = mapProductColumns(header);
    if (cols.produk === undefined) {
      addError(1, `Sheet "${sheetLabel}": kolom "produk" tidak ditemukan di baris header.`);
      continue;
    }
    const str = (r: unknown[], c: Col): Cell<string> =>
      cols[c] === undefined ? undefined : text(r[cols[c]!]);

    // Errors name their sheet: "baris 12" is ambiguous across seven brand tabs.
    const err = (row: number, reason: string) => addError(row, `[${sheetLabel}] ${reason}`);

    for (let i = 1; i < rows.length && byName.size < MAX_ROWS; i++) {
      const r = rows[i]!;
      const sheetRow = i + 1; // 1-based, matching what the uploader sees in Excel

      const name = str(r, 'produk');
      if (!name) continue; // a blank spacer row, not an error

      let product = byName.get(name.toLowerCase());
      if (!product) {
        const tierRaw = str(r, 'tier');
        if (tierRaw !== null && tierRaw !== undefined && !TIERS.includes(tierRaw as ProductTier)) {
          err(sheetRow, `Tier tidak valid: "${tierRaw}" (pakai economic/mid/premium).`);
          continue;
        }
        const relatedRaw = str(r, 'produk_terkait');
        product = {
          row: sheetRow,
          name,
          brand: brandName,
          category: str(r, 'kategori'),
          description: str(r, 'deskripsi_produk'),
          fungsi: str(r, 'fungsi'),
          usp: str(r, 'usp'),
          kataKunci: str(r, 'kata_kunci'),
          kelengkapan: str(r, 'kelengkapan'),
          bahan: str(r, 'bahan'),
          ketebalan: str(r, 'ketebalan'),
          imageUrl: str(r, 'gambar_produk'),
          tier: (tierRaw ?? null) as Cell<ProductTier>,
          upsell: str(r, 'upsell_produk'),
          related:
            relatedRaw === undefined
              ? undefined
              : relatedRaw === null
                ? null
                : relatedRaw.split('|').map((s) => s.trim()).filter(Boolean),
          variants: [],
        };
        byName.set(name.toLowerCase(), product);
      }

      const variantName = str(r, 'varian');
      if (!variantName) continue; // the export's 14-null pad row: a product with no variants

      const nums: Partial<Record<'harga_idr' | 'mp_idr' | 'isi_ctn' | 'isi_box' | 'min_order_qty', number | null>> = {};
      let numberFailed = false;
      for (const key of ['harga_idr', 'mp_idr', 'isi_ctn', 'isi_box', 'min_order_qty'] as const) {
        if (cols[key] === undefined) continue;
        const parsed = num(r[cols[key]!]);
        if (parsed === BAD_NUMBER) {
          err(sheetRow, `Angka pada kolom "${key}" tidak terbaca: "${String(r[cols[key]!])}".`);
          numberFailed = true;
          break;
        }
        nums[key] = parsed;
      }
      if (numberFailed) continue;

      const stockRaw = str(r, 'status_stok');
      const stock = stockRaw && STOCK.includes(stockRaw as StockStatus) ? (stockRaw as StockStatus) : undefined;
      if (stockRaw && !stock) {
        err(sheetRow, `Status stok tidak dikenal: "${stockRaw}".`);
        continue;
      }

      const int = (v: number | null | undefined): Cell<number> =>
        v === undefined ? undefined : v === null ? null : Math.round(v);

      product.variants.push({
        row: sheetRow,
        name: variantName,
        sku: str(r, 'sku'),
        priceIdr: nums.harga_idr,
        uomPrice: str(r, 'uom_harga'),
        mpPriceIdr: nums.mp_idr,
        mpUom: str(r, 'uom_mp'),
        isiCtn: int(nums.isi_ctn),
        uomCtn: str(r, 'uom_ctn'),
        isiBox: int(nums.isi_box),
        uomBox: str(r, 'uom_box'),
        minOrderQty: int(nums.min_order_qty),
        uomMinOrder: str(r, 'uom_min_order'),
        stockStatus: stock,
        // NOT NULL DEFAULT columns: a blank cell means "no change", never "false".
        isActive: cols.aktif === undefined ? undefined : bool(r[cols.aktif]),
        description: str(r, 'deskripsi_varian'),
        imageUrl: str(r, 'gambar_varian'),
      });
    }
  }

  if (byName.size >= MAX_ROWS) {
    addError(0, `File melebihi batas ${MAX_ROWS} produk - sisanya dilewati.`);
  }

  result.products = [...byName.values()];
  return result;
}

// ─── Apply ─────────────────────────────────────────────────────────────────

export async function importCatalogFromXlsx(buffer: Buffer): Promise<CatalogImportResult> {
  // Returns every sheet as { sheet, data } - the same shape buildCatalogSheets produces, which
  // is what lets the round-trip test skip the xlsx layer entirely.
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    sheets = await readXlsxFile(buffer);
  } catch (err) {
    throw new InvalidXlsxError(err);
  }

  const parsed = parseCatalogWorkbook(sheets as SheetLike[]);
  const result: CatalogImportResult = {
    productsCreated: 0,
    productsUpdated: 0,
    variantsCreated: 0,
    variantsUpdated: 0,
    lookupsCreated: 0,
    skipped: 0,
    untouched: 0,
    errors: parsed.errors,
  };
  if (parsed.fatal) return result;

  const db = getDb();
  const changed = new Set<string>();

  await db.transaction(async (tx) => {
    const [brandRows, categoryRows, uomRows, productRows, variantRows] = await Promise.all([
      tx.select({ id: brands.id, name: brands.name }).from(brands),
      tx.select({ id: categories.id, name: categories.name }).from(categories),
      tx.select({ id: uomTable.id, name: uomTable.name }).from(uomTable),
      tx.select({ id: products.id, name: products.name }).from(products),
      tx
        .select({ id: productVariants.id, productId: productVariants.productId, name: productVariants.name })
        .from(productVariants),
    ]);

    const brandMap = new Map(brandRows.map((b) => [b.name.toLowerCase(), b.id]));
    const categoryMap = new Map(categoryRows.map((c) => [c.name.toLowerCase(), c.id]));
    const uomMap = new Map(uomRows.map((u) => [u.name.toLowerCase(), u.id]));
    const productMap = new Map(productRows.map((p) => [p.name.toLowerCase(), p.id]));
    const variantMap = new Map(variantRows.map((v) => [`${v.productId}::${v.name.toLowerCase()}`, v.id]));

    // 1-3. Lookup tables. Any name the Produk sheet references but the lookup sheets omit is
    // created rather than failing the import - they are lookup rows, not decisions.
    for (const u of parsed.uoms) {
      const id = uomMap.get(u.name.toLowerCase());
      if (id) await tx.update(uomTable).set(defined({ description: u.description })).where(eq(uomTable.id, id));
      else {
        const [row] = await tx.insert(uomTable).values({ name: u.name, description: u.description ?? null }).returning();
        uomMap.set(u.name.toLowerCase(), row!.id);
        result.lookupsCreated++;
      }
    }
    const uomId = async (name: Cell<string>): Promise<string | null | undefined> => {
      if (name === undefined) return undefined;
      if (name === null) return null;
      const hit = uomMap.get(name.toLowerCase());
      if (hit) return hit;
      const [row] = await tx.insert(uomTable).values({ name }).returning();
      uomMap.set(name.toLowerCase(), row!.id);
      result.lookupsCreated++;
      return row!.id;
    };

    for (const c of parsed.categories) {
      const id = categoryMap.get(c.name.toLowerCase());
      if (id) await tx.update(categories).set(defined({ description: c.description })).where(eq(categories.id, id));
      else {
        const [row] = await tx.insert(categories).values({ name: c.name, description: c.description ?? null }).returning();
        categoryMap.set(c.name.toLowerCase(), row!.id);
        result.lookupsCreated++;
      }
    }

    // Writing brands here is also what closes the Merek.tipe / catalog_file_url round-trip gap:
    // neither is accepted by the HTTP brand schemas, but both are exported.
    for (const b of parsed.brands) {
      const patch = defined({
        description: b.description,
        brandType: b.brandType ?? undefined,
        catalogFileUrl: b.catalogFileUrl,
      });
      const id = brandMap.get(b.name.toLowerCase());
      if (id) await tx.update(brands).set(patch).where(eq(brands.id, id));
      else {
        const [row] = await tx.insert(brands).values({ name: b.name, ...patch }).returning();
        brandMap.set(b.name.toLowerCase(), row!.id);
        result.lookupsCreated++;
      }
    }

    // 4. Products and variants.
    for (const p of parsed.products) {
      let brandId = brandMap.get(p.brand.toLowerCase());
      if (!brandId) {
        const [row] = await tx.insert(brands).values({ name: p.brand }).returning();
        brandId = row!.id;
        brandMap.set(p.brand.toLowerCase(), brandId);
        result.lookupsCreated++;
      }

      let categoryId: string | null | undefined;
      if (p.category === null) categoryId = null;
      else if (p.category !== undefined) {
        categoryId = categoryMap.get(p.category.toLowerCase());
        if (!categoryId) {
          const [row] = await tx.insert(categories).values({ name: p.category }).returning();
          categoryId = row!.id;
          categoryMap.set(p.category.toLowerCase(), categoryId);
          result.lookupsCreated++;
        }
      }

      const fields = defined({
        brandId,
        categoryId,
        description: p.description,
        fungsi: p.fungsi,
        usp: p.usp,
        kataKunci: p.kataKunci,
        kelengkapan: p.kelengkapan,
        bahan: p.bahan,
        ketebalan: p.ketebalan,
        imageUrl: p.imageUrl,
        tier: p.tier,
      });

      let productId = productMap.get(p.name.toLowerCase());
      if (productId) {
        await tx.update(products).set({ ...fields, updatedAt: new Date() }).where(eq(products.id, productId));
        result.productsUpdated++;
      } else {
        const [row] = await tx.insert(products).values({ name: p.name, ...fields, brandId }).returning();
        productId = row!.id;
        productMap.set(p.name.toLowerCase(), productId);
        result.productsCreated++;
      }
      changed.add(productId);

      for (const v of p.variants) {
        const vFields = defined({
          sku: v.sku,
          priceIdr: v.priceIdr === undefined ? undefined : v.priceIdr === null ? null : String(v.priceIdr),
          mpPriceIdr: v.mpPriceIdr === undefined ? undefined : v.mpPriceIdr === null ? null : String(v.mpPriceIdr),
          uomPriceId: await uomId(v.uomPrice),
          mpUomId: await uomId(v.mpUom),
          isiCtn: v.isiCtn,
          uomCtnId: await uomId(v.uomCtn),
          isiBox: v.isiBox,
          uomBoxId: await uomId(v.uomBox),
          minOrderQty: v.minOrderQty,
          minOrderUomId: await uomId(v.uomMinOrder),
          stockStatus: v.stockStatus,
          isActive: v.isActive,
          description: v.description,
          imageUrl: v.imageUrl,
        });

        const key = `${productId}::${v.name.toLowerCase()}`;
        const variantId = variantMap.get(key);
        if (variantId) {
          await tx.update(productVariants).set({ ...vFields, updatedAt: new Date() }).where(eq(productVariants.id, variantId));
          result.variantsUpdated++;
        } else {
          const [row] = await tx.insert(productVariants).values({ productId, name: v.name, ...vFields }).returning();
          variantMap.set(key, row!.id);
          result.variantsCreated++;
        }
      }
    }

    // 5. Cross-references, second pass: upsell_produk and produk_terkait name products that may
    // not have existed until the loop above finished.
    for (const p of parsed.products) {
      if (p.upsell === undefined && p.related === undefined) continue;
      const productId = productMap.get(p.name.toLowerCase())!;
      const resolve = (name: string): string | null => productMap.get(name.toLowerCase()) ?? null;

      const patch: Record<string, unknown> = {};
      if (p.upsell !== undefined) {
        if (p.upsell === null) patch.upsellProductId = null;
        else {
          const id = resolve(p.upsell);
          // A typo must not wipe a good link, so the existing value is left alone.
          if (id) patch.upsellProductId = id;
          else addTo(result.errors, p.row, `Produk upsell "${p.upsell}" tidak ditemukan - tautan lama dipertahankan.`);
        }
      }
      if (p.related !== undefined) {
        if (p.related === null) patch.relatedProductIds = null;
        else {
          const ids = p.related.map(resolve).filter((id): id is string => id !== null);
          const missing = p.related.filter((n) => !resolve(n));
          if (missing.length > 0) {
            addTo(result.errors, p.row, `Produk terkait tidak ditemukan: ${missing.join(', ')}.`);
          }
          patch.relatedProductIds = ids;
        }
      }
      if (Object.keys(patch).length > 0) {
        await tx.update(products).set(patch).where(eq(products.id, productId));
      }
    }

    result.untouched = productRows.length - result.productsUpdated;
  });

  // After commit. refreshEmbeddingAsync opens its own pg.Client per call, so firing it for every
  // touched product at once is a self-DoS - drained one at a time in the background instead.
  void refreshEmbeddingsSequential([...changed]);

  return result;
}

function addTo(errors: { row: number; reason: string }[], row: number, reason: string): void {
  if (errors.length < MAX_ERRORS) errors.push({ row, reason });
}
