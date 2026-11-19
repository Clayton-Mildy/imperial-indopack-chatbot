import { notFound } from "next/navigation";
import { getLeadDetail } from "@/lib/api/leads";
import { isReadOnly } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { stripCustomerText } from "@/lib/leads/redact";
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
  // the proof quote, the first message, the form's message field or an event's evidence. Stripped
  // on the server so it never reaches the browser; the client hides a missing quote. Items, brands
  // and the quoted prices are sales facts, not the customer's words, and stay.
  let { lead, events, previousLead } = detail;
  if (readOnly) {
    lead = stripCustomerText([lead])[0]!;
    events = events.map((e) => ({ ...e, evidence: null }));
    previousLead = previousLead ? stripCustomerText([previousLead])[0]! : null;
  }

  let name: string | null = lead.name?.trim() || null;
  for (const k of NAME_KEYS) {
    if (name) break;
    const v = lead.payload[k];
    if (typeof v === "string" && v.trim()) name = v.trim();
  }
  name = name ?? lead.displayName ?? lead.waId ?? t("leadDetail.noName");

  return (
    <>
      <Header title={name} breadcrumb={t("leadDetail.breadcrumb")} breadcrumbHref="/leads" />
      <LeadDetailClient
        lead={lead}
        events={events}
        previousLead={previousLead}
        extras={detail.extras}
        name={name}
        readOnly={readOnly}
      />
    </>
  );
}
