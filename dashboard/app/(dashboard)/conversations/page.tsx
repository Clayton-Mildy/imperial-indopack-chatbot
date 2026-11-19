import { getConversations } from "@/lib/api/conversations";
import { Header } from "@/components/layout/Header";
import { getT } from "@/lib/i18n";
import { inboxQueryOf, INBOX_PAGE_SIZE, type InboxSearchParams } from "@/lib/conversations/inboxQuery";
import { ConversationsClient } from "./ConversationsClient";
import type { ConversationListMeta, ConversationListRow } from "@/types/api";

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<InboxSearchParams> }) {
  const t = await getT();
  const query = inboxQueryOf(await searchParams);

  // null = the fetch failed; the client keeps the rows it already shows.
  let list: { rows: ConversationListRow[]; meta: ConversationListMeta } | null = null;
  try {
    list = await getConversations({ ...query, view: query.view ?? undefined, limit: INBOX_PAGE_SIZE });
  } catch (err) {
    console.warn("[conversations] Failed to fetch list:", err);
  }

  return (
    <>
      <Header title={t("conversations.title")} />
      <ConversationsClient list={list} query={query} />
    </>
  );
}
