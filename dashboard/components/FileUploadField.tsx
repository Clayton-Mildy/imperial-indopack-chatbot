"use client";
import { useRef, useState } from "react";
import { BASE_PATH } from "@/lib/basePath";
import { useT } from "@/lib/i18n/LangProvider";

interface Props {
  label: string;
  accept: string;          // e.g. "image/*" or ".pdf"
  uploadEndpoint: string;  // e.g. "/api/upload-image" or "/api/upload-catalog"
  currentUrl?: string | null;
  onUploaded: (url: string) => void;
  previewType?: "image" | "document"; // default "image"
  optional?: boolean;
}

export function FileUploadField({ label, accept, uploadEndpoint, currentUrl, onUploaded, previewType = "image", optional = true }: Props) {
  const t = useT();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(currentUrl ?? null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      // uploadEndpoint is a route path ("/api/upload-image"); fetch() does not apply the /app basePath,
      // and a bare path misses the dashboard and comes back as an HTML 404 page (see lib/basePath.ts).
      const res = await fetch(`${BASE_PATH}${uploadEndpoint}`, { method: "POST", body: form });
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok || !body.data?.url) throw new Error(body.error ?? t("common.uploadFailed"));
      const url = body.data.url;
      setLocalUrl(url);
      onUploaded(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.uploadFailedRetry"));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#1F1F1F", marginBottom: 5, letterSpacing: "0.02em", textTransform: "uppercase" };

  return (
    <div>
      <label style={labelStyle}>
        {label} {optional && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{t("common.optional")}</span>}
      </label>

      {/* Preview */}
      {localUrl && previewType === "image" && (
        <img src={localUrl.startsWith("/uploads") ? `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:50070"}${localUrl}` : localUrl}
          alt={t("common.previewAlt")} style={{ display: "block", width: 80, height: 80, objectFit: "cover", borderRadius: 6, border: "1px solid #E2E8F0", marginBottom: 8 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      )}
      {localUrl && previewType === "document" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 4, marginBottom: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0369A1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <span style={{ fontSize: 12, color: "#0369A1" }}>{t("common.fileUploaded")}</span>
          <a href={localUrl.startsWith("/uploads") ? `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:50070"}${localUrl}` : localUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#64748B", marginLeft: "auto" }}>{t("common.view")}</a>
        </div>
      )}

      {/* Upload button */}
      <input ref={inputRef} type="file" accept={accept} style={{ display: "none" }} onChange={handleFile} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        style={{ height: 34, padding: "0 12px", background: "white", border: "1px solid #CBD5E1", borderRadius: 4, fontSize: 12, fontWeight: 500, color: "#1F1F1F", cursor: uploading ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 6, opacity: uploading ? 0.6 : 1 }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/>
          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
        </svg>
        {uploading ? t("common.uploading") : localUrl ? t("common.replaceFile") : t("common.uploadFile")}
      </button>
      {localUrl && (
        <button type="button" onClick={() => { setLocalUrl(null); onUploaded(""); }}
          style={{ marginLeft: 6, height: 34, padding: "0 10px", background: "transparent", border: "none", fontSize: 12, color: "#DC2626", cursor: "pointer" }}>
          {t("common.delete")}
        </button>
      )}
      {error && <p style={{ fontSize: 11, color: "#DC2626", margin: "4px 0 0" }}>{error}</p>}
    </div>
  );
}
