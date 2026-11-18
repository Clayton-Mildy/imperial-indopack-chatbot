/**
 * Catalog -> Excel export.
 *
 * The workbook layout is a contract: catalogImport.ts reads this exact shape back. Three
 * consequences:
 *
 *  - ONE SHEET PER BRAND, named after the brand, like the vendor's own workbook - that is how
 *    the team works through a price list, a tab at a time. The brand is therefore the SHEET,
 *    not a column: moving a product between brands means moving its rows to another tab.
 *  - Every dashboard-editable field is present. That is why the columns do NOT mirror the
 *    vendor price list, which has no column for image_url, sku, tier, category, upsell or
 *    stock status.
 *  - Identity is by NAME, never UUID. The schema already guarantees it: products.name
 *    is UNIQUE, uq_variant_name_per_product makes (product, variant name) unique, and
 *    brands / categories / uom names are unique too. So a human can edit the sheet
 *    without stepping around id columns they must not touch.
 *
 * `harga_idr` holds the true rupiah value as a real number. The x1000 number-format
 * heuristic in scripts/ingest_catalog.py is for the vendor sheet only - never apply it here.
 */

import writeExcelFile from 'write-excel-file/node';
import type { Sheet } from 'write-excel-file/node';
import { listProducts, listBrands, listCategories, listUom } from '../repositories/products.js';
import type { Brand, Category, Product, Uom } from '../domain/types.js';

/** Exported: catalogImport resolves its column indices from this array, so the export IS the
 *  contract and the two can never drift. Order is free to change; names are not. */
export const PRODUCT_HEADERS = [
  'kategori',
  'produk',
  'deskripsi_produk',
  'fungsi',
  'usp',
  'kata_kunci',
  'kelengkapan',
  'bahan',
  'ketebalan',
  'tier',
  'gambar_produk',
  'upsell_produk',
  'produk_terkait',
  'varian',
  'sku',
  'harga_idr',
  'uom_harga',
  'mp_idr',
  'uom_mp',
  'isi_ctn',
  'uom_ctn',
  'isi_box',
  'uom_box',
  'min_order_qty',
  'uom_min_order',
  'status_stok',
  'aktif',
  'deskripsi_varian',
  'gambar_varian',
] as const;

/** Columns after the repeated product ones. Derived so the pad row below cannot drift out of
 *  step with PRODUCT_HEADERS the way a hardcoded count did. */
const PRODUCT_COLUMN_COUNT = 13;
const VARIANT_COLUMN_COUNT = PRODUCT_HEADERS.length - PRODUCT_COLUMN_COUNT;

const headerRow = (headers: readonly string[]) =>
  headers.map((value) => ({ value, fontWeight: 'bold' as const }));

/**
 * Pure: turns already-fetched rows into the four sheets. Kept separate from the DB
 * and the xlsx writer so the flattening logic is testable on its own.
 */
/**
 * Excel forbids : \ / ? * [ ] in a sheet name and caps it at 31 characters. Real brand names
 * are already safe; this exists so one that is not cannot make the whole workbook unopenable.
 */
export function sheetNameForBrand(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31).trim() || 'Tanpa Merek';
}

/** Reserved for the lookup tables, so the importer can tell them from brand sheets. */
export const LOOKUP_SHEETS = ['Merek', 'Kategori', 'UOM'] as const;

export function buildCatalogSheets(
  products: Product[],
  brands: Brand[],
  categories: Category[],
  uoms: Uom[]
): Sheet<Buffer>[] {
  const productNameById = new Map(products.map((p) => [p.id, p.name]));
  const nameOf = (id: string | null | undefined) => (id ? productNameById.get(id) ?? null : null);

  // A sheet for EVERY brand, including one with no products yet: an empty tab is where a human
  // adds the first row for that brand, and the import reads it straight back.
  const rowsByBrand = new Map<string, Sheet<Buffer>['data']>();
  const sheetOrder: { sheet: string; brand: string }[] = [];
  const usedNames = new Set<string>(LOOKUP_SHEETS);
  for (const b of brands) {
    let name = sheetNameForBrand(b.name);
    // Two brands can only collide here after truncation or character stripping, but an xlsx
    // with duplicate sheet names does not open at all.
    for (let n = 2; usedNames.has(name); n++) name = `${sheetNameForBrand(b.name).slice(0, 28)}~${n}`;
    usedNames.add(name);
    rowsByBrand.set(b.name, [headerRow(PRODUCT_HEADERS)]);
    sheetOrder.push({ sheet: name, brand: b.name });
  }

  const rowsFor = (brandName: string | null): Sheet<Buffer>['data'] => {
    const key = brandName ?? '';
    let rows = rowsByBrand.get(key);
    if (!rows) {
      // A product whose brand is missing from `brands` - only reachable if the two queries
      // disagree. Give it a tab rather than dropping the product silently.
      rows = [headerRow(PRODUCT_HEADERS)];
      rowsByBrand.set(key, rows);
      sheetOrder.push({ sheet: sheetNameForBrand(key || 'Tanpa Merek'), brand: key });
    }
    return rows;
  };

  for (const p of products) {
    const productRows = rowsFor(p.brand?.name ?? null);
    // Product columns repeat on every one of its variant rows.
    const productCells = [
      p.category?.name ?? null,
      p.name,
      p.description,
      p.fungsi,
      p.usp,
      p.kataKunci,
      p.kelengkapan,
      p.bahan,
      p.ketebalan,
      p.tier ?? null,
      p.imageUrl,
      nameOf(p.upsellProductId),
      (p.relatedProductIds ?? []).map(nameOf).filter(Boolean).join(' | ') || null,
    ];

    const variants = p.variants ?? [];
    if (variants.length === 0) {
      // A product with no variants still gets a row, or it would vanish on a round trip.
      productRows.push([...productCells, ...new Array(VARIANT_COLUMN_COUNT).fill(null)]);
      continue;
    }

    for (const v of variants) {
      productRows.push([
        ...productCells,
        v.name,
        v.sku,
        v.priceIdr == null ? null : { value: v.priceIdr, type: Number, format: '#,##0' },
        v.uomPrice?.name ?? null,
        v.mpPriceIdr == null ? null : { value: v.mpPriceIdr, type: Number, format: '#,##0' },
        v.mpUom?.name ?? null,
        v.isiCtn,
        v.uomCtn?.name ?? null,
        v.isiBox,
        v.uomBox?.name ?? null,
        v.minOrderQty,
        v.uomMinOrder?.name ?? null,
        v.stockStatus,
        v.isActive,
        v.description,
        v.imageUrl,
      ]);
    }
  }

  return [
    ...sheetOrder.map(({ sheet, brand }) => ({
      sheet,
      data: rowsByBrand.get(brand)!,
      stickyRowsCount: 1,
    })),
    {
      sheet: 'Merek',
      stickyRowsCount: 1,
      data: [
        headerRow(['nama', 'tipe', 'deskripsi', 'catalog_file_url']),
        ...brands.map((b) => [b.name, b.brandType, b.description, b.catalogFileUrl]),
      ],
    },
    {
      sheet: 'Kategori',
      stickyRowsCount: 1,
      data: [
        headerRow(['nama', 'deskripsi']),
        ...categories.map((c) => [c.name, c.description]),
      ],
    },
    {
      sheet: 'UOM',
      stickyRowsCount: 1,
      data: [headerRow(['nama', 'deskripsi']), ...uoms.map((u) => [u.name, u.description])],
    },
  ];
}

/**
 * The whole catalog, never a filtered slice: a partial file would be a loaded gun
 * once an import that "replaces the catalog" exists.
 *
 * listProducts orders by product name and variant name, so an unchanged catalog
 * exports the same rows in the same order every time.
 */
export async function buildCatalogWorkbook(): Promise<Buffer> {
  const [{ products }, brands, categories, uoms] = await Promise.all([
    listProducts({ limit: 0 }),
    listBrands(),
    listCategories(),
    listUom(),
  ]);
  return writeExcelFile(buildCatalogSheets(products, brands, categories, uoms)).toBuffer();
}
