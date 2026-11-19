"use client";

import { useEffect, useRef, useState } from "react";
import { priceCheckAction } from "@/actions/catalogActions";
import { PCS_PER_RIM } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { formatNumber, formatRupiah } from "@/lib/i18n/core";
import type { CatalogProduct, PriceTier, PriceToolCall, QtyUnit } from "@/types/api";

const DEBOUNCE_MS = 300;

const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#5F6B5A" };
const control: React.CSSProperties = {
  font: "inherit",
  fontSize: 13,
  height: 34,
  padding: "0 8px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#ffffff",
  color: "#1F2421",
  width: "100%",
  boxSizing: "border-box",
};

const tierPcs = (t: PriceTier): number => (t.qtyUnit === "rim" ? t.minQty * PCS_PER_RIM : t.minQty);
const byPcs = (tiers: PriceTier[]): PriceTier[] => [...tiers].sort((a, b) => tierPcs(a) - tierPcs(b));

/** "2.500" (Indonesian thousands) is 2500, "1,5" is 1.5; anything else that is not a number is NaN. */
function parseQty(raw: string): number {
  const s = raw.trim().replace(/[.\s]/g, "").replace(",", ".");
  return s === "" ? NaN : Number(s);
}

type Result = { ok: true; text: string; call: PriceToolCall } | { ok: false; error: string };

/** The Katalog "Cek harga" panel: hitung_harga itself, so staff see exactly what a customer would be told. */
export function PriceCheckPanel({ products }: { products: CatalogProduct[] }) {
  const t = useT();
  const lang = useLang();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const product = products.find((p) => p.id === productId) ?? products[0];
  const [sizeId, setSizeId] = useState(product?.sizes[0]?.id ?? "");
  const size = product?.sizes.find((s) => s.id === sizeId) ?? product?.sizes[0];
  const lowest = size ? byPcs(size.tiers)[0] : undefined;
  const [qtyText, setQtyText] = useState(lowest ? String(lowest.minQty) : "");
  const [unit, setUnit] = useState<QtyUnit>(lowest?.qtyUnit ?? "rim");
  const [result, setResult] = useState<Result | null>(null);
  const [checking, setChecking] = useState(false);
  const requestRef = useRef(0);

  const qty = parseQty(qtyText);
  const productName = product?.name ?? "";
  const sizeName = size?.size ?? "";

  useEffect(() => {
    const request = ++requestRef.current;
    if (!productName || !sizeName || !Number.isFinite(qty) || qty <= 0) {
      setResult(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    const timer = setTimeout(async () => {
      let res: Result;
      try {
        res = await priceCheckAction({ product: productName, size: sizeName, qty, unit });
      } catch {
        res = { ok: false, error: t("catalog.check.failed") };
      }
      // A later edit already asked again: this answer is stale.
      if (request !== requestRef.current) return;
      setResult(res);
      setChecking(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [productName, sizeName, qty, unit, t]);

  function pickProduct(id: string) {
    const next = products.find((p) => p.id === id);
    setProductId(id);
    const firstSize = next?.sizes[0];
    setSizeId(firstSize?.id ?? "");
    const min = firstSize ? byPcs(firstSize.tiers)[0] : undefined;
    if (min) {
      setQtyText(String(min.minQty));
      setUnit(min.qtyUnit);
    }
  }

  const amount = (n: number, u: QtyUnit) => `${formatNumber(n, lang)} ${u}`;
  const sorted = size ? byPcs(size.tiers) : [];
  const top = sorted[sorted.length - 1];

  return (
    <section
      aria-labelledby="price-check-title"
      style={{
        flex: "1 1 280px",
        minWidth: 0,
        background: "#ffffff",
        border: "1px solid #E1E7DC",
        borderRadius: 8,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span id="price-check-title" style={{ fontSize: 14, fontWeight: 600, color: "#1F2421" }}>
          {t("catalog.check.title")}
        </span>
        <span style={{ fontSize: 12, color: "#5F6B5A" }}>{t("catalog.check.subtitle")}</span>
      </div>

      {!product ? (
        <span style={{ fontSize: 13, color: "#5F6B5A" }}>{t("catalog.check.noProducts")}</span>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor="cp-product" style={label}>
              {t("catalog.check.product")}
            </label>
            <select id="cp-product" value={product.id} onChange={(e) => pickProduct(e.target.value)} style={control}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor="cp-size" style={label}>
              {t("catalog.check.size")}
            </label>
            <select id="cp-size" value={size?.id ?? ""} onChange={(e) => setSizeId(e.target.value)} style={control}>
              {product.sizes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.size}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label htmlFor="cp-qty" style={label}>
                {t("catalog.check.qty")}
              </label>
              <input
                id="cp-qty"
                type="text"
                inputMode="decimal"
                value={qtyText}
                onChange={(e) => setQtyText(e.target.value)}
                style={control}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label htmlFor="cp-unit" style={label}>
                {t("catalog.check.unit")}
              </label>
              <select id="cp-unit" value={unit} onChange={(e) => setUnit(e.target.value as QtyUnit)} style={control}>
                <option value="rim">rim</option>
                <option value="pcs">pcs</option>
              </select>
            </div>
          </div>

          <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {checking && !result && <span style={{ fontSize: 12, color: "#5F6B5A" }}>{t("catalog.check.checking")}</span>}
            {result && !result.ok && <span style={{ fontSize: 12.5, color: "#B91C1C" }}>{result.error}</span>}
            {result?.ok && (
              <Outcome call={result.call} amount={amount} dim={checking} />
            )}
            {result?.ok && result.call.outcome === "quote" && lowest && top && (
              <span style={{ fontSize: 12, color: "#5F6B5A", lineHeight: 1.5 }}>
                {t("catalog.check.belowMin", { min: amount(lowest.minQty, lowest.qtyUnit) })}{" "}
                {t("catalog.check.aboveTop", { top: amount(top.minQty, top.qtyUnit) })}
              </span>
            )}
            {result?.ok && (
              <details style={{ fontSize: 12, color: "#5F6B5A" }}>
                <summary style={{ cursor: "pointer" }}>{t("catalog.check.toolText")}</summary>
                <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", lineHeight: 1.5, color: "#3B4540" }}>{result.text}</p>
              </details>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Outcome({
  call,
  amount,
  dim,
}: {
  call: PriceToolCall;
  amount: (n: number, u: QtyUnit) => string;
  dim: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const q = call.quote;
  const box: React.CSSProperties = {
    borderRadius: 6,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
    opacity: dim ? 0.6 : 1,
  };

  if (call.outcome === "quote" && q?.kind === "quote") {
    const { tier, nextTier } = q;
    const delivery = t(q.includesDelivery ? "catalog.check.deliveryIncluded" : "catalog.check.deliveryExcluded");
    const next = nextTier
      ? t("catalog.check.next", {
          qty: formatNumber(nextTier.minQty, lang),
          unit: nextTier.qtyUnit,
          price: formatRupiah(nextTier.priceIdr),
          priceUnit: nextTier.priceUnit,
        })
      : null;
    return (
      <div style={{ ...box, background: "#F0F7E6", color: "#1F2421" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#445428", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {t("catalog.check.tier", { qty: formatNumber(tier.minQty, lang), unit: tier.qtyUnit })}
        </span>
        <span>
          {t("catalog.check.line", {
            price: formatRupiah(q.unitPriceIdr),
            priceUnit: tier.priceUnit,
            qty: formatNumber(q.qtyInPriceUnit, lang),
          })}
        </span>
        <span style={{ fontSize: 17, fontWeight: 700 }}>{t("catalog.check.total", { amount: formatRupiah(q.totalIdr) })}</span>
        <span style={{ fontSize: 12, color: "#3B4540" }}>{next ? `${delivery} · ${next}` : delivery}</span>
      </div>
    );
  }

  // The three no-price outcomes: the bot's rule, in words. Amber, not red - nothing went wrong.
  const rule =
    call.outcome === "below_minimum" && q?.kind === "below_minimum"
      ? t("catalog.check.belowMin", { min: amount(q.minimum.minQty, q.minimum.qtyUnit) })
      : call.outcome === "above_top_tier" && q?.kind === "above_top_tier"
        ? t("catalog.check.aboveTop", { top: amount(q.top.minQty, q.top.qtyUnit) })
        : t("catalog.check.notInCatalog");
  return (
    <div style={{ ...box, background: "#FBF6EC", border: "1px solid #EAD9B5", color: "#6E531E", fontWeight: 600 }}>
      {rule}
    </div>
  );
}
