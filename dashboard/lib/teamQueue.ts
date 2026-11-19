import type { TFn, TKey } from "@/lib/i18n/core";
import type { HandoffCategory, OrderDetailKey, TeamQueue, TeamQueueItem } from "@/types/api";

/** The groups Perlu Tim always shows, in the designed order; the other two appear only when non-empty. */
export const DESIGNED_GROUPS: HandoffCategory[] = ["harga_custom", "desain_masuk", "pesanan_besar", "minta_orang", "komplain"];

export function visibleGroups(q: TeamQueue): TeamQueue["groups"] {
  return q.groups.filter((g) => DESIGNED_GROUPS.includes(g.category) || g.items.length > 0);
}

const MISSING_KEY: Record<OrderDetailKey, TKey> = {
  name: "teamQueue.missing.name",
  business_name: "teamQueue.missing.business_name",
  model: "teamQueue.missing.model",
  size: "teamQueue.missing.size",
  qty: "teamQueue.missing.qty",
  design: "teamQueue.missing.design",
};

/** '6/6 detail', or '5/6 · desain?' naming the first detail still missing. */
export function detailsBadge(i: TeamQueueItem, t: TFn): string {
  const first = i.missing[0];
  if (!first) return t("teamQueue.details", { n: i.detailsFilled });
  return t("teamQueue.detailsMissing", { n: i.detailsFilled, key: t(MISSING_KEY[first]) });
}

export const CATEGORY_COPY: Record<HandoffCategory, { title: TKey; desc: TKey }> = {
  harga_custom: { title: "handoff.harga_custom", desc: "teamQueue.desc.harga_custom" },
  desain_masuk: { title: "handoff.desain_masuk", desc: "teamQueue.desc.desain_masuk" },
  pesanan_besar: { title: "handoff.pesanan_besar", desc: "teamQueue.desc.pesanan_besar" },
  minta_orang: { title: "handoff.minta_orang", desc: "teamQueue.desc.minta_orang" },
  komplain: { title: "handoff.komplain", desc: "teamQueue.desc.komplain" },
  bukan_pembeli: { title: "handoff.bukan_pembeli", desc: "teamQueue.desc.bukan_pembeli" },
  lainnya: { title: "handoff.lainnya", desc: "teamQueue.desc.lainnya" },
};
