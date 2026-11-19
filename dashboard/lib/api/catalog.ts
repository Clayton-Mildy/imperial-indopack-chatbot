import { apiFetch } from "./client";
import type { BrandSlug } from "@/lib/brands";
import type {
  BrandPriceList,
  CatalogCounts,
  CatalogProduct,
  CatalogProductDetail,
  PriceToolCall,
  PriceToolInput,
  ProductDraft,
  ProductPreview,
} from "@/types/api";

// The Katalog pages' API (api/src/routes/dashboard/catalogProducts.ts, brandPriceLists.ts, catalog.ts).
// Multipart uploads (import, price-list PDFs, reference photos) go through the app/api route handlers instead.

/** Who is acting, always read from the dashboard session by the caller - never from the browser. */
export interface StaffActor {
  staffId?: string;
  staffName: string;
}

const EMPTY_COUNTS: CatalogCounts = { all: 0, kertas_supreme: 0, imperial_indopack: 0 };

export async function listCatalogProducts(filters: {
  brand?: BrandSlug;
  search?: string;
  status?: "active" | "inactive";
}): Promise<{ items: CatalogProduct[]; counts: CatalogCounts }> {
  const qs = new URLSearchParams();
  if (filters.brand) qs.set("brand", filters.brand);
  if (filters.search) qs.set("search", filters.search);
  if (filters.status) qs.set("status", filters.status);
  const query = qs.toString();
  const envelope = await apiFetch<CatalogProduct[]>(`/catalog/products${query ? `?${query}` : ""}`);
  // This route's meta is { counts }, not the paging meta ApiEnvelope declares.
  const meta = envelope.meta as unknown as { counts?: CatalogCounts } | undefined;
  return { items: envelope.data ?? [], counts: { ...EMPTY_COUNTS, ...meta?.counts } };
}

export async function setCatalogProductActive(id: string, isActive: boolean, actor: StaffActor): Promise<CatalogProduct> {
  const envelope = await apiFetch<CatalogProduct>(`/catalog/products/${encodeURIComponent(id)}/active`, {
    method: "PATCH",
    body: JSON.stringify({ isActive, ...actor }),
  });
  return envelope.data as CatalogProduct;
}

/** How many sizes and tiers went with the product. */
export async function deleteCatalogProduct(id: string, actor: StaffActor): Promise<{ sizes: number; tiers: number }> {
  const qs = new URLSearchParams({ staffName: actor.staffName });
  if (actor.staffId) qs.set("staffId", actor.staffId);
  const envelope = await apiFetch<{ sizes: number; tiers: number }>(
    `/catalog/products/${encodeURIComponent(id)}?${qs.toString()}`,
    { method: "DELETE" }
  );
  return envelope.data ?? { sizes: 0, tiers: 0 };
}

/** hitung_harga over the bot's live catalog: exactly what a customer would be told. */
export async function checkPrice(input: PriceToolInput): Promise<{ text: string; call: PriceToolCall }> {
  const envelope = await apiFetch<{ text: string; call: PriceToolCall }>("/catalog/price-check", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!envelope.data) throw new Error("PRICE_CHECK_FAILED");
  return envelope.data;
}

/** Both brands, Kertas Supreme first. */
export async function getBrandPriceLists(): Promise<BrandPriceList[]> {
  const envelope = await apiFetch<BrandPriceList[]>("/brands/price-lists");
  return envelope.data ?? [];
}

/** The product with its history (newest first) and how chats use it. A 404 throws ApiError(404). */
export async function getCatalogProductDetail(id: string): Promise<CatalogProductDetail> {
  const envelope = await apiFetch<CatalogProductDetail>(`/catalog/products/${encodeURIComponent(id)}`);
  if (!envelope.data) throw new Error("PRODUCT_DETAIL_EMPTY");
  return envelope.data;
}

/**
 * Creates (id null) or replaces (PUT, sizes left out are deleted) a product. A refused draft throws
 * ApiError(400, VALIDATION_ERROR) with the per-field errors in `details`; a taken name ApiError(409, NAME_TAKEN).
 */
export async function saveCatalogProduct(id: string | null, draft: ProductDraft, actor: StaffActor): Promise<CatalogProduct> {
  const envelope = await apiFetch<CatalogProduct>(id ? `/catalog/products/${encodeURIComponent(id)}` : "/catalog/products", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify({ draft, ...actor }),
  });
  if (!envelope.data) throw new Error("PRODUCT_SAVE_EMPTY");
  return envelope.data;
}

/** How the bot would read the draft, its problems, and (over a stored product) what a save would record. */
export async function previewCatalogProduct(productId: string | null, draft: ProductDraft): Promise<ProductPreview> {
  const envelope = await apiFetch<ProductPreview>("/catalog/products/preview", {
    method: "POST",
    body: JSON.stringify(productId ? { productId, draft } : { draft }),
  });
  if (!envelope.data) throw new Error("PRODUCT_PREVIEW_EMPTY");
  return envelope.data;
}

/** One design-reference photo (Plan 1's route; 204, or 404 when it is already gone). */
export async function deleteReferenceImage(id: string): Promise<void> {
  await apiFetch<null>(`/reference-images/${encodeURIComponent(id)}`, { method: "DELETE" });
}
