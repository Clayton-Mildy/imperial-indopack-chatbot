"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { LeadReport, LeadStatus } from "@/types/api";
import { useT, useLang } from "@/lib/i18n/LangProvider";
import { formatNumber, type TFn, type TKey } from "@/lib/i18n/core";

// Same palette as the Leads page's status pills; the funnel bars take the text colour.
const STATUS_KEYS: LeadStatus[] = ["new", "contacted", "quoted", "won", "lost"];
const STATUS_COLOR: Record<LeadStatus, { background: string; color: string }> = {
  new: { background: "#F1F5F9", color: "#475569" },
  contacted: { background: "#DBEAFE", color: "#1D4ED8" },
  quoted: { background: "#FEF3C7", color: "#B45309" },
  won: { background: "#DCFCE7", color: "#15803D" },
  lost: { background: "#FEE2E2", color: "#B91C1C" },
};
const BAR_NEW = "#586B34";
const BAR_CONTACTED = "#ADCF6D";

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
  width: 148,
};
const cardStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #E2E8F0",
  borderRadius: 6,
};
const h2Style: React.CSSProperties = { margin: 0, fontSize: 15, fontWeight: 700, color: "#0A0A0A" };
const hintStyle: React.CSSProperties = { margin: "2px 0 0", fontSize: 12, color: "#64748B" };
const emptyStyle: React.CSSProperties = {
  padding: "24px 16px",
  textAlign: "center",
  color: "#64748B",
  fontSize: 14,
};

/** "{n} mnt / jam / hari" - same rule as the Leads page. */
function waitText(iso: string, t: TFn): string {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return t("leads.wait.min", { n: minutes });
  if (minutes < 60 * 24) return t("leads.wait.hour", { n: Math.floor(minutes / 60) });
  return t("leads.wait.day", { n: Math.floor(minutes / (60 * 24)) });
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/^\+/, "").replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length >= 11) {
    const local = digits.slice(2);
    return `+62 ${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  return raw.startsWith("+") ? raw : `+${digits}`;
}

/** 'YYYY-MM-DD' -> '21/10'. String slicing, so no timezone can shift the day. */
function dayLabel(day: string): string {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

function barHeight(value: number, max: number, full: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(2, Math.round((value / max) * full));
}

interface Props {
  report: LeadReport | null;
  problem: "invalid" | "failed" | null;
  activeStartDate: string;
  activeEndDate: string;
}

export function SummaryClient({ report, problem, activeStartDate, activeEndDate }: Props) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const num = (n: number) => formatNumber(n, lang);
  const locale = lang === "id" ? "id-ID" : "en-US";

  function navigate(patch: Record<string, string>) {
    const qs = new URLSearchParams();
    const current: Record<string, string> = {
      startDate: activeStartDate,
      endDate: activeEndDate,
      ...patch,
    };
    for (const [key, value] of Object.entries(current)) if (value) qs.set(key, value);
    router.push(`/summary${qs.toString() ? "?" + qs.toString() : ""}`);
  }

  const hasFilter = Boolean(activeStartDate || activeEndDate);
  const statusLabel = (st: LeadStatus) => t(`leads.status.${st}`);

  const filterBar = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
      <span style={{ fontSize: 12, color: "#64748B" }}>{t("leads.from")}</span>
      <input
        type="date"
        value={activeStartDate}
        onChange={(e) => navigate({ startDate: e.target.value })}
        style={inputStyle}
      />
      <span style={{ fontSize: 12, color: "#64748B" }}>{t("leads.to")}</span>
      <input
        type="date"
        value={activeEndDate}
        onChange={(e) => navigate({ endDate: e.target.value })}
        style={inputStyle}
      />
      {hasFilter && (
        <button
          type="button"
          onClick={() => navigate({ startDate: "", endDate: "" })}
          style={{
            height: 34,
            padding: "0 12px",
            fontSize: 13,
            color: "#64748B",
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {t("summary.reset")}
        </button>
      )}
    </div>
  );

  if (!report) {
    return (
      <main style={{ flex: 1, overflowY: "auto", padding: 32 }}>
        {filterBar}
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 6,
            color: "#B91C1C",
            fontSize: 13,
          }}
        >
          {problem === "invalid" ? t("summary.invalidRange") : t("summary.loadError")}
        </div>
      </main>
    );
  }

  const tiles: { label: string; hint: string; value: string; color?: string; sub?: string }[] = [
    {
      label: t("summary.tile.newLeads"),
      hint: t("summary.tile.newLeads.hint"),
      value: num(report.newLeads),
      sub:
        report.returningLeads > 0
          ? t("summary.tile.newLeads.returning", { n: num(report.returningLeads) })
          : undefined,
    },
    {
      label: t("summary.tile.contacted"),
      hint: t("summary.tile.contacted.hint"),
      value: num(report.contactedLeads),
    },
    {
      label: t("summary.tile.won"),
      hint: t("summary.tile.won.hint"),
      value: num(report.won),
      color: "#15803D",
    },
    {
      label: t("summary.tile.lost"),
      hint: t("summary.tile.lost.hint"),
      value: num(report.lost),
      color: "#B91C1C",
    },
    {
      label: t("summary.tile.conversion"),
      hint: t("summary.tile.conversion.hint"),
      value:
        report.conversionPct === null
          ? "—"
          : `${new Intl.NumberFormat(locale, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }).format(report.conversionPct)}%`,
    },
    {
      label: t("summary.tile.closeTime"),
      hint: t("summary.tile.closeTime.hint"),
      value:
        report.avgDaysToClose === null
          ? "—"
          : t("summary.days", {
              n: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
                report.avgDaysToClose
              ),
            }),
    },
  ];

  const maxDaily = Math.max(0, ...report.daily.flatMap((d) => [d.newLeads, d.contacted]));
  const CHART_H = 140;
  const maxReason = Math.max(1, ...report.lostReasons.map((r) => r.count));
  const maxFunnel = Math.max(1, ...STATUS_KEYS.map((k) => report.funnel[k] ?? 0));

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: 32 }}>
      {filterBar}

      {/* Tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
          marginBottom: 8,
        }}
      >
        {tiles.map((tile) => (
          <div key={tile.label} style={{ ...cardStyle, padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>{tile.label}</div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                lineHeight: 1.2,
                marginTop: 4,
                color: tile.color ?? "#0A0A0A",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {tile.value}
            </div>
            {tile.sub && <div style={{ fontSize: 12, color: "#B45309", marginTop: 2 }}>{tile.sub}</div>}
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>{tile.hint}</div>
          </div>
        ))}
      </div>
      <p style={{ margin: "0 0 24px", fontSize: 12, color: "#94A3B8" }}>{t("summary.nonLeadNote")}</p>

      {/* Daily chart: plain div bars, no chart library. */}
      <div style={{ ...cardStyle, padding: "16px 16px 12px", marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <h2 style={h2Style}>{t("summary.daily.title")}</h2>
          <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#475569" }}>
            {[
              { color: BAR_NEW, label: t("summary.daily.new") },
              { color: BAR_CONTACTED, label: t("summary.daily.contacted") },
            ].map((l) => (
              <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
        </div>
        {report.daily.length === 0 ? (
          <div style={emptyStyle}>{t("summary.daily.empty")}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "flex", gap: 10, minWidth: "max-content" }}>
              {report.daily.map((d) => (
                <div key={d.day} style={{ width: 44, flexShrink: 0 }}>
                  <div
                    style={{
                      height: CHART_H + 18,
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                      gap: 3,
                    }}
                  >
                    {[
                      { v: d.newLeads, color: BAR_NEW },
                      { v: d.contacted, color: BAR_CONTACTED },
                    ].map((bar, i) => (
                      <div
                        key={i}
                        style={{
                          width: 19,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "flex-end",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            color: "#475569",
                            lineHeight: "14px",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {num(bar.v)}
                        </span>
                        <div
                          style={{
                            width: "100%",
                            height: barHeight(bar.v, maxDaily, CHART_H),
                            background: bar.color,
                            borderRadius: "2px 2px 0 0",
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      borderTop: "1px solid #E2E8F0",
                      marginTop: 2,
                      paddingTop: 4,
                      textAlign: "center",
                      fontSize: 11,
                      color: "#64748B",
                    }}
                  >
                    {dayLabel(d.day)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Funnel + lost reasons */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div style={{ ...cardStyle, padding: 16 }}>
          <h2 style={h2Style}>{t("summary.funnel.title")}</h2>
          <p style={{ ...hintStyle, marginBottom: 12 }}>{t("summary.funnel.hint")}</p>
          {STATUS_KEYS.map((k) => {
            const count = report.funnel[k] ?? 0;
            const pct = report.newLeads > 0 ? Math.round((count / report.newLeads) * 100) : 0;
            return (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ width: 84, fontSize: 13, color: "#334155" }}>{statusLabel(k)}</span>
                <div style={{ flex: 1, height: 14, background: "#F1F5F9", borderRadius: 3 }}>
                  <div
                    style={{
                      width: `${(count / maxFunnel) * 100}%`,
                      minWidth: count > 0 ? 2 : 0,
                      height: "100%",
                      background: STATUS_COLOR[k].color,
                      borderRadius: 3,
                    }}
                  />
                </div>
                <span
                  style={{
                    minWidth: 76,
                    textAlign: "right",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#334155",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {num(count)}
                  <span style={{ fontWeight: 400, color: "#94A3B8", marginLeft: 4 }}>({pct}%)</span>
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ ...cardStyle, padding: 16 }}>
          <h2 style={h2Style}>{t("summary.reasons.title")}</h2>
          <p style={{ ...hintStyle, marginBottom: 12 }}>{t("summary.reasons.hint")}</p>
          {report.lostReasons.length === 0 ? (
            <div style={emptyStyle}>{t("summary.reasons.empty")}</div>
          ) : (
            report.lostReasons.map((r) => (
              <div
                key={r.reason ?? "none"}
                style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}
              >
                <span style={{ width: 130, fontSize: 13, color: "#334155" }}>
                  {r.reason ? t(`lostReason.${r.reason}` as TKey) : t("summary.reasons.none")}
                </span>
                <div style={{ flex: 1, height: 14, background: "#F1F5F9", borderRadius: 3 }}>
                  <div
                    style={{
                      width: `${(r.count / maxReason) * 100}%`,
                      minWidth: r.count > 0 ? 2 : 0,
                      height: "100%",
                      background: "#B91C1C",
                      borderRadius: 3,
                    }}
                  />
                </div>
                <span
                  style={{
                    minWidth: 32,
                    textAlign: "right",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#334155",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {num(r.count)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Unreplied */}
      <div style={{ marginBottom: 10 }}>
        <h2 style={h2Style}>{t("summary.unreplied.title")}</h2>
        <p style={hintStyle}>{t("summary.unreplied.hint")}</p>
      </div>
      <div style={{ ...cardStyle, overflow: "hidden" }}>
        {report.unreplied.length === 0 ? (
          <div style={emptyStyle}>{t("summary.unreplied.empty")}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                  <th style={thStyle}>{t("summary.unreplied.col.name")}</th>
                  <th style={thStyle}>{t("summary.unreplied.col.phone")}</th>
                  <th style={thStyle}>{t("summary.unreplied.col.status")}</th>
                  <th style={thStyle}>{t("summary.unreplied.col.last")}</th>
                  <th style={thStyle}>{t("summary.unreplied.col.wait")}</th>
                </tr>
              </thead>
              <tbody>
                {report.unreplied.map((u) => {
                  const color = STATUS_COLOR[u.status] ?? STATUS_COLOR.new;
                  return (
                    <tr key={u.leadId} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={tdStyle}>
                        <Link
                          href={`/leads/${u.leadId}`}
                          style={{ color: "#0A0A0A", fontWeight: 500, textDecoration: "underline" }}
                        >
                          {u.name?.trim() || t("summary.unreplied.noName")}
                        </Link>
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {u.waId ? formatPhone(u.waId) : "—"}
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            fontSize: 12,
                            fontWeight: 600,
                            borderRadius: 4,
                            background: color.background,
                            color: color.color,
                          }}
                        >
                          {STATUS_KEYS.includes(u.status) ? statusLabel(u.status) : u.status}
                        </span>
                      </td>
                      {/* Customer text, never translated. */}
                      <td style={{ ...tdStyle, color: "#475569", maxWidth: 360 }}>
                        {u.lastMessage ? truncate(u.lastMessage, 80) : "—"}
                      </td>
                      <td style={{ ...tdStyle, color: "#92400E", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {waitText(u.waitingSince, t)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
