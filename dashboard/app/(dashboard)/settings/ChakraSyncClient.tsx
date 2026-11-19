"use client";

import { useState, useTransition } from "react";
import { runChakraSync } from "@/actions/settingsActions";
import type { ChakraSyncStatus } from "@/types/api";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { formatDate, type Lang, type TFn } from "@/lib/i18n/core";

function formatWhen(iso: string | null, lang: Lang, t: TFn): string {
  if (!iso) return t("settings.chakra.never");
  return formatDate(iso, lang, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** WhatsApp section, ChakraHQ only: the last history sync and a button to run one now. */
export function ChakraSyncClient({ status, canEdit }: { status: ChakraSyncStatus | null; canEdit: boolean }) {
  const t = useT();
  const lang = useLang();
  const [pending, startTransition] = useTransition();
  // The API returns as soon as the run starts, so the summary below is from the *previous*
  // run until the page is reloaded. Say so rather than pretending it finished.
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRun() {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const result = await runChakraSync().catch(() => ({ ok: false, error: t("settings.chakra.runFailed") }));
      if (result.ok) setNotice(t("settings.chakra.started"));
      else setError(result.error ?? t("settings.chakra.runFailed"));
    });
  }

  const last = status?.lastResult;

  return (
    <div style={{ borderTop: "1px solid #EEF2EA", paddingTop: 14 }}>
      <h3 style={{ fontSize: 13.5, fontWeight: 600, color: "#1F2421", margin: 0 }}>
        {t("settings.chakra.title")}
      </h3>
      <div style={{ paddingTop: 8, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#1F2421" }}>
            {t("settings.chakra.lastSynced", { when: formatWhen(status?.lastRunAt ?? null, lang, t) })}
          </div>
          <div style={{ fontSize: 12, color: "#5F6B5A", marginTop: 4, lineHeight: 1.5 }}>
            {last
              ? t("settings.chakra.summary", { chats: last.chats, messages: last.messages }) +
                (last.mediaFailed > 0 ? t("settings.chakra.expired", { n: last.mediaFailed }) : "") +
                (last.errors > 0 ? t("settings.chakra.failed", { n: last.errors }) : "")
              : t("settings.chakra.desc")}
            {" "}{t("settings.chakra.auto")}
          </div>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={handleRun}
            disabled={pending || status?.running === true}
            style={{
              flexShrink: 0,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 500,
              color: "#0A0A0A",
              background: "white",
              border: "1px solid #E2E8F0",
              borderRadius: 6,
              cursor: pending || status?.running ? "default" : "pointer",
              opacity: pending || status?.running ? 0.6 : 1,
            }}
          >
            {status?.running ? t("settings.chakra.running") : pending ? t("settings.chakra.starting") : t("settings.chakra.run")}
          </button>
        )}
      </div>
      {notice && <div role="status" style={{ marginTop: 10, fontSize: 12, color: "#5F6B5A" }}>{notice}</div>}
      {error && <div role="status" style={{ marginTop: 10, fontSize: 12, color: "#B91C1C" }}>{error}</div>}
    </div>
  );
}
