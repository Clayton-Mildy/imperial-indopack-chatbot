"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandTags } from "@/components/BrandTag";
import { ReconnectingNote } from "@/components/conversations/ReconnectingNote";
import { useLastGood } from "@/lib/conversations/lastGood";
import { formatWait } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { CATEGORY_COPY, detailsBadge, visibleGroups } from "@/lib/teamQueue";
import type { TeamQueue, TeamQueueItem } from "@/types/api";

const MINUTE_MS = 60_000;
const GRID = "1.4fr 1fr 2.4fr 0.9fr 0.8fr 0.9fr";

function waitMinutes(iso: string, now: number): number {
  return Math.max(0, (now - new Date(iso).getTime()) / MINUTE_MS);
}

/**
 * Perlu Tim: the summary line, the tabs (Semua tim / Ditangani saya) and the groups. The queue
 * re-runs its server page every 5 seconds; a failed poll (queue null) keeps what is shown.
 */
export function TeamQueueClient({ queue, mine }: { queue: TeamQueue | null; mine: boolean }) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const shown = useLastGood(queue, mine ? "mine" : "all");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh();
      setNow(Date.now());
    }, 5000);
    return () => clearInterval(interval);
  }, [router]);

  const groups = shown ? visibleGroups(shown) : [];
  const filled = groups.filter((g) => g.items.length > 0);
  const empty = groups.filter((g) => g.items.length === 0);

  const tab = (active: boolean): React.CSSProperties => ({
    font: "inherit",
    fontSize: 12.5,
    fontWeight: active ? 600 : 500,
    height: 30,
    padding: "0 12px",
    border: 0,
    borderRadius: 6,
    background: active ? "#EAF2DD" : "transparent",
    color: active ? "#3E4C24" : "#3B4540",
    display: "inline-flex",
    alignItems: "center",
    textDecoration: "none",
  });

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      {!queue && <ReconnectingNote />}
      <div style={{ padding: "16px 32px 0", display: "flex", justifyContent: "flex-end" }}>
        <div role="tablist" aria-label={t("teamQueue.tabs")} style={{ display: "flex", gap: 4 }}>
          <Link role="tab" aria-selected={!mine} href="/team-queue" style={tab(!mine)}>
            {t("teamQueue.tab.all")}
          </Link>
          <Link role="tab" aria-selected={mine} href="/team-queue?mine=1" style={tab(mine)}>
            {t("teamQueue.tab.mine")}
          </Link>
        </div>
      </div>

      <main style={{ padding: "12px 32px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        {shown && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", fontSize: 13 }}>
            <span style={{ fontSize: 20, fontWeight: 700 }}>{t("teamQueue.waiting", { n: shown.waitingCount })}</span>
            {shown.oldestWaitingSince && (
              <span suppressHydrationWarning style={{ color: "#92400E", fontWeight: 600 }}>
                {t("teamQueue.oldest", { wait: formatWait(waitMinutes(shown.oldestWaitingSince, now), lang) })}
              </span>
            )}
            <span style={{ color: "#5F6B5A" }}>{t("teamQueue.reminder", { n: shown.reminderMinutes })}</span>
          </div>
        )}

        {filled.map((g) => (
          <section key={g.category} style={{ background: "#fff", border: "1px solid #E1E7DC", borderRadius: 8, overflow: "hidden" }}>
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid #EEF2EA",
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                gap: 8,
                alignItems: "baseline",
              }}
            >
              <b style={{ fontSize: 14 }}>
                {t(CATEGORY_COPY[g.category].title)} · {g.items.length}
              </b>
              <span style={{ fontSize: 12, color: "#5F6B5A" }}>{t(CATEGORY_COPY[g.category].desc)}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 860, fontSize: 13 }}>
                {g.items.map((item, i) => (
                  <QueueRow key={item.conversationId} item={item} now={now} last={i === g.items.length - 1} />
                ))}
              </div>
            </div>
          </section>
        ))}

        {empty.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            {empty.map((g) => (
              <div
                key={g.category}
                style={{
                  background: "#fff",
                  border: "1px solid #E1E7DC",
                  borderRadius: 8,
                  padding: "12px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 13,
                }}
              >
                <b>{t(CATEGORY_COPY[g.category].title)}</b>
                <span style={{ color: "#5F6B5A" }}>{t("teamQueue.none")}</span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function QueueRow({ item, now, last }: { item: TeamQueueItem; now: number; last: boolean }) {
  const t = useT();
  const lang = useLang();
  const complete = item.missing.length === 0;
  return (
    <Link
      href={`/conversations/${item.conversationId}`}
      style={{
        display: "grid",
        gridTemplateColumns: GRID,
        alignItems: "center",
        color: "#1F2421",
        textDecoration: "none",
        borderBottom: last ? "none" : "1px solid #EEF2EA",
      }}
    >
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <b>{item.customerName ?? t("teamQueue.noName")}</b>
        {item.businessName && <span style={{ fontSize: 11.5, color: "#5F6B5A" }}>{item.businessName}</span>}
      </div>
      <div style={{ padding: "12px 10px" }}>
        <BrandTags brands={item.brands} />
      </div>
      <div style={{ padding: "12px 10px", color: "#3B4540" }}>{item.itemsSummary || t("teamQueue.noItems")}</div>
      <div style={{ padding: "12px 10px", color: complete ? "#15803D" : "#92400E", fontWeight: 600 }}>{detailsBadge(item, t)}</div>
      <div suppressHydrationWarning style={{ padding: "12px 10px", color: "#92400E", fontWeight: 700 }}>
        {formatWait(waitMinutes(item.waitingSince, now), lang)}
      </div>
      <div style={{ padding: "12px 16px", color: item.assignedAgent ? "#3B4540" : "#5F6B5A" }}>
        {item.assignedAgent ?? t("teamQueue.unassigned")}
      </div>
    </Link>
  );
}
