import { BRAND_TAG } from "@/lib/brands";
import { PCS_PER_RIM } from "@/lib/format";
import { formatNumber, type Lang, type TFn, type TKey } from "@/lib/i18n/core";
import { id } from "@/lib/i18n/id";
import type { GoLiveIssue } from "@/types/api";

// Client-safe helpers for Pengaturan: the PO link check, the minimum-order hint, the prompt section
// labels and the go-live banner lines.

/**
 * A PO form link as staff paste it (trimmed): 'ok' for https:// with a host, 'not_https' for http://,
 * anything else 'invalid'. The link goes to customers exactly as saved, so it must start with
 * https:// itself - the URL parser alone would also take "https:forms.gle".
 */
export function validatePoUrl(url: string): "ok" | "not_https" | "invalid" {
  const v = url.trim();
  const scheme = /^https:\/\//i.test(v) ? "https" : /^http:\/\//i.test(v) ? "http" : null;
  if (!scheme) return "invalid";
  let host: string;
  try {
    host = new URL(v).hostname;
  } catch {
    return "invalid";
  }
  if (!host) return "invalid";
  return scheme === "https" ? "ok" : "not_https";
}

/** The unit beside the minimum-order input: 2500 -> 'pcs (5 rim)'; 1200 -> 'pcs' (rims only when whole). */
export function minOrderHint(pcs: number, lang: Lang): string {
  return pcs > 0 && pcs % PCS_PER_RIM === 0 ? `pcs (${formatNumber(pcs / PCS_PER_RIM, lang)} rim)` : "pcs";
}

/** The shipped prompt sections (api/src/domain/constants.ts SYSTEM_PROMPT_SECTIONS) by their stored name. */
const SECTION_LABEL: Record<string, TKey> = {
  Identity: "settings.prompt.section.identity",
  Mission: "settings.prompt.section.mission",
  Tone: "settings.prompt.section.tone",
  Brands: "settings.prompt.section.brands",
  "Order Details": "settings.prompt.section.orderDetails",
  Recommendations: "settings.prompt.section.recommendations",
  Pricing: "settings.prompt.section.pricing",
  Design: "settings.prompt.section.design",
  "PO Form": "settings.prompt.section.poForm",
  Rules: "settings.prompt.section.rules",
  Escalation: "settings.prompt.section.escalation",
};

/** A shipped section's label key; any other section keeps its own name. */
export function sectionLabelKey(name: string): TKey | string {
  return Object.hasOwn(SECTION_LABEL, name) ? SECTION_LABEL[name] : name;
}

/** What a section tile shows: the translated label for a shipped section, else the stored name. */
export function sectionLabel(name: string, t: TFn): string {
  const key = sectionLabelKey(name);
  return key !== name && key in id ? t(key as TKey) : name;
}

/** One banner line, linking to where the issue is fixed: a section of this page (#…) or a page (/…). */
export interface GoLiveLine {
  text: string;
  href: string;
}

/** The banner line for an issue; null for a code this dashboard does not know yet. */
export function goLiveIssueLine(issue: GoLiveIssue, t: TFn): GoLiveLine | null {
  switch (issue.code) {
    case "po_form_placeholder":
      return issue.form === "plano"
        ? { text: t("settings.golive.poForm.plano"), href: "#pemesanan" }
        : { text: t("settings.golive.poForm.cetak"), href: "#pemesanan" };
    case "whatsapp_not_connected":
      return { text: t("settings.golive.whatsapp"), href: "#whatsapp" };
    case "catalog_empty":
      return { text: t("settings.golive.catalogEmpty"), href: "/catalog" };
    case "catalog_demo":
      return { text: t("settings.golive.catalogDemo"), href: "/catalog" };
    case "price_list_missing": {
      const brand = BRAND_TAG[issue.brand];
      return brand ? { text: t("settings.golive.priceList", { brand: t(brand.labelKey) }), href: "/catalog" } : null;
    }
    default:
      return null;
  }
}
