import { formatRupiah } from "@/lib/i18n/core";
import type { OrderItem, QuotedPrice } from "@/types/api";

/** The API's limits on one item's text (PatchLeadBodySchema's OrderItemSchema). */
export const MAX_PRODUCT = 200;
export const MAX_SIZE = 100;

/**
 * One editable line of "Barang yang diminta": every field as typed, so a half-typed row keeps its
 * text. `noUnit` and `stored` are hidden: a row opened from a stored item carries it, so a field
 * staff leave alone goes back exactly as stored (gsm, print and qty_unit included).
 */
export interface ItemRow {
  product: string;
  size: string;
  qty: string;
  qtyUnit: "rim" | "pcs";
  design: "" | "yes" | "no";
  /** No unit chosen: the Satuan select shows "—" and the item is saved without one; `qtyUnit` is then ignored. */
  noUnit?: boolean;
  /** The stored item this row was opened from; absent on a row staff added. */
  stored?: OrderItem;
}

export interface RowProblem {
  /** Index into the rows passed in. */
  row: number;
  field: "product" | "size";
}

/** The product already states this gsm: '64 gsm' / '64gsm', not merely the digits ('Box 640' does not state 64 gsm). */
function statesGsm(product: string, gsm: string): boolean {
  const escaped = gsm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9])${escaped}\\s*gsm`, "i").test(product);
}

/**
 * The product as the item is shown: 'Kertas Supreme 64 gsm cetak 1 warna'. A gsm the product name
 * already states is not repeated.
 */
export function productText(item: OrderItem): string {
  const product = item.product?.trim() ?? "";
  const gsm = item.gsm?.trim().replace(/\s*gsm$/i, "");
  const withGsm = gsm && !statesGsm(product, gsm) ? `${product} ${gsm} gsm` : product;
  const print = item.print?.trim();
  return [withGsm.trim(), print ? `cetak ${print}` : ""].filter(Boolean).join(" ");
}

/** 2500 -> '2.500', 2.5 -> '2,5': the Indonesian way, which is how staff type it back. */
function qtyText(qty: number): string {
  const [whole, fraction] = String(qty).split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return fraction ? `${grouped},${fraction}` : grouped;
}

/** '2.500' is two thousand five hundred (dots group thousands), '2,5' is 2.5; anything else that is not a positive number is no quantity. */
function parseQty(typed: string): number | undefined {
  const t = typed.replace(/\s/g, "");
  if (!t) return undefined;
  const n = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The visible fields of the row a stored item opens as. */
function openedRow(item: OrderItem): Omit<ItemRow, "stored"> {
  return {
    product: productText(item),
    size: item.size?.trim() ?? "",
    qty: item.qty !== undefined && item.qty > 0 ? qtyText(item.qty) : "",
    qtyUnit: item.qty_unit ?? "pcs",
    noUnit: !item.qty_unit,
    design: item.has_design === true ? "yes" : item.has_design === false ? "no" : "",
  };
}

/** The edit rows for the stored items. Each carries its stored item. */
export function fromItems(items: OrderItem[]): ItemRow[] {
  return items.map((item) => ({ ...openedRow(item), stored: { ...item } }));
}

const unitOf = (r: Pick<ItemRow, "qtyUnit" | "noUnit">): "rim" | "pcs" | undefined => (r.noUnit ? undefined : r.qtyUnit);

/**
 * The item one row saves as; null for a row with nothing in it. Field by field, a field left as it
 * opened is the stored value, untouched. An edited product text replaces product, gsm and print (it
 * showed all three); an edited unit is whatever staff picked.
 */
function rowItem(row: ItemRow): OrderItem | null {
  const s = row.stored;
  const o = s ? openedRow(s) : undefined;
  const same = {
    product: o !== undefined && row.product === o.product,
    size: o !== undefined && row.size === o.size,
    qty: o !== undefined && row.qty === o.qty,
    unit: o !== undefined && unitOf(row) === unitOf(o),
    design: o !== undefined && row.design === o.design,
  };
  if (s && same.product && same.size && same.qty && same.unit && same.design) return { ...s };
  if (!row.product.trim() && !row.size.trim() && !row.qty.trim() && row.design === "") return null;

  const item: OrderItem = {};
  if (s && same.product) {
    if (s.product !== undefined) item.product = s.product;
    if (s.gsm !== undefined) item.gsm = s.gsm;
    if (s.print !== undefined) item.print = s.print;
  } else if (row.product.trim()) {
    item.product = row.product.trim();
  }
  if (s && same.size) {
    if (s.size !== undefined) item.size = s.size;
  } else if (row.size.trim()) {
    item.size = row.size.trim();
  }
  const qty = s && same.qty ? s.qty : parseQty(row.qty);
  if (qty !== undefined) item.qty = qty;
  const unit = s && same.unit ? s.qty_unit : unitOf(row);
  if (unit !== undefined) item.qty_unit = unit;
  if (s && same.design) {
    if (s.has_design !== undefined) item.has_design = s.has_design;
  } else if (row.design !== "") {
    item.has_design = row.design === "yes";
  }
  return Object.keys(item).length > 0 ? item : null;
}

/**
 * The PATCH `items`: empty rows dropped, typed text trimmed, a blank field left out. A row opened
 * from a stored item and left alone is that item, exactly.
 */
export function toItemsPayload(rows: ItemRow[]): OrderItem[] {
  return rows.map(rowItem).filter((i): i is OrderItem => i !== null);
}

/** Rows whose saved text the API would refuse as too long; the product counts as it will be sent (an edited one includes the folded gsm and print). */
export function rowProblems(rows: ItemRow[]): RowProblem[] {
  const out: RowProblem[] = [];
  rows.forEach((row, i) => {
    const item = rowItem(row);
    if ((item?.product?.length ?? 0) > MAX_PRODUCT) out.push({ row: i, field: "product" });
    if ((item?.size?.length ?? 0) > MAX_SIZE) out.push({ row: i, field: "size" });
  });
  return out;
}

/** 'Rp 165.000/rim'; '—' when the bot quoted no price for the item. */
export function quotedPriceText(q: QuotedPrice | null | undefined): string {
  return q ? `${formatRupiah(q.unitPriceIdr)}/${q.priceUnit}` : "—";
}
