import { notFound } from "next/navigation";
import { getConversation, getConversations, getOrderPanel } from "@/lib/api/conversations";
import { Header } from "@/components/layout/Header";
import { getT } from "@/lib/i18n";
import { inboxQueryOf, INBOX_PAGE_SIZE, type InboxSearchParams } from "@/lib/conversations/inboxQuery";
import { sessionStaff } from "@/lib/session";
import { ConversationDetailClient } from "./ConversationDetailClient";
import type { ConversationListMeta, ConversationListRow, ConversationWithMessages, OrderPanel } from "@/types/api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /conversations/[id]: the inbox list, the chat and the order panel. Re-run every 3 seconds by the
 * client's poll. Only a conversation that does not exist is a not-found page; any other failed fetch
 * hands the client null for that piece, and it keeps what it shows (with the reply draft and notes).
 */
export default async function ConversationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<InboxSearchParams>;
}) {
  const { id } = await params;
  // A malformed id is a conversation that does not exist (the API would answer it with a 500).
  if (!UUID_RE.test(id)) notFound();
  const query = inboxQueryOf(await searchParams);
  const t = await getT();

  const [conversation, panel, list, staff] = await Promise.all([
    getConversation(id).then(
      (c): ConversationWithMessages | "missing" | null => c,
      (err: unknown) => {
        if ((err as { status?: number }).status === 404) return "missing";
        console.warn("[conversation-detail] Fetch error:", err);
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
      (r): { rows: ConversationListRow[]; meta: ConversationListMeta } | null => r,
      (err: unknown) => {
        console.warn("[conversation-detail] List fetch error:", err);
        return null;
      }
    ),
    sessionStaff(),
  ]);

  if (conversation === "missing") notFound();

  return (
    <>
      <Header title={t("conversations.title")} />
      <ConversationDetailClient
        conversationId={id}
        conversation={conversation}
        panel={panel}
        list={list}
        query={query}
        staffName={staff.staffName}
      />
    </>
  );
}
