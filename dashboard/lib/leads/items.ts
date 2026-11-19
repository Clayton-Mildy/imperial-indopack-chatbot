import { formatNumber, translate, type Lang } from "@/lib/i18n/core";
import type { OrderItem } from "@/types/api";

/** '30 x 30 cm' -> '30×30 cm': an 'x' between digits shows as '×'; an x inside a word stays. */
export function sizeText(size: string): string {
  return size.trim().replace(/(\d)\s*x\s*(?=\d)/gi, "$1×");
}

/** '300', '300gsm' and '300 GSM' all read '300 gsm'; other text stays as typed. */
function gsmText(gsm: string | undefined): string {
  const raw = gsm?.trim().replace(/\s+/g, " ");
  if (!raw) return "";
  const m = /^(\d+(?:[.,]\d+)?)\s*(?:gsm)?$/i.exec(raw);
  return m ? `${m[1]!.replace(",", ".")} gsm` : raw;
}

/** The gramasi after the name, unless the name already says it (old items carry it in the product name). */
function gsmAfterName(product: string | undefined, gsm: string | undefined): string {
  const g = gsmText(gsm);
  if (!g) return "";
  const name = (product ?? "").toLowerCase().replace(/(\d)\s*gsm/g, "$1 gsm");
  return name.includes(g.toLowerCase()) ? "" : g;
}

/**
 * 'Supreme 64 gsm 30×30 · 12 rim'. With a gramasi: 'Box Contoh 20×20×7 · 300 gsm · 2.500 pcs'.
 * Without a quantity: 'Box ivory 21×14×5 · jumlah belum ada'. An 'x' between digits in a size shows as '×'.
 */
export function itemLine(item: OrderItem, lang: Lang): string {
  const size = item.size ? sizeText(item.size) : undefined;
  const name = [item.product?.trim(), size].filter(Boolean).join(" ");
  const qty =
    item.qty !== undefined && item.qty > 0
      ? `${formatNumber(item.qty, lang)} ${item.qty_unit ?? "pcs"}`
      : translate(lang, "leads.item.noQty");
  return [name, gsmAfterName(item.product, item.gsm), qty].filter(Boolean).join(" · ");
}
