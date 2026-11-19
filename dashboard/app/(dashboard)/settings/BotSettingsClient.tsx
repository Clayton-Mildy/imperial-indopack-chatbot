"use client";

import { useState, useTransition } from "react";
import { saveBotSettingsAction } from "@/actions/settingsActions";
import { useT } from "@/lib/i18n/LangProvider";
import type { BotSettings, SignAs } from "@/types/api";
import { SaveStatus, hintStyle, inputStyle, labelStyle, primaryButtonStyle, warnHintStyle } from "./settingsUi";

const SIGN_AS: SignAs[] = ["brand_discussed", "imperial_indopack"];
/** The shipped placeholder name (api/src/domain/botSettings.ts DEFAULT_BOT_SETTINGS). */
const TEMPORARY_NAME = "Admin";

/** Bot section: the bot's name, who it signs as, and its first greeting. */
export function BotSettingsClient({ initial, canEdit }: { initial: BotSettings; canEdit: boolean }) {
  const t = useT();
  const [saved, setSaved] = useState(initial);
  const [botName, setBotName] = useState(initial.botName);
  const [signAs, setSignAs] = useState<SignAs>(initial.signAs);
  const [greeting, setGreeting] = useState(initial.greeting);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const disabled = pending || !canEdit;

  function edit<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setStatus(null);
    };
  }

  function handleSave() {
    const name = botName.trim();
    const greet = greeting.trim();
    if (name.length < 1 || name.length > 40) return setStatus({ ok: false, text: t("settings.bot.nameInvalid") });
    if (greet.length < 1 || greet.length > 500) return setStatus({ ok: false, text: t("settings.bot.greetingInvalid") });
    setStatus(null);
    startTransition(async () => {
      const res = await saveBotSettingsAction({ botName: name, signAs, greeting: greet }).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (res.ok) {
        setSaved(res.settings);
        setBotName(res.settings.botName);
        setSignAs(res.settings.signAs);
        setGreeting(res.settings.greeting);
        setStatus({ ok: true, text: t("settings.saved") });
      } else {
        setStatus({ ok: false, text: t(res.error === "forbidden" ? "settings.err.forbidden" : res.error === "invalid" ? "settings.err.invalid" : "settings.err.failed") });
      }
    });
  }

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="st-name" style={labelStyle}>{t("settings.bot.name")}</label>
          <input id="st-name" type="text" maxLength={40} value={botName} disabled={disabled} onChange={(e) => edit(setBotName)(e.target.value)} style={inputStyle} />
          {saved.botName === TEMPORARY_NAME && <span style={warnHintStyle}>{t("settings.bot.nameTemp")}</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="st-sign" style={labelStyle}>{t("settings.bot.signAs")}</label>
          <select id="st-sign" value={signAs} disabled={disabled} onChange={(e) => edit(setSignAs)(e.target.value as SignAs)} style={{ ...inputStyle, padding: "0 10px" }}>
            {SIGN_AS.map((s) => (
              <option key={s} value={s}>{t(`settings.bot.signAs.${s}`)}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor="st-greet" style={labelStyle}>{t("settings.bot.greeting")}</label>
        <textarea
          id="st-greet"
          rows={2}
          maxLength={500}
          value={greeting}
          disabled={disabled}
          onChange={(e) => edit(setGreeting)(e.target.value)}
          style={{ ...inputStyle, height: "auto", padding: "10px 12px", resize: "vertical", lineHeight: 1.5 }}
        />
        <span style={hintStyle}>{t("settings.bot.greetingHint")}</span>
      </div>
      {canEdit && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={handleSave} disabled={pending} style={primaryButtonStyle(pending)}>
            {pending ? t("settings.saving") : t("settings.save")}
          </button>
          <SaveStatus status={status} />
        </div>
      )}
    </>
  );
}
