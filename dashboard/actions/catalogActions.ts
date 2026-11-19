"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createProduct,
  updateProduct,
  deleteProduct,
  createVariant,
  updateVariant,
  deleteVariant,
} from "@/lib/api/catalog";
import type { Product, ProductVariant, StockStatus } from "@/types/api";

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  return (session?.user as { role?: string })?.role === "admin";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ActionResult<T> = { data: T; error: null } | { data: null; error: string };

function isNameConflict(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("CONFLICT") || msg.includes("duplicate") || msg.includes("unique");
}

// ─── Product Actions ──────────────────────────────────────────────────────────

export async function createProductAction(data: {
  brandId: string;
  categoryId?: string | null;
  name: string;
  description?: string | null;
  fungsi?: string | null;
  usp?: string | null;
  kataKunci?: string | null;
  kelengkapan?: string | null;
  bahan?: string | null;
  ketebalan?: string | null;
  imageUrl?: string | null;
  tier?: string | null;
  upsellProductId?: string | null;
  relatedProductIds?: string[] | null;
}): Promise<ActionResult<Product>> {
  if (!(await requireAdmin())) return { data: null, error: "FORBIDDEN" };
  try {
    const product = await createProduct(data);
    revalidatePath("/catalog");
    return { data: product, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[createProductAction] error:", msg, e);
    if (isNameConflict(e)) return { data: null, error: "NAME_EXISTS" };
    return { data: null, error: "UNKNOWN" };
  }
}

export async function updateProductAction(
  id: string,
  data: Partial<{ brandId: string; categoryId: string | null; name: string; description: string | null; fungsi: string | null; usp: string | null; kataKunci: string | null; kelengkapan: string | null; bahan: string | null; ketebalan: string | null; imageUrl: string | null; tier: string | null; upsellProductId: string | null; relatedProductIds: string[] | null }>
): Promise<ActionResult<Product>> {
  if (!(await requireAdmin())) return { data: null, error: "FORBIDDEN" };
  try {
    const product = await updateProduct(id, data);
    revalidatePath("/catalog");
    return { data: product!, error: null };
  } catch (e) {
    if (isNameConflict(e)) return { data: null, error: "NAME_EXISTS" };
    return { data: null, error: "UNKNOWN" };
  }
}

export async function deleteProductAction(id: string) {
  if (!(await requireAdmin())) return;
  await deleteProduct(id);
  revalidatePath("/catalog");
}

// ─── Variant Actions ──────────────────────────────────────────────────────────

export async function createVariantAction(
  productId: string,
  data: {
    name: string;
    sku?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    priceIdr?: number | null;
    isiCtn?: number | null;
    isiBox?: number | null;
    uomPriceId?: string | null;
    uomCtnId?: string | null;
    uomBoxId?: string | null;
    mpPriceIdr?: number | null;
    mpUomId?: string | null;
    minOrderQty?: number | null;
    minOrderUomId?: string | null;
    stockStatus?: StockStatus;
    isActive?: boolean;
  },
  skipRevalidate = false
): Promise<ActionResult<ProductVariant>> {
  if (!(await requireAdmin())) return { data: null, error: "FORBIDDEN" };
  try {
    const variant = await createVariant(productId, data);
    if (!skipRevalidate) revalidatePath("/catalog");
    return { data: variant, error: null };
  } catch (e) {
    if (isNameConflict(e)) return { data: null, error: "NAME_EXISTS" };
    return { data: null, error: "UNKNOWN" };
  }
}

export async function updateVariantAction(
  id: string,
  data: Partial<{
    name: string;
    sku: string | null;
    description: string | null;
    imageUrl: string | null;
    priceIdr: number | null;
    isiCtn: number | null;
    isiBox: number | null;
    uomPriceId: string | null;
    uomCtnId: string | null;
    uomBoxId: string | null;
    mpPriceIdr: number | null;
    mpUomId: string | null;
    minOrderQty: number | null;
    minOrderUomId: string | null;
    stockStatus: StockStatus;
    isActive: boolean;
  }>
): Promise<ActionResult<ProductVariant>> {
  if (!(await requireAdmin())) return { data: null, error: "FORBIDDEN" };
  try {
    const variant = await updateVariant(id, data);
    revalidatePath("/catalog");
    return { data: variant!, error: null };
  } catch (e) {
    return { data: null, error: "UNKNOWN" };
  }
}

export async function deleteVariantAction(id: string) {
  if (!(await requireAdmin())) return;
  await deleteVariant(id);
  revalidatePath("/catalog");
}
