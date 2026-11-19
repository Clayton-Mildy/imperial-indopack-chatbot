"use client";

import Link from "next/link";
import { describeChange } from "@/lib/catalog/productForm";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { formatDate, formatNumber } from "@/lib/i18n/core";
import type { CatalogHistoryEntry, CatalogProductDetail } from "@/types/api";

const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #E1E7DC",
  borderRadius: 8,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  fontSize: 13,
  color: "#1F2421",
};
const title: React.CSSProperties = { fontSize: 14, fontWeight: 600 };

const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };

/** "Riwayat perubahan": each saved change in words, newest first, with who made it and when (WIB). */
export function ProductHistory({ history }: { history: CatalogHistoryEntry[] }) {
  const t = useT();
  const lang = useLang();
  return (
    <section aria-labelledby="ph-title" style={{ ...card, gap: 10 }}>
      <span id="ph-title" style={title}>
        {t("catalog.history.title")}
      </span>
      {history.length === 0 ? (
        <span style={{ color: "#5F6B5A" }}>{t("catalog.history.empty")}</span>
      ) : (
        history.map((entry, i) => (
          <div
            key={entry.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              paddingBottom: i < history.length - 1 ? 10 : 0,
              borderBottom: i < history.length - 1 ? "1px solid #EEF2EA" : 0,
            }}
          >
            {entry.changes.map((c, j) => (
              <span key={j} style={{ overflowWrap: "anywhere" }}>
                {describeChange(c, t, lang)}
              </span>
            ))}
            <span style={{ fontSize: 11.5, color: "#5F6B5A" }}>
              {entry.actorName} · {formatDate(entry.changedAt, lang, WHEN)}
            </span>
          </div>
        ))
      )}
    </section>
  );
}

/** "Dipakai di percakapan": how often the bot quoted it in 30 days, the won leads, and a way to those leads. */
export function ProductUsage({ usage, productName }: { usage: CatalogProductDetail["usage"]; productName: string }) {
  const t = useT();
  const lang = useLang();
  return (
    <section aria-labelledby="pu-title" style={{ ...card, gap: 8 }}>
      <span id="pu-title" style={title}>
        {t("catalog.usage.title")}
      </span>
      <span style={{ color: "#3B4540" }}>
        {t("catalog.usage.line", { n: formatNumber(usage.quotedLast30Days, lang), m: formatNumber(usage.wonLeads, lang) })}
      </span>
      <Link
        href={`/leads?search=${encodeURIComponent(productName)}`}
        style={{ fontSize: 12.5, fontWeight: 600, color: "#445428" }}
      >
        {t("catalog.usage.leads")}
      </Link>
    </section>
  );
}
