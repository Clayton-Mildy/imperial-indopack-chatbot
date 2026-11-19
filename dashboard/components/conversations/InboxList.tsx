"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrandTags } from "@/components/BrandTag";
import { listTime, phoneLocal, previewLine, rowStatus } from "@/lib/conversations/labels";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import type { ConversationListMeta, ConversationListRow, ConversationView } from "@/types/api";

/** The list's place in the URL, kept when a row or a tab is opened so the list stays as it was. */
export interface InboxQuery {
  view: ConversationView | null;
  search: string;
  page: number;
}

export function inboxHref(path: string, q: InboxQuery): string {
  const qs = new URLSearchParams();
  if (q.view) qs.set("view", q.view);
  if (q.search.trim()) qs.set("search", q.search.trim());
  if (q.page > 1) qs.set("page", String(q.page));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

const STATUS_TONE: Record<string, { background: string; color: string }> = {
  "conversations.status.team": { background: "#FEF3C7", color: "#92400E" },
  "conversations.status.poSent": { background: "#DCFCE7", color: "#15803D" },
  "conversations.status.ai": { background: "#F1F5F1", color: "#3B4540" },
  "conversations.status.resolved": { background: "#F1F5F1", color: "#5F6B5A" },
};

const pageBtn: React.CSSProperties = {
  font: "inherit",
  fontSize: 12,
  fontWeight: 500,
  height: 28,
  padding: "0 10px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#ffffff",
  color: "#3B4540",
  cursor: "pointer",
};

/**
 * The left column of Percakapan: search, the view tabs (Semua / Perlu Tim · n / AI / Selesai) and the
 * rows. Every control changes the URL; the server page reads it back and fetches the page.
 */
export function InboxList({
  rows,
  meta,
  query,
  selectedId,
}: {
  rows: ConversationListRow[];
  meta: ConversationListMeta;
  query: InboxQuery;
  selectedId: string | null;
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const [searchInput, setSearchInput] = useState(query.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const basePath = selectedId ? `/conversations/${selectedId}` : "/conversations";
  const now = new Date();

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      router.replace(inboxHref(basePath, { view: query.view, search: value, page: 1 }));
    }, 300);
  }

  const tabs: { view: ConversationView | null; label: string; tone?: string }[] = [
    { view: null, label: t("conversations.tab.all") },
    { view: "team", label: t("conversations.tab.team", { n: meta.counts.team }), tone: "#92400E" },
    { view: "ai", label: t("conversations.tab.ai") },
    { view: "resolved", label: t("conversations.tab.resolved") },
  ];
  const pages = Math.max(1, Math.ceil(meta.total / Math.max(1, meta.limit)));
  const listQuery = { view: query.view, search: query.search, page: query.page };

  return (
    <section
      aria-label={t("conversations.listLabel")}
      style={{
        flex: "0 0 300px",
        minWidth: 0,
        background: "#ffffff",
        borderRight: "1px solid #E1E7DC",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid #EEF2EA", flexShrink: 0 }}>
        <label
          htmlFor="cv-search"
          style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
        >
          {t("conversations.searchLabel")}
        </label>
        <input
          id="cv-search"
          type="search"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t("conversations.searchPlaceholder")}
          maxLength={200}
          style={{
            font: "inherit",
            fontSize: 13,
            height: 34,
            padding: "0 10px",
            border: "1px solid #D5DECF",
            borderRadius: 6,
            color: "#1F2421",
            boxSizing: "border-box",
            width: "100%",
          }}
        />
        <div role="tablist" aria-label={t("conversations.tabsLabel")} style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {tabs.map((tab) => {
            const active = query.view === tab.view;
            return (
              <button
                key={tab.view ?? "all"}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => router.push(inboxHref(basePath, { view: tab.view, search: searchInput, page: 1 }))}
                style={{
                  font: "inherit",
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  height: 28,
                  padding: "0 10px",
                  border: 0,
                  borderRadius: 6,
                  background: active ? "#EAF2DD" : "transparent",
                  color: active ? "#3E4C24" : tab.tone ?? "#3B4540",
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {rows.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "#5F6B5A", fontSize: 13 }}>
            {query.search ? t("conversations.noResults", { query: query.search }) : t("conversations.empty")}
          </div>
        ) : (
          rows.map((row) => {
            const selected = row.id === selectedId;
            const phone = row.contact?.waId ? phoneLocal(row.contact.waId) : null;
            const name = row.customerName ?? phone ?? t("conversations.customerFallback");
            const status = rowStatus(row, lang);
            const tone = STATUS_TONE[status.key] ?? STATUS_TONE["conversations.status.ai"];
            return (
              <Link
                key={row.id}
                href={inboxHref(`/conversations/${row.id}`, listQuery)}
                aria-current={selected ? "page" : undefined}
                style={{
                  padding: "12px 14px",
                  borderBottom: "1px solid #EEF2EA",
                  borderLeft: `3px solid ${selected ? "#586B34" : "transparent"}`,
                  background: selected ? "#F5F8F2" : undefined,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  color: "#1F2421",
                  textDecoration: "none",
                }}
              >
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <b style={{ fontSize: 13.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.businessName ? `${name} · ${row.businessName}` : name}
                  </b>
                  <span style={{ fontSize: 11.5, color: "#5F6B5A", flexShrink: 0 }}>{listTime(row.lastMessageAt, now, lang)}</span>
                </span>
                <span style={{ fontSize: 12.5, color: "#3B4540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {previewLine(row.lastMessage, lang)}
                </span>
                <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  <BrandTags brands={row.brands} />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "1px 7px",
                      borderRadius: 4,
                      background: tone.background,
                      color: tone.color,
                    }}
                  >
                    {t(status.key, status.vars)}
                  </span>
                </span>
              </Link>
            );
          })
        )}
      </div>

      {pages > 1 && (
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid #EEF2EA",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            style={{ ...pageBtn, opacity: meta.page <= 1 ? 0.4 : 1 }}
            disabled={meta.page <= 1}
            onClick={() => router.push(inboxHref(basePath, { ...listQuery, page: meta.page - 1 }))}
          >
            {t("conversations.previous")}
          </button>
          <span style={{ fontSize: 12, color: "#5F6B5A" }}>{t("conversations.pageOf", { page: meta.page, pages })}</span>
          <button
            type="button"
            style={{ ...pageBtn, opacity: meta.page >= pages ? 0.4 : 1 }}
            disabled={meta.page >= pages}
            onClick={() => router.push(inboxHref(basePath, { ...listQuery, page: meta.page + 1 }))}
          >
            {t("conversations.next")}
          </button>
        </div>
      )}
    </section>
  );
}
