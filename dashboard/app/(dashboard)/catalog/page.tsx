import { getBrands, getProducts, getUomList, getCategories } from "@/lib/api/catalog";
import { Header } from "@/components/layout/Header";
import { CatalogClient } from "./CatalogClient";
import { auth } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import type { Brand, Category, Uom } from "@/types/api";

interface CatalogPageProps {
  searchParams: Promise<{
    page?: string;
    limit?: string;
    brandId?: string;
    search?: string;
    status?: string;
    categoryId?: string;
  }>;
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const t = await getT();
  const params = await searchParams;
  const session = await auth();
  const isAdmin = (session?.user as { role?: string })?.role === "admin";

  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const limit = parseInt(params.limit ?? "25", 10);
  const validLimit = isNaN(limit) ? 25 : limit;
  const brandId = params.brandId ?? "all";
  const search = params.search ?? "";
  const status = params.status ?? "";
  const categoryId = params.categoryId ?? "";

  let brands: Brand[] = [];
  let uomList: Uom[] = [];
  let categoryList: Category[] = [];
  let products: import("@/types/api").Product[] = [];
  let meta = { page: 1, limit: validLimit, total: 0, totalPages: 1 };

  try {
    const [brandsResult, uomResult, categoriesResult, productsResult] = await Promise.all([
      getBrands(),
      getUomList(),
      getCategories(),
      getProducts({
        page,
        limit: validLimit,
        brandId: brandId !== "all" ? brandId : undefined,
        search: search || undefined,
        status: status || undefined,
        categoryId: categoryId || undefined,
      }),
    ]);
    brands = brandsResult;
    uomList = uomResult;
    categoryList = categoriesResult;
    products = productsResult.products;
    meta = productsResult.meta;
  } catch (err) {
    console.warn("[catalog] Fetch failed:", err);
  }

  return (
    <>
      <Header title={t("catalog.title")} />
      <CatalogClient
        brands={brands}
        products={products}
        uomList={uomList}
        categoryList={categoryList}
        meta={meta}
        currentPage={page}
        currentLimit={validLimit}
        currentBrandId={brandId}
        currentSearch={search}
        currentStatus={status}
        currentCategoryId={categoryId}
        isAdmin={isAdmin}
      />
    </>
  );
}
