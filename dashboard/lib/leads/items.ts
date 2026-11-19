import { formatNumber, translate, type Lang } from "@/lib/i18n/core";
import type { OrderItem } from "@/types/api";

/** '30 x 30 cm' -> '30×30 cm': an 'x' between digits shows as '×'; an x inside a word stays. */
export function sizeText(size: string): string {
  return size.trim().replace(/(\d)\s*x\s*(?=\d)/gi, "$1×");
}

/**
 * 'Supreme 64 gsm 30×30 · 12 rim'. Without a quantity: 'Box ivory 21×14×5 · jumlah belum ada'.
 * An 'x' between digits in a size shows as '×'.
 */
export function itemLine(item: OrderItem, lang: Lang): string {
  const size = item.size ? sizeText(item.size) : undefined;
  const name = [item.product?.trim(), size].filter(Boolean).join(" ");
  const qty =
    item.qty !== undefined && item.qty > 0
      ? `${formatNumber(item.qty, lang)} ${item.qty_unit ?? "pcs"}`
      : translate(lang, "leads.item.noQty");
  return `${name} · ${qty}`;
}
