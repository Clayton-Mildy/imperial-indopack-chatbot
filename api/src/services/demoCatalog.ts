/**
 * A clearly marked DEMO catalog, so pricing can be tried on WhatsApp before the client sends a real
 * price list. Every product name ends with " (CONTOH)"; go-live refuses to pass while any is active
 * (goLive.ts, catalog_demo). The rows go through the same import as client data.
 * Never real prices: the figures are obviously fake, round, and fall with quantity.
 */
import writeExcelFile from 'write-excel-file/node';
import { eq as sqlEq, like } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { products, productVariants, variantPriceTiers } from '../db/schema.js';
import { TEMPLATE_COLUMNS, TEMPLATE_SHEET } from './catalogTemplate.js';
import { importCatalogFromXlsx, type CatalogImportResult } from './catalogImport.js';
import { invalidateCatalogCache } from './ragQuery.js';
import { DEMO_SUFFIX } from './goLive.js';

const NOTE = 'DATA CONTOH — hapus sebelum go-live';

interface DemoProduct {
  brand: string;
  product: string;
  gramasi: string;
  sizes: string[];
  unit: 'rim' | 'pcs';
  tiers: [number, number][]; // [min qty, price per unit]
}

const DEMO_PRODUCTS: DemoProduct[] = [
  { brand: 'Kertas Supreme', product: `Kertas Nasi 64 gsm Cetak 1 Warna ${DEMO_SUFFIX}`, gramasi: '64 gsm', sizes: ['25x25', '30x30'], unit: 'rim', tiers: [[5, 123000], [10, 111000], [20, 99000]] },
  { brand: 'Kertas Supreme', product: `Kertas Burger 40 gsm Cetak 1 Warna ${DEMO_SUFFIX}`, gramasi: '40 gsm', sizes: ['30x30'], unit: 'rim', tiers: [[5, 123000], [10, 111000], [20, 99000]] },
  { brand: 'Imperial Indopack', product: `Box Makan Ivory 300 gsm ${DEMO_SUFFIX}`, gramasi: '300 gsm', sizes: ['20x20x7', '16x16x6'], unit: 'pcs', tiers: [[2500, 1234], [5000, 1111], [10000, 999]] },
  { brand: 'Imperial Indopack', product: `Box Kue Ivory 270 gsm ${DEMO_SUFFIX}`, gramasi: '270 gsm', sizes: ['22x22x8'], unit: 'pcs', tiers: [[2500, 1234], [5000, 1111], [10000, 999]] },
];

/** The template rows (header first), as the client's own file would carry them. */
export function buildDemoRows(): (string | number)[][] {
  const rows: (string | number)[][] = [[...TEMPLATE_COLUMNS]];
  for (const p of DEMO_PRODUCTS) {
    for (const size of p.sizes) {
      for (const [minQty, price] of p.tiers) {
        rows.push([p.brand, p.product, size, p.gramasi, 'Cetak 1 warna', '', '', minQty, p.unit, price, p.unit, 'tidak', NOTE]);
      }
    }
  }
  return rows;
}

export async function loadDemoCatalog(): Promise<CatalogImportResult> {
  const buffer = await writeExcelFile([{ sheet: TEMPLATE_SHEET, data: buildDemoRows() as never }] as never).toBuffer();
  const result = await importCatalogFromXlsx(buffer);
  invalidateCatalogCache();
  return result;
}

export interface PurgeResult { products: number; variants: number; tiers: number }

/** Deletes ONLY products named "... (CONTOH)"; their variants, tiers and reference images go with them (cascade). */
export async function purgeDemoCatalog(): Promise<PurgeResult> {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const demo = await tx.select({ id: products.id }).from(products).where(like(products.name, `%${DEMO_SUFFIX}`));
    const out: PurgeResult = { products: demo.length, variants: 0, tiers: 0 };
    for (const { id } of demo) {
      const variants = await tx.select({ id: productVariants.id }).from(productVariants).where(sqlEq(productVariants.productId, id));
      out.variants += variants.length;
      for (const v of variants) {
        out.tiers += (await tx.select({ id: variantPriceTiers.id }).from(variantPriceTiers).where(sqlEq(variantPriceTiers.variantId, v.id))).length;
      }
      await tx.delete(products).where(sqlEq(products.id, id));
    }
    return out;
  });
  invalidateCatalogCache();
  return result;
}
