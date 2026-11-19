import { getConversations } from "@/lib/api/conversations";
import { Header } from "@/components/layout/Header";
import { getT } from "@/lib/i18n";
import { inboxQueryOf, INBOX_PAGE_SIZE, type InboxSearchParams } from "@/lib/conversations/inboxQuery";
import { ConversationsClient } from "./ConversationsClient";
import type { ConversationListMeta, ConversationListRow } from "@/types/api";

const EMPTY_META: ConversationListMeta = { page: 1, total: 0, limit: INBOX_PAGE_SIZE, counts: { all: 0, team: 0, ai: 0, resolved: 0 } };

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<InboxSearchParams> }) {
  const t = await getT();
  const query = inboxQueryOf(await searchParams);

  let rows: ConversationListRow[] = [];
  let meta = EMPTY_META;
  try {
    ({ rows, meta } = await getConversations({ ...query, view: query.view ?? undefined, limit: INBOX_PAGE_SIZE }));
  } catch (err) {
    console.warn("[conversations] Failed to fetch list:", err);
  }

  return (
    <>
      <Header title={t("conversations.title")} />
      <ConversationsClient rows={rows} meta={meta} query={query} />
    </>
  );
}
