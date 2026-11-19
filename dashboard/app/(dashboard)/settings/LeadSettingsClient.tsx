"use client";

import { useState, useTransition } from "react";
import { saveLeadReopenDays, saveLeadSilenceDays, type LeadReopenResult } from "@/actions/settingsActions";
import { useT } from "@/lib/i18n/LangProvider";
import type { TKey } from "@/lib/i18n/core";

/** One "N days" setting: number input, save button, result message, hint. */
function DaysField({
  id,
  label,
  hint,
  initialDays,
  save,
}: {
  id: string;
  label: TKey;
  hint: TKey;
  initialDays: number | null;
  save: (days: number) => Promise<LeadReopenResult>;
}) {
  const t = useT();
  const [value, setValue] = useState(initialDays === null ? "" : String(initialDays));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    initialDays === null ? { ok: false, text: t("settings.leads.loadFailed") } : null,
  );

  function handleSave() {
    const days = Number(value);
    if (value.trim() === "" || !Number.isInteger(days) || days < 1 || days > 365) {
      setMsg({ ok: false, text: t("settings.leads.invalid") });
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const result = await save(days).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (result.ok) {
        setValue(String(result.days));
        setMsg({ ok: true, text: t("settings.leads.saved") });
      } else if (result.error === "invalid") {
        setMsg({ ok: false, text: t("settings.leads.invalid") });
      } else if (result.error === "forbidden") {
        setMsg({ ok: false, text: t("settings.leads.forbidden") });
      } else {
        setMsg({ ok: false, text: t("settings.leads.error") });
      }
    });
  }

  return (
    <div style={{ paddingTop: 14 }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 500, color: "#1F1F1F" }}>
        {t(label)}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <input
          id={id}
          type="number"
          min={1}
          max={365}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: 80, height: 32, padding: "0 8px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13 }}
        />
        <span style={{ fontSize: 13, color: "#64748B" }}>{t("settings.leads.unit")}</span>
        <button
          onClick={handleSave}
          disabled={pending}
          style={{
            height: 32,
            padding: "0 14px",
            background: "#0A0A0A",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            cursor: pending ? "default" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {t("settings.leads.save")}
        </button>
        {msg && (
          <span role="status" style={{ fontSize: 12, color: msg.ok ? "#15803D" : "#DC2626" }}>
            {msg.text}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "#64748B", marginTop: 8, lineHeight: 1.5 }}>{t(hint)}</div>
    </div>
  );
}

export function LeadSettingsClient({
  initialDays,
  initialSilenceDays,
}: {
  initialDays: number | null;
  initialSilenceDays: number | null;
}) {
  const t = useT();
  return (
    <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, padding: "20px 24px" }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0A0A0A", margin: 0, paddingBottom: 14, borderBottom: "1px solid #F1F5F9" }}>
        {t("settings.leads.title")}
      </h3>
      <DaysField
        id="lead-silence-days"
        label="settings.leads.silenceLabel"
        hint="settings.leads.silenceHint"
        initialDays={initialSilenceDays}
        save={saveLeadSilenceDays}
      />
      <DaysField
        id="lead-reopen-days"
        label="settings.leads.label"
        hint="settings.leads.hint"
        initialDays={initialDays}
        save={saveLeadReopenDays}
      />
    </div>
  );
}
