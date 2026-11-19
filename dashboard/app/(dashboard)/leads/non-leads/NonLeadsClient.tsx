"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import type { Lead } from "@/types/api";
import { updateLead } from "@/actions/leadActions";
import { useT, useLang } from "@/lib/i18n/LangProvider";
import { formatDate, type TKey } from "@/lib/i18n/core";

const TABS: { key: string; labelKey: TKey }[] = [
  { key: "all", labelKey: "nonLeads.tab.all" },
  { key: "kurir", labelKey: "kind.kurir" },
  { key: "status_pesanan", labelKey: "kind.status_pesanan" },
  { key: "lamaran_kerja", labelKey: "kind.lamaran_kerja" },
  { key: "supplier", labelKey: "kind.supplier" },
  { key: "lainnya", labelKey: "kind.lainnya" },
];

const SET_BY_KEY: Record<string, TKey> = {
  ai: "nonLeads.setBy.ai",
  rule: "nonLeads.setBy.rule",
  staff: "nonLeads.setBy.staff",
};

const NAME_KEYS = ["nama", "name", "nama_lengkap"];
const MESSAGE_KEYS = ["apa_yang_anda_butuhkan"];

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

function pick(bag: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = bag[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function NonLeadsClient({
  rows,
  meta,
  counts,
  activeKind,
  readOnly,
}: {
  rows: Lead[];
  meta: { page: number; total: number; limit: number };
  counts: Record<string, number | undefined>;
  activeKind: string;
  readOnly: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit));

  function go(kind: string, page: number) {
    const qs = new URLSearchParams();
    if (kind !== "all") qs.set("kind", kind);
    if (page > 1) qs.set("page", String(page));
    const query = qs.toString();
    router.push(`/leads/non-leads${query ? `?${query}` : ""}`);
  }

  function makeLead(id: string) {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await updateLead(id, { kind: "lead" });
      setBusyId(null);
      if (!res.ok) {
        setError(res.error ?? t("nonLeads.error"));
        return;
      }
      router.refresh();
    });
  }

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: 32, background: "#F8FAFC" }}>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "#64748B" }}>{t("nonLeads.intro")}</p>

      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #E2E8F0", marginBottom: 14 }}>
        {TABS.map((tab) => {
          const isActive = activeKind === tab.key;
          const count = counts[tab.key];
          return (
            <button
              key={tab.key}
              onClick={() => go(tab.key, 1)}
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
              {t(tab.labelKey)}
              {count !== undefined ? ` ${count}` : ""}
            </button>
          );
        })}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            padding: "8px 12px",
            fontSize: 13,
            color: "#B91C1C",
            background: "#FEE2E2",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "#64748B", fontSize: 14 }}>
            {t("nonLeads.empty")}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                <th style={thStyle}>{t("nonLeads.col.chatStarted")}</th>
                <th style={thStyle}>{t("nonLeads.col.contact")}</th>
                <th style={thStyle}>{t("nonLeads.col.kind")}</th>
                <th style={thStyle}>{t("nonLeads.col.message")}</th>
                <th style={thStyle}>{t("nonLeads.col.setBy")}</th>
                {!readOnly && <th style={thStyle}>{t("nonLeads.col.action")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = row.name ?? pick(row.payload, NAME_KEYS) ?? row.displayName;
                const message = pick(row.payload, MESSAGE_KEYS);
                const setByKey = row.kindSetBy ? SET_BY_KEY[row.kindSetBy] : undefined;
                const busy = busyId === row.id && isPending;
                return (
                  <tr key={row.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <td style={{ ...tdStyle, fontSize: 12, color: "#334155", whiteSpace: "nowrap" }}>
                      {formatDate(row.conversationStartedAt ?? row.submittedAt, lang)}
                    </td>
                    <td style={tdStyle}>
                      <Link href={`/leads/${row.id}`} style={{ textDecoration: "none" }}>
                        <div style={{ fontWeight: 500, fontSize: 14, color: "#0A0A0A" }}>
                          {name ?? t("leadDetail.noName")}
                        </div>
                        {row.waId && (
                          <div
                            style={{
                              fontFamily: "JetBrains Mono, monospace",
                              fontSize: 11,
                              color: "#94A3B8",
                              marginTop: 2,
                            }}
                          >
                            {formatPhone(row.waId)}
                          </div>
                        )}
                      </Link>
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "#F1F5F9",
                          color: "#475569",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t(`kind.${row.kind}` as TKey)}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 360, color: message ? "#334155" : "#94A3B8" }}>
                      {message ?? "—"}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, color: setByKey ? "#334155" : "#94A3B8" }}>
                      {setByKey ? t(setByKey) : "—"}
                    </td>
                    {!readOnly && (
                      <td style={tdStyle}>
                        <button
                          onClick={() => makeLead(row.id)}
                          disabled={busy}
                          style={{
                            ...pageBtnStyle,
                            height: 30,
                            color: "#445428",
                            borderColor: "#D5DECF",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            opacity: busy ? 0.5 : 1,
                          }}
                        >
                          {t("nonLeads.makeLead")}
                        </button>
                      </td>
                    )}
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
            {t("nonLeads.pageOf", { page: meta.page, pages: totalPages, total: meta.total })}
          </span>
          <button
            style={{ ...pageBtnStyle, opacity: meta.page <= 1 ? 0.5 : 1 }}
            disabled={meta.page <= 1}
            onClick={() => go(activeKind, meta.page - 1)}
          >
            {t("leads.prev")}
          </button>
          <button
            style={{ ...pageBtnStyle, opacity: meta.page >= totalPages ? 0.5 : 1 }}
            disabled={meta.page >= totalPages}
            onClick={() => go(activeKind, meta.page + 1)}
          >
            {t("leads.next")}
          </button>
        </div>
      )}
    </main>
  );
}
