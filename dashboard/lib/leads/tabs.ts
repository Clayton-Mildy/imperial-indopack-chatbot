import type { BrandSlug } from "@/lib/brands";
import type { LeadsQuery } from "@/lib/api/leads";
import type { LeadStatus } from "@/types/api";

export type LeadTab = "all" | "kertas_supreme" | "imperial_indopack" | "followup" | "unreplied";

export const LEAD_TABS: readonly LeadTab[] = ["all", "kertas_supreme", "imperial_indopack", "followup", "unreplied"];

export function isLeadTab(v: unknown): v is LeadTab {
  return LEAD_TABS.includes(v as LeadTab);
}

/** The API filters for one tab plus the shared filter bar. Only set fields are present. */
export function leadsQueryForTab(
  tab: LeadTab,
  f: { startDate?: string; endDate?: string; status?: LeadStatus; search?: string; page: number }
): LeadsQuery {
  const q: LeadsQuery = { page: f.page };
  if (f.startDate) q.startDate = f.startDate;
  if (f.endDate) q.endDate = f.endDate;
  if (f.status) q.status = f.status;
  if (f.search) q.search = f.search;
  if (tab === "kertas_supreme" || tab === "imperial_indopack") q.brand = tab as BrandSlug;
  if (tab === "followup") q.followUpStatus = "needs_followup";
  // Newest chat first everywhere, except Belum Dibalas, where whoever has waited longest comes first.
  if (tab === "unreplied") q.unreplied = true;
  else q.sort = "last_chat";
  return q;
}
