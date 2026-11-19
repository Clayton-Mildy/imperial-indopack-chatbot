"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { Lead, LeadCampaignSummary, LeadStatus, LostReason } from "@/types/api";
import { updateLead } from "@/actions/leadActions";
import { setContactAi } from "@/actions/contactActions";
import { Toggle } from "@/components/Toggle";
import { ManualMark } from "@/components/ManualMark";
import { BASE_PATH } from "@/lib/basePath";
import { useT, useLang } from "@/lib/i18n/LangProvider";
import { formatDate as formatDateL, type TFn, type TKey } from "@/lib/i18n/core";

// Labels come from t("leads.status.<key>"). Keep in step with STATUS_LABEL in
// actions/leadActions.ts, which writes the (Indonesian) activity log sentence.
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

const TABS: { key: string; labelKey: TKey; color?: string; salesOnly?: boolean }[] = [
  { key: "all", labelKey: "leads.tab.all" },
  // Hidden from marketing: chasing a lead is the sales team's queue, not theirs.
  { key: "follow_up", labelKey: "leads.tab.followUp", color: "#7C3AED", salesOnly: true },
  { key: "unreplied", labelKey: "leads.tab.unreplied", color: "#92400E", salesOnly: true },
];

// Written by the AI each turn (services/conversationInsights.ts). "Hot"/"Cold" stay in
// English - the sales team uses the words as-is.
const TEMPERATURE_BADGE: Record<string, { label: string; background: string; color: string }> = {
  hot: { label: "Hot", background: "#FBE3DA", color: "#9A2E12" },
  cold: { label: "Cold", background: "#E2EAF2", color: "#2F4A66" },
};

// The marketing form's labels differ per landing page, so try the ones production actually
// sends rather than assuming a single schema. First hit wins.
const NAME_KEYS = ["nama", "name", "nama_lengkap"];
const NEED_KEYS = ["apa_yang_anda_butuhkan", "kebutuhan", "catatan", "nama_perusahaan", "pesan"];
// Whereas these come from the AI's own extraction (the old /contacts "Minat" column).
const INTEREST_KEYS = ["product_sought", "recommended_product", "business_type", "business_name"];

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

const tagStyle: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 10,
  fontWeight: 600,
  padding: "1px 5px",
  borderRadius: 4,
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

/** "{n} mnt / jam / hari" - minutes under an hour, hours under a day, days beyond. */
function waitText(iso: string, t: TFn): string {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return t("leads.wait.min", { n: minutes });
  if (minutes < 60 * 24) return t("leads.wait.hour", { n: Math.floor(minutes / 60) });
  return t("leads.wait.day", { n: Math.floor(minutes / (60 * 24)) });
}

function formatRupiah(value: number): string {
  return `Rp ${new Intl.NumberFormat("id-ID").format(value)}`;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/^\+/, "").replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length >= 11) {
    const local = digits.slice(2);
    return `+62 ${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  return raw.startsWith("+") ? raw : `+${digits}`;
}

function pick(bag: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = bag[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Everything the form and the AI captured, for the row's hover title. */
function tooltip(lead: Lead): string | undefined {
  const lines = [...Object.entries(lead.payload), ...Object.entries(lead.contactProfile)]
    .filter(([, v]) => typeof v === "string" && v.trim())
    .map(([k, v]) => `${k}: ${v as string}`);
  if (lead.followUpNotes) lines.push(`follow-up: ${lead.followUpNotes}`);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function statusColor(status: LeadStatus) {
  return STATUS_COLOR[status] ?? STATUS_COLOR.new;
}

/** Must mirror the API's CAMPAIGN_BUCKET_SQL, or filtering by a label shown here misses rows. */
function campaignOf(lead: Lead): string {
  if (lead.utmCampaign?.trim()) return lead.utmCampaign.trim();
  return lead.requestId === null ? "Organik" : "Campaign";
}

interface Props {
  leads: Lead[];
  summary: LeadCampaignSummary[];
  meta: { page: number; total: number; limit: number };
  aiDefault: boolean;
  /** Marketing: every cell is plain text and nothing links into a conversation. */
  readOnly: boolean;
  /** null when the count could not be fetched: shown without a number. */
  unrepliedCount: number | null;
  nonLeadCount: number | null;
  /** Filters, already resolved by the server, forwarded verbatim to the export. */
  exportQuery: string;
  activeSearch: string;
  activeCampaign: string;
  activeStatus: string;
  activeStartDate: string;
  activeEndDate: string;
  activeTipe: string;
  /** "" = the default order (newest submitted, or longest wait on the unreplied tab). */
  activeSort: string;
  activeOrder: string;
}

export function LeadsClient({
  leads,
  summary,
  meta,
  aiDefault,
  readOnly,
  unrepliedCount,
  nonLeadCount,
  exportQuery,
  activeSearch,
  activeCampaign,
  activeStatus,
  activeStartDate,
  activeEndDate,
  activeTipe,
  activeSort,
  activeOrder,
}: Props) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const formatDate = (iso: string) => formatDateL(iso, lang);
  const formatTime = (iso: string) => formatDateL(iso, lang, { hour: "2-digit", minute: "2-digit" });
  const statusLabel = (st: LeadStatus) => (STATUS_KEYS.includes(st) ? t(`leads.status.${st}`) : st);
  const [searchInput, setSearchInput] = useState(activeSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, startTransition] = useTransition();
  // Local overrides so an edited row updates before the server round-trip lands.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, LeadStatus>>({});
  const [aiOverrides, setAiOverrides] = useState<Record<string, boolean | null>>({});
  // Why a status change was refused, under that row's dropdown (the same text the detail page shows).
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setStatusOverrides({});
    setAiOverrides({});
    setStatusErrors({});
  }, [leads]);

  function navigate(patch: Record<string, string>, resetPage = true) {
    const qs = new URLSearchParams();
    const current: Record<string, string> = {
      search: searchInput.trim(),
      campaign: activeCampaign,
      status: activeStatus,
      startDate: activeStartDate,
      endDate: activeEndDate,
      tipe: activeTipe === "all" ? "" : activeTipe,
      sort: activeSort,
      order: activeOrder,
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

  /** First click sorts newest first; clicking the same column again flips it. */
  function toggleSort(key: string) {
    const order = activeSort === key && activeOrder === "desc" ? "asc" : "desc";
    navigate({ sort: key, order });
  }

  function sortHeader(key: string, label: string, width: number) {
    const active = activeSort === key;
    return (
      <th style={{ ...thStyle, width, minWidth: width, padding: 0 }} aria-sort={active ? (activeOrder === "asc" ? "ascending" : "descending") : "none"}>
        <button
          onClick={() => toggleSort(key)}
          title={t("leads.sortHint")}
          style={{
            ...thStyle,
            width: "100%",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontFamily: "inherit",
            color: active ? "#3E4C24" : thStyle.color,
          }}
        >
          {label}
          <span style={{ marginLeft: 4, opacity: active ? 1 : 0.35 }}>
            {active ? (activeOrder === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </button>
      </th>
    );
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ search: value.trim() }), 400);
  }

  function handleStatusChange(lead: Lead, status: LeadStatus) {
    const previous = statusOverrides[lead.id] ?? lead.status;
    setStatusOverrides((prev) => ({ ...prev, [lead.id]: status }));
    setStatusErrors(({ [lead.id]: _cleared, ...rest }) => rest);
    startTransition(async () => {
      const result = await updateLead(lead.id, { status }).catch(() => ({ ok: false, error: undefined as string | undefined }));
      if (!result.ok) {
        setStatusOverrides((prev) => ({ ...prev, [lead.id]: previous }));
        // LEAD_ALREADY_OPEN arrives as leads.alreadyOpen; anything else as leads.saveFailed.
        setStatusErrors((prev) => ({ ...prev, [lead.id]: result.error ?? t("leads.saveFailed") }));
        return;
      }
      // Pulls the campaign block's Won / Lost / Win% / Nilai columns back in sync.
      router.refresh();
    });
  }

  function handleDealValue(lead: Lead, raw: string) {
    const digits = raw.replace(/\D/g, "");
    const next = digits === "" ? null : Number(digits);
    if (next === lead.dealValueIdr) return;
    startTransition(async () => {
      await updateLead(lead.id, { dealValueIdr: next }).catch(() => ({ ok: false }));
      router.refresh();
    });
  }

  // Correcting a number locks that field against the AI (total_orders_set_at / deal_value_set_at),
  // so a cleared box means 0 rather than "leave it to the model".
  function handleTotalOrders(lead: Lead, raw: string) {
    const digits = raw.replace(/\D/g, "");
    const next = digits === "" ? 0 : Number(digits);
    if (next === lead.totalOrders) return;
    startTransition(async () => {
      await updateLead(lead.id, { totalOrders: next }).catch(() => ({ ok: false }));
      router.refresh();
    });
  }

  function handleToggleAi(lead: Lead) {
    if (!lead.contactId) return;
    const current = aiOverrides[lead.id] !== undefined ? aiOverrides[lead.id]! : lead.aiEnabled;
    const next = !(current ?? aiDefault);
    setAiOverrides((prev) => ({ ...prev, [lead.id]: next }));
    startTransition(async () => {
      const result = await setContactAi(lead.contactId!, next).catch(() => ({ ok: false }));
      if (!result.ok) setAiOverrides((prev) => ({ ...prev, [lead.id]: current }));
    });
  }

  const hasFilter = Boolean(
    activeSearch ||
      activeCampaign ||
      activeStatus ||
      activeStartDate ||
      activeEndDate ||
      activeTipe !== "all"
  );
  const totalPages = Math.ceil(meta.total / meta.limit);
  const maxLeads = Math.max(1, ...summary.map((r) => r.leads));

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
          value={activeCampaign}
          onChange={(e) => navigate({ campaign: e.target.value })}
          style={{ ...inputStyle, width: 170, cursor: "pointer" }}
        >
          <option value="">{t("leads.allCampaigns")}</option>
          {summary.map((row) => (
            <option key={row.campaign} value={row.campaign}>
              {row.campaign}
            </option>
          ))}
        </select>

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
          style={{ ...inputStyle, width: 230 }}
        />

        {hasFilter && (
          <button onClick={() => router.push("/leads")} style={{ ...pageBtnStyle, height: 34 }}>
            {t("leads.reset")}
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Plain anchor - the browser downloads it; no blob, no client fetch. Unlike the
            catalog export this one carries the active filters, so the file always matches
            the rows on screen. */}
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

      {/* Campaign performance. A div bar rather than a chart library: one series, one hue,
          sorted descending — a dependency would buy nothing here. */}
      <h2 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700, color: "#0A0A0A" }}>
        {t("leads.campaignPerformance")}
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
        {summary.length === 0 ? (
          <div style={{ padding: "28px 24px", textAlign: "center", color: "#64748B", fontSize: 14 }}>
            {t("leads.noDataPeriod")}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                <th style={thStyle}>{t("leads.col.campaign")}</th>
                <th style={{ ...thStyle, width: 220 }}>{t("leads.col.leads")}</th>
                <th style={{ ...thStyle, width: 100 }}>{t("leads.col.chat")}</th>
                <th style={{ ...thStyle, width: 70 }}>{t("leads.col.won")}</th>
                <th style={{ ...thStyle, width: 70 }}>{t("leads.col.lost")}</th>
                <th style={{ ...thStyle, width: 80 }}>{t("leads.col.winPct")}</th>
                <th style={{ ...thStyle, width: 130 }}>{t("leads.col.value")}</th>
                <th style={{ ...thStyle, width: 90 }}>{t("leads.col.escalated")}</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => {
                const decided = row.won + row.lost;
                return (
                  <tr key={row.campaign} style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 500 }}>{row.campaign}</div>
                      {row.source && (
                        <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{row.source}</div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 8, background: "#EAF2DD", borderRadius: 4 }}>
                          <div
                            style={{
                              width: `${(row.leads / maxLeads) * 100}%`,
                              height: 8,
                              background: "#88B44E",
                              borderRadius: 4,
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#334155",
                            minWidth: 32,
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {row.leads}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, color: "#64748B" }}>
                      {row.chats}
                      {row.leads > 0 && (
                        <span style={{ fontSize: 11, color: "#94A3B8", marginLeft: 4 }}>
                          ({Math.round((row.chats / row.leads) * 100)}%)
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: row.won > 0 ? "#15803D" : "#94A3B8" }}>{row.won}</td>
                    <td style={{ ...tdStyle, color: row.lost > 0 ? "#B91C1C" : "#94A3B8" }}>{row.lost}</td>
                    {/* Decided leads only, so a campaign still in progress isn't scored 0%. */}
                    <td style={{ ...tdStyle, color: "#64748B" }}>
                      {decided > 0 ? `${Math.round((row.won / decided) * 100)}%` : "—"}
                    </td>
                    <td style={{ ...tdStyle, color: row.dealValueIdr > 0 ? "#0A0A0A" : "#94A3B8" }}>
                      {row.dealValueIdr > 0 ? formatRupiah(row.dealValueIdr) : "—"}
                    </td>
                    <td style={{ ...tdStyle, color: "#64748B" }}>{row.escalated}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Leads list — one row per lead, campaign or organic. This replaced the separate
          Pelanggan page: after the backfill every contact has a lead, so the two lists were
          the same rows with different columns. */}
      <h2 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700, color: "#0A0A0A" }}>
        {t("leads.listTitle")}
      </h2>

      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #E2E8F0", marginBottom: 14 }}>
        {TABS.filter((tab) => !tab.salesOnly || !readOnly).map((tab) => {
          const isActive = activeTipe === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => navigate({ tipe: tab.key === "all" ? "" : tab.key })}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "#3E4C24" : (tab.color ?? "#64748B"),
                background: "transparent",
                border: "none",
                borderBottom: isActive ? "2px solid #586B34" : "2px solid transparent",
                cursor: "pointer",
                marginBottom: -1,
              }}
            >
              {t(tab.labelKey)}
              {tab.key === "unreplied" && unrepliedCount ? ` ${unrepliedCount}` : ""}
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

      {/* Scrolls sideways rather than squeezing: eleven columns no longer fit a laptop screen. */}
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, overflowX: "auto" }}>
        {leads.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "#64748B", fontSize: 14 }}>
            {hasFilter ? t("leads.emptyFiltered") : t("leads.empty")}
          </div>
        ) : (
          <table style={{ width: "100%", minWidth: 1500, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                {sortHeader("chat_started", t("leads.col.chatStarted"), 120)}
                {sortHeader("last_chat", t("leads.col.lastChat"), 130)}
                <th style={thStyle}>{t("leads.col.customer")}</th>
                {/* Wide enough for a full 36-char uuid at 10px monospace. */}
                <th style={{ ...thStyle, width: 250, minWidth: 250 }}>{t("leads.col.source")}</th>
                <th style={{ ...thStyle, width: 90, minWidth: 90 }}>{t("leads.col.hotCold")}</th>
                <th style={thStyle}>{t("leads.col.need")}</th>
                <th style={{ ...thStyle, width: 120, minWidth: 120 }}>{t("leads.col.status")}</th>
                <th style={{ ...thStyle, width: 90, minWidth: 90 }}>{t("leads.col.totalOrders")}</th>
                <th style={{ ...thStyle, width: 120, minWidth: 120 }}>{t("leads.col.totalDeal")}</th>
                {!readOnly && <th style={{ ...thStyle, width: 90, minWidth: 90 }}>{t("leads.col.aiReply")}</th>}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const status = statusOverrides[lead.id] ?? lead.status;
                const aiOverride =
                  aiOverrides[lead.id] !== undefined ? aiOverrides[lead.id]! : lead.aiEnabled;
                const aiOn = aiOverride ?? aiDefault;
                const name = pick(lead.payload, NAME_KEYS) ?? lead.displayName;
                const need =
                  pick(lead.payload, NEED_KEYS) ?? pick(lead.contactProfile, INTEREST_KEYS);
                const campaign = campaignOf(lead);
                const fromForm = Boolean(lead.requestId);
                const temp = lead.leadTemperature
                  ? TEMPERATURE_BADGE[lead.leadTemperature]
                  : undefined;

                return (
                  <tr key={lead.id} style={{ borderBottom: "1px solid #F1F5F9" }} title={tooltip(lead)}>
                    <td style={{ ...tdStyle, fontSize: 12, color: lead.conversationStartedAt ? "#334155" : "#94A3B8" }}>
                      {lead.conversationStartedAt
                        ? formatDate(lead.conversationStartedAt)
                        : t("leads.noChat")}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, color: lead.lastChatAt ? "#334155" : "#94A3B8" }}>
                      {lead.lastChatAt ? (
                        <>
                          {formatDate(lead.lastChatAt)}
                          <div style={{ fontSize: 11, color: "#94A3B8" }}>{formatTime(lead.lastChatAt)}</div>
                        </>
                      ) : (
                        t("leads.noChat")
                      )}
                    </td>
                    <td style={tdStyle}>
                      <NameCell lead={lead} name={name} readOnly={readOnly} t={t} formatDate={formatDate} />
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: fromForm ? "#EDE9FE" : "#F1F5F9",
                          color: fromForm ? "#7C3AED" : "#475569",
                        }}
                      >
                        {campaign}
                      </span>
                      {lead.utmSource && (
                        <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>
                          {lead.utmSource}
                          {lead.utmContent ? ` · ${lead.utmContent}` : ""}
                        </div>
                      )}
                      {/* The Request ID is the only handle on a form lead whose campaign
                          hasn't been filled in yet — without it you can't tell which
                          submission to look up in marketing's export. */}
                      {lead.requestId && <RequestId value={lead.requestId} t={t} />}
                    </td>
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
                        <span style={{ color: "#94A3B8" }}>—</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: need ? "#334155" : "#94A3B8" }}>
                      <div
                        style={{
                          maxWidth: 320,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {need ?? "—"}
                      </div>
                    </td>
                    {/* The AI keeps status, order count and deal value current; a staff edit locks
                        that one field against it for good and marks it "Manual" (per-field locks,
                        2026-11-10). Marketing sees the values, never the controls. */}
                    <td style={tdStyle}>
                      {readOnly ? (
                        <span
                          style={{
                            display: "inline-block",
                            fontSize: 12,
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: statusColor(status).background,
                            color: statusColor(status).color,
                          }}
                        >
                          {statusLabel(status)}
                        </span>
                      ) : (
                        <select
                          value={status}
                          disabled={pending}
                          onChange={(e) => handleStatusChange(lead, e.target.value as LeadStatus)}
                          style={{
                            height: 28,
                            padding: "0 6px",
                            fontSize: 12,
                            fontWeight: 600,
                            width: "100%",
                            border: "1px solid #CBD5E1",
                            borderRadius: 4,
                            outline: "none",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            background: statusColor(status).background,
                            color: statusColor(status).color,
                          }}
                        >
                          {STATUS_KEYS.map((k) => (
                            <option key={k} value={k}>
                              {statusLabel(k)}
                            </option>
                          ))}
                        </select>
                      )}
                      {lead.humanUpdatedAt && <ManualMark block at={lead.humanUpdatedAt} name={lead.statusSetByName} />}
                      {statusErrors[lead.id] && (
                        <div role="alert" style={{ marginTop: 4, fontSize: 11, color: "#B91C1C" }}>
                          {statusErrors[lead.id]}
                        </div>
                      )}
                      <OutcomeLink lead={lead} status={status} t={t} />
                    </td>
                    <td style={tdStyle}>
                      {readOnly ? (
                        <span
                          style={{
                            fontSize: 12,
                            fontVariantNumeric: "tabular-nums",
                            color: lead.totalOrders > 0 ? "#0A0A0A" : "#94A3B8",
                          }}
                        >
                          {lead.totalOrders > 0 ? lead.totalOrders : "—"}
                        </span>
                      ) : (
                        <input
                          type="text"
                          inputMode="numeric"
                          defaultValue={lead.totalOrders === 0 ? "" : String(lead.totalOrders)}
                          placeholder="—"
                          onBlur={(e) => handleTotalOrders(lead, e.target.value)}
                          style={{ ...inputStyle, height: 28, width: "100%", fontSize: 12 }}
                        />
                      )}
                      {lead.totalOrdersSetAt && <ManualMark block at={lead.totalOrdersSetAt} name={lead.totalOrdersSetByName} />}
                    </td>
                    <td style={tdStyle}>
                      {readOnly ? (
                        <span
                          style={{
                            fontSize: 12,
                            fontVariantNumeric: "tabular-nums",
                            color: lead.dealValueIdr ? "#0A0A0A" : "#94A3B8",
                          }}
                        >
                          {lead.dealValueIdr ? formatRupiah(lead.dealValueIdr) : "—"}
                        </span>
                      ) : (
                        <input
                          type="text"
                          inputMode="numeric"
                          defaultValue={lead.dealValueIdr === null ? "" : String(lead.dealValueIdr)}
                          placeholder="—"
                          onBlur={(e) => handleDealValue(lead, e.target.value)}
                          style={{ ...inputStyle, height: 28, width: "100%", fontSize: 12 }}
                        />
                      )}
                      {lead.dealValueSetAt && <ManualMark block at={lead.dealValueSetAt} name={lead.dealValueSetByName} />}
                    </td>
                    {!readOnly && (
                      <td style={tdStyle}>
                        {lead.contactId ? (
                          <Toggle on={aiOn} onChange={() => handleToggleAi(lead)} disabled={pending} />
                        ) : (
                          <span style={{ fontSize: 11, color: "#94A3B8" }}>—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
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

/**
 * The full id, not a prefix: it has to be readable against marketing's export and pasteable
 * into the campaign modal, and a truncated one is neither. Click to copy.
 */
function RequestId({ value, t }: { value: string; t: TFn }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      title={t("leads.copyHint")}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => {}
        );
      }}
      style={{
        display: "block",
        marginTop: 4,
        padding: 0,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        lineHeight: 1.4,
        letterSpacing: "-0.02em",
        color: copied ? "#15803D" : "#94A3B8",
      }}
    >
      {copied ? t("leads.copied") : value}
    </button>
  );
}

/** Under the status: why the AI closed the lead, linking to the detail page where the quoted message sits. */
function OutcomeLink({ lead, status, t }: { lead: Lead; status: LeadStatus; t: TFn }) {
  let text: string | null = null;
  if (status === "won" && lead.outcomeEvidence) text = t("leads.proofWon");
  else if (status === "lost" && lead.lostReason) {
    text = t("leads.proofLost", { reason: t(`lostReason.${lead.lostReason as LostReason}`) });
  }
  if (!text) return null;
  return (
    <Link
      href={`/leads/${lead.id}`}
      style={{ display: "block", marginTop: 4, fontSize: 11, color: "#64748B", textDecoration: "none" }}
    >
      {text}
    </Link>
  );
}

function NameCell({
  lead,
  name,
  readOnly,
  t,
  formatDate,
}: {
  lead: Lead;
  name: string | null;
  readOnly: boolean;
  t: TFn;
  formatDate: (iso: string) => string;
}) {
  const needsFollowUp = lead.followUpStatus === "needs_followup";
  const body = (
    <>
      <div style={{ fontWeight: 500, fontSize: 14, color: "#0A0A0A" }}>
        {name ?? t("leads.noChat")}
        {needsFollowUp && (
          <span
            title={lead.followUpNotes ?? undefined}
            style={{
              marginLeft: 6,
              fontSize: 10,
              fontWeight: 600,
              color: "#7C3AED",
              background: "#EDE9FE",
              padding: "1px 5px",
              borderRadius: 4,
            }}
          >
            {t("leads.tag.followUp")}
          </span>
        )}
        {lead.previousLeadId && (
          <span style={{ ...tagStyle, background: "#FAE8FF", color: "#A21CAF" }}>
            {t("leads.tag.returning")}
          </span>
        )}
        {lead.waitingSince && (
          <span suppressHydrationWarning style={{ ...tagStyle, background: "#FEF3C7", color: "#92400E" }}>
            {t("leads.tag.waiting", { wait: waitText(lead.waitingSince, t) })}
          </span>
        )}
      </div>
      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
        {lead.waId ? formatPhone(lead.waId) : t("leads.submittedOn", { date: formatDate(lead.submittedAt) })}
      </div>
    </>
  );

  // The lead's own page (proxy.ts lets marketing in there); the conversation is one link away from it.
  return (
    <Link href={`/leads/${lead.id}`} style={{ textDecoration: "none" }}>
      {body}
    </Link>
  );
}
