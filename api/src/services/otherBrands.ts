import { LEGACY_BRANDS } from '../domain/constants.js';

/**
 * Brands that are not ours, said as brands. Live 2026-10-22 a SOLID padlock was answered "gembok 60mm
 * solid yang kokoh": the brand read as the English adjective - our own catalog prose says "solid zinc
 * alloy yang kokoh" - and the customer was never told we do not carry it. A brand named here reaches
 * the reply as a note in the customer block, and replyChecks.verifyReplyOtherBrand holds the reply to it.
 */

const norm = (b: string): string => b.toLowerCase().replace(/[^a-z0-9]/g, '');
// Our brands, plus the company's own name, compared without case, spaces or dashes ("DXPLORE").
const OWN_BRANDS = new Set([...LEGACY_BRANDS, 'Legacy'].map(norm));

/** The names that are not ours, first spelling kept. */
export function notOurBrands(names: string[]): string[] {
  const foreign = names.map((b) => b.trim()).filter((b) => b.length >= 2 && !OWN_BRANDS.has(norm(b)));
  return foreign.filter((b, i) => foreign.findIndex((o) => norm(o) === norm(b)) === i);
}

// "merk apa aja?", "merek lain", "brand lokal" - a question about brands, not a brand.
const NOT_A_BRAND = new Set([
  'apa', 'apaan', 'mana', 'lain', 'lainnya', 'yang', 'yg', 'ini', 'itu', 'nya', 'sendiri', 'lokal', 'import',
  'impor', 'china', 'cina', 'jepang', 'luar', 'dalam', 'bagus', 'terbaik', 'ternama', 'terkenal', 'original',
  'ori', 'asli', 'sama', 'beda', 'berbeda', 'tertentu', 'kalian', 'kamu', 'kakak', 'kak', 'aja', 'saja', 'juga',
  'dari', 'untuk', 'buat', 'ada', 'kami', 'kita', 'toko', 'apapun', 'bebas', 'terserah', 'murah', 'mahal',
]);
// A brand customers write bare, right after the item ("gembok solid"). Only next to an item word: on its
// own "solid" is an adjective ("kayu solid"). Add a brand here when a customer names one this way.
const BARE_BRANDS = ['solid'];
const ITEM_WORDS = 'gembok|kunci|handle|gagang|engsel|grendel|silinder|slot|doorpull|doorstop|kait|rel';
const BARE_RE = new RegExp(`\\b(?:${ITEM_WORDS})\\s+(${BARE_BRANDS.join('|')})\\b`, 'gi');
const NAMED_RE = /\b(?:merk|merek|mrk|brand)\s+([a-z0-9][a-z0-9-]{1,20})\b/gi;

/** Brands that are not ours, named in the customer's own words: "merk X", or a known one bare after the item. */
export function brandsNamedInText(message: string): string[] {
  const found = [
    ...[...message.matchAll(NAMED_RE)].map((m) => m[1]!).filter((w) => !NOT_A_BRAND.has(w.toLowerCase())),
    ...[...message.matchAll(BARE_RE)].map((m) => m[1]!),
  ].map((w) => (w === w.toLowerCase() ? w[0]!.toUpperCase() + w.slice(1) : w));
  return notOurBrands(found);
}

export type BrandSource = 'foto' | 'pesan';

/** The note the reply reads. replyChecks.OTHER_BRAND_NOTE_RE parses it back - change both together. */
export function otherBrandNote(source: BrandSource, brands: string[]): string | null {
  if (brands.length === 0) return null;
  const names = brands.join(', ');
  const where = source === 'foto' ? 'barang/kemasan di foto bertuliskan' : 'pelanggan menyebut';
  return `MEREK DI ${source.toUpperCase()}: ${where} merek ${names} - itu NAMA MEREK lain, bukan merek kami, dan bukan sifat barangnya: jangan diterjemahkan atau dipakai sebagai kata sifat. Sebut merek ${names} apa adanya dan sampaikan merek itu belum ada di kami, lalu ikuti BARANG YANG TIDAK KAMI PUNYA: kalau ada produk kami yang jenis dan ukurannya sama, tawarkan sebagai penggantinya dengan menyebut merek kami.`;
}
