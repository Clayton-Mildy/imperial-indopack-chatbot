"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveBotSettingsAction } from "@/actions/settingsActions";
import type { TFn } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/LangProvider";
import type { ChakraSyncStatus, WhatsAppStatus } from "@/types/api";
import { ChakraSyncClient } from "./ChakraSyncClient";
import { SaveStatus, hintStyle, numberInputStyle, primaryButtonStyle, sentenceRowStyle } from "./settingsUi";

/** Why the number is not connected, in the order it has to be fixed. */
function notConnectedReason(s: WhatsAppStatus, t: TFn): string {
  if (s.transport === "capture") return t("settings.wa.reason.noProvider");
  if (!s.credentialsSet) return t("settings.wa.reason.noCredentials", { transport: t(`settings.wa.transport.${s.transport}`) });
  return t("settings.wa.reason.noNumber");
}

/** How often the team's replies typed on the WhatsApp phone are pulled in (BotSettings.whatsappSyncMinutes, 0 = off). */
function SyncMinutesField({ initialMinutes, canEdit }: { initialMinutes: number; canEdit: boolean }) {
  const t = useT();
  const [value, setValue] = useState(String(initialMinutes));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    const v = value.trim();
    const minutes = /^\d+$/.test(v) ? Number(v) : NaN;
    if (!(minutes >= 0 && minutes <= 1440)) return setStatus({ ok: false, text: t("settings.wa.syncInvalid") });
    setStatus(null);
    startTransition(async () => {
      const res = await saveBotSettingsAction({ whatsappSyncMinutes: minutes }).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (res.ok) {
        setValue(String(res.settings.whatsappSyncMinutes));
        setStatus({ ok: true, text: t("settings.saved") });
      } else {
        setStatus({ ok: false, text: t(res.error === "forbidden" ? "settings.err.forbidden" : res.error === "invalid" ? "settings.wa.syncInvalid" : "settings.err.failed") });
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={sentenceRowStyle}>
        <label htmlFor="st-sync">{t("settings.wa.sync")}</label>
        <input
          id="st-sync"
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
      <span style={{ ...hintStyle, fontSize: 12 }}>{t("settings.wa.syncHint")}</span>
      <SaveStatus status={status} />
    </div>
  );
}

/**
 * WhatsApp: is the one number connected (and if not, why), a way to the Nomor WhatsApp page, and -
 * for ChakraHQ only, the provider whose phone app the team also replies from - the sync interval and
 * the manual history sync.
 */
export function WhatsAppStatusClient({
  status,
  syncMinutes,
  chakraSync,
  canEdit,
}: {
  status: WhatsAppStatus | null;
  syncMinutes: number | null;
  chakraSync: ChakraSyncStatus | null;
  canEdit: boolean;
}) {
  const t = useT();
  const connected = status?.connected === true;

  return (
    <>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          borderRadius: 8,
          fontSize: 13,
          ...(connected ? { border: "1px solid #CFE0B8", background: "#F5F8F2" } : { border: "1px dashed #D9C49A", background: "#FBF6EC" }),
        }}
      >
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <b>
            {status === null
              ? t("settings.err.load")
              : connected
                ? t("settings.wa.connected", { transport: t(`settings.wa.transport.${status.transport}`), n: status.numberCount })
                : t("settings.wa.notConnected")}
          </b>
          <span style={{ color: connected ? "#3B4540" : "#6E531E" }}>
            {t("settings.wa.oneNumber")}
            {status && !connected && ` ${notConnectedReason(status, t)}`}
          </span>
        </span>
        <Link
          href="/numbers"
          style={{
            fontSize: 13,
            fontWeight: 600,
            height: 36,
            padding: "0 14px",
            borderRadius: 6,
            display: "inline-flex",
            alignItems: "center",
            textDecoration: "none",
            ...(connected ? { border: "1px solid #D5DECF", background: "#ffffff", color: "#1F2421" } : { background: "#8A6A2A", color: "#ffffff" }),
          }}
        >
          {connected ? t("nav.numbers") : t("settings.wa.connect")}
        </Link>
      </div>
      {status?.transport === "chakra" && (
        <>
          {syncMinutes !== null && <SyncMinutesField initialMinutes={syncMinutes} canEdit={canEdit} />}
          <ChakraSyncClient status={chakraSync} canEdit={canEdit} />
        </>
      )}
    </>
  );
}
