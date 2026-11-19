"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/LangProvider";
import { changeOwnPasswordAction } from "@/actions/staffActions";
import { inputStyle, labelStyle, primaryButtonStyle } from "./settingsUi";

/** Profil saya: the signed-in staff member changes their own password. */
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

  const fieldStyle: React.CSSProperties = { ...inputStyle, width: "100%" };
  const marker = <span aria-hidden="true" style={{ color: "#92400E" }}>*</span>;

  return (
    <form onSubmit={handleSubmit} style={{ borderTop: "1px solid #EEF2EA", paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ fontSize: 13.5, fontWeight: 600, color: "#1F2421", margin: 0 }}>{t("settings.password.title")}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="st-pw-new" style={labelStyle}>
            {t("settings.password.new")} {marker}
          </label>
          <input
            id="st-pw-new"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setError(null); setSuccess(false); }}
            minLength={8}
            required
            placeholder={t("settings.password.phNew")}
            style={fieldStyle}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="st-pw-confirm" style={labelStyle}>
            {t("settings.password.confirm")} {marker}
          </label>
          <input
            id="st-pw-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); setError(null); setSuccess(false); }}
            minLength={8}
            required
            placeholder={t("settings.password.phConfirm")}
            style={fieldStyle}
          />
        </div>
      </div>

      {error && <p role="status" style={{ margin: 0, fontSize: 12, color: "#B91C1C" }}>{error}</p>}
      {success && (
        <p role="status" style={{ margin: 0, fontSize: 12, color: "#15803D", fontWeight: 500 }}>
          {t("settings.password.success")}
        </p>
      )}

      <div>
        <button type="submit" disabled={saving} style={primaryButtonStyle(saving)}>
          {saving ? t("common.saving") : t("settings.password.save")}
        </button>
      </div>
    </form>
  );
}
