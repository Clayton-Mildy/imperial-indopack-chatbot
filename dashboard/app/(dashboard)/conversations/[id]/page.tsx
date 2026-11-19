import { notFound } from "next/navigation";
import { getConversation, getConversations, getOrderPanel } from "@/lib/api/conversations";
import { Header } from "@/components/layout/Header";
import { getT } from "@/lib/i18n";
import { inboxQueryOf, INBOX_PAGE_SIZE, type InboxSearchParams } from "@/lib/conversations/inboxQuery";
import { sessionStaff } from "@/lib/session";
import { ConversationDetailClient } from "./ConversationDetailClient";
import type { ConversationListMeta, ConversationListRow, ConversationWithMessages, OrderPanel } from "@/types/api";

const EMPTY_META: ConversationListMeta = { page: 1, total: 0, limit: INBOX_PAGE_SIZE, counts: { all: 0, team: 0, ai: 0, resolved: 0 } };

/** /conversations/[id]: the inbox list, the chat and the order panel. Re-run every 3 seconds by the client's poll. */
export default async function ConversationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<InboxSearchParams>;
}) {
  const { id } = await params;
  const query = inboxQueryOf(await searchParams);
  const t = await getT();

  const [conversationResult, panelResult, listResult, staff] = await Promise.all([
    getConversation(id).then(
      (c): ConversationWithMessages | null => c,
      (err: unknown) => {
        const status = (err as { status?: number }).status;
        if (status !== 404) console.warn("[conversation-detail] Fetch error:", err);
        return null;
      }
    ),
    getOrderPanel(id).then(
      (p): OrderPanel | null => p,
      (err: unknown) => {
        console.warn("[conversation-detail] Order panel fetch error:", err);
        return null;
      }
    ),
    getConversations({ ...query, view: query.view ?? undefined, limit: INBOX_PAGE_SIZE }).then(
      (r): { rows: ConversationListRow[]; meta: ConversationListMeta } => r,
      (err: unknown) => {
        console.warn("[conversation-detail] List fetch error:", err);
        return { rows: [], meta: EMPTY_META };
      }
    ),
    sessionStaff(),
  ]);

  if (!conversationResult) notFound();

  return (
    <>
      <Header title={t("conversations.title")} />
      <ConversationDetailClient
        conversation={conversationResult}
        panel={panelResult}
        rows={listResult.rows}
        meta={listResult.meta}
        query={query}
        staffName={staff.staffName}
      />
    </>
  );
}
