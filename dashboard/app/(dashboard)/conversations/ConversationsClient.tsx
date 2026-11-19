"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { InboxList, type InboxQuery } from "@/components/conversations/InboxList";
import { ReconnectingNote } from "@/components/conversations/ReconnectingNote";
import { EMPTY_INBOX_META } from "@/lib/conversations/inboxQuery";
import { useLastGood } from "@/lib/conversations/lastGood";
import { useT } from "@/lib/i18n/LangProvider";
import type { ConversationListMeta, ConversationListRow } from "@/types/api";

/**
 * /conversations: the inbox list beside an empty chat column ("Pilih percakapan"). The list polls
 * every 5 seconds; an open conversation (/conversations/[id]) polls itself instead. A failed poll
 * (list null) keeps the rows already shown.
 */
export function ConversationsClient({
  list,
  query,
}: {
  list: { rows: ConversationListRow[]; meta: ConversationListMeta } | null;
  query: InboxQuery;
}) {
  const router = useRouter();
  const t = useT();
  const shownList = useLastGood(list, "list");

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(interval);
  }, [router]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      {!list && <ReconnectingNote />}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <InboxList rows={shownList?.rows ?? []} meta={shownList?.meta ?? EMPTY_INBOX_META} query={query} selectedId={null} />
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
    </div>
  );
}
