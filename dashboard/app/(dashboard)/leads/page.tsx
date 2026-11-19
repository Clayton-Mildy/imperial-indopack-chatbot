import { getLeads, getLeadsSummary } from "@/lib/api/leads";
import { getAiDefault } from "@/actions/settingsActions";
import { isReadOnly } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { Header } from "@/components/layout/Header";
import { LeadsClient } from "./LeadsClient";
import type { Lead, LeadCampaignSummary } from "@/types/api";

const LIMIT = 25;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    search?: string;
    campaign?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    tipe?: string;
    sort?: string;
    order?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const search = params.search?.trim() ?? "";
  const campaign = params.campaign ?? "";
  const status = params.status ?? "";
  const startDate = params.startDate ?? "";
  const endDate = params.endDate ?? "";
  // One tab strip drives the follow-up queue and the "Belum Dibalas" filter.
  const tipe = params.tipe ?? "all";
  const followUpStatus = tipe === "follow_up" ? "needs_followup" : "";
  // "Belum Dibalas" is a tab on the same strip but a different backend filter again.
  const unreplied = tipe === "unreplied";
  // A column header the user clicked. Anything else is ignored rather than sent on to a 400.
  const sort = ["submitted", "chat_started", "last_chat"].includes(params.sort ?? "") ? params.sort! : "";
  const order = sort && params.order === "asc" ? "asc" : sort ? "desc" : "";

  let leads: Lead[] = [];
  let summary: LeadCampaignSummary[] = [];
  // null = the count fetch failed: the badge and link then show no number.
  let unrepliedCount: number | null = null;
  let nonLeadCount: number | null = null;
  let meta = { page: 1, total: 0, limit: LIMIT };

  // Built once and reused for the Excel export, so the file can never disagree with the
  // rows on screen.
  const filters: Record<string, string> = {
    ...(search ? { search } : {}),
    ...(campaign ? { campaign } : {}),
    ...(status ? { status } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(followUpStatus ? { followUpStatus } : {}),
    ...(unreplied ? { unreplied: "true" } : {}),
    ...(sort ? { sort, order } : {}),
  };

  // The summary deliberately ignores every filter except the date range: it is the report,
  // and it also supplies the campaign dropdown's options, so it must see the whole period.
  // The two counts are limit=1 calls read only for meta.total: the tab badge and the
  // "Bukan Lead" link show them whatever filters are active. allSettled, so a failed count
  // (or summary) costs only its own number, never the list.
  const [leadsResult, summaryResult, unrepliedResult, nonLeadResult] = await Promise.allSettled([
    getLeads({ page, limit: LIMIT, ...filters }),
    getLeadsSummary({
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    }),
    getLeads({ page: 1, limit: 1, unreplied: true }),
    getLeads({ page: 1, limit: 1, kind: "non_lead" }),
  ]);
  if (leadsResult.status === "fulfilled") {
    leads = leadsResult.value.data;
    meta = leadsResult.value.meta;
  } else {
    console.warn("[leads] Fetch error:", leadsResult.reason);
  }
  if (summaryResult.status === "fulfilled") summary = summaryResult.value;
  else console.warn("[leads] Summary fetch error:", summaryResult.reason);
  if (unrepliedResult.status === "fulfilled") unrepliedCount = unrepliedResult.value.meta.total;
  if (nonLeadResult.status === "fulfilled") nonLeadCount = nonLeadResult.value.meta.total;

  const t = await getT();
  const aiDefault = await getAiDefault();
  // Marketing: no status dropdown, no deal input, no AI toggle, no link into a conversation.
  // proxy.ts and the server actions are what enforce it - this only hides the controls.
  const readOnly = await isReadOnly();
  // The AI's proof quote is the customer's own message: stripped on the server for marketing, like
  // /leads/[id] and /summary, so it never reaches their browser in the page data.
  if (readOnly) leads = leads.map((l) => ({ ...l, outcomeEvidence: null }));

  return (
    <>
      <Header title={t("leads.title")} />
      <LeadsClient
        leads={leads}
        summary={summary}
        meta={meta}
        aiDefault={aiDefault}
        readOnly={readOnly}
        unrepliedCount={unrepliedCount}
        nonLeadCount={nonLeadCount}
        exportQuery={new URLSearchParams(filters).toString()}
        activeSearch={search}
        activeCampaign={campaign}
        activeStatus={status}
        activeStartDate={startDate}
        activeEndDate={endDate}
        activeTipe={tipe}
        activeSort={sort}
        activeOrder={order}
      />
    </>
  );
}
