import { Header } from "@/components/layout/Header";
import { getBrandPriceLists, listCatalogProducts } from "@/lib/api/catalog";
import { isBrandSlug, type BrandSlug } from "@/lib/brands";
import { getT } from "@/lib/i18n";
import { sessionRole } from "@/lib/session";
import type { BrandPriceList, CatalogCounts, CatalogProduct } from "@/types/api";
import { CatalogClient } from "./CatalogClient";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const brand: BrandSlug | undefined = isBrandSlug(params.brand) ? params.brand : undefined;
  const search = params.search?.trim() ?? "";
  const status = params.status === "active" || params.status === "inactive" ? params.status : undefined;
  const filtered = Boolean(brand || search || status);

  // The price check offers every active product whatever the list is filtered to; unfiltered, the
  // list itself already holds them. allSettled: a failed side call costs only its own part.
  const [listResult, activeResult, priceListResult] = await Promise.allSettled([
    listCatalogProducts({ brand, ...(search ? { search } : {}), status }),
    filtered ? listCatalogProducts({ status: "active" }) : Promise.resolve(null),
    getBrandPriceLists(),
  ]);

  let products: CatalogProduct[] = [];
  let counts: CatalogCounts = { all: 0, kertas_supreme: 0, imperial_indopack: 0 };
  const loadFailed = listResult.status === "rejected";
  if (listResult.status === "fulfilled") {
    products = listResult.value.items;
    counts = listResult.value.counts;
  } else {
    console.warn("[catalog] Fetch error:", listResult.reason);
  }
  const activeProducts =
    activeResult.status === "fulfilled"
      ? (activeResult.value?.items ?? products.filter((p) => p.isActive))
      : [];
  let priceLists: BrandPriceList[] = [];
  if (priceListResult.status === "fulfilled") priceLists = priceListResult.value;
  else console.warn("[catalog] Price lists fetch error:", priceListResult.reason);

  const t = await getT();
  const isAdmin = (await sessionRole()) === "admin";

  return (
    <>
      <Header title={t("catalog.title")} />
      <CatalogClient
        products={products}
        counts={counts}
        activeProducts={activeProducts}
        priceLists={priceLists}
        isAdmin={isAdmin}
        loadFailed={loadFailed}
        activeBrand={brand ?? ""}
        activeSearch={search}
        activeStatus={status ?? ""}
      />
    </>
  );
}
