/**
 * Catalog -> Excel export, in the same single-sheet tier template the import reads
 * (catalogTemplate.ts): one row per price tier, so the file edited by staff goes straight back in.
 * The whole catalog, never a filtered slice.
 */

import writeExcelFile from 'write-excel-file/node';
import { listProducts } from '../repositories/products.js';
import { TEMPLATE_SHEET, buildTemplateRows } from './catalogTemplate.js';
import type { Product } from '../domain/types.js';

const PRICE_COLUMN = 9; // 'Harga'

export function buildCatalogSheet(products: Product[]) {
  const [header, ...body] = buildTemplateRows(products);
  return {
    sheet: TEMPLATE_SHEET,
    stickyRowsCount: 1,
    data: [
      header!.map((value) => ({ value, fontWeight: 'bold' as const })),
      ...body.map((r) =>
        r.map((v, i) => (i === PRICE_COLUMN ? { value: v, type: Number, format: '#,##0' } : v))
      ),
    ],
  };
}

export async function buildCatalogWorkbook(): Promise<Buffer> {
  const { products } = await listProducts({ limit: 0 });
  return writeExcelFile([buildCatalogSheet(products)] as never).toBuffer();
}
