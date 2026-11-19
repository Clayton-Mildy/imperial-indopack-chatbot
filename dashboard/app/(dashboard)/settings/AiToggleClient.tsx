"use client";

import { useState, useTransition } from "react";
import { Toggle } from "@/components/Toggle";
import { useT } from "@/lib/i18n/LangProvider";
import { setAiDefault } from "@/actions/settingsActions";

export function AiToggleClient({ initialAiEnabled }: { initialAiEnabled: boolean }) {
  const t = useT();
  const [aiEnabled, setAiEnabled] = useState(initialAiEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    const next = !aiEnabled;
    setAiEnabled(next); // optimistic — reverted below if the call fails
    setError(null);
    startTransition(async () => {
      const result = await setAiDefault(next).catch(() => ({ ok: false, error: t("settings.ai.saveFailed") }));
      if (!result.ok) {
        setAiEnabled(!next);
        setError(result.error ?? t("settings.ai.saveFailed"));
      }
    });
  }

  return (
    <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, padding: "20px 24px" }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0A0A0A", margin: 0, paddingBottom: 14, borderBottom: "1px solid #F1F5F9" }}>
        {t("settings.ai.title")}
      </h3>
      <div style={{ paddingTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#1F1F1F" }}>
            {aiEnabled ? t("settings.ai.on") : t("settings.ai.off")}
          </div>
          <div style={{ fontSize: 12, color: "#64748B", marginTop: 4, lineHeight: 1.5 }}>
            {t("settings.ai.hintPre")}<strong>{t("settings.ai.hintStrong")}</strong>{t("settings.ai.hintPost")}
          </div>
        </div>
        <Toggle on={aiEnabled} onChange={handleToggle} disabled={pending} />
      </div>
      {error && <div style={{ marginTop: 10, fontSize: 12, color: "#DC2626" }}>{error}</div>}
    </div>
  );
}
