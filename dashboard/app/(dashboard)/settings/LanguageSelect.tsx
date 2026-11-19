"use client";

import { useTransition } from "react";
import { setLanguage } from "@/lib/i18n/actions";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { isLang } from "@/lib/i18n/core";

export function LanguageSelect() {
  const lang = useLang();
  const t = useT();
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={lang}
      disabled={pending}
      aria-label={t("settings.profile.language")}
      onChange={(e) => {
        const next = e.target.value;
        if (isLang(next)) startTransition(() => void setLanguage(next));
      }}
      style={{
        height: 32,
        border: "1px solid #CBD5E1",
        borderRadius: 6,
        padding: "0 8px",
        fontSize: 13,
        color: "#0A0A0A",
        background: "white",
      }}
    >
      <option value="id">{t("settings.profile.language.id")}</option>
      <option value="en">{t("settings.profile.language.en")}</option>
    </select>
  );
}
