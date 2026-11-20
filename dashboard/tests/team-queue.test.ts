import { describe, expect, it } from "vitest";
import { CATEGORY_COPY, DESIGNED_GROUPS, defaultTab, detailsBadge, queueTabs, resolveTab, tabItems, visibleGroups } from "@/lib/teamQueue";
import { id } from "@/lib/i18n/id";
import { makeT } from "@/lib/i18n/core";
import type { HandoffCategory, TeamQueue, TeamQueueItem } from "@/types/api";

const T_ID = makeT("id");
const ALL: HandoffCategory[] = ["harga_custom", "desain_masuk", "pesanan_besar", "minta_orang", "komplain", "bukan_pembeli", "lainnya"];

function ITEM(over: Partial<TeamQueueItem> = {}): TeamQueueItem {
  return {
    conversationId: "c1",
    customerName: "Contoh Andi",
    businessName: "Katering Contoh",
    waId: "6281200007001",
    brands: ["kertas_supreme"],
    itemsSummary: "Supreme 64 gsm",
    detailsFilled: 6,
    missing: [],
    waitingSince: "2026-11-19T01:00:00.000Z",
    assignedAgent: null,
    status: "escalated",
    ...over,
  };
}

function queue(filled: Partial<Record<HandoffCategory, TeamQueueItem[]>>): TeamQueue {
  return {
    waitingCount: 1,
    oldestWaitingSince: null,
    reminderMinutes: 30,
    groups: ALL.map((category) => ({ category, items: filled[category] ?? [] })),
  };
}

describe("team queue", () => {
  it("always shows the five designed groups, others only when non-empty", () => {
    expect(visibleGroups(queue({ lainnya: [ITEM()] })).map((g) => g.category)).toEqual([...DESIGNED_GROUPS, "lainnya"]);
    expect(visibleGroups(queue({})).map((g) => g.category)).toEqual(DESIGNED_GROUPS);
  });

  it("details badge", () => {
    expect(detailsBadge(ITEM({ detailsFilled: 6, missing: [] }), T_ID)).toBe("6/6 detail");
    expect(detailsBadge(ITEM({ detailsFilled: 5, missing: ["design"] }), T_ID)).toBe("5/6 · desain?");
  });

  it("every category has a title and description key that exist", () => {
    for (const c of ALL) {
      expect(CATEGORY_COPY[c].title in id).toBe(true);
      expect(CATEGORY_COPY[c].desc in id).toBe(true);
    }
  });
});

describe("team queue tabs", () => {
  it("tabs: Semua first with the total, then the visible groups with counts", () => {
    const q = queue({ harga_custom: [ITEM({ conversationId: "a" }), ITEM({ conversationId: "b" })], komplain: [ITEM({ conversationId: "c" })] });
    expect(queueTabs(q).map((t) => [t.key, t.count])).toEqual([
      ["all", 3], ["harga_custom", 2], ["desain_masuk", 0], ["pesanan_besar", 0], ["minta_orang", 0], ["komplain", 1],
    ]);
  });

  it("default is Semua, also when empty; unknown or vanished tabs fall back to it", () => {
    expect(defaultTab(queue({}))).toBe("all");
    expect(resolveTab(queue({}), "komplain")).toBe("komplain");
    expect(resolveTab(queue({}), "lainnya")).toBe("all");
    expect(resolveTab(queue({}), "bogus")).toBe("all");
    expect(resolveTab(queue({}), null)).toBe("all");
  });

  it("Semua lists every chat oldest first, tagged with its category", () => {
    const q = queue({
      komplain: [ITEM({ conversationId: "new", waitingSince: "2026-11-19T03:00:00.000Z" })],
      harga_custom: [ITEM({ conversationId: "old", waitingSince: "2026-11-19T01:00:00.000Z" })],
    });
    expect(tabItems(q, "all").map((r) => [r.item.conversationId, r.category])).toEqual([["old", "harga_custom"], ["new", "komplain"]]);
    expect(tabItems(q, "komplain").map((r) => r.item.conversationId)).toEqual(["new"]);
    expect(tabItems(queue({}), "all")).toEqual([]);
  });

  it("new tab label keys exist", () => {
    expect("teamQueue.cat.all" in id).toBe(true);
  });
});
