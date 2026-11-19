"use client";

import { useTransition } from "react";
import { setLanguage } from "@/lib/i18n/actions";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import type { Lang } from "@/lib/i18n/core";

const OPTIONS: { value: Lang; label: string }[] = [
  { value: "id", label: "ID" },
  { value: "en", label: "EN" },
];

export function LanguageSwitch() {
  const lang = useLang();
  const t = useT();
  const [pending, startTransition] = useTransition();

  return (
    <div
      role="group"
      aria-label={t("header.language")}
      style={{
        display: "inline-flex",
        height: 30,
        border: "1px solid #CBD5E1",
        borderRadius: 6,
        overflow: "hidden",
        marginRight: 6,
        opacity: pending ? 0.6 : 1,
      }}
    >
      {OPTIONS.map(({ value, label }) => {
        const active = lang === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            disabled={pending}
            onClick={() => {
              if (!active) startTransition(() => void setLanguage(value));
            }}
            style={{
              padding: "0 10px",
              border: "none",
              fontSize: 12,
              fontWeight: 600,
              cursor: active ? "default" : "pointer",
              background: active ? "#0A0A0A" : "white",
              color: active ? "white" : "#475569",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
