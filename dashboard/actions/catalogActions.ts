"use server";

import { revalidatePath } from "next/cache";
import { checkPrice, deleteCatalogProduct, setCatalogProductActive } from "@/lib/api/catalog";
import { ApiError } from "@/lib/api/client";
import { sessionRole, sessionStaff } from "@/lib/session";
import { getT } from "@/lib/i18n";
import type { PriceToolCall } from "@/types/api";

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
