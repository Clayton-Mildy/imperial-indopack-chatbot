"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { patchLead } from "@/lib/api/leads";
import { createLog } from "@/lib/api/activityLogs";
import { isReadOnly } from "@/lib/session";
import { ApiError } from "@/lib/api/client";
import { getT } from "@/lib/i18n";
import type { BrandSlug } from "@/lib/brands";
import type { LeadCampaignFields, LeadKind, LeadStatus, LostReason, OrderItem } from "@/types/api";

// Must stay in step with STATUS_OPTIONS in app/(dashboard)/leads/LeadsClient.tsx - this copy
// is what the activity log sentence reads.
const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "Baru",
  contacted: "Dihubungi",
  quoted: "Penawaran",
  won: "Menang",
  lost: "Kalah",
};

export async function updateLead(
  id: string,
  updates: LeadCampaignFields & {
    status?: LeadStatus;
    dealValueIdr?: number | null;
    totalOrders?: number;
    kind?: LeadKind;
    lostReason?: LostReason | null;
    /** Staff's brands and item lines replace the AI's, and lock both against its lead pass. */
    brands?: BrandSlug[];
    items?: OrderItem[];
  }
): Promise<{ ok: boolean; error?: string }> {
  const t = await getT();
  if (await isReadOnly()) return { ok: false, error: t("leads.readOnly") };

  const session = await auth();
  const agentName = session?.user?.name ?? "Agen";

  try {
    // The editor is always the session user, read here: a staffId from the client is never trusted.
    const staffId = (session?.user as { id?: string } | undefined)?.id;
    await patchLead(id, { ...updates, ...(staffId ? { staffId } : {}) });
  } catch (err) {
    // The API refuses to reopen a renewed customer's old lost lead while their new one is open.
    if (err instanceof ApiError && err.status === 409 && err.message === "LEAD_ALREADY_OPEN") {
      return { ok: false, error: t("leads.alreadyOpen") };
    }
    return { ok: false, error: t("leads.saveFailed") };
  }

  revalidatePath("/leads");

  const what =
    updates.status !== undefined
      ? `status lead menjadi "${STATUS_LABEL[updates.status]}"`
      : updates.utmCampaign !== undefined
        ? `campaign lead menjadi "${updates.utmCampaign ?? "kosong"}"`
        : updates.totalOrders !== undefined
          ? `total order lead menjadi ${updates.totalOrders}`
          : updates.kind !== undefined
            ? `jenis lead menjadi "${updates.kind}"`
            : updates.lostReason !== undefined
              ? `alasan kalah lead`
              : updates.items !== undefined || updates.brands !== undefined
                ? `barang dan merek lead`
                : `nilai deal lead`;
  createLog({
    message: `${agentName} mengubah ${what}`,
    performedBy: agentName,
    entityType: "lead",
    entityId: id,
  }).catch(() => {});

  return { ok: true };
}
