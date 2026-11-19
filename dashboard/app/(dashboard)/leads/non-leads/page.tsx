import { getLeads } from "@/lib/api/leads";
import { isReadOnly } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { Header } from "@/components/layout/Header";
import { stripCustomerText } from "@/lib/leads/redact";
import { NonLeadsClient } from "./NonLeadsClient";
import type { Lead, LeadKind } from "@/types/api";

// Same page size as the Leads list.
const LIMIT = 25;

const NON_LEAD_KINDS: LeadKind[] = ["kurir", "status_pesanan", "lamaran_kerja", "supplier", "lainnya"];

export default async function NonLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; kind?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const activeKind = NON_LEAD_KINDS.find((k) => k === params.kind) ?? "all";

  let rows: Lead[] = [];
  let meta = { page: 1, total: 0, limit: LIMIT };
  // One limit=1 call per tab, read only for meta.total. A failed one leaves the count
  // undefined, so the tab shows no number instead of taking the page down.
  const tabKinds = ["non_lead", ...NON_LEAD_KINDS];
  const counts: Record<string, number | undefined> = {};

  const [listResult, ...countResults] = await Promise.allSettled([
    getLeads({ page, limit: LIMIT, kind: activeKind === "all" ? "non_lead" : activeKind }),
    ...tabKinds.map((kind) => getLeads({ page: 1, limit: 1, kind })),
  ]);
  if (listResult.status === "fulfilled") {
    rows = listResult.value.data;
    meta = listResult.value.meta;
  } else {
    console.warn("[non-leads] Fetch error:", listResult.reason);
  }
  countResults.forEach((r, i) => {
    counts[i === 0 ? "all" : tabKinds[i]] = r.status === "fulfilled" ? r.value.meta.total : undefined;
  });

  const t = await getT();
  const readOnly = await isReadOnly();
  // As on /leads: the AI's proof quote is customer message text, which marketing never receives.
  if (readOnly) rows = stripCustomerText(rows);

  return (
    <>
      <Header title={t("nonLeads.title")} breadcrumb={t("nonLeads.breadcrumb")} breadcrumbHref="/leads" />
      <NonLeadsClient rows={rows} meta={meta} counts={counts} activeKind={activeKind} readOnly={readOnly} />
    </>
  );
}
