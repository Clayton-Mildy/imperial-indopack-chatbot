"use client";

import { useState, useTransition } from "react";
import { saveLeadSilenceDays, saveReopenMonthsAction, type SaveError } from "@/actions/settingsActions";
import { useT } from "@/lib/i18n/LangProvider";
import type { TKey } from "@/lib/i18n/core";
import { SaveStatus, hintStyle, numberInputStyle, primaryButtonStyle, sentenceRowStyle } from "./settingsUi";

/** A whole number from min to max, or null. */
function wholeIn(text: string, min: number, max: number): number | null {
  const v = text.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

const errorKey = (e: SaveError): TKey => (e === "forbidden" ? "settings.err.forbidden" : e === "invalid" ? "settings.err.invalid" : "settings.err.failed");

/**
 * Leads: how many months until a lost lead's customer counts as a new lead (1-12), and how many days of
 * silence close a lead as Lost (1-365). One Simpan saves whichever changed; a value that failed to
 * load stays empty and is only saved once staff type one.
 */
export function LeadSettingsClient({
  initialMonths,
  initialSilenceDays,
  canEdit,
}: {
  initialMonths: number | null;
  initialSilenceDays: number | null;
  canEdit: boolean;
}) {
  const t = useT();
  const [saved, setSaved] = useState({ months: initialMonths, days: initialSilenceDays });
  const [months, setMonths] = useState(initialMonths === null ? "" : String(initialMonths));
  const [days, setDays] = useState(initialSilenceDays === null ? "" : String(initialSilenceDays));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    initialMonths === null || initialSilenceDays === null ? { ok: false, text: t("settings.err.load") } : null,
  );
  const [pending, startTransition] = useTransition();
  const disabled = pending || !canEdit;

  function handleSave() {
    const monthsDirty = months.trim() !== (saved.months === null ? "" : String(saved.months));
    const daysDirty = days.trim() !== (saved.days === null ? "" : String(saved.days));
    const m = wholeIn(months, 1, 12);
    const d = wholeIn(days, 1, 365);
    if (monthsDirty && m === null) return setStatus({ ok: false, text: t("settings.leads.reopenInvalid") });
    if (daysDirty && d === null) return setStatus({ ok: false, text: t("settings.leads.silenceInvalid") });
    if (!monthsDirty && !daysDirty) return setStatus({ ok: true, text: t("settings.saved") });
    setStatus(null);
    startTransition(async () => {
      const failed = (error: SaveError) => ({ ok: false as const, error });
      const mRes = monthsDirty && m !== null ? await saveReopenMonthsAction(m).catch(() => failed("failed")) : null;
      const dRes = daysDirty && d !== null ? await saveLeadSilenceDays(d).catch(() => failed("failed")) : null;
      setSaved((s) => ({ months: mRes?.ok ? mRes.months : s.months, days: dRes?.ok ? dRes.days : s.days }));
      if (mRes?.ok) setMonths(String(mRes.months));
      if (dRes?.ok) setDays(String(dRes.days));
      const error = (mRes && !mRes.ok ? mRes.error : null) ?? (dRes && !dRes.ok ? dRes.error : null);
      setStatus(error ? { ok: false, text: t(errorKey(error)) } : { ok: true, text: t("settings.saved") });
    });
  }

  return (
    <>
      <div style={sentenceRowStyle}>
        <label htmlFor="st-reopen">{t("settings.leads.reopenLabel")}</label>
        <input id="st-reopen" type="text" inputMode="numeric" value={months} disabled={disabled} onChange={(e) => { setMonths(e.target.value); setStatus(null); }} style={numberInputStyle} />
        <span>{t("settings.leads.months")}</span>
      </div>
      <span style={{ ...hintStyle, fontSize: 12, marginTop: -8 }}>{t("settings.leads.reopenHint")}</span>
      <div style={sentenceRowStyle}>
        <label htmlFor="st-silence">{t("settings.leads.silenceLabel")}</label>
        <input id="st-silence" type="text" inputMode="numeric" value={days} disabled={disabled} onChange={(e) => { setDays(e.target.value); setStatus(null); }} style={numberInputStyle} />
        <span>{t("settings.leads.days")}</span>
      </div>
      <span style={{ ...hintStyle, fontSize: 12, marginTop: -8 }}>{t("settings.leads.silenceHint")}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {canEdit && (
          <button type="button" onClick={handleSave} disabled={pending} style={primaryButtonStyle(pending)}>
            {pending ? t("settings.saving") : t("settings.save")}
          </button>
        )}
        <SaveStatus status={status} />
      </div>
    </>
  );
}
