import { describe, expect, it } from "vitest";
import { CATEGORY_COPY, DESIGNED_GROUPS, detailsBadge, visibleGroups } from "@/lib/teamQueue";
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
    waId: "628120000070 01",
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
