import { apiFetch } from "./client";
import type { BrandSlug } from "@/lib/brands";
import type {
  BrandPerformance,
  Lead,
  LeadCampaignFields,
  LeadCampaignSummary,
  LeadDetail,
  LeadKind,
  LeadReport,
  LeadStatus,
  LostReason,
} from "@/types/api";

export interface LeadsQuery {
  page?: number;
  limit?: number;
  search?: string;
  campaign?: string;
  source?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  followUpStatus?: string;
  /** `lead` (default), `non_lead`, or one concrete kind. */
  kind?: string;
  unreplied?: boolean;
  /** Only leads that asked about this brand. */
  brand?: BrandSlug;
  sort?: string;
  order?: string;
}

export async function getLeads(params: LeadsQuery): Promise<{ data: Lead[]; meta: { page: number; total: number; limit: number } }> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.search) qs.set("search", params.search);
  if (params.campaign) qs.set("campaign", params.campaign);
  if (params.source) qs.set("source", params.source);
  if (params.status) qs.set("status", params.status);
  if (params.startDate) qs.set("startDate", params.startDate);
  if (params.endDate) qs.set("endDate", params.endDate);
  if (params.followUpStatus) qs.set("followUpStatus", params.followUpStatus);
  if (params.kind) qs.set("kind", params.kind);
  if (params.unreplied) qs.set("unreplied", "true");
  if (params.brand) qs.set("brand", params.brand);
  if (params.sort) qs.set("sort", params.sort);
  if (params.order) qs.set("order", params.order);

  const query = qs.toString();
  const envelope = await apiFetch<Lead[]>(`/leads${query ? `?${query}` : ""}`);
  return {
    data: envelope.data ?? [],
    meta: envelope.meta ?? { page: 1, total: 0, limit: 25 },
  };
}

export async function getLeadsSummary(params: {
  startDate?: string;
  endDate?: string;
}): Promise<LeadCampaignSummary[]> {
  const qs = new URLSearchParams();
  if (params.startDate) qs.set("startDate", params.startDate);
  if (params.endDate) qs.set("endDate", params.endDate);

  const query = qs.toString();
  const envelope = await apiFetch<LeadCampaignSummary[]>(`/leads/summary${query ? `?${query}` : ""}`);
  return envelope.data ?? [];
}

export async function getBrandSummary(params: {
  startDate?: string;
  endDate?: string;
}): Promise<BrandPerformance[]> {
  const qs = new URLSearchParams();
  if (params.startDate) qs.set("startDate", params.startDate);
  if (params.endDate) qs.set("endDate", params.endDate);
  const query = qs.toString();
  const envelope = await apiFetch<BrandPerformance[]>(`/leads/brand-summary${query ? `?${query}` : ""}`);
  return envelope.data ?? [];
}

export async function patchLead(
  id: string,
  updates: LeadCampaignFields & {
    status?: LeadStatus;
    dealValueIdr?: number | null;
    totalOrders?: number;
    kind?: LeadKind;
    lostReason?: LostReason | null;
    staffId?: string;
  }
): Promise<void> {
  await apiFetch(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(updates) });
}

export async function getLeadDetail(id: string): Promise<LeadDetail> {
  const envelope = await apiFetch<LeadDetail>(`/leads/${id}`);
  return envelope.data as LeadDetail;
}

export async function getLeadReport(params: {
  startDate?: string;
  endDate?: string;
}): Promise<LeadReport> {
  const qs = new URLSearchParams();
  if (params.startDate) qs.set("startDate", params.startDate);
  if (params.endDate) qs.set("endDate", params.endDate);
  const query = qs.toString();
  const envelope = await apiFetch<LeadReport>(`/leads/report${query ? `?${query}` : ""}`);
  return envelope.data as LeadReport;
}
