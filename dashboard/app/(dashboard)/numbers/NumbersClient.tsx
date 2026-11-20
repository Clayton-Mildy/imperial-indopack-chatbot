"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { PhoneNumber } from "@/types/api";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { formatDate as fmtDate, type TFn } from "@/lib/i18n/core";

import {
  removeNumber,
  createPhoneNumber,
  updatePhoneNumber,
} from "@/actions/numberActions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function friendlyError(e: unknown, t: TFn): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("CONFLICT") || msg.includes("unique") || msg.includes("duplicate"))
    return t("common.err.duplicateNumber");
  if (msg.includes("EMAIL_ALREADY_EXISTS")) return t("common.err.duplicateEmail");
  if (msg.includes("VALIDATION") || msg.includes("validation"))
    return t("common.err.validation");
  if (msg.includes("NOT_FOUND")) return t("common.err.notFound");
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch"))
    return t("common.err.network");
  return t("common.err.generic");
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/^\+/, "").replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length >= 11) {
    const local = digits.slice(2);
    return `+62 ${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  return raw.startsWith("+") ? raw : `+${digits}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#1F1F1F",
  marginBottom: 5,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 13,
  color: "#0A0A0A",
  background: "white",
  border: "1px solid #CBD5E1",
  borderRadius: 4,
  outline: "none",
  boxSizing: "border-box",
};

const btnPrimaryStyle: React.CSSProperties = {
  height: 36,
  padding: "0 16px",
  background: "#586B34",
  color: "white",
  border: "none",
  borderRadius: 4,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const btnSecondaryStyle: React.CSSProperties = {
  height: 36,
  padding: "0 16px",
  background: "white",
  color: "#1F1F1F",
  border: "1px solid #CBD5E1",
  borderRadius: 4,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
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

const iconBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "1px solid #E2E8F0",
  borderRadius: 4,
  cursor: "pointer",
  color: "#64748B",
};

// ─── Toggle ───────────────────────────────────────────────────────────────────

// ─── Register Modal ───────────────────────────────────────────────────────────

function RegisterModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (num: PhoneNumber) => void;
}) {
  const t = useT();
  const [label, setLabel] = useState("");
  const [number, setNumber] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);

  function handleSubmit() {
    setError(null);
    setNumberError(null);
    startTransition(async () => {
      try {
        const num = await createPhoneNumber({
          number,
          label,
          wabaId,
          phoneNumberId,
        });
        onCreated(num);
        onClose();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("CONFLICT") || msg.includes("unique") || msg.includes("duplicate")) {
          setNumberError(t("common.err.duplicateNumber"));
        } else {
          setError(friendlyError(e, t));
        }
      }
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 8,
          width: 480,
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#0A0A0A" }}>
            {t("numbers.register.title")}
          </h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748B", display: "flex", alignItems: "center", padding: 4, borderRadius: 4 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>
            </svg>
          </button>
        </div>

        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ padding: "10px 14px", background: "#FEE2E2", color: "#B91C1C", borderRadius: 4, fontSize: 13 }}>
              {error}
            </div>
          )}

          <div>
            <label style={labelStyle}>{t("numbers.field.label")} <span style={{ color: "#DC2626" }}>*</span></label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="CS Line 1" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("numbers.field.phone")} <span style={{ color: "#DC2626" }}>*</span></label>
            <input value={number} onChange={(e) => { setNumber(e.target.value); setNumberError(null); }} placeholder="+6281200000070" style={{ ...inputStyle, fontFamily: "JetBrains Mono, monospace", ...(numberError ? { borderColor: "#DC2626" } : {}) }} />
            {numberError ? (
              <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 4 }}>{numberError}</div>
            ) : (
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>{t("numbers.field.phoneExample")}</div>
            )}
          </div>
          <div>
            <label style={labelStyle}>
              {t("numbers.field.waba")} <span style={{ color: "#DC2626" }}>*</span>
            </label>
            <input value={wabaId} onChange={(e) => setWabaId(e.target.value)} placeholder="1234567890" style={{ ...inputStyle, fontFamily: "JetBrains Mono, monospace" }} />
          </div>
          <div>
            <label style={labelStyle}>
              {t("numbers.field.phoneId")} <span style={{ color: "#DC2626" }}>*</span>
            </label>
            <input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="1234567890" style={{ ...inputStyle, fontFamily: "JetBrains Mono, monospace" }} />
          </div>

          <div style={{ padding: "10px 14px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 4, fontSize: 12, color: "#64748B" }}>
            {t("numbers.register.notePre")}<strong>{t("numbers.settingsPage")}</strong>{t("numbers.register.notePost")}
          </div>
        </div>

        <div style={{ padding: "14px 20px", borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btnSecondaryStyle} disabled={pending}>{t("common.cancel")}</button>
          <button onClick={handleSubmit} style={btnPrimaryStyle} disabled={pending}>
            {pending ? t("numbers.registering") : t("numbers.register")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({
  num,
  onClose,
  onUpdated,
}: {
  num: PhoneNumber;
  onClose: () => void;
  onUpdated: (updated: PhoneNumber) => void;
}) {
  const t = useT();
  const [label, setLabel] = useState(num.label ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const updated = await updatePhoneNumber(num.id, {
          label: label.trim() || undefined,
        });
        onUpdated(updated);
        onClose();
      } catch (e) {
        setError(friendlyError(e, t));
      }
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 8,
          width: 520,
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#0A0A0A" }}>
            {t("numbers.edit.title")}
          </h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748B", display: "flex", alignItems: "center", padding: 4, borderRadius: 4 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>
            </svg>
          </button>
        </div>

        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ padding: "10px 14px", background: "#FEE2E2", color: "#B91C1C", borderRadius: 4, fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Read-only number display */}
          <div>
            <label style={labelStyle}>{t("numbers.field.number")}</label>
            <div style={{ fontSize: 13, fontFamily: "JetBrains Mono, monospace", color: "#64748B", padding: "8px 10px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 4 }}>
              {formatPhone(num.number)}
            </div>
          </div>

          <div>
            <label style={labelStyle}>{t("numbers.field.label")}</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="CS Line 1"
              style={inputStyle}
            />
          </div>

          <div style={{ padding: "10px 14px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 4, fontSize: 12, color: "#64748B" }}>
            {t("numbers.edit.notePre")}<strong>{t("numbers.settingsPage")}</strong>{t("numbers.edit.notePost")}
          </div>
        </div>

        <div style={{ padding: "14px 20px", borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btnSecondaryStyle} disabled={pending}>{t("common.cancel")}</button>
          <button onClick={handleSubmit} style={btnPrimaryStyle} disabled={pending}>
            {pending ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Delete Modal ─────────────────────────────────────────────────────

function ConfirmDeleteModal({ title, description, onConfirm, onCancel, pending }: { title: string; description: string; onConfirm: () => void; onCancel: () => void; pending?: boolean }) {
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
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0A0A0A", margin: "0 0 8px" }}>{title}</h3>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 20px", lineHeight: 1.5 }}>{description}</p>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 24 }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ width: 16, height: 16, marginTop: 1, accentColor: "#B91C1C", cursor: "pointer", flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "#1F1F1F", lineHeight: 1.4 }}>{t("common.deleteAckPre")}<strong>{t("common.deleteAckStrong")}</strong>{t("common.deleteAckPost")}</span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} disabled={pending} style={{ height: 36, padding: "0 16px", background: "white", color: "#1F1F1F", border: "1px solid #CBD5E1", borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>{t("common.cancel")}</button>
          <button onClick={onConfirm} disabled={!checked || pending} style={{ height: 36, padding: "0 16px", background: checked && !pending ? "#B91C1C" : "#F1F5F9", color: checked && !pending ? "white" : "#94A3B8", border: "none", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: checked && !pending ? "pointer" : "not-allowed" }}>
            {pending ? t("common.deleting") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Client Component ────────────────────────────────────────────────────

export function NumbersClient({ initialNumbers }: { initialNumbers: PhoneNumber[] }) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const [numbers, setNumbers] = useState<PhoneNumber[]>(initialNumbers);
  const [showModal, setShowModal] = useState(false);
  const [editingNumber, setEditingNumber] = useState<PhoneNumber | null>(null);
  const [deletingNumber, setDeletingNumber] = useState<PhoneNumber | null>(null);
  const [pendingDelete, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Sync local state when server re-validates and passes fresh props
  useEffect(() => { setNumbers(initialNumbers); }, [initialNumbers]);

  function handleDelete(num: PhoneNumber) {
    setDeletingNumber(num);
  }

  function confirmDelete() {
    if (!deletingNumber) return;
    const id = deletingNumber.id;
    setDeletingNumber(null);
    setDeleteError(null);
    startDelete(async () => {
      try {
        const res = await removeNumber(id);
        if (!res.ok) { setDeleteError(res.error); return; }
        router.refresh();
      } catch (err) {
        console.error("[numbers] Delete failed:", err);
        setDeleteError(t("numbers.err.deleteFailed"));
      }
    });
  }

  function handleCreated(num: PhoneNumber) {
    setNumbers((prev) => [...prev, num]);
  }

  function handleUpdated(updated: PhoneNumber) {
    setNumbers((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  }

  function formatDate(iso: string) {
    return fmtDate(iso, lang, { day: "numeric", month: "long", year: "numeric" });
  }

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: 32 }}>
      {deletingNumber && (
        <ConfirmDeleteModal
          title={t("numbers.deleteTitle")}
          description={t("numbers.deleteDesc", { name: deletingNumber.label || deletingNumber.number })}
          onConfirm={confirmDelete}
          onCancel={() => setDeletingNumber(null)}
          pending={pendingDelete}
        />
      )}
      {deleteError && (
        <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 6, background: "#FDECEC", border: "1px solid #F5C2C2", color: "#8A1C1C", fontSize: 13, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <span>{deleteError}</span>
          <button type="button" onClick={() => setDeleteError(null)} aria-label={t("numbers.err.dismiss")} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0A0A0A" }}>{t("numbers.title")}</h1>
        <button
          onClick={() => setShowModal(true)}
          style={{ height: 36, padding: "0 14px", background: "#586B34", color: "white", border: "none", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {t("numbers.add")}
        </button>
      </div>

      {numbers.length === 0 ? (
        <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, padding: "40px 24px", textAlign: "center", color: "#64748B", fontSize: 14 }}>
          {t("numbers.empty")}
        </div>
      ) : (
        <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                <th style={{ ...thStyle, width: 200 }}>{t("numbers.col.number")}</th>
                <th style={thStyle}>{t("numbers.col.label")}</th>
                <th style={{ ...thStyle, width: 150 }}>{t("numbers.col.waba")}</th>
                <th style={{ ...thStyle, width: 140 }}>{t("numbers.col.registered")}</th>
                <th style={{ ...thStyle, width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {numbers.map((num) => (
                <tr key={num.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>{formatPhone(num.number)}</span>
                  </td>
                  <td style={tdStyle}>{num.label ?? <span style={{ color: "#94A3B8" }}>—</span>}</td>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "#1F1F1F" }}>{num.wabaId}</span>
                  </td>
                  <td style={{ ...tdStyle, color: "#64748B" }}>{formatDate(num.createdAt)}</td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        style={iconBtnStyle}
                        title={t("common.edit")}
                        onClick={() => setEditingNumber(num)}
                        disabled={pendingDelete}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button
                        style={{ ...iconBtnStyle, color: "#B91C1C" }}
                        title={t("common.delete")}
                        onClick={() => handleDelete(num)}
                        disabled={pendingDelete}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3,6 5,6 21,6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6M14 11v6"/>
                          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 12, color: "#64748B", marginTop: 12 }}>
        {t("numbers.showing", { n: numbers.length })}
      </p>

      {showModal && (
        <RegisterModal onClose={() => setShowModal(false)} onCreated={handleCreated} />
      )}

      {editingNumber && (
        <EditModal
          num={editingNumber}
          onClose={() => setEditingNumber(null)}
          onUpdated={handleUpdated}
        />
      )}
    </main>
  );
}
