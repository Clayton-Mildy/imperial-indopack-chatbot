"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { photoProductsAction, poFormPreviewAction, quickSendAction } from "@/actions/conversationActions";
import { BRAND_SLUGS, BRAND_TAG, type BrandSlug } from "@/lib/brands";
import { quickSendAllFailed, quickSendErrorKey, quickSendLines } from "@/lib/conversations/labels";
import { PO_FORM_CHOICES, defaultPoFormChoice, poFormPreview, poUnsetKey } from "@/lib/conversations/poForms";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import type { PhotoProduct, PoFormChoice, PoFormKind, PoFormsSetting, QuickSendAction, QuickSendItem } from "@/types/api";

const pill: React.CSSProperties = {
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  height: 30,
  padding: "0 10px",
  border: "1px solid #C9D6BB",
  borderRadius: 9999,
  background: "#F5F8F2",
  color: "#3E4C24",
  cursor: "pointer",
};

const smallBtn: React.CSSProperties = {
  font: "inherit",
  fontSize: 12.5,
  fontWeight: 600,
  height: 32,
  padding: "0 12px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#ffffff",
  color: "#1F2421",
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = { ...smallBtn, border: 0, background: "#586B34", color: "#ffffff" };

const RESULT_TONE = {
  ok: { background: "#F0FDF4", border: "#BBF7D0", color: "#15803D" },
  warn: { background: "#FFFBEB", border: "#F3DC94", color: "#92400E" },
  error: { background: "#FEF2F2", border: "#FECACA", color: "#B91C1C" },
} as const;

type Panel = "brand" | "photos" | "po" | null;

/**
 * Kirim daftar harga / foto referensi / form PO. Each send goes as the session's staff member, who
 * then holds the chat. While one send is out every button is disabled (a double click must not send
 * twice); afterwards each item says whether WhatsApp took it. The PO dialog offers Form cetak (has a
 * design), Form plano (no design) or Keduanya, preselected from the order's design facts.
 */
export function QuickSendBar({
  conversationId,
  brands,
  nearestProductId,
  suggestedPoForms,
}: {
  conversationId: string;
  /** The brands in the customer's profile: exactly one sends that brand's list straight away. */
  brands: BrandSlug[];
  /** The photo picker's default: the first nearest catalog match. */
  nearestProductId: string | null;
  /** The PO form(s) the bot would send for this order (order panel): the PO dialog's default. */
  suggestedPoForms: PoFormKind[];
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [result, setResult] = useState<{ tone: keyof typeof RESULT_TONE; lines: string[] } | null>(null);

  const [products, setProducts] = useState<PhotoProduct[] | null>(null);
  const [productsFailed, setProductsFailed] = useState(false);
  const [productId, setProductId] = useState<string>(nearestProductId ?? "");

  const [po, setPo] = useState<PoFormsSetting | null>(null);
  const [poFailed, setPoFailed] = useState(false);
  const [poChoice, setPoChoice] = useState<PoFormChoice>("both");
  const suggestedChoice = defaultPoFormChoice(suggestedPoForms);

  useEffect(() => {
    if (panel !== "po") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !inFlight.current) setPanel(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel]);

  const brandName = (b: BrandSlug) => t(BRAND_TAG[b].labelKey);

  async function run(actions: QuickSendAction[]) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setResult(null);
    const lines: string[] = [];
    const errors: string[] = [];
    const items: QuickSendItem[] = [];
    try {
      for (const action of actions) {
        const res = await quickSendAction(conversationId, action).catch(() => ({ ok: false as const, error: "FAILED" as const }));
        if (res.ok) {
          items.push(...res.sent);
          lines.push(...quickSendLines(action, res.sent, lang));
        } else {
          const msg = t(quickSendErrorKey(res.error));
          // "Keduanya" sends one brand at a time: say which brand had nothing to send.
          errors.push(
            actions.length > 1 && action.kind === "price_list" && action.brand
              ? t("conversations.quick.brandError", { brand: brandName(action.brand), error: msg })
              : msg
          );
        }
      }
    } finally {
      inFlight.current = false;
      setSending(false);
    }
    setPanel(null);
    const allFailed = quickSendAllFailed(items);
    const tone = items.length === 0 || allFailed ? "error" : errors.length > 0 || items.some((i) => i.status === "saved") ? "warn" : "ok";
    setResult({ tone, lines: [...(allFailed ? [t("conversations.quick.allFailed")] : []), ...lines, ...errors] });
    if (items.length > 0) router.refresh();
  }

  function onPriceList() {
    setResult(null);
    if (brands.length === 1) return void run([{ kind: "price_list", brand: brands[0] }]);
    setPanel(panel === "brand" ? null : "brand");
  }

  async function onPhotos() {
    setResult(null);
    if (panel === "photos") return setPanel(null);
    setPanel("photos");
    if (products) return;
    setProductsFailed(false);
    const res = await photoProductsAction().catch(() => ({ ok: false as const }));
    if (!res.ok) return setProductsFailed(true);
    setProducts(res.products);
    setProductId((current) => current || nearestProductId || res.products.find((p) => p.photos > 0)?.id || "");
  }

  async function onPoForm() {
    setResult(null);
    setPanel("po");
    setPo(null);
    setPoFailed(false);
    setPoChoice(suggestedChoice);
    const res = await poFormPreviewAction().catch(() => ({ ok: false as const }));
    if (res.ok) setPo(res.setting);
    else setPoFailed(true);
  }

  // The picker lists the active catalog by brand; the nearest match is kept even if it is not in the list.
  const byBrand = BRAND_SLUGS.map((b) => ({ brand: b, items: (products ?? []).filter((p) => p.brand === b) })).filter((g) => g.items.length > 0);
  const tone = result ? RESULT_TONE[result.tone] : null;
  const poPreview = po ? poFormPreview(po, poChoice) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button type="button" style={{ ...pill, opacity: sending ? 0.6 : 1 }} disabled={sending} onClick={onPriceList} aria-expanded={brands.length === 1 ? undefined : panel === "brand"}>
          {t("conversations.quick.priceList")}
        </button>
        <button type="button" style={{ ...pill, opacity: sending ? 0.6 : 1 }} disabled={sending} onClick={onPhotos} aria-expanded={panel === "photos"}>
          {t("conversations.quick.photos")}
        </button>
        <button type="button" style={{ ...pill, opacity: sending ? 0.6 : 1 }} disabled={sending} onClick={onPoForm}>
          {t("conversations.quick.poForm")}
        </button>
        {sending && <span style={{ fontSize: 12, color: "#5F6B5A", alignSelf: "center" }}>{t("conversations.quick.sending")}</span>}
      </div>

      {panel === "brand" && (
        <div role="menu" style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 8, borderRadius: 8, background: "#F8FAF6", border: "1px solid #E1E7DC" }}>
          {BRAND_SLUGS.map((b) => (
            <button key={b} type="button" role="menuitem" style={smallBtn} disabled={sending} onClick={() => run([{ kind: "price_list", brand: b }])}>
              {brandName(b)}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            style={smallBtn}
            disabled={sending}
            onClick={() => run(BRAND_SLUGS.map((b) => ({ kind: "price_list" as const, brand: b })))}
          >
            {t("conversations.quick.both")}
          </button>
        </div>
      )}

      {panel === "photos" && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8, padding: 8, borderRadius: 8, background: "#F8FAF6", border: "1px solid #E1E7DC" }}>
          {productsFailed ? (
            <span style={{ fontSize: 12.5, color: "#B91C1C" }}>{t("conversations.quick.loadFailed")}</span>
          ) : !products ? (
            <span style={{ fontSize: 12.5, color: "#5F6B5A" }}>{t("conversations.quick.loading")}</span>
          ) : products.length === 0 ? (
            <span style={{ fontSize: 12.5, color: "#5F6B5A" }}>{t("conversations.quick.noProducts")}</span>
          ) : (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 220px", minWidth: 0 }}>
                <span style={{ fontSize: 11.5, color: "#5F6B5A" }}>{t("conversations.quick.product")}</span>
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  style={{ font: "inherit", fontSize: 12.5, height: 32, padding: "0 8px", border: "1px solid #D5DECF", borderRadius: 6, background: "#ffffff", color: "#1F2421", maxWidth: "100%" }}
                >
                  {!productId && <option value="" />}
                  {byBrand.map((g) => (
                    <optgroup key={g.brand} label={brandName(g.brand)}>
                      {g.items.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.photos > 0
                            ? t("conversations.quick.productPhotos", { name: p.name, n: p.photos })
                            : t("conversations.quick.productNoPhotos", { name: p.name })}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <button
                type="button"
                style={{ ...primaryBtn, opacity: sending || !productId ? 0.6 : 1 }}
                disabled={sending || !productId}
                onClick={() => run([{ kind: "reference_photos", productId }])}
              >
                {t("conversations.quick.send")}
              </button>
            </>
          )}
        </div>
      )}

      {result && tone && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 8,
            background: tone.background,
            border: `1px solid ${tone.border}`,
            color: tone.color,
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        >
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            {result.lines.map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </div>
          <button
            type="button"
            aria-label={t("conversations.quick.close")}
            onClick={() => setResult(null)}
            style={{ font: "inherit", border: 0, background: "none", color: "inherit", cursor: "pointer", padding: 0, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      {panel === "po" && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(31, 36, 33, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !sending) setPanel(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="qs-po-title"
            style={{ width: "100%", maxWidth: 460, background: "#ffffff", borderRadius: 12, boxShadow: "0 12px 32px rgba(31, 36, 33, 0.18)", padding: 22, display: "flex", flexDirection: "column", gap: 12, color: "#1F2421" }}
          >
            <span id="qs-po-title" style={{ fontSize: 16, fontWeight: 700 }}>
              {t("conversations.quick.poTitle")}
            </span>
            <div role="radiogroup" aria-label={t("conversations.quick.poChoice")} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 11.5, color: "#5F6B5A" }}>{t("conversations.quick.poChoice")}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {PO_FORM_CHOICES.map((c) => {
                  const on = poChoice === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={sending}
                      onClick={() => setPoChoice(c)}
                      style={{
                        font: "inherit",
                        flex: "1 1 120px",
                        minWidth: 0,
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: on ? "1.5px solid #586B34" : "1px solid #D5DECF",
                        background: on ? "#F5F8F2" : "#ffffff",
                        color: "#1F2421",
                        cursor: sending ? "default" : "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{t(`conversations.quick.poChoice.${c}`)}</span>
                      <span style={{ fontSize: 11.5, color: "#5F6B5A" }}>{t(`conversations.quick.poHint.${c}`)}</span>
                      {c === suggestedChoice && <span style={{ fontSize: 11, fontWeight: 600, color: "#586B34" }}>{t("conversations.quick.poSuggested")}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            {poFailed ? (
              <span style={{ fontSize: 13, color: "#B91C1C" }}>{t("conversations.quick.loadFailed")}</span>
            ) : !po ? (
              <span style={{ fontSize: 13, color: "#5F6B5A" }}>{t("conversations.quick.loading")}</span>
            ) : poPreview && !poPreview.ok ? (
              // The placeholder link never goes to a customer (the API refuses it too), so there is nothing to confirm.
              <span style={{ fontSize: 13, color: "#92400E", background: "#FFFBEB", border: "1px solid #F3DC94", borderRadius: 8, padding: "10px 12px", lineHeight: 1.5 }}>
                {t(poUnsetKey(po, poPreview.unset))}
              </span>
            ) : poPreview ? (
              <>
                <span style={{ fontSize: 13, color: "#3B4540" }}>{t("conversations.quick.poBody")}</span>
                <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#F5F8F2", border: "1px solid #E1E7DC", borderRadius: 8, padding: "10px 12px" }}>
                  {poPreview.message}
                </div>
              </>
            ) : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <button type="button" style={smallBtn} disabled={sending} onClick={() => setPanel(null)}>
                {poPreview?.ok ? t("common.cancel") : t("conversations.quick.close")}
              </button>
              {poPreview?.ok && (
                <button type="button" style={{ ...primaryBtn, opacity: sending ? 0.6 : 1 }} disabled={sending} onClick={() => run([{ kind: "po_form", form: poChoice }])}>
                  {sending ? t("conversations.quick.sending") : t("conversations.quick.send")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
