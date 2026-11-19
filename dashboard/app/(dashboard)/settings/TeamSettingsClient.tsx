"use client";

import { useState, useTransition } from "react";
import { saveBotSettingsAction } from "@/actions/settingsActions";
import { NotificationToggle } from "@/components/layout/NotificationToggle";
import { useT } from "@/lib/i18n/LangProvider";
import { CATEGORY_COPY } from "@/lib/teamQueue";
import type { HandoffCategory } from "@/types/api";
import { SaveStatus, labelStyle, numberInputStyle, primaryButtonStyle, sentenceRowStyle } from "./settingsUi";

/** All seven hand-off reasons, in the API's HANDOFF_CATEGORIES order (CATEGORY_COPY is keyed by every one, in that order). */
const CATEGORIES = Object.keys(CATEGORY_COPY) as HandoffCategory[];

/**
 * Tim & notifikasi: after how many minutes an unanswered Perlu Tim chat reminds the team (5-1440),
 * push notifications in this browser, and why the bot hands a chat to the team.
 */
export function TeamSettingsClient({ initialMinutes, canEdit }: { initialMinutes: number | null; canEdit: boolean }) {
  const t = useT();
  const [value, setValue] = useState(initialMinutes === null ? "" : String(initialMinutes));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    initialMinutes === null ? { ok: false, text: t("settings.err.load") } : null,
  );
  const [pending, startTransition] = useTransition();

  function handleSave() {
    const v = value.trim();
    const minutes = /^\d+$/.test(v) ? Number(v) : NaN;
    if (!(minutes >= 5 && minutes <= 1440)) return setStatus({ ok: false, text: t("settings.team.reminderInvalid") });
    setStatus(null);
    startTransition(async () => {
      const res = await saveBotSettingsAction({ teamReminderMinutes: minutes }).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (res.ok) {
        setValue(String(res.settings.teamReminderMinutes));
        setStatus({ ok: true, text: t("settings.saved") });
      } else {
        setStatus({ ok: false, text: t(res.error === "forbidden" ? "settings.err.forbidden" : res.error === "invalid" ? "settings.team.reminderInvalid" : "settings.err.failed") });
      }
    });
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={sentenceRowStyle}>
          <label htmlFor="st-nudge">{t("settings.team.reminder")}</label>
          <input
            id="st-nudge"
            type="text"
            inputMode="numeric"
            value={value}
            disabled={pending || !canEdit}
            onChange={(e) => {
              setValue(e.target.value);
              setStatus(null);
            }}
            style={numberInputStyle}
          />
          <span>{t("settings.team.minutes")}</span>
          {canEdit && (
            <button type="button" onClick={handleSave} disabled={pending} style={primaryButtonStyle(pending)}>
              {pending ? t("settings.saving") : t("settings.save")}
            </button>
          )}
        </div>
        <SaveStatus status={status} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 16, fontSize: 13.5 }}>
        <span>{t("settings.team.push")}</span>
        <div style={{ width: 240, maxWidth: "100%" }}>
          <NotificationToggle />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        <span style={labelStyle}>{t("settings.team.categories")}</span>
        <span>{CATEGORIES.map((c) => t(CATEGORY_COPY[c].title)).join(" · ")}</span>
      </div>
    </>
  );
}
