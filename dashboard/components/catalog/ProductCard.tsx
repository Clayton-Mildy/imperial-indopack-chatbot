"use client";

import Link from "next/link";
import { BrandTags } from "@/components/BrandTag";
import { BRAND_TAG } from "@/lib/brands";
import { apiFileUrl } from "@/lib/format";
import { gramasiSummary } from "@/lib/catalog/productForm";
import { PCS_PER_RIM } from "@/lib/format";
import { cellFor, deliveryLabel, distinctSizeCount, sizeRowLabel, tierColumns, type TierColumn } from "@/lib/catalog/tierTable";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { formatNumber, formatRupiah, type TFn } from "@/lib/i18n/core";
import type { CatalogProduct } from "@/types/api";

const MAX_THUMBS = 3;

const btn: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  height: 32,
  padding: "0 12px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  color: "#1F2421",
  background: "#ffffff",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  cursor: "pointer",
  fontFamily: "inherit",
};
const th: React.CSSProperties = {
  padding: "9px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: "#5F6B5A",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = { padding: "10px 12px", borderTop: "1px solid #EEF2EA", whiteSpace: "nowrap" };

/** "270 · 300 · 350 gsm · Cetak 1 warna · Laminasi food grade"; a value that already starts with its label keeps it once. */
function specLine(p: CatalogProduct, t: TFn): string {
  const labelled = (label: string, v: string | null): string | null => {
    const value = v?.trim();
    if (!value) return null;
    return value.toLowerCase().startsWith(label.toLowerCase()) ? value : `${label} ${value}`;
  };
  return [gramasiSummary(p.sizes.map((s) => s.gsm)) || null, labelled(t("catalog.card.print"), p.print), p.finishing?.trim() || null]
    .filter(Boolean)
    .join(" · ");
}

function Thumb({ url, alt, size }: { url: string; alt: string; size: number }) {
  // A plain <img>: the photo is an API-hosted upload, not a Next asset.
  return (
    <img
      src={apiFileUrl(url)}
      alt={alt}
      style={{ width: size, height: size, objectFit: "cover", borderRadius: 6, border: "1px solid #DDE5D6", display: "block" }}
    />
  );
}

interface Props {
  product: CatalogProduct;
  /** Ubah / Hapus are admin-only, like every catalog write. */
  canEdit: boolean;
  onDelete: (product: CatalogProduct) => void;
}

/** An active product as a card with its tier table; an inactive one collapses to a single row. */
export function ProductCard({ product: p, canEdit, onDelete }: Props) {
  const t = useT();
  const lang = useLang();
  const photos = [...p.referenceImages].sort((a, b) => a.sort - b.sort).slice(0, MAX_THUMBS);
  const editHref = `/catalog/${p.id}`;

  if (!p.isActive) {
    return (
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #E1E7DC",
          borderRadius: 8,
          padding: "14px 16px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 16,
          fontSize: 13,
          color: "#3B4540",
        }}
      >
        {photos[0] ? (
          <Thumb url={photos[0].imageUrl} alt={t("catalog.card.photoAlt", { name: p.name, n: 1 })} size={40} />
        ) : (
          <div style={{ width: 40, height: 40, borderRadius: 6, background: "#F8FAF6", border: "1px solid #DDE5D6" }} />
        )}
        <span style={{ flex: "1 1 260px" }}>
          <b style={{ color: "#1F2421" }}>{p.name}</b> · {t(BRAND_TAG[p.brand].labelKey)} ·{" "}
          {t("catalog.card.sizes", { n: distinctSizeCount(p.sizes) })}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "#F1F5F1", color: "#5F6B5A" }}>
          {t("catalog.card.inactive")}
        </span>
        {canEdit && (
          <Link href={editHref} style={{ fontSize: 12.5, fontWeight: 600, color: "#445428" }}>
            {t("catalog.card.edit")}
          </Link>
        )}
      </div>
    );
  }

  const columns = tierColumns(p.sizes);
  const colLabel = (c: TierColumn) => c.mixed && c.qtyUnit === "rim"
    ? t("catalog.card.fromBoth", { qty: formatNumber(c.minQty, lang), pcs: formatNumber(c.minQty * PCS_PER_RIM, lang) })
    : t("catalog.card.from", { qty: formatNumber(c.minQty, lang), unit: c.qtyUnit });
  const spec = specLine(p, t);

  return (
    <div style={{ background: "#ffffff", border: "1px solid #E1E7DC", borderRadius: 8, overflow: "hidden" }}>
      <div
        style={{
          padding: 16,
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "flex-start",
          borderBottom: "1px solid #EEF2EA",
        }}
      >
        {photos.length > 0 ? (
          <div style={{ display: "flex", gap: 6 }}>
            {photos.map((ph, i) => (
              <Thumb key={ph.id} url={ph.imageUrl} alt={t("catalog.card.photoAlt", { name: p.name, n: i + 1 })} size={56} />
            ))}
          </div>
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 6,
              background: "#FBF6EC",
              border: "1px dashed #D9C49A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              color: "#6E531E",
              textAlign: "center",
              lineHeight: 1.3,
              padding: 4,
              boxSizing: "border-box",
            }}
          >
            {t("catalog.card.noPhoto")}
          </div>
        )}
        <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#1F2421" }}>{p.name}</span>
            <BrandTags brands={[p.brand]} />
            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "#586B34", color: "#ffffff" }}>
              {t("catalog.card.active")}
            </span>
          </div>
          {spec && <span style={{ fontSize: 12.5, color: "#3B4540" }}>{spec}</span>}
          {p.use.trim() && <span style={{ fontSize: 12.5, color: "#5F6B5A" }}>{t("catalog.card.use", { use: p.use.trim() })}</span>}
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8 }}>
            <Link href={editHref} style={btn}>
              {t("catalog.card.edit")}
            </Link>
            <button type="button" onClick={() => onDelete(p)} style={{ ...btn, border: "1px solid #F1C9C9", color: "#B91C1C" }}>
              {t("catalog.card.delete")}
            </button>
          </div>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            minWidth: 680,
            borderCollapse: "collapse",
            fontSize: 13,
            fontVariantNumeric: "tabular-nums",
            color: "#1F2421",
          }}
        >
          <thead>
            <tr style={{ background: "#F8FAF6" }}>
              <th style={{ ...th, paddingLeft: 16 }}>
                {t(p.brand === "imperial_indopack" ? "catalog.card.sizeBox" : "catalog.card.size")}
              </th>
              {columns.map((c) => (
                <th key={`${c.minQty}-${c.qtyUnit}`} style={th}>
                  {colLabel(c)}
                </th>
              ))}
              <th style={th}>{t("catalog.card.delivery")}</th>
            </tr>
          </thead>
          <tbody>
            {p.sizes.map((s) => {
              const delivery = deliveryLabel(s);
              const includedAt = columns.filter((c) => cellFor(s, c)?.includesDelivery).map(colLabel);
              return (
                <tr key={s.id}>
                  <td style={{ ...td, paddingLeft: 16, fontWeight: 600 }}>{sizeRowLabel(s)}</td>
                  {columns.map((c) => {
                    const tier = cellFor(s, c);
                    return tier ? (
                      <td key={`${c.minQty}-${c.qtyUnit}`} style={td} title={tier.note ?? undefined}>
                        {formatRupiah(tier.priceIdr)}/{tier.priceUnit}
                      </td>
                    ) : (
                      <td key={`${c.minQty}-${c.qtyUnit}`} style={{ ...td, color: "#8A949B" }}>
                        —
                      </td>
                    );
                  })}
                  {delivery === "included" ? (
                    <td style={{ ...td, color: "#586B34", fontWeight: 600 }}>{t("catalog.card.deliveryIncluded")}</td>
                  ) : delivery === "excluded" ? (
                    <td style={{ ...td, color: "#5F6B5A" }}>{t("catalog.card.deliveryExcluded")}</td>
                  ) : (
                    <td
                      style={{ ...td, color: "#5F6B5A" }}
                      title={t("catalog.card.deliveryMixedTitle", { tiers: includedAt.join(", ") })}
                    >
                      {t("catalog.card.deliveryMixed")}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
