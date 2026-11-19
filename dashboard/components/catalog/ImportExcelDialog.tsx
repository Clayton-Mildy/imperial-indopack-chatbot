"use client";

import { useEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/basePath";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { formatNumber, type TFn } from "@/lib/i18n/core";
import { XLSX_MAX_BYTES } from "@/lib/uploadLimit";
import type { ImportPreview } from "@/types/api";

// The template's header row (api/src/services/catalogTemplate.ts TEMPLATE_COLUMNS). Excel headers
// are never translated.
const TEMPLATE_COLUMNS = [
  "Merek", "Produk", "Ukuran", "Gramasi", "Cetak", "Finishing", "Kegunaan",
  "Min Qty", "Satuan Qty", "Harga", "Satuan Harga", "Termasuk Ongkir", "Catatan",
];

const step: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: "50%",
  background: "#586B34",
  color: "#ffffff",
  fontSize: 12,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
const footerBtn: React.CSSProperties = {
  font: "inherit",
  fontSize: 13,
  fontWeight: 500,
  height: 36,
  padding: "0 16px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#ffffff",
  color: "#1F2421",
  cursor: "pointer",
};

function fileSize(bytes: number, lang: "id" | "en"): string {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)), lang)} KB`;
  return `${formatNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10, lang)} MB`;
}

function errorText(status: number, code: unknown, t: TFn): string {
  if (code === "INVALID_XLSX") return t("catalog.import.err.invalidXlsx");
  if (code === "UNSUPPORTED_MIME_TYPE") return t("catalog.import.err.notXlsx");
  if (status === 413 || code === "FILE_TOO_LARGE") return t("catalog.import.err.tooLarge");
  if (code === "FORBIDDEN") return t("catalog.err.forbidden");
  return t("catalog.import.err.failed");
}

interface Props {
  onClose: () => void;
  /** After the file was applied; the caller closes the dialog and refreshes the list. */
  onApplied: (validRows: number) => void;
}

/**
 * Import katalog dari Excel. Picking a file runs the dry run (counts and row errors, nothing written);
 * "Terapkan" sends the same file again without dryRun. One request at a time: every button is
 * disabled while one is in flight. Mounted only while open, so each opening starts clean.
 */
export function ImportExcelDialog({ onClose, onApplied }: Props) {
  const t = useT();
  const lang = useLang();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [phase, setPhase] = useState<"idle" | "checking" | "applying">("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = phase !== "idle";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function post(f: File, query: string): Promise<{ preview: ImportPreview } | null> {
    const form = new FormData();
    form.append("file", f, f.name);
    try {
      const res = await fetch(`${BASE_PATH}/api/catalog-import?${query}`, { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error || !body.data?.preview) {
        setError(errorText(res.status, body.error, t));
        return null;
      }
      return body.data as { preview: ImportPreview };
    } catch {
      setError(t("common.err.network"));
      return null;
    }
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again (after editing it) still fires
    if (!picked || busy) return;
    setFile(picked);
    setPreview(null);
    setError(null);
    if (!picked.name.toLowerCase().endsWith(".xlsx")) return setError(t("catalog.import.err.notXlsx"));
    // Same cap as the API's import route, so a huge file is refused before it is sent.
    if (picked.size > XLSX_MAX_BYTES) return setError(t("catalog.import.err.tooLarge"));
    setPhase("checking");
    const data = await post(picked, "dryRun=1");
    if (data) setPreview(data.preview);
    setPhase("idle");
  }

  async function apply() {
    if (!file || !preview || preview.validRows === 0 || busy) return;
    setPhase("applying");
    setError(null);
    const data = await post(file, new URLSearchParams({ fileName: file.name }).toString());
    setPhase("idle");
    if (data) onApplied(preview.validRows);
  }

  const badRows = preview ? Math.max(0, preview.totalRows - preview.validRows) : 0;
  const shownRows = preview ? new Set(preview.errors.map((e) => e.row)).size : 0;
  const hiddenRows = Math.max(0, badRows - shownRows);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(31, 36, 33, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ix-title"
        style={{
          width: "100%",
          maxWidth: 600,
          maxHeight: "calc(100vh - 32px)",
          background: "#ffffff",
          borderRadius: 12,
          boxShadow: "0 12px 32px rgba(31, 36, 33, 0.18)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: "#1F2421",
        }}
      >
        <div
          style={{
            padding: "18px 22px",
            borderBottom: "1px solid #EEF2EA",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span id="ix-title" style={{ fontSize: 16, fontWeight: 700 }}>
              {t("catalog.import.title")}
            </span>
            <span style={{ fontSize: 12, color: "#5F6B5A" }}>{t("catalog.import.subtitle")}</span>
          </div>
          <button
            type="button"
            aria-label={t("catalog.import.close")}
            onClick={onClose}
            disabled={busy}
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: 0,
              background: "none",
              color: "#5F6B5A",
              fontSize: 16,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
          {/* 1 · template */}
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={step}>1</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              <span>
                <b>{t("catalog.import.useTemplate")}</b> ·{" "}
                <a href={`${BASE_PATH}/api/catalog-template`} download style={{ color: "#445428" }}>
                  {t("catalog.import.downloadTemplate")}
                </a>
              </span>
              <span style={{ fontSize: 12, color: "#5F6B5A", lineHeight: 1.5 }}>
                {t("catalog.import.columns", { cols: TEMPLATE_COLUMNS.join(", ") })}
              </span>
            </div>
          </div>

          {/* 2 · file */}
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={step}>2</span>
            <input
              ref={inputRef}
              id="ix-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={pick}
              disabled={busy}
              style={{ display: "none" }}
            />
            {file ? (
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 12,
                  border: "1px solid #C9D6BB",
                  borderRadius: 8,
                  background: "#F5F8F2",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 40,
                    borderRadius: 4,
                    background: "#ffffff",
                    border: "1px solid #C9D6BB",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#445428",
                    flexShrink: 0,
                  }}
                >
                  XLSX
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</b>
                  <span style={{ fontSize: 12, color: "#5F6B5A" }}>
                    {preview
                      ? t("catalog.import.fileMeta", { size: fileSize(file.size, lang), rows: formatNumber(preview.totalRows, lang) })
                      : fileSize(file.size, lang)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                  style={{
                    font: "inherit",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "#445428",
                    border: 0,
                    background: "none",
                    cursor: busy ? "not-allowed" : "pointer",
                  }}
                >
                  {t("catalog.import.replaceFile")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                style={{
                  flex: 1,
                  font: "inherit",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#445428",
                  padding: 14,
                  border: "1px dashed #C9D6BB",
                  borderRadius: 8,
                  background: "#F5F8F2",
                  cursor: "pointer",
                }}
              >
                {t("catalog.import.pick")}
              </button>
            )}
          </div>

          {/* 3 · review */}
          {(file || error) && (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={step}>3</span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
                <b>{t("catalog.import.review")}</b>
                {phase === "checking" && <span style={{ color: "#5F6B5A" }}>{t("catalog.import.checking")}</span>}
                {error && (
                  <span role="alert" style={{ color: "#B91C1C" }}>
                    {error}
                  </span>
                )}
                {preview && (
                  <>
                    {/* Brand olive and deep gold for the counts; red only for the bad rows, which are errors. */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, fontVariantNumeric: "tabular-nums" }}>
                      <Count value={preview.newProducts} label={t("catalog.import.newProducts")} color="#586B34" lang={lang} />
                      <Count value={preview.changedPrices} label={t("catalog.import.changedPrices")} color="#8A6A2A" lang={lang} />
                      <Count value={badRows} label={t("catalog.import.badRows")} color="#B91C1C" border="#F1C9C9" lang={lang} />
                    </div>
                    {preview.newSizes > 0 && (
                      <span style={{ fontSize: 12, color: "#3B4540" }}>
                        {t("catalog.import.newSizes", { n: formatNumber(preview.newSizes, lang) })}
                      </span>
                    )}
                    {preview.errors.length > 0 && (
                      <div style={{ border: "1px solid #F1C9C9", borderRadius: 8, overflow: "hidden" }}>
                        {preview.errors.map((e, i) => (
                          <div
                            key={`${e.row}-${i}`}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "72px 1fr",
                              gap: 8,
                              padding: "8px 12px",
                              background: "#FFF7F7",
                              borderTop: i === 0 ? 0 : "1px solid #F7E1E1",
                            }}
                          >
                            <span style={{ fontWeight: 700, color: "#B91C1C" }}>{t("catalog.import.row", { row: e.row })}</span>
                            <span style={{ overflowWrap: "anywhere" }}>{e.message}</span>
                          </div>
                        ))}
                        {hiddenRows > 0 && (
                          <div style={{ padding: "8px 12px", background: "#FFF7F7", borderTop: "1px solid #F7E1E1", color: "#5F6B5A" }}>
                            {t("catalog.import.moreErrors", { n: formatNumber(hiddenRows, lang) })}
                          </div>
                        )}
                      </div>
                    )}
                    <span style={{ fontSize: 12, color: "#5F6B5A", lineHeight: 1.5 }}>{t("catalog.import.note")}</span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: "14px 22px", borderTop: "1px solid #EEF2EA", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...footerBtn, cursor: busy ? "not-allowed" : "pointer" }}>
            {t("catalog.import.cancel")}
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={busy || !preview || preview.validRows === 0}
            style={{
              ...footerBtn,
              fontWeight: 600,
              border: 0,
              background: busy || !preview || preview.validRows === 0 ? "#A9B696" : "#586B34",
              color: "#ffffff",
              cursor: busy || !preview || preview.validRows === 0 ? "not-allowed" : "pointer",
            }}
          >
            {phase === "applying"
              ? t("catalog.import.applying")
              : t("catalog.import.apply", { n: formatNumber(preview?.validRows ?? 0, lang) })}
          </button>
        </div>
      </div>
    </div>
  );
}

function Count({
  value,
  label,
  color,
  border = "#E1E7DC",
  lang,
}: {
  value: number;
  label: string;
  color: string;
  border?: string;
  lang: "id" | "en";
}) {
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 20, fontWeight: 700, color }}>{formatNumber(value, lang)}</span>
      <span style={{ fontSize: 12, color: "#5F6B5A" }}>{label}</span>
    </div>
  );
}
