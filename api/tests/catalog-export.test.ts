/**
 * catalog-export.test.ts
 * buildCatalogSheets is the whole contract of the Excel export: catalogImport.ts reads this
 * exact layout back. One sheet per brand, named after the brand. Pure - no DB, no xlsx reader.
 */

import { describe, it, expect } from 'vitest';
import writeExcelFile from 'write-excel-file/node';
import { buildCatalogSheets } from '../src/services/catalogExport.js';
import { brand, category, p1, p2, uomPcs, uomSet } from './catalog-fixtures.js';

const sheets = buildCatalogSheets([p1, p2], [brand], [category], [uomSet, uomPcs]);
// Both fixtures are Vintage, so there is exactly one brand sheet plus the three lookups.
const produk = sheets.find((sh) => sh.sheet === 'Vintage')!;
const header = produk.data[0]!.map((c) => (c as { value: string }).value);
const col = (row: number, name: string) => produk.data[row]![header.indexOf(name)];

describe('buildCatalogSheets', () => {
  it('puts each brand on its own sheet, named after it', () => {
    expect(sheets.map((sh) => sh.sheet)).toEqual(['Vintage', 'Merek', 'Kategori', 'UOM']);
    // The sheet IS the brand, so a column that could disagree with it does not exist.
    expect(header).not.toContain('merek');
  });

  it('keys rows by name, not by id', () => {
    expect(header).not.toContain('product_id');
    expect(header).not.toContain('variant_id');
    expect(col(1, 'produk')).toBe('BODY BIASA 8545-NL');
    expect(col(1, 'varian')).toBe('GOTHIC (BLACK)');
  });

  it('emits one row per variant, and a row for a product with none', () => {
    expect(produk.data).toHaveLength(4); // header + 2 variants + 1 variant-less product
    expect(col(3, 'produk')).toBe('ENGSEL 4 INCH');
    expect(col(3, 'varian')).toBeNull();
    expect(col(3, 'harga_idr')).toBeNull();
    expect(produk.data[3]).toHaveLength(header.length);
  });

  it('writes prices as numbers and flags as booleans', () => {
    expect(col(1, 'harga_idr')).toMatchObject({ value: 116000, format: '#,##0' });
    expect(col(1, 'aktif')).toBe(true);
    expect(col(2, 'aktif')).toBe(false);
    expect(col(2, 'harga_idr')).toBeNull(); // unpriced variant, not "null"
    expect(col(1, 'isi_ctn')).toBe(30);
  });

  it('resolves every cross-reference to a name', () => {
    expect(col(1, 'kategori')).toBe('Kunci');
    expect(col(3, 'kategori')).toBeNull();
    expect(col(1, 'uom_harga')).toBe('Set');
    expect(col(1, 'upsell_produk')).toBe('ENGSEL 4 INCH');
    expect(col(1, 'produk_terkait')).toBe('ENGSEL 4 INCH');
  });

  it('carries one lookup row per brand, category and uom', () => {
    const merek = sheets.find((sh) => sh.sheet === 'Merek');
    const kategori = sheets.find((sh) => sh.sheet === 'Kategori');
    const uom = sheets.find((sh) => sh.sheet === 'UOM');
    expect(merek!.data).toHaveLength(2);
    expect(merek!.data[1]).toEqual(['Vintage', 'own', 'Lini premium', null]);
    expect(kategori!.data).toHaveLength(2);
    expect(uom!.data).toHaveLength(3);
    expect(uom!.data[2]).toEqual(['Pcs', 'Piece']);
  });
});

describe('per-brand sheets', () => {
  it('gives a brand with no products an empty tab to add rows to', () => {
    const empty = { ...brand, id: 'b9', name: 'Shind' };
    const out = buildCatalogSheets([p1], [brand, empty], [category], [uomSet]);
    const shind = out.find((sh) => sh.sheet === 'Shind')!;
    expect(shind.data).toHaveLength(1); // header only
  });

  it('never emits two sheets with the same name - the file would not open', () => {
    const a = { ...brand, id: 'b1', name: 'A'.repeat(40) };
    const b = { ...brand, id: 'b2', name: 'A'.repeat(39) + 'B' };
    const out = buildCatalogSheets([], [a, b], [], []);
    const names = out.map((sh) => sh.sheet);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.length <= 31)).toBe(true);
  });

  it('keeps a sheet name away from the reserved lookup names', () => {
    const clash = { ...brand, id: 'b3', name: 'Merek' };
    const out = buildCatalogSheets([], [clash], [], []);
    expect(out.filter((sh) => sh.sheet === 'Merek')).toHaveLength(1);
  });
});

describe('writeExcelFile wiring', () => {
  it('produces a real xlsx (a zip)', async () => {
    const buffer = await writeExcelFile(sheets).toBuffer();
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });
});
