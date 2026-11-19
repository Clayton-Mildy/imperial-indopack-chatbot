"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Conversation } from "@/types/api";
import { useT } from "@/lib/i18n/LangProvider";
import type { TFn, TKey } from "@/lib/i18n/core";

const TABS: { key: string; label: TKey; bold?: boolean; color?: string }[] = [
  { key: "all", label: "conversations.tab.all" },
  { key: "active", label: "conversations.status.active" },
  { key: "escalated", label: "conversations.status.escalated", bold: true, color: "#B45309" },
  { key: "resolved", label: "conversations.status.resolved" },
  { key: "needs_human", label: "conversations.status.needsHuman", bold: true, color: "#B45309" },
  { key: "follow_up", label: "conversations.status.followUp", bold: true, color: "#7C3AED" },
  { key: "upsell_accepted", label: "conversations.tab.upsellAccepted", bold: true, color: "#15803D" },
];

const STATUS_LABEL: Record<string, TKey> = {
  active: "conversations.status.active",
  escalated: "conversations.status.escalated",
  resolved: "conversations.status.resolved",
  needs_human: "conversations.status.needsHuman",
  follow_up: "conversations.status.followUp",
};

const badgeStyles: Record<string, React.CSSProperties> = {
  active: { background: "#F1F5F9", color: "#334155" },
  escalated: { background: "#FEF3C7", color: "#B45309" },
  resolved: { background: "#DCFCE7", color: "#15803D" },
  needs_human: { background: "#FEF3C7", color: "#B45309" },
  follow_up: { background: "#EDE9FE", color: "#7C3AED" },
};

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 14px",
  fontSize: 13,
  color: "#0A0A0A",
  verticalAlign: "middle",
};

const pageBtnStyle: React.CSSProperties = {
  height: 28,
  padding: "0 10px",
  fontSize: 12,
  fontWeight: 500,
  color: "#64748B",
  background: "white",
  border: "1px solid #E2E8F0",
  borderRadius: 4,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPhone(raw: string): string {
  const digits = raw.replace(/^\+/, "").replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length >= 11) {
    const local = digits.slice(2);
    return `+62 ${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  return raw.startsWith("+") ? raw : `+${digits}`;
}

function timeAgo(iso: string, t: TFn): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return t("conversations.ago.minutes", { n: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return t("conversations.ago.hours", { n: diffH });
  return t("conversations.ago.days", { n: Math.floor(diffH / 24) });
}

const READ_KEY = "imperial_conv_read";

function getReadTimes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Last inbound/outbound message, falling back to the row mtime on routes that don't send it. */
function lastActivity(conv: Conversation): string {
  return conv.lastMessageAt ?? conv.updatedAt;
}

function isUnread(conv: Conversation, readTimes: Record<string, number>): boolean {
  if (conv.status === "resolved") return false;
  const lastRead = readTimes[conv.id];
  if (!lastRead) return true;
  return new Date(lastActivity(conv)).getTime() > lastRead;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  conversations: Conversation[];
  meta: { page: number; total: number; limit: number };
  counts: Record<string, number>;
  activeStatus: string;
  activeSearch: string;
}

export function ConversationsClient({ conversations, meta, counts, activeStatus, activeSearch }: Props) {
  const router = useRouter();
  const t = useT();
  const [readTimes, setReadTimes] = useState<Record<string, number>>({});
  const [searchInput, setSearchInput] = useState(activeSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setReadTimes(getReadTimes());
  }, [conversations]);

  // Poll for new conversations every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(interval);
  }, [router]);

  function navigate(status: string, page = 1, search?: string) {
    const qs = new URLSearchParams();
    if (status !== "all") qs.set("status", status);
    if (page > 1) qs.set("page", String(page));
    const q = search ?? searchInput;
    if (q.trim()) qs.set("search", q.trim());
    router.push(`/conversations${qs.toString() ? "?" + qs.toString() : ""}`);
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      navigate(activeStatus, 1, value);
    }, 300);
  }

  const totalPages = Math.ceil(meta.total / meta.limit);

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: 32 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0A0A0A" }}>{t("conversations.title")}</h1>
        <div style={{ position: "relative", width: 280 }}>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          >
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t("conversations.searchPlaceholder")}
            style={{
              width: "100%",
              height: 34,
              paddingLeft: 32,
              paddingRight: 10,
              fontSize: 13,
              color: "#0A0A0A",
              border: "1px solid #CBD5E1",
              borderRadius: 6,
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
            }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #E2E8F0", marginBottom: 16 }}>
        {TABS.map((tab) => {
          const count = counts[tab.key];
          const isActive = activeStatus === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => navigate(tab.key, 1)}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "#3E4C24" : "#64748B",
                background: "transparent",
                border: "none",
                borderBottom: isActive ? "2px solid #586B34" : "2px solid transparent",
                cursor: "pointer",
                marginBottom: -1,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {t(tab.label)}
              {count !== undefined && count > 0 && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: tab.bold ? 700 : 400,
                    color: tab.bold ? (tab.color ?? "#9CA3AF") : "#9CA3AF",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, overflow: "hidden" }}>
        {conversations.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "#64748B", fontSize: 14 }}>
            {activeSearch ? t("conversations.noResults", { query: activeSearch }) : t("conversations.empty")}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                <th style={{ ...thStyle, width: 16, padding: "10px 0 10px 14px" }} />
                <th style={{ ...thStyle }}>{t("conversations.colContact")}</th>
                <th style={{ ...thStyle, width: 130 }}>{t("conversations.colStatus")}</th>
                <th style={{ ...thStyle, width: 70, textAlign: "right" }}>{t("conversations.colTime")}</th>
              </tr>
            </thead>
            <tbody>
              {conversations.map((conv) => {
                const isEscalated = conv.status === "escalated";
                const hasFollowUp = !!conv.followUpNotes;
                const unread = isUnread(conv, readTimes);

                const rowBorderColor = isEscalated ? "#D97706" : hasFollowUp ? "#7C3AED" : "transparent";
                const rowBg = isEscalated ? "rgba(254,243,199,0.18)" : hasFollowUp ? "rgba(237,233,254,0.15)" : undefined;

                return (
                  <tr
                    key={conv.id}
                    style={{
                      borderBottom: "1px solid #F1F5F9",
                      borderLeft: `3px solid ${rowBorderColor}`,
                      background: rowBg,
                    }}
                  >
                    {/* Unread dot */}
                    <td style={{ padding: "0 0 0 14px", width: 16, verticalAlign: "middle" }}>
                      {unread && (
                        <span style={{
                          display: "inline-block",
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: "#3B82F6",
                          flexShrink: 0,
                        }} />
                      )}
                    </td>
                    <td style={tdStyle}>
                      <Link href={`/conversations/${conv.id}`} style={{ textDecoration: "none" }}>
                        {/* Customer name */}
                        <div style={{ fontWeight: unread ? 700 : 500, fontSize: 14, color: "#0A0A0A" }}>
                          {conv.contact?.displayName ?? t("conversations.customerFallback")}
                        </div>
                        {/* WA number */}
                        {conv.contact?.waId && (
                          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                            {formatPhone(conv.contact.waId)}
                          </div>
                        )}
                        {/* Via badge */}
                        {(conv.phoneNumber?.label ?? conv.phoneNumber?.number) && (
                          <div style={{ marginTop: 4 }}>
                            <span style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "1px 6px",
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 500,
                              background: "#F1F5F9",
                              color: "#475569",
                              letterSpacing: "0.01em",
                            }}>
                              {t("conversations.via", { name: conv.phoneNumber.label ?? formatPhone(conv.phoneNumber.number) })}
                            </span>
                          </div>
                        )}
                        {/* Follow-up note snippet */}
                        {conv.followUpNotes && (
                          <div style={{ marginTop: 4, fontSize: 11, color: "#7C3AED", display: "flex", alignItems: "flex-start", gap: 3 }}>
                            <span>⏰</span>
                            <span style={{ lineHeight: 1.4, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {conv.followUpNotes}
                            </span>
                          </div>
                        )}
                      </Link>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        ...(badgeStyles[conv.status] ?? badgeStyles.active),
                      }}>
                        {STATUS_LABEL[conv.status] ? t(STATUS_LABEL[conv.status]) : conv.status}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, fontSize: 11, color: "#64748B", textAlign: "right" }}>
                      {timeAgo(lastActivity(conv), t)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ padding: "10px 14px", borderTop: "1px solid #F1F5F9", display: "flex", gap: 4, alignItems: "center" }}>
            <button
              style={{ ...pageBtnStyle, opacity: meta.page <= 1 ? 0.4 : 1 }}
              disabled={meta.page <= 1}
              onClick={() => navigate(activeStatus, meta.page - 1)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12,19 5,12 12,5"/>
              </svg>{" "}
              {t("conversations.previous")}
            </button>

            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => navigate(activeStatus, p)}
                style={{
                  ...pageBtnStyle,
                  ...(meta.page === p ? { background: "#586B34", color: "white", borderColor: "#586B34" } : {}),
                }}
              >
                {p}
              </button>
            ))}

            <button
              style={{ ...pageBtnStyle, opacity: meta.page >= totalPages ? 0.4 : 1 }}
              disabled={meta.page >= totalPages}
              onClick={() => navigate(activeStatus, meta.page + 1)}
            >
              {t("conversations.next")}{" "}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
