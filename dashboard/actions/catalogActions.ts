"use server";

import { revalidatePath } from "next/cache";
import {
  checkPrice,
  deleteCatalogProduct,
  deleteReferenceImage,
  previewCatalogProduct,
  saveCatalogProduct,
  setCatalogProductActive,
} from "@/lib/api/catalog";
import { ApiError } from "@/lib/api/client";
import { sessionRole, sessionStaff } from "@/lib/session";
import { getT } from "@/lib/i18n";
import type { PriceToolCall, ProductDraft, ProductInputError, ProductPreview } from "@/types/api";

// Catalog writes stay admin-only, as on the page this replaced: a "use server" action is a POST
// endpoint any signed-in session can call, so the check lives here and not only on the buttons.
async function isAdmin(): Promise<boolean> {
  return (await sessionRole()) === "admin";
}

/** Switch the bot's offer of a product on or off. */
export async function setProductActiveAction(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const t = await getT();
  if (!(await isAdmin())) return { ok: false, error: t("catalog.err.forbidden") };
  try {
    await setCatalogProductActive(id, isActive, await sessionStaff());
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { ok: false, error: t("catalog.err.notFound") };
    return { ok: false, error: t("catalog.err.saveFailed") };
  }
  revalidatePath("/catalog");
  return { ok: true };
}

/** Deletes the product with its sizes and tiers; answers how many went with it. */
export async function deleteProductAction(
  id: string
): Promise<{ ok: true; sizes: number; tiers: number } | { ok: false; error: string }> {
  const t = await getT();
  if (!(await isAdmin())) return { ok: false, error: t("catalog.err.forbidden") };
  try {
    const { sizes, tiers } = await deleteCatalogProduct(id, await sessionStaff());
    revalidatePath("/catalog");
    return { ok: true, sizes, tiers };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { ok: false, error: t("catalog.err.notFound") };
    return { ok: false, error: t("catalog.err.deleteFailed") };
  }
}

/** The bot's own price calculator; read-only, so any staff member on the page may run it. */
export async function priceCheckAction(input: {
  product: string;
  size: string;
  qty: number;
  unit: "rim" | "pcs";
}): Promise<{ ok: true; text: string; call: PriceToolCall } | { ok: false; error: string }> {
  const t = await getT();
  const product = typeof input?.product === "string" ? input.product.trim() : "";
  const size = typeof input?.size === "string" ? input.size.trim() : "";
  const qty = Number(input?.qty);
  const unit = input?.unit === "rim" || input?.unit === "pcs" ? input.unit : null;
  if (!product || !size || !unit || !Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: t("catalog.check.invalid") };
  }
  try {
    const { text, call } = await checkPrice({ product, size, qty, unit });
    return { ok: true, text, call };
  } catch {
    return { ok: false, error: t("catalog.check.failed") };
  }
}

/**
 * Tambah (id null) or Ubah Produk: the whole form. The API judges the draft; a refused one comes back
 * with its per-field errors so the form can mark them. The actor is the session's, never the browser's.
 */
export async function saveProductAction(
  id: string | null,
  draft: ProductDraft
): Promise<
  | { ok: true; id: string }
  | { ok: false; error: "VALIDATION_ERROR" | "NAME_TAKEN" | "FAILED"; details?: ProductInputError[] }
> {
  // The pages send anyone but an admin back to the catalog, so a refusal here is only ever a forged call.
  if (!(await isAdmin())) return { ok: false, error: "FAILED" };
  if ((id !== null && typeof id !== "string") || !draft || typeof draft !== "object") return { ok: false, error: "FAILED" };
  try {
    const product = await saveCatalogProduct(id, draft, await sessionStaff());
    revalidatePath("/catalog");
    return { ok: true, id: product.id };
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      return { ok: false, error: "VALIDATION_ERROR", details: Array.isArray(err.details) ? (err.details as ProductInputError[]) : [] };
    }
    if (err instanceof ApiError && err.status === 409) return { ok: false, error: "NAME_TAKEN" };
    return { ok: false, error: "FAILED" };
  }
}

/**
 * The form's "Yang dilihat bot" panel and its problems. Read-only, but the form is admin-only, so this
 * is too. Throws when refused or when the API cannot answer; the form then says the preview failed.
 */
export async function previewProductAction(id: string | null, draft: ProductDraft): Promise<ProductPreview> {
  if (!(await isAdmin())) throw new Error("FORBIDDEN");
  return previewCatalogProduct(typeof id === "string" ? id : null, draft);
}

/** Removes one design-reference photo; the bot stops sending it on its next turn. */
export async function deleteReferenceImageAction(id: string): Promise<{ ok: boolean }> {
  if (!(await isAdmin()) || typeof id !== "string" || !id) return { ok: false };
  try {
    await deleteReferenceImage(id);
  } catch {
    return { ok: false };
  }
  revalidatePath("/catalog");
  return { ok: true };
}
