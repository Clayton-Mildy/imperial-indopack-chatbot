"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandTags } from "@/components/BrandTag";
import { ReconnectingNote } from "@/components/conversations/ReconnectingNote";
import { useLastGood } from "@/lib/conversations/lastGood";
import { formatWait } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { CATEGORY_COPY, detailsBadge, queueTabs, resolveTab, tabItems, type QueueTabKey } from "@/lib/teamQueue";
import { useVisiblePoll } from "@/lib/visiblePoll";
import type { HandoffCategory, TeamQueue, TeamQueueItem } from "@/types/api";

const MINUTE_MS = 60_000;
const GRID = "1.4fr 1fr 2.4fr 0.9fr 0.8fr 0.9fr";

function waitMinutes(iso: string, now: number): number {
  return Math.max(0, (now - new Date(iso).getTime()) / MINUTE_MS);
}

/**
 * Perlu Tim: the summary line, the Semua tim / Ditangani saya toggle, the category tabs and the selected tab's chats. The queue
 * re-runs its server page every 5 seconds while the tab is visible (once more when it is shown
 * again); a failed poll (queue null) keeps what is shown.
 */
export function TeamQueueClient({ queue, mine, initialTab }: { queue: TeamQueue | null; mine: boolean; initialTab: string | null }) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const shown = useLastGood(queue, mine ? "mine" : "all");
  const [now, setNow] = useState(() => Date.now());

  useVisiblePoll(() => {
    router.refresh();
    setNow(Date.now());
  }, 5000);

  const [chosen, setChosen] = useState<string | null>(initialTab);
  const tabs = shown ? queueTabs(shown) : [];
  const active: QueueTabKey = shown ? resolveTab(shown, chosen) : "all";
  const rows = shown ? tabItems(shown, active) : [];

  function select(key: QueueTabKey, focus = false) {
    setChosen(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    window.history.replaceState(window.history.state, "", url);
    if (focus) document.getElementById(`tq-tab-${key}`)?.focus();
  }

  function onTabKey(e: React.KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const next = e.key === "ArrowRight" ? (index + 1) % tabs.length : e.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    select(tabs[next].key, true);
  }

  const toggleHref = (m: boolean) => {
    const qs = new URLSearchParams();
    if (m) qs.set("mine", "1");
    if (active !== "all") qs.set("tab", active);
    const q = qs.toString();
    return q ? `/team-queue?${q}` : "/team-queue";
  };

  const toggle = (on: boolean): React.CSSProperties => ({
    font: "inherit",
    fontSize: 12.5,
    fontWeight: on ? 600 : 500,
    height: 30,
    padding: "0 12px",
    border: 0,
    borderRadius: 6,
    background: on ? "#EAF2DD" : "transparent",
    color: on ? "#3E4C24" : "#3B4540",
    display: "inline-flex",
    alignItems: "center",
    textDecoration: "none",
  });

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      {!queue && <ReconnectingNote />}
      <div style={{ padding: "16px 32px 0", display: "flex", justifyContent: "flex-end" }}>
        <nav aria-label={t("teamQueue.tabs")} style={{ display: "flex", gap: 4 }}>
          <Link aria-current={!mine ? "page" : undefined} href={toggleHref(false)} style={toggle(!mine)}>
            {t("teamQueue.tab.all")}
          </Link>
          <Link aria-current={mine ? "page" : undefined} href={toggleHref(true)} style={toggle(mine)}>
            {t("teamQueue.tab.mine")}
          </Link>
        </nav>
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

        {shown && (
          <>
            <div style={{ overflowX: "auto", borderBottom: "1px solid #E2E8F0" }}>
              <div role="tablist" aria-label={t("teamQueue.cat.tabs")} style={{ display: "flex", minWidth: "max-content" }}>
                {tabs.map((tb, i) => {
                  const on = tb.key === active;
                  const label = tb.key === "all" ? t("teamQueue.cat.all") : t(CATEGORY_COPY[tb.key].title);
                  return (
                    <button
                      key={tb.key}
                      type="button"
                      role="tab"
                      id={`tq-tab-${tb.key}`}
                      aria-selected={on}
                      aria-controls="tq-panel"
                      tabIndex={on ? 0 : -1}
                      className="tq-tab"
                      onClick={() => select(tb.key)}
                      onKeyDown={(e) => onTabKey(e, i)}
                      style={{
                        font: "inherit",
                        padding: "8px 16px",
                        fontSize: 13,
                        fontWeight: on ? 600 : 500,
                        color: on ? "#3E4C24" : "#64748B",
                        background: "transparent",
                        border: "none",
                        borderBottom: on ? "2px solid #586B34" : "2px solid transparent",
                        cursor: "pointer",
                        marginBottom: -1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label} · <span style={{ opacity: tb.count === 0 ? 0.5 : 1 }}>{tb.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <style>{`.tq-tab:focus-visible{outline:2px solid #586B34;outline-offset:-2px;border-radius:4px}`}</style>

            <section
              role="tabpanel"
              id="tq-panel"
              aria-labelledby={`tq-tab-${active}`}
              tabIndex={0}
              style={{ background: "#fff", border: "1px solid #E1E7DC", borderRadius: 8, overflow: "hidden" }}
            >
              {active !== "all" && (
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #EEF2EA", fontSize: 12, color: "#5F6B5A" }}>
                  {t(CATEGORY_COPY[active].desc)}
                </div>
              )}
              {rows.length === 0 ? (
                <div style={{ padding: "12px 16px", fontSize: 13, color: "#5F6B5A" }}>{t("teamQueue.none")}</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <div style={{ minWidth: 860, fontSize: 13 }}>
                    {rows.map(({ category, item }, i) => (
                      <QueueRow
                        key={item.conversationId}
                        item={item}
                        now={now}
                        last={i === rows.length - 1}
                        category={active === "all" ? category : undefined}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function QueueRow({ item, now, last, category }: { item: TeamQueueItem; now: number; last: boolean; category?: HandoffCategory }) {
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
        {category && <span style={{ fontSize: 11, fontWeight: 600, color: "#3E4C24" }}>{t(CATEGORY_COPY[category].title)}</span>}
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
