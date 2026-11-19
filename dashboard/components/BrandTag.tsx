"use client";

import { BRAND_TAG, brandSlugs, type BrandSlug } from "@/lib/brands";
import { useT } from "@/lib/i18n/LangProvider";

/** Brand pills (Kertas Supreme green, Imperial Indopack gold), always Kertas Supreme first, duplicates dropped, whatever order is passed. */
export function BrandTags({ brands }: { brands: BrandSlug[] }): React.JSX.Element {
  const t = useT();
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
      {brandSlugs(brands).map((slug) => {
        const tag = BRAND_TAG[slug];
        return (
          <span
            key={slug}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 9999,
              background: tag.background,
              color: tag.color,
              whiteSpace: "nowrap",
            }}
          >
            {t(tag.labelKey)}
          </span>
        );
      })}
    </span>
  );
}
