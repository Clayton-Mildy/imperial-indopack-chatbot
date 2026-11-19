import { getConversations } from "@/lib/api/conversations";
import { Header } from "@/components/layout/Header";
import { getT } from "@/lib/i18n";
import { ConversationsClient } from "./ConversationsClient";
import type { Conversation, PaginatedResponse } from "@/types/api";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; search?: string }>;
}) {
  const t = await getT();
  const params = await searchParams;
  const status = params.status;
  const page = params.page ? parseInt(params.page, 10) : 1;
  const search = params.search?.trim() || undefined;

  // Fetch the active tab's conversations + counts for each status
  let result: PaginatedResponse<Conversation> = { data: [], meta: { page: 1, total: 0, limit: 20 } };
  let counts: Record<string, number> = {};

  try {
    const isUpsellTab = status === "upsell_accepted";
    const listParams = isUpsellTab
      ? { page, limit: 20, upsell_accepted: true, ...(search ? { search } : {}) }
      : { page, limit: 20, ...(status ? { status } : {}), ...(search ? { search } : {}) };

    const [list, allCount, active, escalated, needsHuman, resolved, followUp, upsellAccepted] = await Promise.allSettled([
      getConversations(listParams),
      getConversations({ limit: 1 }),
      getConversations({ status: "active", limit: 1 }),
      getConversations({ status: "escalated", limit: 1 }),
      getConversations({ status: "needs_human", limit: 1 }),
      getConversations({ status: "resolved", limit: 1 }),
      getConversations({ status: "follow_up", limit: 1 }),
      getConversations({ upsell_accepted: true, limit: 1 }),
    ]);

    if (list.status === "fulfilled") {
      result = list.value;
      // Client-side fallback filter if the API doesn't support search
      if (search) {
        const q = search.toLowerCase();
        result = {
          ...result,
          data: result.data.filter((c) => {
            const name = (c.contact?.displayName ?? "").toLowerCase();
            const phone = (c.contact?.waId ?? "").toLowerCase();
            return name.includes(q) || phone.includes(q);
          }),
        };
      }
      // Client-side follow_up filter: conversations with followUpNotes set
      if (status === "follow_up") {
        result = {
          ...result,
          data: result.data.filter((c) => !!c.followUpNotes),
        };
      }
    } else console.warn("[conversations] Failed to fetch list:", list.reason);

    counts = {
      all: allCount.status === "fulfilled" ? allCount.value.meta.total : 0,
      active: active.status === "fulfilled" ? active.value.meta.total : 0,
      escalated: escalated.status === "fulfilled" ? escalated.value.meta.total : 0,
      needs_human: needsHuman.status === "fulfilled" ? needsHuman.value.meta.total : 0,
      resolved: resolved.status === "fulfilled" ? resolved.value.meta.total : 0,
      follow_up: followUp.status === "fulfilled" ? followUp.value.data.filter((c) => !!c.followUpNotes).length : 0,
      upsell_accepted: upsellAccepted.status === "fulfilled" ? upsellAccepted.value.meta.total : 0,
    };
  } catch (err) {
    console.warn("[conversations] Fetch error:", err);
  }

  return (
    <>
      <Header title={t("conversations.title")} />
      <ConversationsClient
        conversations={result.data}
        meta={result.meta}
        counts={counts}
        activeStatus={status ?? "all"}
        activeSearch={search ?? ""}
      />
    </>
  );
}
