import { formatRupiah } from "@/lib/i18n/core";
import type { OrderItem, QuotedPrice } from "@/types/api";

/** One editable line of "Barang yang diminta": every field as typed, so a half-typed row keeps its text. */
export interface ItemRow {
  product: string;
  size: string;
  qty: string;
  qtyUnit: "rim" | "pcs";
  design: "" | "yes" | "no";
}

/**
 * The product as the item is shown: 'Kertas Supreme 64 gsm cetak 1 warna'. A gsm the product name
 * already says is not repeated (the API's hand-off line does the same).
 */
export function productText(item: OrderItem): string {
  const product = item.product?.trim() ?? "";
  const gsm = item.gsm?.trim().replace(/\s*gsm$/i, "");
  const withGsm = gsm && !product.toLowerCase().includes(gsm.toLowerCase()) ? `${product} ${gsm} gsm` : product;
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

/** The edit rows for the stored items. A stored gsm/print joins the product text, the field staff edit. */
export function fromItems(items: OrderItem[]): ItemRow[] {
  return items.map((item) => ({
    product: productText(item),
    size: item.size?.trim() ?? "",
    qty: item.qty !== undefined && item.qty > 0 ? qtyText(item.qty) : "",
    // A quantity stored without a unit has always been shown as pcs.
    qtyUnit: item.qty_unit ?? "pcs",
    design: item.has_design === true ? "yes" : item.has_design === false ? "no" : "",
  }));
}

/**
 * The PATCH `items`: empty rows dropped, text trimmed, a blank field left out. The unit goes
 * with a quantity only: on its own it says nothing.
 */
export function toItemsPayload(rows: ItemRow[]): OrderItem[] {
  const out: OrderItem[] = [];
  for (const row of rows) {
    const product = row.product.trim();
    const size = row.size.trim();
    const qty = parseQty(row.qty);
    const item: OrderItem = {};
    if (product) item.product = product;
    if (size) item.size = size;
    if (qty !== undefined) {
      item.qty = qty;
      item.qty_unit = row.qtyUnit;
    }
    if (row.design !== "") item.has_design = row.design === "yes";
    // Nothing usable in the row (blank, or only an unreadable quantity): no item.
    if (Object.keys(item).length > 0) out.push(item);
  }
  return out;
}

/** 'Rp 165.000/rim'; '—' when the bot quoted no price for the item. */
export function quotedPriceText(q: QuotedPrice | null | undefined): string {
  return q ? `${formatRupiah(q.unitPriceIdr)}/${q.priceUnit}` : "—";
}
