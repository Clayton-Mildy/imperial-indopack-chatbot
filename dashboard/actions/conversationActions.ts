"use server";

import { revalidatePath } from "next/cache";
import { patchConversation, quickSend, saveTeamNotes } from "@/lib/api/conversations";
import { listCatalogProducts } from "@/lib/api/catalog";
import { getPoFormsSetting } from "@/lib/api/settings";
import { isPoFormChoice } from "@/lib/conversations/poForms";
import { createLog } from "@/lib/api/activityLogs";
import { ApiError } from "@/lib/api/client";
import { isBrandSlug, type BrandSlug } from "@/lib/brands";
import { isReadOnly, sessionStaff } from "@/lib/session";
import type { PhotoProduct, PoFormsSetting, QuickSendAction, QuickSendError, QuickSendItem, TeamNotes } from "@/types/api";

export async function resolveConversation(id: string) {
  if (await isReadOnly()) throw new Error("FORBIDDEN");
  const { staffName: agentName } = await sessionStaff();

  await patchConversation(id, { status: "resolved" });
  revalidatePath(`/conversations/${id}`);
  revalidatePath("/conversations");
  revalidatePath("/team-queue");

  createLog({
    message: `${agentName} menyelesaikan percakapan`,
    performedBy: agentName,
    entityType: "conversation",
    entityId: id,
  }).catch(() => {});
}

/** "Ambil alih": the session's staff member holds the chat (the pill reads "Ditangani tim · {name}") and the AI stops. */
export async function takeOverConversation(id: string) {
  if (await isReadOnly()) throw new Error("FORBIDDEN");
  const { staffName: agentName } = await sessionStaff();

  await patchConversation(id, { status: "needs_human", assignedAgent: agentName });
  revalidatePath(`/conversations/${id}`);
  revalidatePath("/conversations");
  revalidatePath("/team-queue");

  createLog({
    message: `${agentName} mengambil alih percakapan`,
    performedBy: agentName,
    entityType: "conversation",
    entityId: id,
  }).catch(() => {});
}

export async function returnToAi(id: string) {
  if (await isReadOnly()) throw new Error("FORBIDDEN");
  const { staffName: agentName } = await sessionStaff();

  await patchConversation(id, { status: "active" });
  revalidatePath(`/conversations/${id}`);
  revalidatePath("/conversations");
  revalidatePath("/team-queue");

  createLog({
    message: `${agentName} mengembalikan percakapan ke AI`,
    performedBy: agentName,
    entityType: "conversation",
    entityId: id,
  }).catch(() => {});
}

const QUICK_SEND_ERRORS: readonly QuickSendError[] = ["NOT_FOUND", "BRAND_UNKNOWN", "NO_PRICE_LIST", "NO_REFERENCE_PHOTOS", "PO_FORM_PLACEHOLDER"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The action as the browser sent it, rebuilt from known fields only: a server action is a public POST endpoint. */
function cleanAction(a: unknown): QuickSendAction | null {
  if (typeof a !== "object" || a === null) return null;
  const { kind, brand, productId, form } = a as { kind?: unknown; brand?: unknown; productId?: unknown; form?: unknown };
  if (kind === "po_form") {
    if (form === undefined) return { kind };
    return isPoFormChoice(form) ? { kind, form } : null;
  }
  if (kind === "reference_photos") return typeof productId === "string" && UUID_RE.test(productId) ? { kind, productId } : null;
  if (kind === "price_list") {
    if (brand === undefined) return { kind };
    return isBrandSlug(brand) ? { kind, brand: brand as BrandSlug } : null;
  }
  return null;
}

/**
 * One click on the quick-send bar: sent as the session's staff member, who then holds the chat.
 * `sent` says per item whether WhatsApp took it ('saved' = refused). A refusal (nothing to send,
 * the placeholder PO link) comes back as its QuickSendError; anything else is 'FAILED'.
 */
export async function quickSendAction(
  conversationId: string,
  action: QuickSendAction
): Promise<{ ok: true; sent: QuickSendItem[] } | { ok: false; error: QuickSendError | "FAILED" }> {
  if (await isReadOnly()) return { ok: false, error: "FAILED" };
  const clean = cleanAction(action);
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) return { ok: false, error: "NOT_FOUND" };
  if (!clean) return { ok: false, error: "FAILED" };

  const { staffName } = await sessionStaff();
  try {
    const sent = await quickSend(conversationId, clean, staffName);
    revalidatePath(`/conversations/${conversationId}`);
    revalidatePath("/conversations");
    revalidatePath("/team-queue");
    return { ok: true, sent };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
      const code = err.message as QuickSendError;
      return { ok: false, error: QUICK_SEND_ERRORS.includes(code) ? code : err.status === 404 ? "NOT_FOUND" : "FAILED" };
    }
    return { ok: false, error: "FAILED" };
  }
}

/** Catatan tim, saved on blur; the writer is the session's staff member. */
export async function saveTeamNotesAction(conversationId: string, text: string): Promise<{ ok: true; notes: TeamNotes } | { ok: false }> {
  if (await isReadOnly()) return { ok: false };
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) return { ok: false };
  if (typeof text !== "string" || text.length > 2000) return { ok: false };
  try {
    const { staffName } = await sessionStaff();
    const notes = await saveTeamNotes(conversationId, text, staffName);
    return { ok: true, notes };
  } catch {
    return { ok: false };
  }
}

/** What "Kirim form PO" would send - both forms and the both-forms message - read when the confirm dialog opens. */
export async function poFormPreviewAction(): Promise<{ ok: true; setting: PoFormsSetting } | { ok: false }> {
  try {
    return { ok: true, setting: await getPoFormsSetting() };
  } catch {
    return { ok: false };
  }
}

/** The active catalog for the reference-photo picker, with each product's photo count. */
export async function photoProductsAction(): Promise<{ ok: true; products: PhotoProduct[] } | { ok: false }> {
  try {
    const { items } = await listCatalogProducts({ status: "active" });
    return {
      ok: true,
      products: items.map((p) => ({ id: p.id, name: p.name, brand: p.brand, photos: p.referenceImages.length })),
    };
  } catch {
    return { ok: false };
  }
}
