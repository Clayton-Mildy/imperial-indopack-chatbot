"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Link from "next/link";
import type { BrandPerformance, Lead, LeadStatus } from "@/types/api";
import { BrandTags } from "@/components/BrandTag";
import { BASE_PATH } from "@/lib/basePath";
import { BRAND_SLUGS, brandSlugs } from "@/lib/brands";
import { useT, useLang } from "@/lib/i18n/LangProvider";
import { formatDate as formatDateL, type TKey } from "@/lib/i18n/core";
import { formatWait, relativeTime } from "@/lib/format";
import { itemLine } from "@/lib/leads/items";
import { LEAD_TABS, type LeadTab } from "@/lib/leads/tabs";

const STATUS_KEYS: LeadStatus[] = ["new", "contacted", "quoted", "won", "lost"];

// Looked up via statusColor() below, never indexed directly: a status typed straight into the
// DB would otherwise be `undefined` here and take the whole page down on `.background`.
const STATUS_COLOR: Record<LeadStatus, { background: string; color: string }> = {
  new: { background: "#F1F5F9", color: "#475569" },
  contacted: { background: "#DBEAFE", color: "#1D4ED8" },
  quoted: { background: "#FEF3C7", color: "#B45309" },
  won: { background: "#DCFCE7", color: "#15803D" },
  lost: { background: "#FEE2E2", color: "#B91C1C" },
};

const TAB_LABEL: Record<LeadTab, TKey> = {
  all: "leads.tab.all",
  kertas_supreme: "brand.kertas_supreme",
  imperial_indopack: "brand.imperial_indopack",
  followup: "leads.tab.followUp",
  unreplied: "leads.tab.unreplied",
};

// Written by the AI each turn. "Hot"/"Cold" stay in English: the sales team uses the words as-is.
const TEMPERATURE_BADGE: Record<string, { label: string; background: string; color: string }> = {
  hot: { label: "Hot", background: "#FBE3DA", color: "#9A2E12" },
  cold: { label: "Cold", background: "#E2EAF2", color: "#2F4A66" },
};

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "#0A0A0A",
  verticalAlign: "middle",
};

const inputStyle: React.CSSProperties = {
  height: 34,
  padding: "0 10px",
  fontSize: 13,
  color: "#0A0A0A",
  background: "white",
  border: "1px solid #CBD5E1",
  borderRadius: 6,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
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
};

function formatPhone(raw: string): string {
  const digits = raw.replace(/^\+/, "").replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length >= 11) {
    const local = digits.slice(2);
    return `+62 ${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  return raw.startsWith("+") ? raw : `+${digits}`;
}

function statusColor(status: LeadStatus) {
  return STATUS_COLOR[status] ?? STATUS_COLOR.new;
}

interface Props {
  leads: Lead[];
  brandRows: BrandPerformance[];
  meta: { page: number; total: number; limit: number };
  /** Marketing: no follow-up / unreplied tabs and no waiting tags. */
  readOnly: boolean;
  /** null when the count could not be fetched: shown without a number. */
  nonLeadCount: number | null;
  /** Filters, already resolved by the server, forwarded verbatim to the export. */
  exportQuery: string;
  activeSearch: string;
  activeStatus: string;
  activeStartDate: string;
  activeEndDate: string;
  activeTab: LeadTab;
}

export function LeadsClient({
  leads,
  brandRows,
  meta,
  readOnly,
  nonLeadCount,
  exportQuery,
  activeSearch,
  activeStatus,
  activeStartDate,
  activeEndDate,
  activeTab,
}: Props) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const [searchInput, setSearchInput] = useState(activeSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = new Date();

  function navigate(patch: Record<string, string>, resetPage = true) {
    const qs = new URLSearchParams();
    const current: Record<string, string> = {
      search: searchInput.trim(),
      status: activeStatus,
      startDate: activeStartDate,
      endDate: activeEndDate,
      tab: activeTab === "all" ? "" : activeTab,
      page: resetPage ? "" : String(meta.page),
      ...patch,
    };
    for (const [key, value] of Object.entries(current)) {
      if (!value) continue;
      if (key === "page" && value === "1") continue; // page 1 is the bare URL
      qs.set(key, value);
    }
    router.push(`/leads${qs.toString() ? "?" + qs.toString() : ""}`);
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ search: value.trim() }), 400);
  }

  const statusLabel = (st: LeadStatus) => (STATUS_KEYS.includes(st) ? t(`leads.status.${st}`) : st);
  const hasFilter = Boolean(
    activeSearch || activeStatus || activeStartDate || activeEndDate || activeTab !== "all"
  );
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit));
  const tabs = LEAD_TABS.filter((tab) => !readOnly || (tab !== "followup" && tab !== "unreplied"));
  // Both brands always get a row, Kertas Supreme first, even if the API sent them in another order.
  const brandTable = BRAND_SLUGS.map((slug) => brandRows.find((r) => r.brand === slug)).filter(
    (r): r is BrandPerformance => r !== undefined
  );

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: 32 }}>
      {/* Filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: "#64748B" }}>{t("leads.from")}</span>
        <input
          type="date"
          value={activeStartDate}
          onChange={(e) => navigate({ startDate: e.target.value })}
          style={{ ...inputStyle, width: 148 }}
        />
        <span style={{ fontSize: 12, color: "#64748B" }}>{t("leads.to")}</span>
        <input
          type="date"
          value={activeEndDate}
          onChange={(e) => navigate({ endDate: e.target.value })}
          style={{ ...inputStyle, width: 148 }}
        />

        <select
          value={activeStatus}
          onChange={(e) => navigate({ status: e.target.value })}
          style={{ ...inputStyle, width: 135, cursor: "pointer" }}
        >
          <option value="">{t("leads.allStatuses")}</option>
          {STATUS_KEYS.map((k) => (
            <option key={k} value={k}>
              {statusLabel(k)}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t("leads.searchPlaceholder")}
          style={{ ...inputStyle, width: 260 }}
        />

        {hasFilter && (
          <button onClick={() => router.push("/leads")} style={{ ...pageBtnStyle, height: 34 }}>
            {t("leads.reset")}
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Plain anchor: the browser downloads it. Carries the active tab and filters, so the
            file always matches the rows on screen. */}
        <a
          href={`${BASE_PATH}/api/leads-export${exportQuery ? `?${exportQuery}` : ""}`}
          download
          title={t("leads.exportTitle")}
          style={{
            height: 34,
            padding: "0 14px",
            display: "inline-flex",
            alignItems: "center",
            fontSize: 13,
            fontWeight: 600,
            color: "white",
            background: "#586B34",
            borderRadius: 6,
            textDecoration: "none",
          }}
        >
          {t("leads.export")}
        </a>
      </div>

      <h2 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700, color: "#0A0A0A" }}>
        {t("leads.brandPerformance")}
      </h2>
      <div
        style={{
          background: "white",
          border: "1px solid #E2E8F0",
          borderRadius: 6,
          overflow: "hidden",
          marginBottom: 28,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
              <th style={thStyle}>{t("leads.col.brand")}</th>
              <th style={{ ...thStyle, width: 100 }}>{t("leads.col.leads")}</th>
              <th style={{ ...thStyle, width: 100 }}>{t("leads.col.chat")}</th>
              <th style={{ ...thStyle, width: 100 }}>{t("leads.col.won")}</th>
              <th style={{ ...thStyle, width: 100 }}>{t("leads.col.lost")}</th>
              <th style={{ ...thStyle, width: 110 }}>{t("leads.col.winPct")}</th>
            </tr>
          </thead>
          <tbody>
            {brandTable.map((row) => (
              <tr key={row.brand} style={{ borderBottom: "1px solid #F1F5F9" }}>
                <td style={tdStyle}>
                  <BrandTags brands={[row.brand]} />
                </td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{row.leads}</td>
                <td style={{ ...tdStyle, color: "#64748B" }}>{row.chats}</td>
                <td style={{ ...tdStyle, color: row.won > 0 ? "#15803D" : "#94A3B8" }}>{row.won}</td>
                <td style={{ ...tdStyle, color: row.lost > 0 ? "#B91C1C" : "#94A3B8" }}>{row.lost}</td>
                {/* null = no leads in the period: a dash, not 0%. */}
                <td style={{ ...tdStyle, color: "#64748B" }}>{row.winPct === null ? "—" : `${row.winPct}%`}</td>
              </tr>
            ))}
            {brandTable.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#64748B", padding: "24px" }}>
                  —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700, color: "#0A0A0A" }}>{t("leads.listTitle")}</h2>

      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #E2E8F0", marginBottom: 14 }}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => navigate({ tab: tab === "all" ? "" : tab })}
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
              }}
            >
              {t(TAB_LABEL[tab])}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <Link
          href="/leads/non-leads"
          style={{ fontSize: 12, color: "#64748B", textDecoration: "none", padding: "8px 4px" }}
        >
          {nonLeadCount === null ? t("leads.nonLeadsLinkNoCount") : t("leads.nonLeadsLink", { n: nonLeadCount })}
        </Link>
      </div>

      {/* Scrolls sideways rather than squeezing the columns. */}
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, overflowX: "auto" }}>
        {leads.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "#64748B", fontSize: 14 }}>
            {hasFilter ? t("leads.emptyFiltered") : t("leads.empty")}
          </div>
        ) : (
          <table style={{ width: "100%", minWidth: 1250, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                <th style={{ ...thStyle, width: 100 }}>{t("leads.col.chatStarted")}</th>
                <th style={{ ...thStyle, width: 140 }}>{t("leads.col.lastChat")}</th>
                <th style={thStyle}>{t("leads.col.customer")}</th>
                <th style={thStyle}>{t("leads.col.company")}</th>
                <th style={thStyle}>{t("leads.col.brand")}</th>
                <th style={{ ...thStyle, width: 90 }}>{t("leads.col.hotCold")}</th>
                <th style={thStyle}>{t("leads.col.items")}</th>
                <th style={{ ...thStyle, width: 150 }}>{t("leads.col.status")}</th>
                <th style={{ ...thStyle, width: 90 }}>{t("leads.col.totalOrders")}</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const temp = lead.leadTemperature ? TEMPERATURE_BADGE[lead.leadTemperature] : undefined;
                const name = lead.name ?? lead.displayName;
                const brands = brandSlugs(lead.brands);
                const started = lead.conversationStartedAt ?? lead.submittedAt;
                return (
                  <tr key={lead.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <td style={{ ...tdStyle, fontSize: 12, color: "#334155", whiteSpace: "nowrap" }}>
                      {formatDateL(started, lang, { day: "2-digit", month: "short" })}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12 }} suppressHydrationWarning>
                      <div style={{ color: lead.lastChatAt ? "#334155" : "#94A3B8", whiteSpace: "nowrap" }}>
                        {lead.lastChatAt ? relativeTime(lead.lastChatAt, now, lang) : t("leads.noChat")}
                      </div>
                      {lead.waitingSince && (
                        <div style={{ fontSize: 11, color: "#92400E", marginTop: 2 }}>
                          {t("leads.tag.waiting", {
                            wait: formatWait((now.getTime() - new Date(lead.waitingSince).getTime()) / 60000, lang),
                          })}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {/* The lead's own page (proxy.ts lets marketing in there). */}
                      <Link href={`/leads/${lead.id}`} style={{ textDecoration: "none" }}>
                        <div style={{ fontWeight: 500, fontSize: 14, color: "#0A0A0A" }}>
                          {name ?? t("leads.noChat")}
                          {lead.followUpStatus === "needs_followup" && (
                            <span style={tag("#EDE9FE", "#7C3AED")} title={lead.followUpNotes ?? undefined}>
                              {t("leads.tag.followUp")}
                            </span>
                          )}
                          {lead.previousLeadId && <span style={tag("#FAE8FF", "#A21CAF")}>{t("leads.tag.returning")}</span>}
                        </div>
                        <div
                          style={{
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: 11,
                            color: "#94A3B8",
                            marginTop: 2,
                          }}
                        >
                          {lead.waId ? formatPhone(lead.waId) : "—"}
                        </div>
                      </Link>
                    </td>
                    <td style={{ ...tdStyle, color: lead.company ? "#334155" : "#94A3B8" }}>{lead.company ?? "—"}</td>
                    <td style={tdStyle}>{brands.length > 0 ? <BrandTags brands={brands} /> : <Dash />}</td>
                    <td style={tdStyle}>
                      {temp ? (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "2px 6px",
                            borderRadius: 4,
                            background: temp.background,
                            color: temp.color,
                          }}
                        >
                          {temp.label}
                        </span>
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: "#334155" }}>
                      {lead.items.length === 0 ? (
                        <Dash />
                      ) : (
                        lead.items.map((item, i) => (
                          <div key={i} style={{ lineHeight: 1.5 }}>
                            {itemLine(item, lang)}
                          </div>
                        ))
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 12,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: statusColor(lead.status).background,
                          color: statusColor(lead.status).color,
                        }}
                      >
                        {statusLabel(lead.status)}
                      </span>
                      {lead.status === "lost" && lead.lostReason && (
                        <div style={{ marginTop: 4, fontSize: 11, color: "#64748B" }}>
                          {t("leads.proofLost", {
                            by: lead.humanUpdatedAt ? (lead.statusSetByName ?? t("leads.statusBy.staff")) : "AI",
                            reason: t(`lostReason.${lead.lostReason}`).toLowerCase(),
                          })}
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        fontVariantNumeric: "tabular-nums",
                        color: lead.totalOrders > 0 ? "#0A0A0A" : "#94A3B8",
                      }}
                    >
                      {lead.totalOrders}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {meta.total > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <span style={{ fontSize: 12, color: "#64748B" }}>
            {t("leads.pageOf", { page: meta.page, pages: totalPages, total: meta.total })}
          </span>
          <button
            style={{ ...pageBtnStyle, opacity: meta.page <= 1 ? 0.5 : 1 }}
            disabled={meta.page <= 1}
            onClick={() => navigate({ page: String(meta.page - 1) }, false)}
          >
            {t("leads.prev")}
          </button>
          <button
            style={{ ...pageBtnStyle, opacity: meta.page >= totalPages ? 0.5 : 1 }}
            disabled={meta.page >= totalPages}
            onClick={() => navigate({ page: String(meta.page + 1) }, false)}
          >
            {t("leads.next")}
          </button>
        </div>
      )}
    </main>
  );
}

function Dash() {
  return <span style={{ color: "#94A3B8" }}>—</span>;
}

function tag(background: string, color: string): React.CSSProperties {
  return { marginLeft: 6, fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 4, background, color };
}
