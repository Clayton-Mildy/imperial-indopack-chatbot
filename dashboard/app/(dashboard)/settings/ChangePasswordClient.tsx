"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/LangProvider";
import { changeOwnPasswordAction } from "@/actions/staffActions";

export function ChangePasswordClient() {
  const t = useT();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  function validate(): string | null {
    if (newPassword.length < 8) return t("settings.password.tooShort");
    if (newPassword !== confirmPassword) return t("settings.password.mismatch");
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const result = await changeOwnPasswordAction(newPassword);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      setError(t("settings.password.error"));
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    height: 36,
    width: "100%",
    padding: "0 10px",
    fontSize: 13,
    color: "#0A0A0A",
    background: "white",
    border: "1px solid #CBD5E1",
    borderRadius: 4,
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, padding: "20px 24px" }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0A0A0A", margin: 0, paddingBottom: 14, borderBottom: "1px solid #F1F5F9" }}>
        {t("settings.password.title")}
      </h3>

      <form onSubmit={handleSubmit} style={{ paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: "#64748B" }}>
            {t("settings.password.new")} <span style={{ color: "#DC2626" }}>*</span>
          </label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setError(null); setSuccess(false); }}
            minLength={8}
            required
            placeholder={t("settings.password.phNew")}
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: "#64748B" }}>
            {t("settings.password.confirm")} <span style={{ color: "#DC2626" }}>*</span>
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); setError(null); setSuccess(false); }}
            minLength={8}
            required
            placeholder={t("settings.password.phConfirm")}
            style={inputStyle}
          />
        </div>

        {error && (
          <p style={{ margin: 0, fontSize: 12, color: "#B91C1C" }}>{error}</p>
        )}

        {success && (
          <p style={{ margin: 0, fontSize: 12, color: "#15803D", fontWeight: 500 }}>
            {t("settings.password.success")}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={saving}
            style={{
              height: 36,
              padding: "0 16px",
              background: saving ? "#88B44E" : "#586B34",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? t("common.saving") : t("settings.password.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
