import type { TKey } from "@/lib/i18n/core";

// The two brands sold through the one WhatsApp number. Slugs match the API (api/src/domain/brands.ts).
// Kertas Supreme is always listed first wherever both appear, as the designs do.
export type BrandSlug = "kertas_supreme" | "imperial_indopack";

export const BRAND_SLUGS: readonly BrandSlug[] = ["kertas_supreme", "imperial_indopack"];

/** Tag colours: Kertas Supreme green, Imperial Indopack gold. */
export const BRAND_TAG: Record<BrandSlug, { labelKey: TKey; background: string; color: string }> = {
  kertas_supreme: { labelKey: "brand.kertas_supreme", background: "#EAF2DD", color: "#445428" },
  imperial_indopack: { labelKey: "brand.imperial_indopack", background: "#F4EBD8", color: "#6E531E" },
};

export function isBrandSlug(v: unknown): v is BrandSlug {
  return v === "kertas_supreme" || v === "imperial_indopack";
}

/** Keeps the known slugs from an API value, de-duplicated and in BRAND_SLUGS order. */
export function brandSlugs(v: unknown): BrandSlug[] {
  if (!Array.isArray(v)) return [];
  return BRAND_SLUGS.filter((slug) => v.includes(slug));
}
