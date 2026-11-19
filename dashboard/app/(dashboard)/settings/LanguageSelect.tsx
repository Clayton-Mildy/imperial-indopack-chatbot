"use client";

import { useTransition } from "react";
import { setLanguage } from "@/lib/i18n/actions";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { isLang } from "@/lib/i18n/core";
import { inputStyle } from "./settingsUi";

export function LanguageSelect({ id }: { id?: string }) {
  const lang = useLang();
  const t = useT();
  const [pending, startTransition] = useTransition();

  return (
    <select
      id={id}
      value={lang}
      disabled={pending}
      aria-label={t("settings.profile.language")}
      onChange={(e) => {
        const next = e.target.value;
        if (isLang(next)) startTransition(() => void setLanguage(next));
      }}
      style={{ ...inputStyle, padding: "0 10px" }}
    >
      <option value="id">{t("settings.profile.language.id")}</option>
      <option value="en">{t("settings.profile.language.en")}</option>
    </select>
  );
}
