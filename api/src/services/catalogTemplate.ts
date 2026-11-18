/**
 * The catalog Excel template: ONE SHEET ("Katalog"), ONE ROW PER PRICE TIER.
 *
 * Rows sharing Merek + Produk + Ukuran form one variant; each row adds a quantity tier to it.
 * Pure on purpose (rows in, rows out) so catalogImport / catalogExport only add the xlsx and
 * database layers.
 */

import type { Product } from '../domain/types.js';
import { toPcs, type PriceTier, type QtyUnit } from '../domain/pricing.js';
import { formatProductSpec, parseProductSpec } from '../domain/productSpec.js';
import { normalizeSize } from '../domain/orderProfile.js';
import { normalizeHeader } from './leadImport.js';
import { BRAND_NAME, brandSlugOfName } from '../domain/brands.js';

export const TEMPLATE_SHEET = 'Katalog';
export const TEMPLATE_COLUMNS = [
  'Merek', 'Produk', 'Ukuran', 'Gramasi', 'Cetak', 'Finishing', 'Kegunaan',
  'Min Qty', 'Satuan Qty', 'Harga', 'Satuan Harga', 'Termasuk Ongkir', 'Catatan',
] as const;
type Col = (typeof TEMPLATE_COLUMNS)[number];

export interface TemplateVariant {
  brand: string;
  product: string;
  size: string;
  description: string | null;
  fungsi: string | null;
  tiers: PriceTier[];
  /** The Excel row each tier came from, parallel to `tiers`. */
  tierRows: number[];
}
export interface ParsedTemplate {
  variants: TemplateVariant[];
  errors: { row: number; message: string }[];
  /** Data rows (blank rows skipped) and how many of them carry no error of their own; counted past the error list's cap. */
  totalRows: number;
  validRows: number;
}

const MAX_ERRORS = 50;

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = v instanceof Date ? v.toISOString() : String(v).trim();
  return s === '' ? null : s;
}

/** "1.500", "1,500" and 1500 are all fifteen hundred (a separator followed by exactly 3 digits is a
 *  thousands separator, repeatable); anything with a real decimal part comes back non-integer so the
 *  caller can reject it, and anything unreadable is NaN. Never a guess at a price. */
function number(v: unknown): number {
  if (typeof v === 'number') return v;
  let s = (text(v) ?? '').replace(/^Rp\s*/i, '').replace(/\s/g, '');
  if (s === '') return NaN;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else s = s.replace(',', '.');
  return Number(s);
}

function unit(v: unknown): QtyUnit | null {
  const s = text(v)?.toLowerCase();
  return s === 'rim' || s === 'pcs' ? s : null;
}

export function parseTemplateRows(rows: unknown[][]): ParsedTemplate {
  const out: ParsedTemplate = { variants: [], errors: [], totalRows: 0, validRows: 0 };
  const errorRows = new Set<number>();
  const err = (row: number, message: string) => {
    errorRows.add(row);
    if (out.errors.length < MAX_ERRORS) out.errors.push({ row, message });
  };

  const header = (rows[0] ?? []).map(normalizeHeader);
  const idx = {} as Record<Col, number>;
  const missing: string[] = [];
  for (const c of TEMPLATE_COLUMNS) {
    const i = header.indexOf(normalizeHeader(c));
    if (i === -1) missing.push(c);
    else idx[c] = i;
  }
  if (missing.length > 0) {
    err(1, `Baris header bukan template katalog (kolom tidak ada: ${missing.join(', ')}). Unduh template dari Export.`);
    return out;
  }

  const groups = new Map<string, TemplateVariant>();
  // Per variant, each tier's threshold in pcs -> how the first row wrote it.
  const seenTiers = new Map<string, string>();
  const failed = new Set<string>();
  const blankKeyRows: { brand: string | null; product: string | null; size: string | null }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const row = i + 1; // 1-based, as the uploader sees it in Excel
    const cell = (c: Col) => r[idx[c]];
    if (TEMPLATE_COLUMNS.every((c) => text(cell(c)) === null)) continue;
    out.totalRows++;

    const brandRaw = text(cell('Merek'));
    const product = text(cell('Produk'));
    const size = text(cell('Ukuran'));
    const brandNames = `${BRAND_NAME.kertas_supreme} atau ${BRAND_NAME.imperial_indopack}`;
    const brandSlug = brandRaw ? brandSlugOfName(brandRaw) : null;
    const brand = brandSlug ? BRAND_NAME[brandSlug] : brandRaw;
    if (!brand || !product || !size) {
      err(row, !brand ? `Kolom Merek kosong. Isi ${brandNames}.` : !product ? 'Kolom Produk kosong.' : 'Kolom Ukuran kosong.');
      // Whose tier was this? Every variant matching the keys that ARE filled is suspect.
      if (brand || product || size) blankKeyRows.push({ brand, product, size });
      continue;
    }

    // Identity as the import applies it: by product name and normalised size ("30x30" is "30 x 30 cm").
    const key = `${product.toLowerCase()}\u0000${normalizeSize(size)}`;
    // A bad row poisons its whole variant: importing the rest would replace its tiers with a
    // partial set, silently dropping the tier the bad row was meant to carry.
    const bad = (message: string) => { err(row, message); failed.add(key); };

    if (!brandSlug) { bad(`Merek "${brandRaw}" tidak dikenal. Isi ${brandNames}.`); continue; }

    const minQty = number(cell('Min Qty'));
    if (!Number.isInteger(minQty) || minQty <= 0) { bad(`Min Qty "${text(cell('Min Qty')) ?? ''}" bukan angka bulat lebih dari 0.`); continue; }
    const qtyUnit = unit(cell('Satuan Qty'));
    if (!qtyUnit) { bad(`Satuan "${text(cell('Satuan Qty')) ?? ''}" tidak dikenal. Pakai rim atau pcs.`); continue; }
    const priceIdr = number(cell('Harga'));
    if (priceIdr <= 0) { bad(`Harga ${text(cell('Harga')) ?? priceIdr}. Harga harus lebih dari 0.`); continue; }
    if (!Number.isInteger(priceIdr)) { bad(`Harga harus bilangan bulat rupiah lebih dari 0: "${text(cell('Harga')) ?? ''}".`); continue; }
    const priceUnit = unit(cell('Satuan Harga'));
    if (!priceUnit) { bad(`Satuan "${text(cell('Satuan Harga')) ?? ''}" tidak dikenal. Pakai rim atau pcs.`); continue; }
    const deliveryRaw = text(cell('Termasuk Ongkir'))?.toLowerCase() ?? 'tidak';
    if (deliveryRaw !== 'ya' && deliveryRaw !== 'tidak') { bad(`Termasuk Ongkir harus ya atau tidak: "${deliveryRaw}".`); continue; }

    // One threshold, one price: "5 rim" and "2500 pcs" are the same tier, and with both the price that
    // applied hung on sort order while the catalog block listed both (final review M10).
    const pcs = toPcs(minQty, qtyUnit);
    const tierKey = `${key}\u0000${pcs}`;
    const first = seenTiers.get(tierKey);
    if (first !== undefined) {
      bad(first === `${minQty} ${qtyUnit}`
        ? `Tier ${minQty} ${qtyUnit} muncul dua kali untuk ukuran ini.`
        : `Tier ${minQty} ${qtyUnit} sama dengan tier ${first} (${pcs} pcs) untuk ukuran ini - satu jumlah hanya boleh punya satu harga.`);
      continue;
    }
    seenTiers.set(tierKey, `${minQty} ${qtyUnit}`);

    let variant = groups.get(key);
    if (!variant) {
      const description = formatProductSpec({ gsm: text(cell('Gramasi')), print: text(cell('Cetak')), finishing: text(cell('Finishing')) });
      variant = { brand, product, size, description, fungsi: text(cell('Kegunaan')), tiers: [], tierRows: [] };
      groups.set(key, variant);
    }
    const note = text(cell('Catatan'));
    variant.tierRows.push(row);
    variant.tiers.push({ minQty, qtyUnit, priceIdr, priceUnit, includesDelivery: deliveryRaw === 'ya', ...(note ? { note } : {}) });
  }
  const poisoned = (v: TemplateVariant) =>
    blankKeyRows.some(
      (b) =>
        (!b.brand || b.brand.toLowerCase() === v.brand.toLowerCase()) &&
        (!b.product || b.product.toLowerCase() === v.product.toLowerCase()) &&
        (!b.size || normalizeSize(b.size) === normalizeSize(v.size))
    );
  out.validRows = out.totalRows - errorRows.size;
  out.variants = [...groups].filter(([k, v]) => !failed.has(k) && !poisoned(v)).map(([, v]) => v);
  return out;
}

/** Header row plus one row per tier. A variant with no tiers has nothing to say in this layout and is omitted. */
export function buildTemplateRows(products: Product[]): unknown[][] {
  const rows: unknown[][] = [[...TEMPLATE_COLUMNS]];
  for (const p of products) {
    // "Gramasi: 64 gsm · Finishing: x" back into its three columns; unknown parts are dropped.
    const spec = parseProductSpec(p.description);
    for (const v of p.variants ?? []) {
      for (const t of v.priceTiers ?? []) {
        rows.push([
          p.brand?.name ?? '', p.name, v.name, spec.gsm, spec.print, spec.finishing, p.fungsi,
          t.minQty, t.qtyUnit, t.priceIdr, t.priceUnit, t.includesDelivery ? 'ya' : 'tidak', t.note ?? null,
        ]);
      }
    }
  }
  return rows;
}
