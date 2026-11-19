import { formatNumber, translate, type Lang } from "@/lib/i18n/core";

// Client-safe display helpers shared by the inbox, team queue, leads and catalog screens.

/** 1 rim = 500 sheets (Kertas Supreme); the box brand counts the same 500 pcs as a rim. */
export const PCS_PER_RIM = 500;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** WIB is UTC+7 all year (no daylight saving), so a fixed offset gives the WIB calendar day. */
const WIB_OFFSET_MS = 7 * 60 * MINUTE_MS;

/**
 * '5.000 pcs (10 rim)', '12 rim (6.000 pcs)', '2.700 pcs'.
 * A pcs quantity gets its rim equivalent only when it is a whole number of rims.
 */
export function formatQty(qty: number, unit: "rim" | "pcs", lang: Lang): string {
  if (unit === "rim") {
    return `${formatNumber(qty, lang)} rim (${formatNumber(qty * PCS_PER_RIM, lang)} pcs)`;
  }
  const base = `${formatNumber(qty, lang)} pcs`;
  if (qty > 0 && qty % PCS_PER_RIM === 0) {
    return `${base} (${formatNumber(qty / PCS_PER_RIM, lang)} rim)`;
  }
  return base;
}

/** id: '18 mnt', '1 j 12 mnt', '1 hr 2 j'; en: '18 min', '1 h 12 min', '1 d 2 h'. */
export function formatWait(minutes: number, lang: Lang): string {
  const total = Math.max(0, Math.floor(minutes));
  if (total < 60) return translate(lang, "format.wait.min", { m: total });
  if (total < 1440) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m === 0
      ? translate(lang, "format.wait.hour", { h })
      : translate(lang, "format.wait.hourMin", { h, m });
  }
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  return h === 0
    ? translate(lang, "format.wait.day", { d })
    : translate(lang, "format.wait.dayHour", { d, h });
}

function wibDay(t: number): number {
  return Math.floor((t + WIB_OFFSET_MS) / DAY_MS);
}

/**
 * '10 mnt lalu', '1 jam lalu', 'kemarin' (the previous WIB calendar day), '3 hari lalu'.
 * Anything under an hour reads in minutes even across midnight.
 */
export function relativeTime(iso: string, now: Date, lang: Lang): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMin = Math.max(0, Math.floor((now.getTime() - then) / MINUTE_MS));
  if (diffMin < 1) return translate(lang, "format.ago.justNow");
  if (diffMin < 60) return translate(lang, "format.ago.min", { n: diffMin });
  const days = wibDay(now.getTime()) - wibDay(then);
  if (days <= 0) return translate(lang, "format.ago.hour", { n: Math.floor(diffMin / 60) });
  if (days === 1) return translate(lang, "format.ago.yesterday");
  return translate(lang, "format.ago.day", { n: days });
}
