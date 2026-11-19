import { describe, expect, it } from "vitest";
import { id } from "@/lib/i18n/id";
import { EMPTY_INBOX_META, inboxQueryOf } from "@/lib/conversations/inboxQuery";
import { adoptIncomingNotes } from "@/lib/conversations/teamNotes";
import { nextKept, shownValue } from "@/lib/conversations/lastGood";
import {
  chatActions,
  chatStatus,
  listTime,
  nearestPriceLine,
  phoneLocal,
  previewLine,
  priceCallsOf,
  quickSendAllFailed,
  quickSendErrorKey,
  quickSendLines,
  rowStatus,
  sourceLabel,
  stampTime,
  toolLine,
} from "@/lib/conversations/labels";
import type { ConversationListRow, NearestMatch, PriceTier, PriceToolCall, QuickSendError } from "@/types/api";

const ROW = (over: Partial<ConversationListRow> = {}): ConversationListRow => ({
  id: "c1",
  contactId: "k1",
  phoneNumberId: "p1",
  status: "active",
  escalationReason: null,
  assignedAgent: null,
  handoffCategory: null,
  conversationSummary: null,
  followUpNotes: null,
  teamNotes: null,
  teamNotesUpdatedAt: null,
  teamNotesUpdatedBy: null,
  createdAt: "2026-11-17T01:00:00Z",
  updatedAt: "2026-11-17T01:00:00Z",
  unread: false,
  lastMessageAt: "2026-11-17T02:41:00Z",
  escalatedAt: null,
  customerName: "Andi",
  businessName: "Katering Contoh Sehat",
  brands: ["imperial_indopack"],
  lastMessage: { body: "Halo kak", role: "user", senderName: null },
  poFormSentAt: null,
  ...over,
});

const CALL = (over: Omit<Partial<PriceToolCall>, "input"> & { input?: Partial<PriceToolCall["input"]> } = {}): PriceToolCall => ({
  outcome: "quote",
  productId: "p1",
  productName: "Box Ivory",
  variantName: "22x22x7",
  gsm: null,
  quote: null,
  ...over,
  input: { product: "Box Ivory", size: "30x30", qty: 5000, unit: "pcs", ...over.input },
});

const RIM_TIER = (minQty: number, priceIdr: number, includesDelivery = false): PriceTier => ({
  minQty,
  qtyUnit: "rim",
  priceIdr,
  priceUnit: "rim",
  includesDelivery,
});

const QUOTE_CALL_12_RIM = CALL({
  outcome: "quote",
  productName: "Kertas Supreme 64 gsm",
  variantName: "30x30",
  input: { product: "Kertas Supreme 64 gsm", size: "30x30", qty: 12, unit: "rim" },
  quote: {
    kind: "quote",
    tier: RIM_TIER(10, 165000),
    qtyInPriceUnit: 12,
    unitPriceIdr: 165000,
    totalIdr: 1980000,
    includesDelivery: false,
    nextTier: RIM_TIER(20, 160000),
  },
});

const PCS_TIER: PriceTier = { minQty: 10, qtyUnit: "rim", priceIdr: 1500, priceUnit: "pcs", includesDelivery: true };

const MATCH = (over: Partial<NearestMatch> = {}): NearestMatch => ({
  item: { product: "Box Ivory", size: "22x22x7", qty: 5000, qty_unit: "pcs" },
  productId: "p1",
  productName: "Box Ivory 270 gsm full color",
  variantName: "21 x 14 x 5 cm",
  gsm: null,
  exact: false,
  quote: null,
  tier: PCS_TIER,
  ...over,
});

describe("rowStatus", () => {
  it("labels a team row with its category", () =>
    expect(rowStatus(ROW({ status: "escalated", handoffCategory: "harga_custom" }))).toEqual({
      key: "conversations.status.team",
      vars: { category: expect.any(String) },
    }));
  it("a sent PO form wins over AI", () =>
    expect(rowStatus(ROW({ status: "active", poFormSentAt: "2026-11-17T02:20:00Z" })).key).toBe("conversations.status.poSent"));
  it("names the category in the label", () => {
    expect(rowStatus(ROW({ status: "needs_human", handoffCategory: "desain_masuk" })).vars).toEqual({ category: "Desain masuk" });
    expect(rowStatus(ROW({ status: "escalated", handoffCategory: null })).vars).toEqual({ category: "Lainnya" });
  });
  it("a held chat stays a team row even after the PO form went", () =>
    expect(rowStatus(ROW({ status: "needs_human", handoffCategory: "minta_orang", poFormSentAt: "2026-11-17T02:20:00Z" })).key).toBe(
      "conversations.status.team"
    ));
  it("AI and resolved rows", () => {
    expect(rowStatus(ROW({ status: "active" })).key).toBe("conversations.status.ai");
    expect(rowStatus(ROW({ status: "resolved" })).key).toBe("conversations.status.resolved");
  });
});

describe("toolLine", () => {
  it("tool line for not_in_catalog", () =>
    expect(toolLine(CALL({ outcome: "not_in_catalog", input: { size: "22x22x7" } }), "id")).toBe("hitung_harga · 22×22×7 → tidak ada di katalog"));
  it("tool line for a quote", () =>
    expect(toolLine(QUOTE_CALL_12_RIM, "id")).toBe("hitung_harga · 30×30 · 12 rim → Rp 165.000/rim, total Rp 1.980.000"));
  it("tool lines for below the minimum and above the top tier", () => {
    expect(
      toolLine(CALL({ outcome: "below_minimum", input: { size: "30x30", qty: 2, unit: "rim" }, quote: { kind: "below_minimum", minimum: RIM_TIER(5, 170000) } }), "id")
    ).toBe("hitung_harga · 30×30 · 2 rim → di bawah minimum 5 rim");
    expect(
      toolLine(CALL({ outcome: "above_top_tier", input: { size: "30x30", qty: 900, unit: "rim" }, quote: { kind: "above_top_tier", top: RIM_TIER(100, 150000) } }), "id")
    ).toBe("hitung_harga · 30×30 · 900 rim → di atas tingkat teratas");
  });
  it("speaks English too", () => expect(toolLine(CALL({ outcome: "not_in_catalog", input: { size: "22x22x7" } }), "en")).toBe("hitung_harga · 22×22×7 → not in the catalog"));
});

describe("quick-send copy", () => {
  it("every quick-send error has copy", () =>
    ["NOT_FOUND", "BRAND_UNKNOWN", "NO_PRICE_LIST", "NO_REFERENCE_PHOTOS", "PO_FORM_PLACEHOLDER"].forEach((e) =>
      expect(id[quickSendErrorKey(e as QuickSendError)]).toBeTruthy()
    ));
  it("a failed call has copy", () => expect(id[quickSendErrorKey("FAILED")]).toBeTruthy());

  it("says per item whether it reached WhatsApp", () => {
    expect(
      quickSendLines({ kind: "price_list", brand: "kertas_supreme" }, [{ messageId: "m1", kind: "document", status: "sent" }], "id")
    ).toEqual(["Daftar harga Kertas Supreme terkirim"]);
    expect(
      quickSendLines(
        { kind: "reference_photos", productId: "p1" },
        [
          { messageId: "m1", kind: "image", status: "sent" },
          { messageId: "m2", kind: "image", status: "saved" },
        ],
        "id"
      )
    ).toEqual(["Foto 1 terkirim", "Foto 2 gagal terkirim"]);
    expect(quickSendLines({ kind: "po_form" }, [{ messageId: "m1", kind: "text", status: "saved" }], "id")).toEqual(["Form PO gagal terkirim"]);
  });

  it("all saved is a failure", () => {
    expect(quickSendAllFailed([{ messageId: "m1", kind: "image", status: "saved" }])).toBe(true);
    expect(
      quickSendAllFailed([
        { messageId: "m1", kind: "image", status: "saved" },
        { messageId: "m2", kind: "image", status: "sent" },
      ])
    ).toBe(false);
  });
});

describe("nearestPriceLine", () => {
  it("from the tier", () => expect(nearestPriceLine(MATCH(), "id")).toBe("Mulai 10 rim Rp 1.500/pcs, termasuk ongkir"));
  it("without delivery", () =>
    expect(nearestPriceLine(MATCH({ tier: { ...PCS_TIER, includesDelivery: false } }), "id")).toBe("Mulai 10 rim Rp 1.500/pcs, belum termasuk ongkir"));
  it("above the top tier", () =>
    expect(nearestPriceLine(MATCH({ quote: { kind: "above_top_tier", top: PCS_TIER } }), "id")).toBe("di atas tingkat teratas — harga khusus dari tim"));
  it("below the minimum", () =>
    expect(nearestPriceLine(MATCH({ quote: { kind: "below_minimum", minimum: PCS_TIER } }), "id")).toBe("di bawah minimum 10 rim"));
  it("no tier, no price", () => expect(nearestPriceLine(MATCH({ quote: { kind: "no_tiers" }, tier: null }), "id")).toBeNull());
});

describe("display helpers", () => {
  it("writes a WhatsApp number the local way", () => {
    expect(phoneLocal("6281200000012")).toBe("0812-0000-0012");
    expect(phoneLocal("+62 812-0000-0031")).toBe("0812-0000-0031");
    expect(phoneLocal("4479460000")).toBe("+4479460000");
  });

  it("prefixes the bot and staff in the preview", () => {
    expect(previewLine({ body: "Untuk pemesanannya...", role: "assistant", senderName: null }, "id")).toBe("Bot: Untuk pemesanannya...");
    expect(previewLine({ body: "Sedang kami hitungkan", role: "assistant", senderName: "Admin" }, "id")).toBe("Admin: Sedang kami hitungkan");
    expect(previewLine({ body: "Halo kak", role: "user", senderName: null }, "id")).toBe("Halo kak");
    expect(previewLine(null, "id")).toBe("");
  });

  it("the chat status pill", () => {
    expect(chatStatus("needs_human", "Admin")).toEqual({ key: "conversations.chat.statusHandled", vars: { agent: "Admin" }, tone: "team" });
    expect(chatStatus("needs_human", null).key).toBe("conversations.chat.statusTeam");
    expect(chatStatus("escalated", "Admin").key).toBe("conversations.chat.statusTeam");
    expect(chatStatus("active", null).key).toBe("conversations.chat.statusAi");
    expect(chatStatus("resolved", null).key).toBe("conversations.chat.statusResolved");
  });

  it("times in WIB: the clock today, the day otherwise", () => {
    const now = new Date("2026-11-17T10:00:00+07:00");
    expect(listTime("2026-11-17T09:41:00+07:00", now, "id")).toBe("09.41");
    expect(listTime("2026-11-15T09:41:00+07:00", now, "id")).toBe("15 Nov");
    expect(stampTime("2026-11-17T09:41:00+07:00", now, "id")).toBe("09.41");
    expect(stampTime("2026-11-15T09:41:00+07:00", now, "id")).toBe("15 Nov 09.41");
  });
});

describe("message metadata", () => {
  it("reads the price calls a bot reply carries, skipping anything malformed", () => {
    const good = CALL({ outcome: "not_in_catalog", input: { size: "22x22x7" } });
    expect(priceCallsOf({ priceCalls: [good, { outcome: "quote" }, null, "x"] })).toEqual([good]);
    expect(priceCallsOf({ priceCalls: "nope" })).toEqual([]);
    expect(priceCallsOf(null)).toEqual([]);
  });

  it("names what a bot or staff send was", () => {
    expect(sourceLabel({ source: "price_list", brand: "Kertas Supreme" }, "id")).toBe("daftar harga Kertas Supreme");
    expect(sourceLabel({ source: "reference_photo", productId: "p1" }, "id")).toBe("foto referensi");
    expect(sourceLabel({ source: "po_form" }, "id")).toBe("form PO");
    expect(sourceLabel({ source: "vision_recommend" }, "id")).toBeNull();
    expect(sourceLabel(undefined, "id")).toBeNull();
  });
});

describe("inbox query", () => {
  it("reads the view, search and page from the URL", () => {
    expect(inboxQueryOf({ view: "team", search: "  dewi ", page: "2" })).toEqual({ view: "team", search: "dewi", page: 2 });
    expect(inboxQueryOf({ view: "follow_up", page: "abc" })).toEqual({ view: null, search: "", page: 1 });
    expect(inboxQueryOf({ view: ["ai", "team"], page: "0" })).toEqual({ view: "ai", search: "", page: 1 });
  });
});

describe("chat actions per status", () => {
  it("an AI chat can be taken over or resolved, with the takeover hint", () =>
    expect(chatActions("active")).toEqual({ takeOver: true, returnToAi: false, resolve: true, takeoverHint: true }));
  it("an escalated chat (the bot still replies) can be taken over or returned to AI", () =>
    expect(chatActions("escalated")).toEqual({ takeOver: true, returnToAi: true, resolve: true, takeoverHint: true }));
  it("a chat staff hold can go back to AI", () =>
    expect(chatActions("needs_human")).toEqual({ takeOver: false, returnToAi: true, resolve: true, takeoverHint: false }));
  it("a resolved chat has no actions", () =>
    expect(chatActions("resolved")).toEqual({ takeOver: false, returnToAi: false, resolve: false, takeoverHint: false }));
});

describe("team notes from the poll", () => {
  const SAVED = { text: "cek plano", updatedAt: "2026-11-17T02:00:00.000Z", updatedBy: "Admin" };
  const NEWER = { text: "cek plano 79x109", updatedAt: "2026-11-17T02:05:00.000Z", updatedBy: "Rina" };

  it("takes a colleague's newer save when nothing local is unsaved", () => expect(adoptIncomingNotes("cek plano", SAVED, NEWER, false)).toEqual(NEWER));
  it("keeps local edits", () => expect(adoptIncomingNotes("cek plano, pot 1:6", SAVED, NEWER, false)).toBeNull());
  it("waits while a save is out", () => expect(adoptIncomingNotes("cek plano", SAVED, NEWER, true)).toBeNull());
  it("ignores a poll older than the last save", () =>
    expect(adoptIncomingNotes(NEWER.text, NEWER, SAVED, false)).toBeNull());
  it("ignores the same notes", () => expect(adoptIncomingNotes("cek plano", SAVED, { ...SAVED }, false)).toBeNull());
  it("takes the first notes ever written", () =>
    expect(adoptIncomingNotes("", { text: "", updatedAt: null, updatedBy: null }, NEWER, false)).toEqual(NEWER));
});

describe("keeping the last good poll", () => {
  it("a failed poll keeps the last value of the same conversation", () => {
    const kept = nextKept({ key: "c1", value: null as string | null }, "c1", "panel-1");
    expect(kept).toEqual({ key: "c1", value: "panel-1" });
    const afterFailure = nextKept(kept, "c1", null);
    expect(afterFailure).toBe(kept);
    expect(shownValue(afterFailure, "c1", null)).toBe("panel-1");
  });
  it("never shows another conversation's value", () => {
    const kept = { key: "c1", value: "panel-1" };
    expect(shownValue(kept, "c2", null)).toBeNull();
    expect(nextKept(kept, "c2", null)).toEqual({ key: "c2", value: null });
  });
  it("a fresh value always wins", () => expect(shownValue({ key: "c1", value: "old" }, "c1", "new")).toBe("new"));
  it("the empty list meta", () => expect(EMPTY_INBOX_META.counts).toEqual({ all: 0, team: 0, ai: 0, resolved: 0 }));
});
