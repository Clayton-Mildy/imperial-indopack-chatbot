import { BRAND_TAG, isBrandSlug } from "@/lib/brands";
import { wibDay } from "@/lib/format";
import { formatDate, formatNumber, translate, type Lang, type TKey, type TVars } from "@/lib/i18n/core";
import { sizeText } from "@/lib/leads/items";
import type {
  ConversationListRow,
  ConversationStatus,
  HandoffCategory,
  NearestMatch,
  PriceTier,
  PriceToolCall,
  QuickSendAction,
  QuickSendError,
  QuickSendItem,
} from "@/types/api";

// Pure copy helpers for the Percakapan screen (inbox list, chat, order panel). Client-safe.

/** The hand-off category labels, mirroring api/src/domain/handoff.ts HANDOFF_LABEL. */
export const HANDOFF_KEY: Record<HandoffCategory, TKey> = {
  harga_custom: "handoff.harga_custom",
  desain_masuk: "handoff.desain_masuk",
  pesanan_besar: "handoff.pesanan_besar",
  minta_orang: "handoff.minta_orang",
  komplain: "handoff.komplain",
  bukan_pembeli: "handoff.bukan_pembeli",
  lainnya: "handoff.lainnya",
};

const isHeld = (status: ConversationStatus): boolean => status === "escalated" || status === "needs_human";

/**
 * The status line under an inbox row. A held chat names its hand-off category in `lang` (none stored
 * reads Lainnya); otherwise a sent PO form wins over the AI / resolved state.
 */
export function rowStatus(r: ConversationListRow, lang: Lang = "id"): { key: TKey; vars?: TVars } {
  if (isHeld(r.status)) {
    return { key: "conversations.status.team", vars: { category: translate(lang, HANDOFF_KEY[r.handoffCategory ?? "lainnya"]) } };
  }
  if (r.poFormSentAt) return { key: "conversations.status.poSent" };
  if (r.status === "active") return { key: "conversations.status.ai" };
  return { key: "conversations.status.resolved" };
}

/** Rupiah digits the Indonesian way, whatever the dashboard language: 1980000 -> '1.980.000'. */
const rupiahDigits = (n: number): string => formatNumber(Math.round(n), "id");

/** '10 rim', '5.000 pcs': a tier's threshold. */
const tierQty = (t: PriceTier, lang: Lang): string => `${formatNumber(t.minQty, lang)} ${t.qtyUnit}`;

/**
 * The line shown before a bot reply that ran hitung_harga:
 * 'hitung_harga · 22×22×7 → tidak ada di katalog' (no quantity: the size is the point) or
 * 'hitung_harga · 30×30 · 12 rim → Rp 165.000/rim, total Rp 1.980.000'.
 */
export function toolLine(c: PriceToolCall, lang: Lang): string {
  const size = sizeText(c.input.size ?? "");
  const qty = Number.isFinite(c.input.qty) ? `${formatNumber(c.input.qty, lang)} ${c.input.unit ?? ""}`.trim() : "";
  const q = c.quote;
  let what: string[];
  let result: string;
  if (c.outcome === "quote" && q?.kind === "quote") {
    what = [size, qty];
    result = translate(lang, "conversations.tool.quote", {
      price: rupiahDigits(q.unitPriceIdr),
      unit: q.tier.priceUnit,
      total: rupiahDigits(q.totalIdr),
    });
  } else if (c.outcome === "below_minimum") {
    what = [size, qty];
    result =
      q?.kind === "below_minimum"
        ? translate(lang, "conversations.tool.belowMin", { min: tierQty(q.minimum, lang) })
        : translate(lang, "conversations.tool.belowMinPlain");
  } else if (c.outcome === "above_top_tier") {
    what = [size, qty];
    result = translate(lang, "conversations.tool.aboveTop");
  } else {
    what = [size];
    result = translate(lang, "conversations.tool.notInCatalog");
  }
  return ["hitung_harga", ...what.filter(Boolean)].join(" · ") + ` → ${result}`;
}

const QUICK_SEND_ERROR_KEY: Record<QuickSendError | "FAILED", TKey> = {
  NOT_FOUND: "conversations.quick.err.NOT_FOUND",
  BRAND_UNKNOWN: "conversations.quick.err.BRAND_UNKNOWN",
  NO_PRICE_LIST: "conversations.quick.err.NO_PRICE_LIST",
  NO_REFERENCE_PHOTOS: "conversations.quick.err.NO_REFERENCE_PHOTOS",
  PO_FORM_PLACEHOLDER: "conversations.quick.err.PO_FORM_PLACEHOLDER",
  FAILED: "conversations.quick.err.FAILED",
};

export function quickSendErrorKey(e: QuickSendError | "FAILED"): TKey {
  return QUICK_SEND_ERROR_KEY[e] ?? QUICK_SEND_ERROR_KEY.FAILED;
}

/** One line per item sent: 'Daftar harga Kertas Supreme terkirim', 'Foto 2 gagal terkirim', 'Form PO terkirim'. */
export function quickSendLines(action: QuickSendAction, sent: QuickSendItem[], lang: Lang): string[] {
  return sent.map((item, i) => {
    const label =
      action.kind === "price_list"
        ? translate(lang, "conversations.quick.item.priceList", {
            brand: action.brand && isBrandSlug(action.brand) ? translate(lang, BRAND_TAG[action.brand].labelKey) : "",
          }).trim()
        : action.kind === "reference_photos"
          ? translate(lang, "conversations.quick.item.photo", { n: i + 1 })
          : translate(lang, "conversations.quick.item.poForm");
    return translate(lang, item.status === "sent" ? "conversations.quick.itemSent" : "conversations.quick.itemFailed", { item: label });
  });
}

/** Every item was stored but refused by the provider: nothing reached the customer. */
export function quickSendAllFailed(sent: QuickSendItem[]): boolean {
  return sent.length > 0 && sent.every((s) => s.status === "saved");
}

/**
 * The price under a nearest catalog match: above the top tier the team prices it; below the minimum
 * it names the minimum; otherwise 'Mulai 10 rim Rp 1.500/pcs, termasuk ongkir' from the match's tier.
 * null when the size has no tiers at all.
 */
export function nearestPriceLine(m: NearestMatch, lang: Lang): string | null {
  if (m.quote?.kind === "above_top_tier") return translate(lang, "conversations.panel.aboveTop");
  if (m.quote?.kind === "below_minimum") return translate(lang, "conversations.panel.belowMin", { min: tierQty(m.quote.minimum, lang) });
  if (!m.tier) return null;
  return translate(lang, "conversations.panel.priceFrom", {
    tier: tierQty(m.tier, lang),
    price: rupiahDigits(m.tier.priceIdr),
    unit: m.tier.priceUnit,
    delivery: translate(lang, m.tier.includesDelivery ? "conversations.panel.withDelivery" : "conversations.panel.withoutDelivery"),
  });
}

/** '6281200000012' -> '0812-0000-0012', the way the team writes Indonesian numbers; others get a '+'. */
export function phoneLocal(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length >= 10) {
    const local = `0${digits.slice(2)}`;
    return [local.slice(0, 4), local.slice(4, 8), local.slice(8)].filter(Boolean).join("-");
  }
  return `+${digits}`;
}

/** The inbox preview: 'Bot: …' for the bot, '{name}: …' for staff, the customer's line as it is. */
export function previewLine(m: ConversationListRow["lastMessage"], lang: Lang): string {
  if (!m) return "";
  if (m.role !== "assistant") return m.body;
  return m.senderName
    ? translate(lang, "conversations.row.staff", { name: m.senderName, body: m.body })
    : translate(lang, "conversations.row.bot", { body: m.body });
}

/**
 * The chat's action buttons. The bot keeps replying while a chat is `escalated`, so it can be taken
 * over (and replying takes it over: the hint) as well as handed back; a chat staff hold can only go
 * back to AI; a resolved chat has none.
 */
export function chatActions(status: ConversationStatus): { takeOver: boolean; returnToAi: boolean; resolve: boolean; takeoverHint: boolean } {
  if (status === "resolved") return { takeOver: false, returnToAi: false, resolve: false, takeoverHint: false };
  const staffHold = status === "needs_human";
  return { takeOver: !staffHold, returnToAi: isHeld(status), resolve: true, takeoverHint: !staffHold };
}

export type StatusTone = "team" | "ai" | "resolved";

/** The chat header's pill: who holds the chat now. */
export function chatStatus(status: ConversationStatus, assignedAgent: string | null): { key: TKey; vars?: TVars; tone: StatusTone } {
  if (status === "needs_human" && assignedAgent) return { key: "conversations.chat.statusHandled", vars: { agent: assignedAgent }, tone: "team" };
  if (isHeld(status)) return { key: "conversations.chat.statusTeam", tone: "team" };
  if (status === "active") return { key: "conversations.chat.statusAi", tone: "ai" };
  return { key: "conversations.chat.statusResolved", tone: "resolved" };
}

const CLOCK: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
const DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

/** An inbox row's time in WIB: '09.41' today, '15 Nov' before. */
export function listTime(iso: string, now: Date, lang: Lang): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return formatDate(iso, lang, wibDay(t) === wibDay(now.getTime()) ? CLOCK : DAY);
}

/** A moment in WIB with its day when it is not today: '09.41', '15 Nov 09.41'. */
export function stampTime(iso: string, now: Date, lang: Lang): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const clock = formatDate(iso, lang, CLOCK);
  return wibDay(t) === wibDay(now.getTime()) ? clock : `${formatDate(iso, lang, DAY)} ${clock}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The hitung_harga calls on a bot reply row (`metadata.priceCalls`), keeping only well-formed ones. */
export function priceCallsOf(metadata: Record<string, unknown> | null | undefined): PriceToolCall[] {
  const calls = metadata?.priceCalls;
  if (!Array.isArray(calls)) return [];
  return calls.filter(
    (c): c is PriceToolCall => isRecord(c) && typeof c.outcome === "string" && isRecord(c.input) && typeof c.input.size === "string"
  );
}

/** What a sent file or fixed line was (`metadata.source`): 'daftar harga Kertas Supreme', 'foto referensi', 'form PO'. */
export function sourceLabel(metadata: Record<string, unknown> | null | undefined, lang: Lang): string | null {
  switch (metadata?.source) {
    case "price_list":
      return translate(lang, "conversations.chat.source.priceList", {
        brand: typeof metadata.brand === "string" ? metadata.brand : "",
      }).trim();
    case "reference_photo":
      return translate(lang, "conversations.chat.source.referencePhoto");
    case "po_form":
      return translate(lang, "conversations.chat.source.poForm");
    default:
      return null;
  }
}
