"use client";

import { useRouter } from "next/navigation";
import { ChatPane } from "@/components/conversations/ChatPane";
import { InboxList, type InboxQuery } from "@/components/conversations/InboxList";
import { OrderPanel } from "@/components/conversations/OrderPanel";
import { ReconnectingNote } from "@/components/conversations/ReconnectingNote";
import { EMPTY_INBOX_META } from "@/lib/conversations/inboxQuery";
import { phoneLocal } from "@/lib/conversations/labels";
import { useLastGood } from "@/lib/conversations/lastGood";
import { useT } from "@/lib/i18n/LangProvider";
import { useVisiblePoll } from "@/lib/visiblePoll";
import type {
  ConversationListMeta,
  ConversationListRow,
  ConversationWithMessages,
  OrderPanel as OrderPanelData,
} from "@/types/api";

/**
 * /conversations/[id]: list, chat and order panel. Polls the whole page every 3 seconds while the tab
 * is visible (once more when it is shown again), so new messages, the panel's details and the list's
 * rows all stay current. A piece whose fetch failed in this poll arrives as null: the last good one of
 * the same conversation stays on screen (so the reply draft and unsaved team notes survive), with a
 * "reconnecting" line over the columns.
 */
export function ConversationDetailClient({
  conversationId,
  conversation,
  panel,
  list,
  query,
  staffName,
}: {
  conversationId: string;
  conversation: ConversationWithMessages | null;
  panel: OrderPanelData | null;
  list: { rows: ConversationListRow[]; meta: ConversationListMeta } | null;
  query: InboxQuery;
  staffName: string;
}) {
  const router = useRouter();
  const t = useT();

  useVisiblePoll(() => router.refresh(), 3000);

  const shownConversation = useLastGood(conversation, conversationId);
  const shownPanel = useLastGood(panel, conversationId);
  const shownList = useLastGood(list, "list");
  const reconnecting = !conversation || !panel || !list;

  // The header names the customer as the panel's details do (the name the bot collected), falling
  // back to the WhatsApp display name and then the number.
  const detail = (key: "name" | "business_name") => shownPanel?.details.find((d) => d.key === key)?.value ?? null;
  const waId = shownConversation?.contact?.waId;
  const phone = waId ? phoneLocal(waId) : null;
  const name = detail("name") ?? shownConversation?.contact?.displayName ?? phone ?? t("conversations.customerFallback");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      {reconnecting && <ReconnectingNote />}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <InboxList rows={shownList?.rows ?? []} meta={shownList?.meta ?? EMPTY_INBOX_META} query={query} selectedId={conversationId} />
        {shownConversation ? (
          <>
            <ChatPane
              key={conversationId}
              conversation={shownConversation}
              name={name}
              business={detail("business_name")}
              leadId={shownPanel?.lead?.id ?? null}
              staffName={staffName}
              brands={shownPanel?.brands ?? []}
              nearestProductId={shownPanel?.nearest[0]?.productId ?? null}
              suggestedPoForms={shownPanel?.suggestedPoForms ?? ["cetak", "plano"]}
            />
            <OrderPanel conversationId={conversationId} panel={shownPanel} />
          </>
        ) : (
          // Never loaded yet (the first fetch failed): the poll keeps trying.
          <section
            style={{ flex: "1 1 420px", minWidth: 0, background: "#EEF2EA", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", fontSize: 13, color: "#5F6B5A" }}
          >
            {t("conversations.chat.loadFailed")}
          </section>
        )}
      </div>
    </div>
  );
}
