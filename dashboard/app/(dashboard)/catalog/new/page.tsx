import { redirect } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { ProductForm } from "@/components/catalog/ProductForm";
import { getT } from "@/lib/i18n";
import { sessionRole } from "@/lib/session";

/** Tambah Produk. Catalog writes are admin-only, so anyone else goes back to the catalog. */
export default async function NewProductPage() {
  if ((await sessionRole()) !== "admin") redirect("/catalog");
  const t = await getT();
  return (
    <>
      <Header title={t("catalog.form.newTitle")} breadcrumb={t("catalog.title")} breadcrumbHref="/catalog" />
      <ProductForm />
    </>
  );
}
