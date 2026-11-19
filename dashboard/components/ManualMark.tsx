"use client";

import { useT, useLang } from "@/lib/i18n/LangProvider";
import { formatDate } from "@/lib/i18n/core";

/**
 * "Manual" tag on a lead field staff set by hand. The AI never writes that field again (a per-field
 * lock on the lead), so the tag is also the answer to "why isn't the bot updating this?". The
 * tooltip says who and when; either may be unknown (an edit from before 2026-11-10 kept no name).
 */
export function ManualMark({ at, name, block = false }: { at?: string | null; name?: string | null; block?: boolean }) {
  const t = useT();
  const lang = useLang();
  const when = at ? formatDate(at, lang, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  const title = name
    ? when
      ? t("leads.manual.byAt", { name, when })
      : t("leads.manual.by", { name })
    : when
      ? t("leads.manual.at", { when })
      : t("leads.manual.title");
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: block ? "inline-block" : "inline",
        marginTop: block ? 4 : 0,
        marginLeft: block ? 0 : 6,
        fontSize: 10,
        fontWeight: 600,
        padding: "1px 5px",
        borderRadius: 4,
        background: "#F1F5F9",
        color: "#475569",
        whiteSpace: "nowrap",
        cursor: "help",
      }}
    >
      ✎ {t("leads.manual.label")}
    </span>
  );
}
