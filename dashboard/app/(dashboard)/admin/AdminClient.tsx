"use client";

import { useState, useTransition, useEffect } from "react";
import { roleLabel } from "@/lib/roles";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { formatDate as fmtDate, type Lang, type TFn } from "@/lib/i18n/core";
import { useRouter } from "next/navigation";
import type { StaffPublic, StaffRole } from "@/types/api";
import {
  createStaffAction,
  patchStaffAction,
  deleteStaffAction,
} from "@/actions/staffActions";

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

const selectStyle: React.CSSProperties = {
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
  cursor: "pointer",
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function friendlyError(e: unknown, t: TFn): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("EMAIL_ALREADY_EXISTS") || msg.includes("CONFLICT") || msg.includes("unique") || msg.includes("duplicate"))
    return t("common.err.duplicateEmailUseOther");
  if (msg.includes("VALIDATION") || msg.includes("validation"))
    return t("common.err.validation");
  if (msg.includes("NOT_FOUND")) return t("common.err.notFound");
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch"))
    return t("common.err.network");
  return t("common.err.generic");
}

function formatDate(iso: string, lang: Lang) {
  return fmtDate(iso, lang, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ─── Close Icon ───────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </svg>
  );
}

// ─── Role Badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: StaffRole }) {
  const t = useT();
  const isAdmin = role === "admin";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        background: isAdmin ? "#DBEAFE" : "#F1F5F9",
        color: isAdmin ? "#1D4ED8" : "#475569",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      {roleLabel(role, t)}
    </span>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ isActive }: { isActive: boolean }) {
  const t = useT();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        background: isActive ? "#DCFCE7" : "#F1F5F1",
        color: isActive ? "#15803D" : "#5F6B5A",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          background: isActive ? "#15803D" : "#5F6B5A",
          borderRadius: 999,
        }}
      />
      {isActive ? t("admin.statusActive") : t("admin.statusInactive")}
    </span>
  );
}

// ─── Modal Overlay ────────────────────────────────────────────────────────────

function ModalOverlay({
  onClose,
  children,
  width = 480,
}: {
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
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
          width,
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Create Staff Modal ───────────────────────────────────────────────────────

function CreateStaffModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("agent");
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    setEmailError(null);
    if (password.length < 8) {
      setError(t("admin.passwordMin"));
      return;
    }
    startTransition(async () => {
      try {
        await createStaffAction({ email, password, displayName, role });
        onClose();
        router.refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("EMAIL_ALREADY_EXISTS") || msg.includes("CONFLICT") || msg.includes("unique") || msg.includes("duplicate")) {
          setEmailError(t("common.err.duplicateEmailUseOther"));
        } else {
          setError(friendlyError(e, t));
        }
      }
    });
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #E2E8F0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#0A0A0A" }}>
          {t("admin.create.title")}
        </h2>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "#64748B",
            display: "flex",
            alignItems: "center",
            padding: 4,
            borderRadius: 4,
          }}
        >
          <CloseIcon />
        </button>
      </div>

      <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {error && (
          <div
            style={{
              padding: "10px 14px",
              background: "#FEE2E2",
              color: "#B91C1C",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div>
          <label style={labelStyle}>{t("admin.field.displayName")} <span style={{ color: "#DC2626" }}>*</span></label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Staf Contoh"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>{t("admin.field.email")} <span style={{ color: "#DC2626" }}>*</span></label>
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
            placeholder="nama@imperial-indopack.example.com"
            style={{ ...inputStyle, ...(emailError ? { borderColor: "#DC2626" } : {}) }}
          />
          {emailError && (
            <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 4 }}>
              {emailError}
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>{t("admin.field.password")} <span style={{ color: "#DC2626" }}>*</span></label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("admin.ph.passwordMin")}
            style={inputStyle}
          />
          {password.length > 0 && password.length < 8 && (
            <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 4 }}>
              {t("admin.passwordMin")}
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>{t("admin.field.role")} <span style={{ color: "#DC2626" }}>*</span></label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            style={selectStyle}
          >
            <option value="agent">{t("common.role.agent")}</option>
            <option value="admin">{t("common.role.admin")}</option>
            {/* Read-only, and only sees /leads - see proxy.ts MARKETING_ALLOWED. */}
            <option value="marketing">{t("common.role.marketing")}</option>
          </select>
        </div>
      </div>

      <div
        style={{
          padding: "14px 20px",
          borderTop: "1px solid #E2E8F0",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <button onClick={onClose} style={btnSecondaryStyle} disabled={pending}>
          {t("common.cancel")}
        </button>
        <button onClick={handleSubmit} style={btnPrimaryStyle} disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </ModalOverlay>
  );
}

// ─── Edit Staff Modal ─────────────────────────────────────────────────────────

function EditStaffModal({
  staff,
  onClose,
}: {
  staff: StaffPublic;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(staff.displayName);
  const [email, setEmail] = useState(staff.email);
  const [role, setRole] = useState<StaffRole>(staff.role);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    setEmailError(null);
    if (newPassword.length > 0 && newPassword.length < 8) {
      setError(t("admin.newPasswordMin"));
      return;
    }
    startTransition(async () => {
      try {
        const payload: {
          email?: string;
          displayName?: string;
          role?: StaffRole;
          newPassword?: string;
        } = { email, displayName, role };
        if (newPassword.trim()) {
          payload.newPassword = newPassword;
        }
        await patchStaffAction(staff.id, payload);
        onClose();
        router.refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("EMAIL_ALREADY_EXISTS") || msg.includes("CONFLICT") || msg.includes("unique") || msg.includes("duplicate")) {
          setEmailError(t("common.err.duplicateEmailUseOther"));
        } else {
          setError(friendlyError(e, t));
        }
      }
    });
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #E2E8F0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#0A0A0A" }}>
          {t("admin.edit.title")}
        </h2>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "#64748B",
            display: "flex",
            alignItems: "center",
            padding: 4,
            borderRadius: 4,
          }}
        >
          <CloseIcon />
        </button>
      </div>

      <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {error && (
          <div
            style={{
              padding: "10px 14px",
              background: "#FEE2E2",
              color: "#B91C1C",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div>
          <label style={labelStyle}>{t("admin.field.displayName")} <span style={{ color: "#DC2626" }}>*</span></label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Staf Contoh"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>{t("admin.field.email")} <span style={{ color: "#DC2626" }}>*</span></label>
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
            placeholder="nama@imperial-indopack.example.com"
            style={{ ...inputStyle, ...(emailError ? { borderColor: "#DC2626" } : {}) }}
          />
          {emailError && (
            <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 4 }}>
              {emailError}
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>{t("admin.field.role")} <span style={{ color: "#DC2626" }}>*</span></label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            style={selectStyle}
          >
            <option value="agent">{t("common.role.agent")}</option>
            <option value="admin">{t("common.role.admin")}</option>
            {/* Read-only, and only sees /leads - see proxy.ts MARKETING_ALLOWED. */}
            <option value="marketing">{t("common.role.marketing")}</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t("admin.field.newPassword")}</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t("admin.ph.passwordKeep")}
            style={inputStyle}
          />
          {newPassword.length > 0 && newPassword.length < 8 && (
            <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 4 }}>
              {t("admin.passwordMin")}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          padding: "14px 20px",
          borderTop: "1px solid #E2E8F0",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <button onClick={onClose} style={btnSecondaryStyle} disabled={pending}>
          {t("common.cancel")}
        </button>
        <button onClick={handleSubmit} style={btnPrimaryStyle} disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </ModalOverlay>
  );
}

// ─── Confirm Delete Modal ─────────────────────────────────────────────────────

function ConfirmDeleteModal({
  staff,
  onConfirm,
  onCancel,
  pending,
}: {
  staff: StaffPublic;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  const t = useT();
  const [checked, setChecked] = useState(false);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{ position: "absolute", inset: 0, background: "rgba(10,10,10,0.55)" }}
        onClick={onCancel}
      />
      <div
        style={{
          position: "relative",
          background: "white",
          borderRadius: 8,
          width: 440,
          padding: 28,
          boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            background: "#FEE2E2",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#DC2626"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3,6 5,6 21,6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
          </svg>
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0A0A0A", margin: "0 0 8px" }}>
          {t("admin.delete.title")}
        </h3>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 20px", lineHeight: 1.5 }}>
          {t("admin.delete.descPre")}<strong>{staff.displayName}</strong> ({staff.email}){t("admin.delete.descPost")}
        </p>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            cursor: "pointer",
            marginBottom: 24,
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={{
              width: 16,
              height: 16,
              marginTop: 1,
              accentColor: "#B91C1C",
              cursor: "pointer",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 13, color: "#1F1F1F", lineHeight: 1.4 }}>
            {t("common.deleteAckPre")}<strong>{t("common.deleteAckStrong")}</strong>{t("common.deleteAckPost")}
          </span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            disabled={pending}
            style={{
              height: 36,
              padding: "0 16px",
              background: "white",
              color: "#1F1F1F",
              border: "1px solid #CBD5E1",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={!checked || pending}
            style={{
              height: 36,
              padding: "0 16px",
              background: checked && !pending ? "#B91C1C" : "#F1F5F9",
              color: checked && !pending ? "white" : "#94A3B8",
              border: "none",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
              cursor: checked && !pending ? "pointer" : "not-allowed",
            }}
          >
            {pending ? t("common.deleting") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Toggle Modal ─────────────────────────────────────────────────────

function ConfirmDeactivateModal({
  staff,
  onConfirm,
  onCancel,
  pending,
}: {
  staff: StaffPublic;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  const t = useT();
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{ position: "absolute", inset: 0, background: "rgba(10,10,10,0.55)" }}
        onClick={onCancel}
      />
      <div
        style={{
          position: "relative",
          background: "white",
          borderRadius: 8,
          width: 420,
          padding: 28,
          boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0A0A0A", margin: "0 0 8px" }}>
          {t("admin.deactivate.title")}
        </h3>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 24px", lineHeight: 1.5 }}>
          {t("admin.deactivate.descPre")}<strong>{staff.displayName}</strong>{t("admin.deactivate.descPost")}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            disabled={pending}
            style={btnSecondaryStyle}
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            style={btnPrimaryStyle}
          >
            {pending ? t("common.processing") : t("admin.deactivate")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Client Component ────────────────────────────────────────────────────

export function AdminClient({ initialStaff }: { initialStaff: StaffPublic[] }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const [staff, setStaff] = useState<StaffPublic[]>(initialStaff);
  const [showCreate, setShowCreate] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffPublic | null>(null);
  const [deletingStaff, setDeletingStaff] = useState<StaffPublic | null>(null);
  const [deactivatingStaff, setDeactivatingStaff] = useState<StaffPublic | null>(null);
  const [pendingAction, startAction] = useTransition();

  useEffect(() => {
    setStaff(initialStaff);
  }, [initialStaff]);

  function handleToggleActive(member: StaffPublic) {
    if (member.isActive) {
      // Deactivating — show confirmation
      setDeactivatingStaff(member);
    } else {
      // Activating — no confirmation needed
      startAction(async () => {
        try {
          const updated = await patchStaffAction(member.id, { isActive: true });
          setStaff((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        } catch (err) {
          console.error("[admin] Toggle active failed:", err);
        }
      });
    }
  }

  function confirmDeactivate() {
    if (!deactivatingStaff) return;
    const id = deactivatingStaff.id;
    setDeactivatingStaff(null);
    startAction(async () => {
      try {
        const updated = await patchStaffAction(id, { isActive: false });
        setStaff((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      } catch (err) {
        console.error("[admin] Deactivate failed:", err);
      }
    });
  }

  function confirmDelete() {
    if (!deletingStaff) return;
    const id = deletingStaff.id;
    setDeletingStaff(null);
    startAction(async () => {
      try {
        await deleteStaffAction(id);
        router.refresh();
      } catch (err) {
        console.error("[admin] Delete failed:", err);
      }
    });
  }

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: 32 }}>
      {/* Modals */}
      {showCreate && <CreateStaffModal onClose={() => setShowCreate(false)} />}
      {editingStaff && (
        <EditStaffModal staff={editingStaff} onClose={() => setEditingStaff(null)} />
      )}
      {deletingStaff && (
        <ConfirmDeleteModal
          staff={deletingStaff}
          onConfirm={confirmDelete}
          onCancel={() => setDeletingStaff(null)}
          pending={pendingAction}
        />
      )}
      {deactivatingStaff && (
        <ConfirmDeactivateModal
          staff={deactivatingStaff}
          onConfirm={confirmDeactivate}
          onCancel={() => setDeactivatingStaff(null)}
          pending={pendingAction}
        />
      )}

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0A0A0A" }}>
          {t("admin.heading")}
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            height: 36,
            padding: "0 14px",
            background: "#586B34",
            color: "white",
            border: "none",
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("admin.add")}
        </button>
      </div>

      {/* Table */}
      {staff.length === 0 ? (
        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 6,
            padding: "40px 24px",
            textAlign: "center",
            color: "#64748B",
            fontSize: 14,
          }}
        >
          {t("admin.empty")}
        </div>
      ) : (
        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                <th style={thStyle}>{t("admin.col.name")}</th>
                <th style={thStyle}>{t("admin.col.email")}</th>
                <th style={{ ...thStyle, width: 100 }}>{t("admin.col.role")}</th>
                <th style={{ ...thStyle, width: 100 }}>{t("admin.col.status")}</th>
                <th style={{ ...thStyle, width: 160 }}>{t("admin.col.joined")}</th>
                <th style={{ ...thStyle, width: 110 }}>{t("admin.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr key={member.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 500 }}>{member.displayName}</div>
                  </td>
                  <td style={{ ...tdStyle, color: "#475569" }}>{member.email}</td>
                  <td style={tdStyle}>
                    <RoleBadge role={member.role} />
                  </td>
                  <td style={tdStyle}>
                    <StatusBadge isActive={member.isActive} />
                  </td>
                  <td style={{ ...tdStyle, color: "#64748B" }}>
                    {formatDate(member.createdAt, lang)}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: 4 }}>
                      {/* Edit */}
                      <button
                        style={iconBtnStyle}
                        title={t("common.edit")}
                        onClick={() => setEditingStaff(member)}
                        disabled={pendingAction}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>

                      {/* Toggle active */}
                      <button
                        style={{
                          ...iconBtnStyle,
                          color: member.isActive ? "#B45309" : "#15803D",
                          borderColor: member.isActive ? "#FDE68A" : "#BBF7D0",
                          background: member.isActive ? "#FFFBEB" : "#F0FDF4",
                        }}
                        title={member.isActive ? t("admin.deactivate") : t("admin.activate")}
                        onClick={() => handleToggleActive(member)}
                        disabled={pendingAction}
                      >
                        {member.isActive ? (
                          // Pause / deactivate icon
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="6" y="4" width="4" height="16" />
                            <rect x="14" y="4" width="4" height="16" />
                          </svg>
                        ) : (
                          // Play / activate icon
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polygon points="5,3 19,12 5,21 5,3" />
                          </svg>
                        )}
                      </button>

                      {/* Delete */}
                      <button
                        style={{ ...iconBtnStyle, color: "#B91C1C" }}
                        title={t("common.delete")}
                        onClick={() => setDeletingStaff(member)}
                        disabled={pendingAction}
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3,6 5,6 21,6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
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
        {t("admin.showing", { n: staff.length })}
      </p>
    </main>
  );
}
