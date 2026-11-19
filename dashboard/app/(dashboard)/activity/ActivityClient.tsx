"use client";
import { BASE_PATH } from "@/lib/basePath";

import { useEffect, useRef, useState } from "react";
import type { ActivityLog } from "@/types/api";
import { useT, useLang } from "@/lib/i18n/LangProvider";
import { formatDate } from "@/lib/i18n/core";

interface LogsResult {
  data: ActivityLog[];
  meta: { page: number; total: number; limit: number };
}

interface Props {
  initialData: LogsResult;
}

const LIMIT = 20;

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

export function ActivityClient({ initialData }: Props) {
  const t = useT();
  const lang = useLang();
  const [logs, setLogs] = useState<ActivityLog[]>(initialData.data);
  const [meta, setMeta] = useState(initialData.meta);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef(search);
  searchRef.current = search;

  async function fetchLogs(params: {
    search: string;
    startDate: string;
    endDate: string;
    page: number;
  }) {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("page", String(params.page));
      qs.set("limit", String(LIMIT));
      if (params.search) qs.set("search", params.search);
      if (params.startDate) qs.set("startDate", params.startDate);
      if (params.endDate) qs.set("endDate", params.endDate);

      const res = await fetch(`${BASE_PATH}/api/activity-logs?${qs.toString()}`);
      if (!res.ok) throw new Error("Failed to load");
      const result: LogsResult = await res.json();
      setLogs(result.data);
      setMeta(result.meta);
    } catch {
      // keep existing state on error
    } finally {
      setLoading(false);
    }
  }

  // Debounced search + immediate date/page changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchLogs({ search, startDate, endDate, page });
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, startDate, endDate, page]);

  function handleSearchChange(val: string) {
    setSearch(val);
    setPage(1);
  }

  function handleStartDate(val: string) {
    setStartDate(val);
    setPage(1);
  }

  function handleEndDate(val: string) {
    setEndDate(val);
    setPage(1);
  }

  function handleReset() {
    setSearch("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  const totalPages = Math.ceil(meta.total / LIMIT);

  const inputStyle: React.CSSProperties = {
    height: 34,
    padding: "0 10px",
    fontSize: 13,
    color: "#0A0A0A",
    background: "white",
    border: "1px solid #CBD5E1",
    borderRadius: 4,
    outline: "none",
  };

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: 32 }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 700, color: "#0A0A0A" }}>{t("activity.title")}</h1>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder={t("activity.searchPlaceholder")}
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          style={{ ...inputStyle, width: 240 }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#64748B", whiteSpace: "nowrap" }}>{t("activity.from")}</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => handleStartDate(e.target.value)}
            style={{ ...inputStyle, width: 150 }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#64748B", whiteSpace: "nowrap" }}>{t("activity.to")}</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => handleEndDate(e.target.value)}
            style={{ ...inputStyle, width: 150 }}
          />
        </div>

        {(search || startDate || endDate) && (
          <button
            onClick={handleReset}
            style={{
              height: 34,
              padding: "0 12px",
              fontSize: 12,
              fontWeight: 500,
              color: "#64748B",
              background: "white",
              border: "1px solid #CBD5E1",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {t("activity.reset")}
          </button>
        )}

        {loading && (
          <span style={{ fontSize: 12, color: "#94A3B8" }}>{t("activity.loading")}</span>
        )}
      </div>

      {/* Log feed */}
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, overflow: "hidden" }}>
        {logs.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: "#94A3B8", fontSize: 14 }}>
            {t("activity.empty")}
          </div>
        ) : (
          <div>
            {logs.map((log, idx) => (
              <div key={log.id}>
                <div style={{ display: "flex", gap: 16, padding: "14px 20px", alignItems: "flex-start" }}>
                  {/* Timestamp */}
                  <div
                    style={{
                      flexShrink: 0,
                      width: 148,
                      fontSize: 12,
                      color: "#94A3B8",
                      paddingTop: 2,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatDate(log.createdAt, lang, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      // h23, not hour12: false - en-US renders the latter as "24:05" after midnight.
                      hourCycle: "h23",
                    })}
                  </div>

                  {/* Message */}
                  <div style={{ flex: 1, fontSize: 13, color: "#0A0A0A", lineHeight: 1.5 }}>
                    {log.message}
                  </div>

                  {/* Performer badge */}
                  <div style={{ flexShrink: 0 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        padding: "2px 8px",
                        background: "#F1F5F9",
                        color: "#475569",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {log.performedBy}
                    </span>
                  </div>
                </div>

                {idx < logs.length - 1 && (
                  <div style={{ borderBottom: "1px solid #F1F5F9", margin: "0 20px" }} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid #F1F5F9", display: "flex", gap: 4, alignItems: "center" }}>
            <button
              style={{ ...pageBtnStyle, opacity: page <= 1 ? 0.4 : 1 }}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12,19 5,12 12,5"/>
              </svg>{" "}
              {t("activity.previous")}
            </button>

            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{
                    ...pageBtnStyle,
                    ...(page === p ? { background: "#586B34", color: "white", borderColor: "#586B34" } : {}),
                  }}
                >
                  {p}
                </button>
              );
            })}

            <button
              style={{ ...pageBtnStyle, opacity: page >= totalPages ? 0.4 : 1 }}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("activity.next")}{" "}
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
