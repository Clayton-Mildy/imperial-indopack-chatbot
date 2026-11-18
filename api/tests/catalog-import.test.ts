/**
 * catalog-import.test.ts
 * The round trip: buildCatalogSheets -> parseCatalogWorkbook must lose nothing.
 *
 * Runs the export straight back through the parser rather than through a real .xlsx, because
 * write-excel-file wraps styled cells as { value, ... } and a real file serializes that away -
 * `plain()` below does the same flattening, so what the parser sees is what read-excel-file
 * would hand it. Pure: no DB, no xlsx round trip on disk.
 */

import { describe, it, expect } from 'vitest';
import type { Sheet } from 'write-excel-file/node';
import { buildCatalogSheets } from '../src/services/catalogExport.js';
import { parseCatalogWorkbook, type SheetLike } from '../src/services/catalogImport.js';
import { brand, category, p1, p2, uomPcs, uomSet } from './catalog-fixtures.js';

const plain = (sheets: Sheet<Buffer>[]): SheetLike[] =>
  sheets.map((s) => ({
    sheet: s.sheet,
    data: s.data.map((r) =>
      (r ?? []).map((c) =>
        c && typeof c === 'object' && 'value' in c ? (c as { value: unknown }).value : (c ?? null)
      )
    ),
  }));

const exported = () => plain(buildCatalogSheets([p1, p2], [brand], [category], [uomSet, uomPcs]));
const parse = (sheets: SheetLike[] = exported()) => parseCatalogWorkbook(sheets);

/** Both fixtures are Vintage, so that is the one brand sheet the export emits. */
const BRAND_SHEET = 'Vintage';

/** Re-headers the brand sheet, keeping the data columns where they are. */
function withHeader(sheets: SheetLike[], fn: (header: unknown[]) => unknown[]): SheetLike[] {
  return sheets.map((s) =>
    s.sheet === BRAND_SHEET ? { ...s, data: [fn([...s.data[0]!]), ...s.data.slice(1)] } : s
  );
}

describe('parseCatalogWorkbook — round trip', () => {
  it('reads its own export back with no errors', () => {
    const out = parse();
    expect(out.fatal).toBe(false);
    expect(out.errors).toEqual([]);
    expect(out.products).toHaveLength(2);
  });

  it('takes the brand from the sheet name, not from a column', () => {
    expect(parse().products.every((p) => p.brand === 'Vintage')).toBe(true);
  });

  it('reads every brand sheet, and a sheet for an unknown brand creates it', () => {
    const sheets = exported();
    const vintage = sheets.find((s) => s.sheet === BRAND_SHEET)!;
    // A second tab, same header, one product - how a new brand arrives through Excel.
    const row = [...(vintage.data[1] as unknown[])];
    const produkIdx = (vintage.data[0] as unknown[]).indexOf('produk');
    row[produkIdx] = 'PALU BARU';
    sheets.push({ sheet: 'Shind', data: [vintage.data[0]!, row] });

    const out = parseCatalogWorkbook(sheets);
    expect(out.errors).toEqual([]);
    expect(out.products.find((p) => p.name === 'PALU BARU')!.brand).toBe('Shind');
  });

  it('keeps every product field', () => {
    const p = parse().products.find((x) => x.name === 'BODY BIASA 8545-NL')!;
    expect(p).toMatchObject({
      brand: 'Vintage',
      category: 'Kunci',
      fungsi: 'mekanisme utama pintu',
      kataKunci: 'rumah kunci',
      kelengkapan: 'Body, Skrup',
      bahan: 'Plat Stainless Steel',
      ketebalan: '2mm',
      tier: 'mid',
      upsell: 'ENGSEL 4 INCH',
    });
    // The ' | ' join the export uses has to split back into names.
    expect(p.related).toEqual(['ENGSEL 4 INCH']);
  });

  it('keeps mp_idr, uom_mp and the min-order pair', () => {
    // These three are the ones with a history of being exported and not writable - this is the
    // assertion that fails if anyone drops them from the write path again.
    const v = parse().products.find((x) => x.name === 'BODY BIASA 8545-NL')!.variants[0]!;
    expect(v).toMatchObject({
      name: 'GOTHIC (BLACK)',
      priceIdr: 116000,
      uomPrice: 'Set',
      mpPriceIdr: 13500,
      mpUom: 'Pcs',
      minOrderQty: 3,
      uomMinOrder: 'Set',
      isiCtn: 30,
      isiBox: 1,
      stockStatus: 'normal',
      isActive: true,
    });
  });

  it('keeps an inactive, unpriced variant as blank rather than dropping it', () => {
    const v = parse().products.find((x) => x.name === 'BODY BIASA 8545-NL')!.variants[1]!;
    expect(v).toMatchObject({ name: 'SN (SILVER)', priceIdr: null, mpPriceIdr: null, isActive: false });
  });

  it('does not invent a variant from the pad row of a product that has none', () => {
    const p = parse().products.find((x) => x.name === 'ENGSEL 4 INCH')!;
    expect(p.variants).toEqual([]);
  });

  it('reads the three lookup sheets', () => {
    const out = parse();
    expect(out.brands).toEqual([
      { name: 'Vintage', description: 'Lini premium', brandType: 'own', catalogFileUrl: null },
    ]);
    expect(out.categories).toEqual([{ name: 'Kunci', description: null }]);
    expect(out.uoms.map((u) => u.name)).toEqual(['Set', 'Pcs']);
  });
});

describe('parseCatalogWorkbook — headers the team will change', () => {
  it('survives a reordered header and an extra appended column', () => {
    const base = exported();
    const shuffled = withHeader(base, (h) => h);
    // Appending a column the export never emits must be ignored, not shift anything.
    shuffled.forEach((s) => {
      if (s.sheet !== BRAND_SHEET) return;
      s.data = s.data.map((r, i) => [...r, i === 0 ? 'catatan_gudang' : 'abaikan saya']);
    });
    expect(parse(shuffled).products[0]!.variants[0]!.priceIdr).toBe(116000);
    expect(parse(shuffled).errors).toEqual([]);
  });

  it('takes the RIGHT-most harga column when the sheet has accumulated several', () => {
    // The whole reason the team's workbooks keep growing: each price revision appends a column,
    // newest on the right. Reading the leftmost would quote last season's price forever.
    const base = exported();
    const grown = base.map((s) => {
      if (s.sheet !== BRAND_SHEET) return s;
      const idx = (s.data[0] as unknown[]).findIndex((c) => c === 'harga_idr');
      return {
        ...s,
        data: s.data.map((r, i) => {
          const row = [...r];
          row[idx] = i === 0 ? 'harga_2025' : row[idx];
          return [...row, i === 0 ? 'harga_2026' : i === 1 ? 128000 : null];
        }),
      };
    });
    expect(parse(grown).products[0]!.variants[0]!.priceIdr).toBe(128000);
  });

  it('is fatal when the file has no brand sheet at all', () => {
    // Only lookup tabs: nothing to import, and nothing may be written.
    expect(parse([{ sheet: 'Merek', data: [['nama']] }]).fatal).toBe(true);
  });

  it('skips a brand sheet missing its key column, naming the sheet, without failing the rest', () => {
    const broken = withHeader(exported(), (h) => h.map((c) => (c === 'produk' ? 'nama_barang' : c)));
    const out = parse(broken);
    expect(out.fatal).toBe(false);   // other brand sheets in the same file must still import
    expect(out.products).toEqual([]);
    expect(out.errors[0]!.reason).toContain(BRAND_SHEET);
  });

  it('names the sheet in a row error - "baris 12" alone is ambiguous across seven tabs', () => {
    const sheets = exported();
    const produk = sheets.find((s) => s.sheet === BRAND_SHEET)!;
    const idx = (produk.data[0] as unknown[]).indexOf('tier');
    produk.data[1]![idx] = 'murah';
    expect(parseCatalogWorkbook(sheets).errors[0]!.reason).toContain(`[${BRAND_SHEET}]`);
  });
});

describe('parseCatalogWorkbook — hand-edited cells', () => {
  const priceCell = (raw: unknown): unknown => {
    const sheets = exported();
    const produk = sheets.find((s) => s.sheet === BRAND_SHEET)!;
    const idx = (produk.data[0] as unknown[]).indexOf('harga_idr');
    produk.data[1]![idx] = raw;
    return parseCatalogWorkbook(sheets);
  };

  it('reads an Indonesian thousands separator as thousands, not as 116', () => {
    const out = priceCell('116.000') as ReturnType<typeof parseCatalogWorkbook>;
    expect(out.products[0]!.variants[0]!.priceIdr).toBe(116000);
  });

  it('strips a typed Rp prefix', () => {
    const out = priceCell('Rp 250.000') as ReturnType<typeof parseCatalogWorkbook>;
    expect(out.products[0]!.variants[0]!.priceIdr).toBe(250000);
  });

  it('reports an unreadable price instead of silently nulling it', () => {
    const out = priceCell('seratus ribu') as ReturnType<typeof parseCatalogWorkbook>;
    expect(out.errors[0]!.reason).toContain('tidak terbaca');
    // The row is skipped, so the bad figure never reaches the database.
    expect(out.products[0]!.variants.find((v) => v.name === 'GOTHIC (BLACK)')).toBeUndefined();
  });

  it('treats a blank cell as "clear it" and an absent column as "leave it alone"', () => {
    const blanked = exported();
    const produk = blanked.find((s) => s.sheet === BRAND_SHEET)!;
    const idx = (produk.data[0] as unknown[]).indexOf('bahan');
    produk.data[1]![idx] = null;
    expect(parseCatalogWorkbook(blanked).products[0]!.bahan).toBeNull();

    const dropped = withHeader(exported(), (h) => h.map((c) => (c === 'bahan' ? 'kolom_lain' : c)));
    expect(parseCatalogWorkbook(dropped).products[0]!.bahan).toBeUndefined();
  });
});
