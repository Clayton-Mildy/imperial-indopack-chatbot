"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandTags } from "@/components/BrandTag";
import { BASE_PATH } from "@/lib/basePath";
import { BRAND_SLUGS, BRAND_TAG, type BrandSlug } from "@/lib/brands";
import { apiFileUrl } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { formatDate } from "@/lib/i18n/core";
// Same cap as the API (routes/dashboard/brandPriceLists.ts); checked here too so a huge file is
// refused before it is sent.
import { PDF_MAX_BYTES } from "@/lib/uploadLimit";
import type { BrandPriceList } from "@/types/api";


const linkBtn: React.CSSProperties = {
  font: "inherit",
  fontSize: 13,
  padding: 0,
  border: 0,
  background: "none",
  color: "#445428",
  textDecoration: "underline",
  cursor: "pointer",
};

/** "Daftar harga untuk dikirim bot": each brand's price-list PDF, the file the bot sends. */
export function PriceListFiles({ priceLists, canEdit }: { priceLists: BrandPriceList[]; canEdit: boolean }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const inputs = useRef<Partial<Record<BrandSlug, HTMLInputElement | null>>>({});
  const [busy, setBusy] = useState<BrandSlug | null>(null);
  const [error, setError] = useState<string | null>(null);

  function errorText(status: number, code: unknown): string {
    if (code === "UNSUPPORTED_MIME_TYPE") return t("catalog.priceLists.notPdf");
    if (status === 413 || code === "FILE_TOO_LARGE") return t("catalog.priceLists.tooLarge");
    if (code === "FORBIDDEN") return t("catalog.err.forbidden");
    return t("catalog.priceLists.failed");
  }

  async function send(slug: BrandSlug, init: RequestInit) {
    setBusy(slug);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/brand-price-list/${slug}`, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) setError(errorText(res.status, body.error));
      else router.refresh();
    } catch {
      setError(t("catalog.priceLists.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function upload(slug: BrandSlug, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires
    if (!file) return;
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) return setError(t("catalog.priceLists.notPdf"));
    if (file.size > PDF_MAX_BYTES) return setError(t("catalog.priceLists.tooLarge"));
    const form = new FormData();
    form.append("file", file, file.name);
    await send(slug, { method: "POST", body: form });
  }

  async function remove(slug: BrandSlug) {
    if (!window.confirm(t("catalog.priceLists.removeConfirm", { brand: t(BRAND_TAG[slug].labelKey) }))) return;
    await send(slug, { method: "DELETE" });
  }

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #E1E7DC",
        borderRadius: 8,
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontSize: 13,
        color: "#1F2421",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 24px" }}>
        <span style={{ fontWeight: 600 }}>{t("catalog.priceLists.title")}</span>
        {BRAND_SLUGS.map((slug) => {
          const file = priceLists.find((p) => p.brand === slug);
          const has = Boolean(file?.url);
          return (
            <span key={slug} style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <BrandTags brands={[slug]} />
              {has && file?.url ? (
                <span>
                  <a href={apiFileUrl(file.url)} target="_blank" rel="noopener noreferrer" style={{ color: "#1F2421" }}>
                    {file.fileName ?? t(BRAND_TAG[slug].labelKey)}
                  </a>
                  {file.uploadedAt ? ` · ${formatDate(file.uploadedAt, lang, { day: "numeric", month: "short" })}` : ""}
                </span>
              ) : (
                <span style={{ color: "#92400E", fontWeight: 600 }}>{t("catalog.priceLists.none")}</span>
              )}
              {canEdit &&
                (busy === slug ? (
                  <span style={{ color: "#5F6B5A" }}>{t("catalog.priceLists.uploading")}</span>
                ) : (
                  <>
                    <input
                      ref={(el) => {
                        inputs.current[slug] = el;
                      }}
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(e) => upload(slug, e)}
                      style={{ display: "none" }}
                    />
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => inputs.current[slug]?.click()}
                      style={linkBtn}
                    >
                      {t(has ? "catalog.priceLists.replace" : "catalog.priceLists.upload")}
                    </button>
                    {has && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => remove(slug)}
                        style={{ ...linkBtn, color: "#5F6B5A" }}
                      >
                        {t("catalog.priceLists.remove")}
                      </button>
                    )}
                  </>
                ))}
            </span>
          );
        })}
      </div>
      {error && (
        <span role="alert" style={{ fontSize: 12.5, color: "#B91C1C" }}>
          {error}
        </span>
      )}
    </div>
  );
}
