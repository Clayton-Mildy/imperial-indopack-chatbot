import { notFound } from "next/navigation";
import { getLeadDetail } from "@/lib/api/leads";
import { isReadOnly } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { Header } from "@/components/layout/Header";
import { LeadDetailClient } from "./LeadDetailClient";
import type { LeadDetail } from "@/types/api";

const NAME_KEYS = ["nama", "name", "nama_lengkap"];

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let detail: LeadDetail | null = null;
  try {
    detail = await getLeadDetail(id);
  } catch (err) {
    // A malformed id is a 400/404 from the API; both mean "no such lead". Anything else is a
    // real failure and should surface, not pose as a missing page.
    const status = (err as { status?: number }).status;
    if (status !== 404 && status !== 400) throw err;
  }
  if (!detail) notFound();

  const t = await getT();
  const readOnly = await isReadOnly();

  // Marketing (read-only) never reaches a conversation, so it gets none of its text either - not
  // the proof quote, not an event's evidence. Stripped on the server so it never reaches the
  // browser; the client hides a missing quote.
  if (readOnly) {
    detail = {
      lead: { ...detail.lead, outcomeEvidence: null },
      events: detail.events.map((e) => ({ ...e, evidence: null })),
      previousLead: detail.previousLead ? { ...detail.previousLead, outcomeEvidence: null } : null,
      orders: (detail.orders ?? []).map((o) => ({ ...o, evidence: null })),
    };
  }

  const { lead } = detail;
  let name: string | null = null;
  for (const k of NAME_KEYS) {
    const v = lead.payload[k];
    if (typeof v === "string" && v.trim()) {
      name = v.trim();
      break;
    }
  }
  name = name ?? lead.displayName ?? lead.waId ?? t("leadDetail.noName");

  return (
    <>
      <Header title={name} breadcrumb={t("leadDetail.breadcrumb")} breadcrumbHref="/leads" />
      <LeadDetailClient
        lead={lead}
        events={detail.events}
        orders={detail.orders ?? []}
        previousLead={detail.previousLead}
        name={name}
        readOnly={readOnly}
      />
    </>
  );
}
