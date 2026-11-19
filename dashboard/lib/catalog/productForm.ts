import { BRAND_TAG, isBrandSlug, type BrandSlug } from "@/lib/brands";
import { PCS_PER_RIM } from "@/lib/format";
import { formatNumber, formatRupiah, type Lang, type TFn, type TKey } from "@/lib/i18n/core";
import type { CatalogChange, CatalogProduct, ProductDraft, ProductInputError, QtyUnit } from "@/types/api";

// The Tambah / Ubah Produk form (api/src/services/catalogEditor.ts). The form keeps what staff typed as
// text; toDraft turns it into the API's draft, and the API's preview names every problem by size and
// tier index. Numbers are typed the Indonesian way: a dot groups thousands, never a decimal point.

export interface TierRow {
  minQty: string;
  qtyUnit: "rim" | "pcs";
  price: string;
  priceUnit: "rim" | "pcs";
  includesDelivery: boolean;
}
export interface SizeRow {
  id?: string;
  size: string;
  /** Gramasi as typed ("300 gsm"); '' when the product has none (all rows then have none). */
  gsm: string;
  tiers: TierRow[];
  copiedFrom?: string;
  /** Set on rows addGramasi made from another gramasi: the source gramasi (copiedFrom is a size name). */
  copiedFromGramasi?: string;
}
export interface ProductFormState {
  brand: BrandSlug;
  name: string;
  print: string;
  finishing: string;
  use: string;
  isActive: boolean;
  sizes: SizeRow[];
}

/** The API's caps (catalogEditor.ts): longer text is a bare 400, so the inputs stop there. */
export const MAX_TEXT_LENGTH = 200;
export const MAX_USE_LENGTH = 500;
export const MAX_TIER_QTY = 10_000_000;
export const MAX_TIER_PRICE_IDR = 1_000_000_000;
/** api/src/repositories/referenceImages.ts */
export const MAX_REFERENCE_PHOTOS = 3;

/** Catalog data, so never translated. A stored value outside these is offered as well, so it survives an edit. */
export const PRINT_OPTIONS = ["1 warna", "Polos", "2 warna", "Full color"] as const;
export const FINISHING_OPTIONS = ["Laminasi food grade", "Non laminasi"] as const;

/** Kertas Supreme is priced per rim, Imperial Indopack per pcs. */
export function defaultPriceUnit(brand: BrandSlug): QtyUnit {
  return brand === "kertas_supreme" ? "rim" : "pcs";
}

function startingTier(brand: BrandSlug): TierRow {
  return { minQty: "5", qtyUnit: "rim", price: "", priceUnit: defaultPriceUnit(brand), includesDelivery: false };
}

export function emptySize(brand: BrandSlug, gsm = ""): SizeRow {
  return { size: "", gsm, tiers: [startingTier(brand)] };
}

export function emptyForm(brand: BrandSlug): ProductFormState {
  return { brand, name: "", print: "", finishing: "", use: "", isActive: true, sizes: [emptySize(brand)] };
}

const idNumber = (n: number): string => formatNumber(n, "id");

export function fromCatalogProduct(p: CatalogProduct): ProductFormState {
  return {
    brand: p.brand,
    name: p.name,
    print: p.print ?? "",
    finishing: p.finishing ?? "",
    use: p.use,
    isActive: p.isActive,
    sizes: p.sizes.map((s) => ({
      id: s.id,
      size: s.size,
      gsm: s.gsm ?? "",
      tiers: s.tiers.map((t) => ({
        minQty: idNumber(t.minQty),
        qtyUnit: t.qtyUnit,
        price: idNumber(t.priceIdr),
        priceUnit: t.priceUnit,
        includesDelivery: t.includesDelivery,
      })),
    })),
  };
}

/** Plain digits, or digits grouped in threes by dots ("1.450", "2.500.000"). */
const WHOLE_RE = /^(\d+|\d{1,3}(\.\d{3})+)$/;

function parseWhole(text: string): number | null {
  const v = text.replace(/\s+/g, "");
  if (!WHOLE_RE.test(v)) return null;
  const n = Number(v.replace(/\./g, ""));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Rupiah as staff type it: "185.000", "Rp 185.000", "Rp185.000,-" and "185000" are all 185000, and
 * "1.450" is 1450, never 1.45. Anything that is not a positive whole number of rupiah is null, so an
 * English "1,450" or a stray "1.45" is refused rather than misread.
 */
export function parseRupiah(s: string): number | null {
  const v = s.trim().replace(/^rp\.?/i, "").replace(/,(-|0{1,2})$/, "");
  return parseWhole(v);
}

/** A tier's starting quantity: "5", "2.500" or "2500"; null when empty or not a positive whole number. */
export function parseQty(s: string): number | null {
  return parseWhole(s.trim());
}

/**
 * The API's draft. Prices go through parseRupiah and quantities through parseQty (the brief says
 * parseInt, but parseInt("2.500") is 2: quantities are typed with thousands dots too). Blank
 * cetak / finishing and a size's gramasi are null; the copy marker is the form's own.
 */
export function toDraft(f: ProductFormState): ProductDraft {
  const optional = (v: string): string | null => v.trim() || null;
  return {
    brand: f.brand,
    name: f.name,
    print: optional(f.print),
    finishing: optional(f.finishing),
    use: f.use,
    isActive: f.isActive,
    sizes: f.sizes.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      size: s.size,
      gsm: optional(s.gsm),
      tiers: s.tiers.map((t) => ({
        minQty: parseQty(t.minQty),
        qtyUnit: t.qtyUnit,
        priceIdr: parseRupiah(t.price),
        priceUnit: t.priceUnit,
        includesDelivery: t.includesDelivery,
      })),
    })),
  };
}

// ─── Gramasi ─────────────────────────────────────────────────────────────────
// Gramasi sits on each size row (a product is all-gramasi or no-gramasi). The form stays a flat sizes[]
// so the API's sizeIndex errors still point at a row; these functions group and edit it by gramasi.
// A small copy of api/src/domain/gramasi.ts: "300", "300gsm" and "300 GSM" are all "300 gsm".

const GSM_NUMERIC = /^(\d+(?:[.,]\d+)?)\s*(?:gsm)?$/i;

/** Canonical gramasi text ('' when blank): a bare number becomes "<n> gsm", anything else stays as typed. */
function normalizeGsm(raw: string): string {
  const text = raw.trim().replace(/\s+/g, " ");
  const m = GSM_NUMERIC.exec(text);
  return m ? `${m[1]!.replace(",", ".")} gsm` : text;
}

/** Whether two gramasi texts are the same gramasi. */
export function sameGsm(a: string, b: string): boolean {
  return normalizeGsm(a).toLowerCase() === normalizeGsm(b).toLowerCase();
}

function gsmNumber(g: string): number | null {
  const m = GSM_NUMERIC.exec(g);
  return m ? Number(m[1]!.replace(",", ".")) : null;
}

/** The API's compareGsm: no gramasi first, then by number, then other text alphabetically. */
function compareGsm(a: string, b: string): number {
  const x = normalizeGsm(a);
  const y = normalizeGsm(b);
  if (!x || !y) return x === y ? 0 : !x ? -1 : 1;
  const nx = gsmNumber(x);
  const ny = gsmNumber(y);
  if (nx !== null && ny !== null) return nx - ny;
  if (nx !== null) return -1;
  if (ny !== null) return 1;
  return x.localeCompare(y);
}

/**
 * The form's rows grouped by gramasi, in the order the API lists them, each group with its row indexes in
 * sizes[]. A no-gramasi product is one group with gsm '' (also when it has no rows yet).
 */
export function gramasiGroups(f: ProductFormState): { gsm: string; indexes: number[] }[] {
  const groups: { gsm: string; indexes: number[] }[] = [];
  f.sizes.forEach((s, i) => {
    const g = groups.find((x) => sameGsm(x.gsm, s.gsm));
    if (g) g.indexes.push(i);
    else groups.push({ gsm: normalizeGsm(s.gsm) ? s.gsm.trim() : "", indexes: [i] });
  });
  if (groups.length === 0) return [{ gsm: "", indexes: [] }];
  return groups.sort((a, b) => compareGsm(a.gsm, b.gsm));
}

/**
 * A new gramasi. With copyFrom, it copies that gramasi's sizes and tier quantities with every price
 * empty, marked as copied from that gramasi (copiedFromGramasi); without, it adds one empty size.
 * The new rows go at the end of sizes[], so existing indexes stay where they are.
 */
export function addGramasi(f: ProductFormState, gsm: string, copyFrom?: string): ProductFormState {
  const to = gsm.trim();
  const source = copyFrom === undefined ? [] : f.sizes.filter((s) => sameGsm(s.gsm, copyFrom));
  if (source.length === 0) return { ...f, sizes: [...f.sizes, emptySize(f.brand, to)] };
  return {
    ...f,
    sizes: [
      ...f.sizes,
      ...source.map((s) => ({
        size: s.size,
        gsm: to,
        copiedFromGramasi: copyFrom,
        tiers: s.tiers.map((t) => ({ ...t, price: "" })),
      })),
    ],
  };
}

/** A no-gramasi product gets its first gramasi: every existing row takes it (the form asks "which gramasi is this?"). */
export function setFirstGramasi(f: ProductFormState, gsm: string): ProductFormState {
  return { ...f, sizes: f.sizes.map((s) => ({ ...s, gsm: gsm.trim() })) };
}

/** "270 · 300 · 350 gsm" for a card: the product's distinct gramasi in order; '' when it has none. */
export function gramasiSummary(gsms: (string | null)[]): string {
  const distinct: string[] = [];
  for (const g of gsms) {
    const n = normalizeGsm(g ?? "");
    if (n && !distinct.some((d) => sameGsm(d, n))) distinct.push(n);
  }
  distinct.sort(compareGsm);
  const numeric = distinct.filter((g) => gsmNumber(g) !== null).map((g) => g.replace(/\s*gsm$/i, ""));
  const other = distinct.filter((g) => gsmNumber(g) === null);
  return [numeric.length ? `${numeric.join(" · ")} gsm` : "", ...other].filter(Boolean).join(" · ");
}

/** Why a gramasi text cannot be used for a product that already has these gramasi: blank, or already there. */
export function gramasiProblem(existing: string[], gsm: string): "blank" | "exists" | null {
  if (!normalizeGsm(gsm)) return "blank";
  return existing.some((g) => sameGsm(g, gsm)) ? "exists" : null;
}

/** Only the rows of that gramasi change. */
export function renameGramasi(f: ProductFormState, from: string, to: string): ProductFormState {
  return { ...f, sizes: f.sizes.map((s) => (sameGsm(s.gsm, from) ? { ...s, gsm: to.trim() } : s)) };
}

/** Removes that gramasi's rows and nothing else. */
export function removeGramasi(f: ProductFormState, gsm: string): ProductFormState {
  return { ...f, sizes: f.sizes.filter((s) => !sameGsm(s.gsm, gsm)) };
}

/** (minQty, qtyUnit) as the API matches tiers; null while the quantity is not a number. */
function tierKey(t: { minQty: string; qtyUnit: QtyUnit }): string | null {
  const q = parseQty(t.minQty);
  return q === null ? null : `${q} ${t.qtyUnit}`;
}

/**
 * Every other size of the same gramasi gets the source size's tier rows. Where that size already had a tier with the same
 * (minQty, qtyUnit), its price - with the unit and delivery that go with it - stays; every other row
 * comes with an empty price, and the size is marked as copied until its prices are filled in.
 */
export function copyTiersToOtherSizes(f: ProductFormState, from: number): ProductFormState {
  const source = f.sizes[from];
  if (!source) return f;
  return {
    ...f,
    sizes: f.sizes.map((s, i) => {
      if (i === from || !sameGsm(s.gsm, source.gsm)) return s;
      const own = new Map<string, TierRow>();
      for (const t of s.tiers) {
        const key = tierKey(t);
        if (key !== null && !own.has(key)) own.set(key, t);
      }
      return {
        ...s,
        copiedFrom: source.size,
        tiers: source.tiers.map((t) => {
          const key = tierKey(t);
          const mine = key === null ? undefined : own.get(key);
          return mine
            ? { ...t, price: mine.price, priceUnit: mine.priceUnit, includesDelivery: mine.includesDelivery }
            : { ...t, price: "" };
        }),
      };
    }),
  };
}

const pcsOf = (qty: number, unit: QtyUnit): number => (unit === "rim" ? qty * PCS_PER_RIM : qty);

/**
 * The tier "+ Tambah tingkat" adds: double the top tier's quantity (highest in pcs), in its units, with
 * an empty price. A size with no readable tier starts at the brand's 5 rim.
 */
export function nextTierRow(size: SizeRow, brand: BrandSlug): TierRow {
  let top: { row: TierRow; qty: number } | null = null;
  for (const row of size.tiers) {
    const qty = parseQty(row.minQty);
    if (qty !== null && (!top || pcsOf(qty, row.qtyUnit) > pcsOf(top.qty, top.row.qtyUnit))) top = { row, qty };
  }
  if (!top) return startingTier(brand);
  return { ...top.row, minQty: idNumber(top.qty * 2), price: "" };
}

/** A text field the API caps (catalogEditor.ts); over the cap its schema answers a bare 400, so the form says it first. */
export type CappedField = "name" | "gsm" | "print" | "finishing" | "use" | "size";

/** The API's error codes plus the form's own "too long" (the API has no code for it). */
export type FormErrorCode = ProductInputError["code"] | "text_too_long";
export interface FormError {
  code: FormErrorCode;
  sizeIndex?: number;
  tierIndex?: number;
  /** For text_too_long: which field. */
  field?: CappedField;
}

/** Codes the form judges itself from what is typed now, exactly as validateProductDraft does. */
const LOCAL_CODES = new Set<FormErrorCode>([
  "name_required",
  "use_required",
  "no_sizes",
  "size_required",
  "gsm_mixed",
  "no_tiers",
  "qty_missing",
  "qty_invalid",
  "price_missing",
  "price_invalid",
]);

/**
 * Every problem with the form, in form order. The form judges what it can itself - required fields, a
 * size and a tier, each quantity and price present, a whole number and within the API's caps, the text
 * caps - so the checklist and Simpan are right from the first render and never wait on the API. Those
 * judgements are made on the current text, so the API's answer for them (possibly about an older draft)
 * is not used. The API stays the authority for what only it can judge: duplicate sizes, duplicate tiers
 * and tier order, kept while the row they point at stands (an order judgement only while that row's
 * quantity still reads as a number).
 */
export function formErrors(f: ProductFormState, server: ProductInputError[]): FormError[] {
  const out: FormError[] = [];
  const seen = new Set<string>();
  const push = (e: FormError) => {
    const key = `${e.code}:${e.field ?? ""}:${e.sizeIndex ?? ""}:${e.tierIndex ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };
  const tooLong = (field: CappedField, text: string, max = MAX_TEXT_LENGTH) => text.length > max;

  if (!f.name.trim()) push({ code: "name_required" });
  else if (tooLong("name", f.name)) push({ code: "text_too_long", field: "name" });
  for (const field of ["print", "finishing"] as const) {
    if (tooLong(field, f[field])) push({ code: "text_too_long", field });
  }
  if (!f.use.trim()) push({ code: "use_required" });
  else if (tooLong("use", f.use, MAX_USE_LENGTH)) push({ code: "text_too_long", field: "use" });
  if (f.sizes.length === 0) push({ code: "no_sizes" });

  // A product is all-gramasi or no-gramasi: the first row decides, the first row that differs is the mistake.
  const hasGsm = (s: SizeRow) => normalizeGsm(s.gsm) !== "";
  const mixedAt = f.sizes.findIndex((s) => hasGsm(s) !== hasGsm(f.sizes[0]!));
  if (mixedAt > 0) push({ code: "gsm_mixed", sizeIndex: mixedAt });

  const qtyBad = new Set<string>();
  f.sizes.forEach((s, sizeIndex) => {
    if (tooLong("gsm", s.gsm)) push({ code: "text_too_long", field: "gsm", sizeIndex });
    if (!s.size.trim()) push({ code: "size_required", sizeIndex });
    else if (tooLong("size", s.size)) push({ code: "text_too_long", field: "size", sizeIndex });
    if (s.tiers.length === 0) push({ code: "no_tiers", sizeIndex });
    s.tiers.forEach((t, tierIndex) => {
      const qty = parseQty(t.minQty);
      if (!t.minQty.trim()) push({ code: "qty_missing", sizeIndex, tierIndex });
      else if (qty === null || qty > MAX_TIER_QTY) push({ code: "qty_invalid", sizeIndex, tierIndex });
      if (qty === null || qty > MAX_TIER_QTY) qtyBad.add(`${sizeIndex}:${tierIndex}`);
      const price = parseRupiah(t.price);
      if (!t.price.trim()) push({ code: "price_missing", sizeIndex, tierIndex });
      else if (price === null || price > MAX_TIER_PRICE_IDR) push({ code: "price_invalid", sizeIndex, tierIndex });
    });
  });

  for (const e of server) {
    if (LOCAL_CODES.has(e.code)) continue;
    if (e.sizeIndex === undefined || !f.sizes[e.sizeIndex]) continue;
    if (e.tierIndex !== undefined) {
      if (!f.sizes[e.sizeIndex]!.tiers[e.tierIndex]) continue;
      if (qtyBad.has(`${e.sizeIndex}:${e.tierIndex}`)) continue;
    }
    push(e);
  }
  return out;
}

/** A field staff can leave or blur; a missing value is marked on it only once it was touched. */
export interface TouchedField {
  field: "name" | "use" | "size" | "qty" | "price";
  sizeIndex?: number;
  tierIndex?: number;
}

const MISSING_FIELD: Partial<Record<FormErrorCode, TouchedField["field"]>> = {
  name_required: "name",
  use_required: "use",
  size_required: "size",
  qty_missing: "qty",
  price_missing: "price",
};

/**
 * The errors marked on the fields of a fresh form: a missing value only once its field was touched or a
 * save was tried, so a blank Tambah Produk does not open covered in red. Anything wrong that was typed
 * (and the API's own judgements) always shows. The checklist and Simpan go by every error.
 */
export function visibleErrors(errors: FormError[], touched: TouchedField[], attempted: boolean): FormError[] {
  if (attempted) return errors;
  return errors.filter((e) => {
    const field = MISSING_FIELD[e.code];
    if (!field) return true;
    return touched.some((t) => t.field === field && t.sizeIndex === e.sizeIndex && t.tierIndex === e.tierIndex);
  });
}

/**
 * Removing a size (no tierIndex) or a tier moves the indexes that errors and touched fields point at:
 * the removed one's entries go, the later ones move up.
 */
export function shiftErrors<T extends { sizeIndex?: number; tierIndex?: number }>(list: T[], sizeIndex: number, tierIndex?: number): T[] {
  return list.flatMap((e) => {
    if (tierIndex === undefined) {
      if (e.sizeIndex === sizeIndex) return [];
      return e.sizeIndex !== undefined && e.sizeIndex > sizeIndex ? [{ ...e, sizeIndex: e.sizeIndex - 1 }] : [e];
    }
    if (e.sizeIndex !== sizeIndex || e.tierIndex === undefined) return [e];
    if (e.tierIndex === tierIndex) return [];
    return e.tierIndex > tierIndex ? [{ ...e, tierIndex: e.tierIndex - 1 }] : [e];
  });
}

/** "30 x 30 cm" → "30 × 30 cm", as the designs write sizes. */
export function displaySize(size: string): string {
  return size.replace(/(\d)\s*[xX×]\s*(?=\d)/g, "$1 × ");
}

const ERROR_KEY: Record<FormErrorCode, TKey> = {
  name_required: "catalog.form.err.name_required",
  use_required: "catalog.form.err.use_required",
  no_sizes: "catalog.form.err.no_sizes",
  size_required: "catalog.form.err.size_required",
  duplicate_size: "catalog.form.err.duplicate_size",
  gsm_mixed: "catalog.form.err.gsm_mixed",
  no_tiers: "catalog.form.err.no_tiers",
  qty_missing: "catalog.form.err.qty_missing",
  qty_invalid: "catalog.form.err.qty_invalid",
  price_missing: "catalog.form.err.price_missing",
  price_invalid: "catalog.form.err.price_invalid",
  duplicate_tier: "catalog.form.err.duplicate_tier",
  tier_order: "catalog.form.err.tier_order",
  text_too_long: "catalog.form.err.text_too_long",
};

/** The message for one error, worded for the row it sits on. */
export function errorMessage(e: FormError, f: ProductFormState, t: TFn, lang: Lang): string {
  const row = e.sizeIndex === undefined || e.tierIndex === undefined ? undefined : f.sizes[e.sizeIndex]?.tiers[e.tierIndex];
  const qty = row ? parseQty(row.minQty) : null;
  const vars = { qty: qty === null ? (row?.minQty.trim() ?? "") : formatNumber(qty, lang), unit: row?.qtyUnit ?? "" };
  if (e.code === "price_missing" && qty === null) return t("catalog.form.err.price_missingBare");
  if (e.code === "qty_invalid") return t(ERROR_KEY[e.code], { max: formatNumber(MAX_TIER_QTY, lang) });
  if (e.code === "price_invalid") return t(ERROR_KEY[e.code], { max: formatRupiah(MAX_TIER_PRICE_IDR) });
  if (e.code === "text_too_long") return t(ERROR_KEY[e.code], { max: formatNumber(e.field === "use" ? MAX_USE_LENGTH : MAX_TEXT_LENGTH, lang) });
  return t(ERROR_KEY[e.code], vars);
}

/** How a draft size compares with the stored product: new (no stored size with its id), changed, or null. */
export function sizeChange(s: SizeRow, initial: ProductFormState): "new" | "changed" | null {
  const before = s.id ? initial.sizes.find((b) => b.id === s.id) : undefined;
  if (!before) return "new";
  const norm = (x: SizeRow) =>
    JSON.stringify({ size: x.size.trim(), gsm: normalizeGsm(x.gsm).toLowerCase(), tiers: toDraft({ ...initial, sizes: [x] }).sizes[0]!.tiers });
  return norm(s) === norm(before) ? null : "changed";
}

/** The stored price of the same (minQty, qtyUnit) in the same stored size, when the form now differs from it. */
export function previousPrice(s: SizeRow, row: TierRow, initial: ProductFormState): { priceIdr: number; priceUnit: QtyUnit } | null {
  const before = s.id ? initial.sizes.find((b) => b.id === s.id) : undefined;
  const key = tierKey(row);
  if (!before || key === null) return null;
  const old = before.tiers.find((b) => tierKey(b) === key);
  const oldPrice = old ? parseRupiah(old.price) : null;
  if (!old || oldPrice === null) return null;
  if (parseRupiah(row.price) === oldPrice && row.priceUnit === old.priceUnit) return null;
  return { priceIdr: oldPrice, priceUnit: old.priceUnit };
}

/** Reference photos are JPG or PNG; a file with no type (some systems) goes by its extension. */
export function isJpgOrPng(file: { type: string; name: string }): boolean {
  if (file.type) return file.type === "image/jpeg" || file.type === "image/png";
  return /\.(jpe?g|png)$/i.test(file.name);
}

const FIELD_KEY: Record<Extract<CatalogChange, { kind: "field" }>["field"], TKey> = {
  name: "catalog.change.f.name",
  brand: "catalog.change.f.brand",
  gsm: "catalog.change.f.gsm",
  print: "catalog.change.f.print",
  finishing: "catalog.change.f.finishing",
  use: "catalog.change.f.use",
};

/**
 * One history or unsaved-change line, e.g. 'Harga 21 × 14 × 5 cm, mulai 10 rim: Rp 1.500 → Rp 1.450/pcs'.
 * Rupiah is always written the Indonesian way; quantities follow `lang` (Indonesian by default).
 */
export function describeChange(c: CatalogChange, t: TFn, lang: Lang = "id"): string {
  const qty = (n: number) => formatNumber(n, lang);
  /** A size, with the gramasi it sits under when the product has one. */
  const sized = (size: string, gsm?: string | null) => (gsm ? `${displaySize(size)} (${gsm})` : displaySize(size));
  switch (c.kind) {
    case "created":
      if (c.via === "form") return t("catalog.change.createdForm");
      return c.fileName ? t("catalog.change.createdImport", { file: c.fileName }) : t("catalog.change.createdImportBare");
    case "field": {
      // Only an addition after a word boundary: "cooki" → "cookies" is a fix, not 'ditambah "es"'.
      if (c.field === "use" && c.from?.trim() && c.to?.startsWith(c.from) && c.to.length > c.from.length) {
        const rest = c.to.slice(c.from.length);
        const added = rest.replace(/^[\s,;.]+/, "").trim();
        if (added && (/^[\s,;.]/.test(rest) || /[\s,;.]$/.test(c.from))) return t("catalog.change.useAdded", { added });
      }
      const show = (v: string | null) => {
        if (!v?.trim()) return "—";
        return c.field === "brand" && isBrandSlug(v) ? t(BRAND_TAG[v].labelKey) : v;
      };
      return t("catalog.change.field", { field: t(FIELD_KEY[c.field]), from: show(c.from), to: show(c.to) });
    }
    case "active":
      return t(c.to ? "catalog.change.activeOn" : "catalog.change.activeOff");
    case "gsm_added":
      return t("catalog.change.gsmAdded", { gsm: c.gsm });
    case "gsm_removed":
      return t("catalog.change.gsmRemoved", { gsm: c.gsm });
    case "gsm_renamed":
      return t("catalog.change.gsmRenamed", { from: c.from, to: c.to });
    case "size_added":
      return t("catalog.change.sizeAdded", { size: sized(c.size, c.gsm) });
    case "size_removed":
      return t("catalog.change.sizeRemoved", { size: sized(c.size, c.gsm) });
    case "size_renamed":
      return t("catalog.change.sizeRenamed", { from: sized(c.from, c.gsm), to: displaySize(c.to) });
    case "tier_added":
    case "tier_removed":
      return t(c.kind === "tier_added" ? "catalog.change.tierAdded" : "catalog.change.tierRemoved", {
        qty: qty(c.minQty),
        unit: c.qtyUnit,
        size: sized(c.size, c.gsm),
      });
    case "tier_price":
      return t("catalog.change.tierPrice", {
        size: sized(c.size, c.gsm),
        qty: qty(c.minQty),
        unit: c.qtyUnit,
        from: formatRupiah(c.from),
        to: formatRupiah(c.to),
        priceUnit: c.priceUnit,
      });
    case "delivery":
      return t(c.to ? "catalog.change.deliveryOn" : "catalog.change.deliveryOff", {
        size: sized(c.size, c.gsm),
        qty: qty(c.minQty),
        unit: c.qtyUnit,
      });
  }
}
