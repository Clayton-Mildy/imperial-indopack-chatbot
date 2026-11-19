"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { InboxList, type InboxQuery } from "@/components/conversations/InboxList";
import { useT } from "@/lib/i18n/LangProvider";
import type { ConversationListMeta, ConversationListRow } from "@/types/api";

/**
 * /conversations: the inbox list beside an empty chat column ("Pilih percakapan"). The list polls
 * every 5 seconds; an open conversation (/conversations/[id]) polls itself instead.
 */
export function ConversationsClient({
  rows,
  meta,
  query,
}: {
  rows: ConversationListRow[];
  meta: ConversationListMeta;
  query: InboxQuery;
}) {
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(interval);
  }, [router]);

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
      <InboxList rows={rows} meta={meta} query={query} selectedId={null} />
      <section
        style={{
          flex: "1 1 420px",
          minWidth: 0,
          background: "#EEF2EA",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: 24,
          textAlign: "center",
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600, color: "#1F2421" }}>{t("conversations.selectPrompt")}</span>
        <span style={{ fontSize: 13, color: "#5F6B5A", maxWidth: 320, lineHeight: 1.5 }}>{t("conversations.selectHint")}</span>
      </section>
    </div>
  );
}
