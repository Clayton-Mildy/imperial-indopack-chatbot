import { getBrandSummary, getLeads } from "@/lib/api/leads";
import { isReadOnly } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { Header } from "@/components/layout/Header";
import { isLeadTab, leadsQueryForTab, type LeadTab } from "@/lib/leads/tabs";
import { stripCustomerText } from "@/lib/leads/redact";
import { LeadsClient } from "./LeadsClient";
import type { BrandPerformance, Lead, LeadStatus } from "@/types/api";

const LIMIT = 25;
const STATUSES: LeadStatus[] = ["new", "contacted", "quoted", "won", "lost"];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    search?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    tab?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const search = params.search?.trim() ?? "";
  const status = STATUSES.find((s) => s === params.status);
  const startDate = params.startDate ?? "";
  const endDate = params.endDate ?? "";
  const readOnly = await isReadOnly();
  // Marketing never sees the sales team's follow-up queues; a hand-typed ?tab= falls back to all.
  let tab: LeadTab = isLeadTab(params.tab) ? params.tab : "all";
  if (readOnly && (tab === "followup" || tab === "unreplied")) tab = "all";

  const query = leadsQueryForTab(tab, { startDate, endDate, status, search, page });

  // Built once and reused for the Excel export, so the file can never disagree with the rows
  // on screen: the same filters, without the page.
  const exportParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "page" || value === undefined || value === "") continue;
    exportParams.set(key, String(value));
  }

  let leads: Lead[] = [];
  let brandRows: BrandPerformance[] = [];
  // null = the count fetch failed: the link then shows no number.
  let nonLeadCount: number | null = null;
  let meta = { page: 1, total: 0, limit: LIMIT };

  // The brand table follows the date range only, like a report. The non-lead count is a
  // limit=1 call read for meta.total. allSettled: a failed side call costs only its own part.
  const [leadsResult, brandResult, nonLeadResult] = await Promise.allSettled([
    getLeads({ ...query, limit: LIMIT }),
    getBrandSummary({
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    }),
    getLeads({ page: 1, limit: 1, kind: "non_lead" }),
  ]);
  if (leadsResult.status === "fulfilled") {
    leads = leadsResult.value.data;
    meta = leadsResult.value.meta;
  } else {
    console.warn("[leads] Fetch error:", leadsResult.reason);
  }
  if (brandResult.status === "fulfilled") brandRows = brandResult.value;
  else console.warn("[leads] Brand summary fetch error:", brandResult.reason);
  if (nonLeadResult.status === "fulfilled") nonLeadCount = nonLeadResult.value.meta.total;

  const t = await getT();
  // The AI's proof quote is the customer's own message: stripped on the server for marketing,
  // like /leads/[id], so it never reaches their browser in the page data.
  if (readOnly) leads = stripCustomerText(leads);

  return (
    <>
      <Header title={t("leads.title")} />
      <LeadsClient
        leads={leads}
        brandRows={brandRows}
        meta={meta}
        readOnly={readOnly}
        nonLeadCount={nonLeadCount}
        exportQuery={exportParams.toString()}
        activeSearch={search}
        activeStatus={status ?? ""}
        activeStartDate={startDate}
        activeEndDate={endDate}
        activeTab={tab}
      />
    </>
  );
}
