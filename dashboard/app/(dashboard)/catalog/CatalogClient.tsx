"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DeleteProductDialog } from "@/components/catalog/DeleteProductDialog";
import { ImportExcelDialog } from "@/components/catalog/ImportExcelDialog";
import { PriceCheckPanel } from "@/components/catalog/PriceCheckPanel";
import { PriceListFiles } from "@/components/catalog/PriceListFiles";
import { ProductCard } from "@/components/catalog/ProductCard";
import { BASE_PATH } from "@/lib/basePath";
import { BRAND_SLUGS, BRAND_TAG, type BrandSlug } from "@/lib/brands";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { formatNumber } from "@/lib/i18n/core";
import type { BrandPriceList, CatalogCounts, CatalogProduct } from "@/types/api";

const actionBtn: React.CSSProperties = {
  font: "inherit",
  fontSize: 13,
  fontWeight: 500,
  height: 34,
  padding: "0 14px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#ffffff",
  color: "#1F2421",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  cursor: "pointer",
};
const control: React.CSSProperties = {
  font: "inherit",
  fontSize: 13,
  height: 34,
  padding: "0 10px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#ffffff",
  color: "#1F2421",
  boxSizing: "border-box",
};
const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

interface Props {
  products: CatalogProduct[];
  counts: CatalogCounts;
  /** Every active product, whatever the list is filtered to: the price check's choices. */
  activeProducts: CatalogProduct[];
  priceLists: BrandPriceList[];
  /** Import, Tambah, Ubah, Hapus and the price-list files are admin-only, like every catalog write. */
  isAdmin: boolean;
  loadFailed: boolean;
  activeBrand: BrandSlug | "";
  activeSearch: string;
  activeStatus: "active" | "inactive" | "";
}

export function CatalogClient({
  products,
  counts,
  activeProducts,
  priceLists,
  isAdmin,
  loadFailed,
  activeBrand,
  activeSearch,
  activeStatus,
}: Props) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const [searchInput, setSearchInput] = useState(activeSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState<CatalogProduct | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function navigate(patch: Partial<Record<"brand" | "search" | "status", string>>) {
    const current = { brand: activeBrand, search: searchInput.trim(), status: activeStatus, ...patch };
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(current)) if (value) qs.set(key, value);
    router.push(`/catalog${qs.toString() ? `?${qs.toString()}` : ""}`);
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ search: value.trim() }), 400);
  }

  // Active cards first, then the collapsed inactive rows; each in the API's (name) order.
  const ordered = [...products.filter((p) => p.isActive), ...products.filter((p) => !p.isActive)];
  const filtered = Boolean(activeBrand || activeSearch || activeStatus);
  const tabs: { value: BrandSlug | ""; label: string; count: number }[] = [
    { value: "", label: t("catalog.tab.all"), count: counts.all },
    ...BRAND_SLUGS.map((slug) => ({ value: slug, label: t(BRAND_TAG[slug].labelKey), count: counts[slug] })),
  ];

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: "24px 32px 32px", color: "#1F2421" }}>
      {/* The design's header actions; the shared Header has no actions slot, so they lead the page. */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, marginBottom: 16 }}>
        {isAdmin && (
          <button type="button" onClick={() => setImportOpen(true)} style={actionBtn}>
            {t("catalog.importExcel")}
          </button>
        )}
        {/* Always the whole catalog, not the filtered view. Plain anchor: the browser downloads it. */}
        <a href={`${BASE_PATH}/api/catalog-export`} download style={actionBtn}>
          {t("catalog.exportExcel")}
        </a>
        {isAdmin && (
          <Link href="/catalog/new" style={{ ...actionBtn, fontWeight: 600, border: 0, background: "#586B34", color: "#ffffff" }}>
            {t("catalog.addProduct")}
          </Link>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div
              role="tablist"
              aria-label={t("catalog.tabsLabel")}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                background: "#ffffff",
                border: "1px solid #E1E7DC",
                borderRadius: 8,
                padding: 4,
              }}
            >
              {tabs.map((tab) => {
                const selected = activeBrand === tab.value;
                return (
                  <button
                    key={tab.value || "all"}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => navigate({ brand: tab.value })}
                    style={{
                      font: "inherit",
                      fontSize: 13,
                      fontWeight: selected ? 600 : 500,
                      height: 32,
                      padding: "0 14px",
                      border: 0,
                      borderRadius: 6,
                      background: selected ? "#EAF2DD" : "transparent",
                      color: selected ? "#3E4C24" : "#3B4540",
                      cursor: "pointer",
                    }}
                  >
                    {tab.label} · {formatNumber(tab.count, lang)}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <label htmlFor="ct-search" style={srOnly}>
                {t("catalog.searchLabel")}
              </label>
              <input
                id="ct-search"
                type="search"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={t("catalog.searchPh")}
                style={{ ...control, width: 260, maxWidth: "100%" }}
              />
              <label htmlFor="ct-status" style={srOnly}>
                {t("catalog.statusLabel")}
              </label>
              <select
                id="ct-status"
                value={activeStatus}
                onChange={(e) => navigate({ status: e.target.value })}
                style={{ ...control, cursor: "pointer" }}
              >
                <option value="">{t("catalog.status.all")}</option>
                <option value="active">{t("catalog.status.active")}</option>
                <option value="inactive">{t("catalog.status.inactive")}</option>
              </select>
            </div>
          </div>

          <PriceListFiles priceLists={priceLists} canEdit={isAdmin} />

          {notice && (
            <div
              role="status"
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 14px",
                borderRadius: 8,
                background: "#F0F7E6",
                border: "1px solid #C9D6BB",
                fontSize: 13,
                color: "#3E4C24",
              }}
            >
              <span>{notice}</span>
              <button
                type="button"
                aria-label={t("catalog.import.close")}
                onClick={() => setNotice(null)}
                style={{ border: 0, background: "none", color: "#5F6B5A", cursor: "pointer", fontSize: 14 }}
              >
                ✕
              </button>
            </div>
          )}

          {loadFailed ? (
            <div role="alert" style={{ padding: 16, borderRadius: 8, background: "#FFF7F7", border: "1px solid #F1C9C9", color: "#B91C1C", fontSize: 13 }}>
              {t("catalog.loadFailed")}
            </div>
          ) : ordered.length === 0 ? (
            <div style={{ padding: 24, borderRadius: 8, background: "#ffffff", border: "1px solid #E1E7DC", color: "#5F6B5A", fontSize: 13, textAlign: "center" }}>
              {t(filtered ? "catalog.emptyFiltered" : "catalog.empty")}
            </div>
          ) : (
            ordered.map((p) => <ProductCard key={p.id} product={p} canEdit={isAdmin} onDelete={setDeleting} />)
          )}
        </div>

        <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", position: "sticky", top: 0 }}>
          <PriceCheckPanel products={activeProducts} />
        </div>
      </div>

      {importOpen && (
        <ImportExcelDialog
          onClose={() => setImportOpen(false)}
          onApplied={(rows) => {
            setImportOpen(false);
            setNotice(t("catalog.import.applied", { n: formatNumber(rows, lang) }));
            router.refresh();
          }}
        />
      )}
      {deleting && <DeleteProductDialog product={deleting} onClose={() => setDeleting(null)} />}
    </main>
  );
}
