import { redirect } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { ProductForm } from "@/components/catalog/ProductForm";
import { getCatalogProductDetail } from "@/lib/api/catalog";
import { getT } from "@/lib/i18n";
import { sessionRole } from "@/lib/session";
import type { CatalogProductDetail } from "@/types/api";

/**
 * Ubah Produk: the stored product with its history and use in chats. Admin-only like every catalog
 * write. `?photos=N` comes from Tambah Produk when the product saved but N of its photos did not.
 *
 * A product that is not there (deleted, or a stale link) sends staff back to the catalog rather than
 * to a 404: "Hapus produk" here revalidates, and Next re-renders this page in the action's response,
 * so a 404 would flash before the form's own navigation to the catalog.
 */
export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ photos?: string }>;
}) {
  if ((await sessionRole()) !== "admin") redirect("/catalog");
  const { id } = await params;
  const { photos } = await searchParams;

  let detail: CatalogProductDetail | null = null;
  try {
    detail = await getCatalogProductDetail(id);
  } catch (err) {
    // A malformed or unknown id is a 404 from the API: no such product. Anything else is a real failure.
    const status = (err as { status?: number }).status;
    if (status !== 404 && status !== 400) throw err;
  }
  if (!detail) redirect("/catalog");

  const t = await getT();
  const photosFailed = /^[1-3]$/.test(photos ?? "") ? Number(photos) : 0;
  const active = detail.product.isActive;

  return (
    <>
      <Header
        title={detail.product.name}
        breadcrumb={t("catalog.title")}
        breadcrumbHref="/catalog"
        badge={
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 4,
              background: active ? "#586B34" : "#EEF2EA",
              color: active ? "#ffffff" : "#5F6B5A",
            }}
          >
            {t(active ? "catalog.card.active" : "catalog.status.inactive")}
          </span>
        }
      />
      <ProductForm key={detail.product.id} detail={detail} photosFailed={photosFailed} />
    </>
  );
}
