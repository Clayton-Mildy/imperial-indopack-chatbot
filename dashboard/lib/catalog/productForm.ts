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
  tiers: TierRow[];
  copiedFrom?: string;
}
export interface ProductFormState {
  brand: BrandSlug;
  name: string;
  gsm: string;
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

export function emptySize(brand: BrandSlug): SizeRow {
  return { size: "", tiers: [startingTier(brand)] };
}

export function emptyForm(brand: BrandSlug): ProductFormState {
  return { brand, name: "", gsm: "", print: "", finishing: "", use: "", isActive: true, sizes: [emptySize(brand)] };
}

const idNumber = (n: number): string => formatNumber(n, "id");

export function fromCatalogProduct(p: CatalogProduct): ProductFormState {
  return {
    brand: p.brand,
    name: p.name,
    gsm: p.gsm ?? "",
    print: p.print ?? "",
    finishing: p.finishing ?? "",
    use: p.use,
    isActive: p.isActive,
    sizes: p.sizes.map((s) => ({
      id: s.id,
      size: s.size,
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
 * gramasi / cetak / finishing are null; the copy marker is the form's own.
 */
export function toDraft(f: ProductFormState): ProductDraft {
  const optional = (v: string): string | null => v.trim() || null;
  return {
    brand: f.brand,
    name: f.name,
    gsm: optional(f.gsm),
    print: optional(f.print),
    finishing: optional(f.finishing),
    use: f.use,
    isActive: f.isActive,
    sizes: f.sizes.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      size: s.size,
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

/** (minQty, qtyUnit) as the API matches tiers; null while the quantity is not a number. */
function tierKey(t: { minQty: string; qtyUnit: QtyUnit }): string | null {
  const q = parseQty(t.minQty);
  return q === null ? null : `${q} ${t.qtyUnit}`;
}

/**
 * Every other size gets the source size's tier rows. Where that size already had a tier with the same
 * (minQty, qtyUnit), its price - with the unit and delivery that go with it - stays; every other row
 * comes with an empty price, and the size is marked as copied until its prices are filled in.
 */
export function copyTiersToOtherSizes(f: ProductFormState, from: number): ProductFormState {
  const source = f.sizes[from];
  if (!source) return f;
  return {
    ...f,
    sizes: f.sizes.map((s, i) => {
      if (i === from) return s;
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

/**
 * The errors the form shows: the API's (from the last preview or save) refined by what is typed now.
 * A quantity or price with text in it that is not a number is invalid, not missing, even before the
 * API answers; a missing field that has since been filled, and an error whose row is gone, drop out.
 */
export function formErrors(f: ProductFormState, server: ProductInputError[]): ProductInputError[] {
  const out: ProductInputError[] = [];
  const seen = new Set<string>();
  const push = (e: ProductInputError) => {
    const key = `${e.code}:${e.sizeIndex ?? ""}:${e.tierIndex ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };
  for (const e of server) {
    if (e.code === "name_required" && f.name.trim()) continue;
    if (e.code === "use_required" && f.use.trim()) continue;
    if (e.code === "no_sizes" && f.sizes.length > 0) continue;
    const size = e.sizeIndex === undefined ? undefined : f.sizes[e.sizeIndex];
    if (e.sizeIndex !== undefined && !size) continue;
    if (e.code === "size_required" && size?.size.trim()) continue;
    if (e.code === "no_tiers" && size && size.tiers.length > 0) continue;
    const row = e.tierIndex === undefined ? undefined : size?.tiers[e.tierIndex];
    if (e.tierIndex !== undefined && !row) continue;
    if (row && (e.code === "qty_missing" || e.code === "qty_invalid")) {
      if (!row.minQty.trim()) push({ ...e, code: "qty_missing" });
      else if (parseQty(row.minQty) === null) push({ ...e, code: "qty_invalid" });
      else if (e.code === "qty_invalid") push(e);
      continue;
    }
    if (row && (e.code === "price_missing" || e.code === "price_invalid")) {
      if (!row.price.trim()) push({ ...e, code: "price_missing" });
      else if (parseRupiah(row.price) === null) push({ ...e, code: "price_invalid" });
      else if (e.code === "price_invalid") push(e);
      continue;
    }
    push(e);
  }
  f.sizes.forEach((s, sizeIndex) =>
    s.tiers.forEach((t, tierIndex) => {
      if (t.minQty.trim() && parseQty(t.minQty) === null) push({ code: "qty_invalid", sizeIndex, tierIndex });
      if (t.price.trim() && parseRupiah(t.price) === null) push({ code: "price_invalid", sizeIndex, tierIndex });
    })
  );
  return out;
}

/** "30 x 30 cm" → "30 × 30 cm", as the designs write sizes. */
export function displaySize(size: string): string {
  return size.replace(/(\d)\s*[xX×]\s*(?=\d)/g, "$1 × ");
}

const ERROR_KEY: Record<ProductInputError["code"], TKey> = {
  name_required: "catalog.form.err.name_required",
  use_required: "catalog.form.err.use_required",
  no_sizes: "catalog.form.err.no_sizes",
  size_required: "catalog.form.err.size_required",
  duplicate_size: "catalog.form.err.duplicate_size",
  no_tiers: "catalog.form.err.no_tiers",
  qty_missing: "catalog.form.err.qty_missing",
  qty_invalid: "catalog.form.err.qty_invalid",
  price_missing: "catalog.form.err.price_missing",
  price_invalid: "catalog.form.err.price_invalid",
  duplicate_tier: "catalog.form.err.duplicate_tier",
  tier_order: "catalog.form.err.tier_order",
};

/** The message for one error, worded for the row it sits on. */
export function errorMessage(e: ProductInputError, f: ProductFormState, t: TFn, lang: Lang): string {
  const row = e.sizeIndex === undefined || e.tierIndex === undefined ? undefined : f.sizes[e.sizeIndex]?.tiers[e.tierIndex];
  const qty = row ? parseQty(row.minQty) : null;
  const vars = { qty: qty === null ? (row?.minQty.trim() ?? "") : formatNumber(qty, lang), unit: row?.qtyUnit ?? "" };
  if (e.code === "price_missing" && qty === null) return t("catalog.form.err.price_missingBare");
  if (e.code === "qty_invalid") return t(ERROR_KEY[e.code], { max: formatNumber(MAX_TIER_QTY, lang) });
  if (e.code === "price_invalid") return t(ERROR_KEY[e.code], { max: formatRupiah(MAX_TIER_PRICE_IDR) });
  return t(ERROR_KEY[e.code], vars);
}

/** How a draft size compares with the stored product: new (no stored size with its id), changed, or null. */
export function sizeChange(s: SizeRow, initial: ProductFormState): "new" | "changed" | null {
  const before = s.id ? initial.sizes.find((b) => b.id === s.id) : undefined;
  if (!before) return "new";
  const norm = (x: SizeRow) =>
    JSON.stringify({ size: x.size.trim(), tiers: toDraft({ ...initial, sizes: [x] }).sizes[0]!.tiers });
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
  switch (c.kind) {
    case "created":
      if (c.via === "form") return t("catalog.change.createdForm");
      return c.fileName ? t("catalog.change.createdImport", { file: c.fileName }) : t("catalog.change.createdImportBare");
    case "field": {
      if (c.field === "use" && c.from?.trim() && c.to?.startsWith(c.from) && c.to.length > c.from.length) {
        const added = c.to.slice(c.from.length).replace(/^[\s,;.]+/, "").trim();
        if (added) return t("catalog.change.useAdded", { added });
      }
      const show = (v: string | null) => {
        if (!v?.trim()) return "—";
        return c.field === "brand" && isBrandSlug(v) ? t(BRAND_TAG[v].labelKey) : v;
      };
      return t("catalog.change.field", { field: t(FIELD_KEY[c.field]), from: show(c.from), to: show(c.to) });
    }
    case "active":
      return t(c.to ? "catalog.change.activeOn" : "catalog.change.activeOff");
    case "size_added":
      return t("catalog.change.sizeAdded", { size: displaySize(c.size) });
    case "size_removed":
      return t("catalog.change.sizeRemoved", { size: displaySize(c.size) });
    case "size_renamed":
      return t("catalog.change.sizeRenamed", { from: displaySize(c.from), to: displaySize(c.to) });
    case "tier_added":
    case "tier_removed":
      return t(c.kind === "tier_added" ? "catalog.change.tierAdded" : "catalog.change.tierRemoved", {
        qty: qty(c.minQty),
        unit: c.qtyUnit,
        size: displaySize(c.size),
      });
    case "tier_price":
      return t("catalog.change.tierPrice", {
        size: displaySize(c.size),
        qty: qty(c.minQty),
        unit: c.qtyUnit,
        from: formatRupiah(c.from),
        to: formatRupiah(c.to),
        priceUnit: c.priceUnit,
      });
    case "delivery":
      return t(c.to ? "catalog.change.deliveryOn" : "catalog.change.deliveryOff", {
        size: displaySize(c.size),
        qty: qty(c.minQty),
        unit: c.qtyUnit,
      });
  }
}
