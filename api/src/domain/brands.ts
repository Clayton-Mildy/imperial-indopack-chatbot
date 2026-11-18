import type { BrandSlug } from './orderProfile.js';

export const BRAND_SLUGS: readonly BrandSlug[] = ['kertas_supreme', 'imperial_indopack'];

export const BRAND_NAME: Record<BrandSlug, string> = {
  kertas_supreme: 'Kertas Supreme',
  imperial_indopack: 'Imperial Indopack',
};

/** The slug of a brand row's name, case-insensitive; null for any other brand. */
export function brandSlugOfName(name: string): BrandSlug | null {
  const n = name.trim().toLowerCase();
  return BRAND_SLUGS.find((s) => BRAND_NAME[s].toLowerCase() === n) ?? null;
}
