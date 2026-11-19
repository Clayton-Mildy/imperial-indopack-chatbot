// Client-safe half of the i18n layer: no next/headers, no auth. Client components (the
// provider, the switch) import this directly; index.ts re-exports it and adds the server-only
// getLang()/getT(). Importing index.ts from a Client Component would pull next/headers in.
import { id } from "./id";
import { en } from "./en";

export type Lang = "id" | "en";
export type TKey = keyof typeof id;
export type TVars = Record<string, string | number>;
export type TFn = (key: TKey, vars?: TVars) => string;

export const LANG_COOKIE = "lang";

export function isLang(v: unknown): v is Lang {
  return v === "id" || v === "en";
}

const DICTS: Record<Lang, Record<TKey, string>> = { id, en };

/** `{name}` placeholders come from vars; a missing var leaves the placeholder visible. */
export function translate(lang: Lang, key: TKey, vars?: TVars): string {
  const text = DICTS[lang][key] ?? id[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole
  );
}

export function makeT(lang: Lang): TFn {
  return (key, vars) => translate(lang, key, vars);
}

const LOCALE: Record<Lang, string> = { id: "id-ID", en: "en-US" };

/** Dates are always shown in WIB, whatever the server's or browser's zone. */
export function formatDate(
  d: Date | string,
  lang: Lang,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }
): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: "Asia/Jakarta", ...options }).format(date);
}

export function formatNumber(n: number, lang: Lang): string {
  return new Intl.NumberFormat(LOCALE[lang]).format(n);
}

/** Always "Rp 46.000": rupiah is written the Indonesian way even in the English dashboard. */
export function formatRupiah(n: number): string {
  return `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Math.round(n))}`;
}
