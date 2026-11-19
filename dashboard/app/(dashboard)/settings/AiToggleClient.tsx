"use client";

import { useState, useTransition } from "react";
import { Toggle } from "@/components/Toggle";
import { useT } from "@/lib/i18n/LangProvider";
import { setAiDefault } from "@/actions/settingsActions";

/** Bot section's first row: the global auto-reply switch. Saves on toggle; a failed save flips it back. */
export function AiToggleClient({ initialAiEnabled, canEdit }: { initialAiEnabled: boolean; canEdit: boolean }) {
  const t = useT();
  const [aiEnabled, setAiEnabled] = useState(initialAiEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    const next = !aiEnabled;
    setAiEnabled(next); // optimistic — reverted below if the call fails
    setError(null);
    startTransition(async () => {
      const result = await setAiDefault(next).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (!result.ok) {
        setAiEnabled(!next);
        setError(result.error === "forbidden" ? t("settings.err.forbidden") : t("settings.ai.saveFailed"));
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "12px 14px", borderRadius: 8, background: "#F5F8F2" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <b style={{ fontSize: 13.5 }}>{t("settings.ai.title")}</b>
          <span style={{ fontSize: 12.5, color: "#3B4540" }}>{t("settings.ai.hint")}</span>
        </span>
        <Toggle on={aiEnabled} onChange={handleToggle} disabled={pending || !canEdit} label={t("settings.ai.title")} />
      </div>
      {error && <span role="status" style={{ fontSize: 12, color: "#B91C1C" }}>{error}</span>}
    </div>
  );
}
