"use client";

import { useT } from "@/lib/i18n/LangProvider";

/** A thin line over the columns while the last poll failed: what is shown is the last good data. */
export function ReconnectingNote() {
  const t = useT();
  return (
    <div
      role="status"
      style={{
        flexShrink: 0,
        padding: "4px 16px",
        fontSize: 12,
        color: "#92400E",
        background: "#FFFBEB",
        borderBottom: "1px solid #F3DC94",
      }}
    >
      {t("conversations.reconnecting")}
    </div>
  );
}
