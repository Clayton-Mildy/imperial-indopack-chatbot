"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/LangProvider";
import type { TKey } from "@/lib/i18n/core";

/** Pengaturan's sections, in page order: the anchor each section carries and its nav label. */
export const SETTINGS_SECTIONS: { id: string; label: TKey }[] = [
  { id: "bot", label: "settings.nav.bot" },
  { id: "pemesanan", label: "settings.nav.ordering" },
  { id: "leads", label: "settings.nav.leads" },
  { id: "tim", label: "settings.nav.team" },
  { id: "whatsapp", label: "settings.nav.whatsapp" },
  { id: "instruksi", label: "settings.nav.prompt" },
  { id: "profil", label: "settings.nav.profile" },
];

/** The in-page nav beside the sections; the last one clicked is marked, as the design marks Bot. */
export function SettingsNav() {
  const t = useT();
  const [active, setActive] = useState("bot");
  return (
    <nav
      aria-label={t("settings.nav.label")}
      style={{ flex: "1 1 180px", maxWidth: "100%", display: "flex", flexDirection: "column", gap: 2, fontSize: 13 }}
    >
      {SETTINGS_SECTIONS.map((s) => {
        const on = s.id === active;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={() => setActive(s.id)}
            aria-current={on ? "location" : undefined}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              textDecoration: "none",
              border: on ? "1px solid #E1E7DC" : "1px solid transparent",
              background: on ? "#ffffff" : "transparent",
              color: on ? "#3E4C24" : "#1F2421",
              fontWeight: on ? 600 : 400,
            }}
          >
            {t(s.label)}
          </a>
        );
      })}
    </nav>
  );
}
