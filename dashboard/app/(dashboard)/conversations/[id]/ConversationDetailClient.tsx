"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChatPane } from "@/components/conversations/ChatPane";
import { InboxList, type InboxQuery } from "@/components/conversations/InboxList";
import { OrderPanel } from "@/components/conversations/OrderPanel";
import { phoneLocal } from "@/lib/conversations/labels";
import { useT } from "@/lib/i18n/LangProvider";
import type {
  ConversationListMeta,
  ConversationListRow,
  ConversationWithMessages,
  OrderPanel as OrderPanelData,
} from "@/types/api";

/**
 * /conversations/[id]: list, chat and order panel. Polls the whole page every 3 seconds, so new
 * messages, the panel's details and the list's rows all stay current.
 */
export function ConversationDetailClient({
  conversation,
  panel,
  rows,
  meta,
  query,
  staffName,
}: {
  conversation: ConversationWithMessages;
  panel: OrderPanelData | null;
  rows: ConversationListRow[];
  meta: ConversationListMeta;
  query: InboxQuery;
  staffName: string;
}) {
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(interval);
  }, [router]);

  // A poll whose panel fetch failed keeps the last panel of this conversation on screen (and the team
  // notes being typed in it); the error shows only when the panel never loaded.
  const [kept, setKept] = useState({ id: conversation.id, panel });
  useEffect(() => {
    if (panel || kept.id !== conversation.id) setKept({ id: conversation.id, panel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, conversation.id]);
  const shown = panel ?? (kept.id === conversation.id ? kept.panel : null);

  // The header names the customer as the panel's details do (the name the bot collected), falling
  // back to the WhatsApp display name and then the number.
  const detail = (key: "name" | "business_name") => shown?.details.find((d) => d.key === key)?.value ?? null;
  const phone = conversation.contact?.waId ? phoneLocal(conversation.contact.waId) : null;
  const name = detail("name") ?? conversation.contact?.displayName ?? phone ?? t("conversations.customerFallback");

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
      <InboxList rows={rows} meta={meta} query={query} selectedId={conversation.id} />
      <ChatPane
        key={conversation.id}
        conversation={conversation}
        name={name}
        business={detail("business_name")}
        leadId={shown?.lead?.id ?? null}
        staffName={staffName}
        brands={shown?.brands ?? []}
        nearestProductId={shown?.nearest[0]?.productId ?? null}
      />
      <OrderPanel conversationId={conversation.id} panel={shown} />
    </div>
  );
}
