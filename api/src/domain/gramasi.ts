/**
 * Gramasi lives on a product's size rows: one product, one size name, several gramasi as separate rows.
 * Canonical text is "<n> gsm"; "300", "300gsm" and "300 GSM" are the same gramasi.
 */
import type { Product } from './types.js';
import { normalizeSize } from './orderProfile.js';

const NUMERIC = /^(\d+(?:[.,]\d+)?)\s*(?:gsm)?$/i;

export function normalizeGsm(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const m = NUMERIC.exec(text);
  return m ? `${m[1]!.replace(',', '.')} gsm` : text;
}

export function sameGsm(a: string | null | undefined, b: string | null | undefined): boolean {
  return (normalizeGsm(a) ?? '').toLowerCase() === (normalizeGsm(b) ?? '').toLowerCase();
}

function numericPart(g: string): number | null {
  const m = NUMERIC.exec(g);
  return m ? Number(m[1]!.replace(',', '.')) : null;
}

/** null first, then numeric ascending, then non-numeric alphabetical. */
export function compareGsm(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  const na = numericPart(a);
  const nb = numericPart(b);
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a.localeCompare(b);
}

/** ['270 gsm','300 gsm','350 gsm'] -> '270, 300 atau 350 gsm'; one value stays '300 gsm'. */
export function formatGsmList(gsms: string[]): string {
  if (gsms.length <= 1) return gsms[0] ?? '';
  const nums = gsms.map((g) => NUMERIC.exec(g)?.[1]);
  const heads = nums.every((n) => n !== undefined) ? (nums as string[]) : gsms;
  const suffix = nums.every((n) => n !== undefined) ? ' gsm' : '';
  return `${heads.slice(0, -1).join(', ')} atau ${heads[heads.length - 1]}${suffix}`;
}

/** The distinct gramasi of a product's active rows of one size, sorted. */
export function gramasiOfSize(product: Product, size: string): string[] {
  const want = normalizeSize(size);
  const found = new Set<string>();
  for (const v of product.variants ?? []) {
    if (v.isActive && v.gsm && normalizeSize(v.name) === want) found.add(v.gsm);
  }
  return [...found].sort(compareGsm);
}
