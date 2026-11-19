import { apiFetch } from "./client";
import type { Brand, Category, Product, ProductVariant, Uom } from "@/types/api";

// ─── UOM ──────────────────────────────────────────────────────────────────────

export async function getUomList(): Promise<Uom[]> {
  const envelope = await apiFetch<Uom[]>("/uom");
  return envelope.data ?? [];
}

export async function createUom(name: string, description?: string): Promise<Uom> {
  const envelope = await apiFetch<Uom>("/uom", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
  if (!envelope.data) throw new Error("Failed to create UOM");
  return envelope.data;
}

export async function updateUom(id: string, data: { name?: string; description?: string }): Promise<Uom> {
  const envelope = await apiFetch<Uom>(`/uom/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!envelope.data) throw new Error("Failed to update UOM");
  return envelope.data;
}

export async function deleteUom(id: string): Promise<void> {
  await apiFetch(`/uom/${id}`, { method: "DELETE" });
}

// ─── Brands ───────────────────────────────────────────────────────────────────

export async function getBrands(): Promise<Brand[]> {
  const envelope = await apiFetch<Brand[]>("/brands");
  return envelope.data ?? [];
}

export async function createBrand(name: string, description?: string, catalogFileUrl?: string): Promise<Brand> {
  const envelope = await apiFetch<Brand>("/brands", {
    method: "POST",
    body: JSON.stringify({ name, description, catalogFileUrl }),
  });
  if (!envelope.data) throw new Error("Failed to create brand");
  return envelope.data;
}

export async function updateBrand(id: string, data: { name?: string; description?: string; catalogFileUrl?: string | null }): Promise<Brand> {
  const envelope = await apiFetch<Brand>(`/brands/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!envelope.data) throw new Error("Failed to update brand");
  return envelope.data;
}

export async function deleteBrand(id: string): Promise<void> {
  await apiFetch(`/brands/${id}`, { method: "DELETE" });
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function getCategories(): Promise<Category[]> {
  const envelope = await apiFetch<Category[]>("/categories");
  return envelope.data ?? [];
}

export async function createCategory(data: { name: string; description?: string | null }): Promise<Category> {
  const envelope = await apiFetch<Category>("/categories", {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!envelope.data) throw new Error("Failed to create category");
  return envelope.data;
}

export async function updateCategory(id: string, data: { name?: string; description?: string | null }): Promise<Category> {
  const envelope = await apiFetch<Category>(`/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!envelope.data) throw new Error("Failed to update category");
  return envelope.data;
}

export async function deleteCategory(id: string): Promise<void> {
  await apiFetch(`/categories/${id}`, { method: "DELETE" });
}

// ─── Products ─────────────────────────────────────────────────────────────────

export interface ProductsResult {
  products: Product[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function getProducts(filters?: {
  page?: number;
  limit?: number;
  brandId?: string;
  search?: string;
  isActive?: boolean;
  status?: string;
  categoryId?: string;
}): Promise<ProductsResult> {
  const qs = new URLSearchParams();
  if (filters?.page !== undefined) qs.set("page", String(filters.page));
  if (filters?.limit !== undefined) qs.set("limit", String(filters.limit));
  if (filters?.brandId) qs.set("brandId", filters.brandId);
  if (filters?.search) qs.set("search", filters.search);
  if (filters?.isActive !== undefined) qs.set("isActive", String(filters.isActive));
  if (filters?.status) qs.set("status", filters.status);
  if (filters?.categoryId) qs.set("categoryId", filters.categoryId);
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const envelope = await apiFetch<Product[]>(`/products${query}`);
  const meta = envelope.meta ?? { page: 1, limit: filters?.limit ?? 25, total: 0, totalPages: 1 };
  return {
    products: envelope.data ?? [],
    meta: {
      page: meta.page,
      limit: meta.limit,
      total: meta.total,
      totalPages: (meta as { totalPages?: number }).totalPages ?? 1,
    },
  };
}

export async function getProduct(id: string): Promise<Product | null> {
  try {
    const envelope = await apiFetch<Product>(`/products/${id}`);
    return envelope.data ?? null;
  } catch {
    return null;
  }
}

export async function createProduct(data: {
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
  sku?: string | null;
  priceIdr?: number | null;
  isiCtn?: number | null;
  isiBox?: number | null;
  uomPriceId?: string | null;
  uomCtnId?: string | null;
  uomBoxId?: string | null;
  imageUrl?: string | null;
  stockStatus?: string;
  isActive?: boolean;
  tier?: string | null;
  upsellProductId?: string | null;
  relatedProductIds?: string[] | null;
}): Promise<Product> {
  const envelope = await apiFetch<Product>("/products", {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!envelope.data) throw new Error("Failed to create product");
  return envelope.data;
}

export async function updateProduct(
  id: string,
  data: Partial<{
    brandId: string;
    categoryId: string | null;
    name: string;
    description: string | null;
    fungsi: string | null;
    usp: string | null;
    kataKunci: string | null;
    kelengkapan: string | null;
    bahan: string | null;
    ketebalan: string | null;
    sku: string | null;
    priceIdr: number | null;
    isiCtn: number | null;
    isiBox: number | null;
    uomPriceId: string | null;
    uomCtnId: string | null;
    uomBoxId: string | null;
    imageUrl: string | null;
    stockStatus: string;
    isActive: boolean;
    tier: string | null;
    upsellProductId: string | null;
    relatedProductIds: string[] | null;
  }>
): Promise<Product> {
  const envelope = await apiFetch<Product>(`/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!envelope.data) throw new Error("Failed to update product");
  return envelope.data;
}

export async function deleteProduct(id: string): Promise<void> {
  await apiFetch(`/products/${id}`, { method: "DELETE" });
}

// ─── Variants ─────────────────────────────────────────────────────────────────

export async function createVariant(
  productId: string,
  data: {
    name: string;
    sku?: string | null;
    description?: string | null;
    priceIdr?: number | null;
    mpPriceIdr?: number | null;
    isiCtn?: number | null;
    isiBox?: number | null;
    uomPriceId?: string | null;
    mpUomId?: string | null;
    uomCtnId?: string | null;
    uomBoxId?: string | null;
    minOrderQty?: number | null;
    minOrderUomId?: string | null;
    imageUrl?: string | null;
    stockStatus?: string;
    isActive?: boolean;
  }
): Promise<ProductVariant> {
  const envelope = await apiFetch<ProductVariant>(`/products/${productId}/variants`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!envelope.data) throw new Error("Failed to create variant");
  return envelope.data;
}

export async function updateVariant(
  id: string,
  data: Partial<{
    name: string;
    sku: string | null;
    description: string | null;
    priceIdr: number | null;
    mpPriceIdr: number | null;
    isiCtn: number | null;
    isiBox: number | null;
    uomPriceId: string | null;
    mpUomId: string | null;
    uomCtnId: string | null;
    uomBoxId: string | null;
    minOrderQty: number | null;
    minOrderUomId: string | null;
    imageUrl: string | null;
    stockStatus: string;
    isActive: boolean;
  }>
): Promise<ProductVariant> {
  const envelope = await apiFetch<ProductVariant>(`/variants/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!envelope.data) throw new Error("Failed to update variant");
  return envelope.data;
}

export async function deleteVariant(id: string): Promise<void> {
  await apiFetch(`/variants/${id}`, { method: "DELETE" });
}
