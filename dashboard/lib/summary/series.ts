import { BRAND_SLUGS, type BrandSlug } from "@/lib/brands";
import type { LeadReport } from "@/types/api";

export interface DaySeries {
  day: string;
  bars: { brand: BrandSlug; n: number }[];
}

/** Both brands per day (Kertas Supreme first), or only the filtered brand. */
export function brandSeries(rows: LeadReport["dailyByBrand"], brand: BrandSlug | null): DaySeries[] {
  const brands = brand ? [brand] : BRAND_SLUGS;
  return rows.map((r) => ({ day: r.day, bars: brands.map((b) => ({ brand: b, n: r[b] })) }));
}

/** Tallest bar, at least 1 so an empty range never divides by zero. */
export function seriesMax(s: DaySeries[]): number {
  return Math.max(1, ...s.flatMap((d) => d.bars.map((b) => b.n)));
}
