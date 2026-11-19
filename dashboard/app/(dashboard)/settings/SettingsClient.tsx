"use client";

import { useState, useTransition } from "react";
import type { ApiKey } from "@/types/api";
import { apiFetch } from "@/lib/api/client";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { formatDate as fmtDate, type Lang, type TFn } from "@/lib/i18n/core";

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "#0A0A0A",
  verticalAlign: "middle",
};

function formatDate(iso: string | null, lang: Lang): string {
  if (!iso) return "—";
  return fmtDate(iso, lang, { day: "numeric", month: "long", year: "numeric" });
}

function friendlyError(e: unknown, fallback: string, t: TFn): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("VALIDATION") || msg.includes("validation"))
    return t("common.err.validation");
  if (msg.includes("NOT_FOUND")) return t("common.err.notFound");
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch"))
    return t("common.err.network");
  if (msg.includes("CONFLICT") || msg.includes("unique") || msg.includes("duplicate"))
    return t("settings.apiKeys.conflict");
  return fallback;
}

// NOTE: API key CRUD endpoints are not yet in the backend (auth.ts returns 501).
// These client-side calls will fail gracefully and show the error inline.

async function revokeApiKey(id: string): Promise<void> {
  await apiFetch(`/auth/api-keys/${id}`, { method: "DELETE" });
}

async function createApiKey(label: string): Promise<ApiKey & { rawKey?: string }> {
  const envelope = await apiFetch<ApiKey & { rawKey?: string }>("/auth/api-keys", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
  if (!envelope.data) throw new Error("Gagal membuat API key.");
  return envelope.data;
}

function ConfirmRevokeModal({ label, onConfirm, onCancel, pending }: { label: string; onConfirm: () => void; onCancel: () => void; pending?: boolean }) {
  const t = useT();
  const [checked, setChecked] = useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(10,10,10,0.55)" }} onClick={onCancel} />
      <div style={{ position: "relative", background: "white", borderRadius: 8, width: 440, padding: 28, boxShadow: "0 10px 25px rgba(0,0,0,0.15)" }}>
        <div style={{ width: 44, height: 44, borderRadius: 22, background: "#FEE2E2", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
          </svg>
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0A0A0A", margin: "0 0 8px" }}>{t("settings.apiKeys.revokeTitle")}</h3>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 20px", lineHeight: 1.5 }}>{t("settings.apiKeys.revokeDescPre")}<strong>{label}</strong>{t("settings.apiKeys.revokeDescPost")}</p>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 24 }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ width: 16, height: 16, marginTop: 1, accentColor: "#B91C1C", cursor: "pointer", flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "#1F1F1F", lineHeight: 1.4 }}>{t("settings.apiKeys.revokeAckPre")}<strong>{t("settings.apiKeys.revokeAckStrong")}</strong>{t("settings.apiKeys.revokeAckPost")}</span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} disabled={pending} style={{ height: 36, padding: "0 16px", background: "white", color: "#1F1F1F", border: "1px solid #CBD5E1", borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>{t("common.cancel")}</button>
          <button onClick={onConfirm} disabled={!checked || pending} style={{ height: 36, padding: "0 16px", background: checked && !pending ? "#B91C1C" : "#F1F5F9", color: checked && !pending ? "white" : "#94A3B8", border: "none", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: checked && !pending ? "pointer" : "not-allowed" }}>
            {pending ? t("settings.apiKeys.revoking") : t("settings.apiKeys.revoke")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsClient({ apiKeys: initialKeys }: { apiKeys: ApiKey[] }) {
  const t = useT();
  const lang = useLang();
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys);
  const [newLabel, setNewLabel] = useState("");
  const [newKeyRaw, setNewKeyRaw] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [revokingKey, setRevokingKey] = useState<ApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRevoke(key: ApiKey) {
    setRevokingKey(key);
  }

  function confirmRevoke() {
    if (!revokingKey) return;
    const id = revokingKey.id;
    setError(null);
    startTransition(async () => {
      try {
        await revokeApiKey(id);
        setKeys((prev) => prev.filter((k) => k.id !== id));
      } catch (e) {
        setError(friendlyError(e, t("settings.apiKeys.revokeFailed"), t));
      } finally {
        setRevokingKey(null);
      }
    });
  }

  function handleCreate() {
    if (!newLabel.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const key = await createApiKey(newLabel.trim());
        setNewKeyRaw(key.rawKey ?? null);
        setKeys((prev) => [...prev, key]);
        setNewLabel("");
        setShowCreate(false);
      } catch (e) {
        setError(friendlyError(e, t("settings.apiKeys.createFailed"), t));
      }
    });
  }

  return (
    <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, padding: "20px 24px" }}>
      {revokingKey && (
        <ConfirmRevokeModal
          label={revokingKey.label}
          onConfirm={confirmRevoke}
          onCancel={() => setRevokingKey(null)}
          pending={pending}
        />
      )}
      <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0A0A0A", margin: 0, paddingBottom: 14, borderBottom: "1px solid #F1F5F9" }}>
        {t("settings.apiKeys.title")}
      </h3>

      {error && (
        <div style={{ margin: "12px 0 0", padding: "10px 14px", background: "#FEF3C7", color: "#B45309", borderRadius: 4, fontSize: 13 }}>
          {error} <span style={{ fontSize: 11, color: "#92400E" }}>{t("settings.apiKeys.unavailable")}</span>
        </div>
      )}

      {newKeyRaw && (
        <div style={{ margin: "12px 0 0", padding: "12px 14px", background: "#DCFCE7", border: "1px solid #BBF7D0", borderRadius: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#15803D", marginBottom: 6 }}>{t("settings.apiKeys.created")}</div>
          <code style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#0A0A0A", wordBreak: "break-all" }}>{newKeyRaw}</code>
          <button onClick={() => setNewKeyRaw(null)} style={{ display: "block", marginTop: 8, background: "transparent", border: "none", fontSize: 12, color: "#64748B", cursor: "pointer", padding: 0 }}>{t("settings.apiKeys.close")}</button>
        </div>
      )}

      {keys.length === 0 ? (
        <div style={{ paddingTop: 14, fontSize: 13, color: "#64748B" }}>{t("settings.apiKeys.empty")}</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
          <thead>
            <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
              <th style={thStyle}>{t("settings.apiKeys.col.label")}</th>
              <th style={{ ...thStyle, width: 140 }}>{t("settings.apiKeys.col.created")}</th>
              <th style={{ ...thStyle, width: 160 }}>{t("settings.apiKeys.col.lastUsed")}</th>
              <th style={{ ...thStyle, width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id} style={{ borderBottom: "1px solid #F1F5F9", opacity: key.revokedAt ? 0.5 : 1 }}>
                <td style={tdStyle}>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "#1F1F1F" }}>{key.label}</span>
                </td>
                <td style={{ ...tdStyle, color: "#1F1F1F" }}>{formatDate(key.createdAt, lang)}</td>
                <td style={{ ...tdStyle, color: "#1F1F1F" }}>{formatDate(key.lastUsedAt, lang)}</td>
                <td style={tdStyle}>
                  {!key.revokedAt && (
                    <button
                      onClick={() => handleRevoke(key)}
                      disabled={pending}
                      style={{ height: 28, padding: "0 10px", background: "white", color: "#B91C1C", border: "1px solid #FECDD3", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                    >
                      {t("settings.apiKeys.revoke")}
                    </button>
                  )}
                  {key.revokedAt && (
                    <span style={{ fontSize: 11, color: "#94A3B8" }}>{t("settings.apiKeys.revoked")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCreate ? (
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t("settings.apiKeys.phLabel")}
            style={{ flex: 1, height: 36, padding: "0 10px", fontSize: 13, color: "#0A0A0A", background: "white", border: "1px solid #CBD5E1", borderRadius: 4, outline: "none" }}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowCreate(false); }}
          />
          <button
            onClick={handleCreate}
            disabled={pending || !newLabel.trim()}
            style={{ height: 36, padding: "0 14px", background: "#586B34", color: "white", border: "none", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            {pending ? t("settings.apiKeys.creating") : t("settings.apiKeys.create")}
          </button>
          <button
            onClick={() => setShowCreate(false)}
            style={{ height: 36, padding: "0 14px", background: "white", color: "#64748B", border: "1px solid #E2E8F0", borderRadius: 4, fontSize: 13, cursor: "pointer" }}
          >
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          style={{ background: "transparent", border: "none", color: "#445428", fontSize: 13, fontWeight: 500, cursor: "pointer", padding: "12px 0 0", display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {t("settings.apiKeys.createNew")}
        </button>
      )}
    </div>
  );
}
