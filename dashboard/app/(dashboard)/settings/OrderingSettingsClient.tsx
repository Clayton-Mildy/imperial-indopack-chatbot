"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveBotSettingsAction, savePoFormUrlAction } from "@/actions/settingsActions";
import { BRAND_SLUGS, BRAND_TAG } from "@/lib/brands";
import { parseQty } from "@/lib/catalog/productForm";
import { formatNumber, type TFn } from "@/lib/i18n/core";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { minOrderHint, validatePoUrl } from "@/lib/settings";
import type { BrandPriceList, PoFormKind, PoFormsSetting } from "@/types/api";
import { SaveStatus, hintStyle, inputStyle, labelStyle, primaryButtonStyle, warnHintStyle } from "./settingsUi";

type Status = { ok: boolean; text: string } | null;

const PO_KINDS: PoFormKind[] = ["cetak", "plano"];

function poErrorText(error: "forbidden" | "not_https" | "invalid" | "failed", t: TFn): string {
  if (error === "forbidden") return t("settings.err.forbidden");
  if (error === "not_https") return t("settings.po.notHttps");
  if (error === "invalid") return t("settings.po.invalid");
  return t("settings.err.failed");
}

/** One PO form: its link with Simpan, the placeholder hint, and the exact message a send carries. */
function PoFormField({
  kind,
  forms,
  onSaved,
  canEdit,
}: {
  kind: PoFormKind;
  forms: PoFormsSetting;
  onSaved: (forms: PoFormsSetting) => void;
  canEdit: boolean;
}) {
  const t = useT();
  const form = forms[kind];
  // A form still on the placeholder shows that link, outlined amber, as designed.
  const [value, setValue] = useState(form.url);
  const [status, setStatus] = useState<Status>(null);
  const [pending, startTransition] = useTransition();
  const id = `st-po-${kind}`;

  function handleSave() {
    const check = validatePoUrl(value);
    if (check !== "ok") return setStatus({ ok: false, text: poErrorText(check, t) });
    setStatus(null);
    startTransition(async () => {
      const res = await savePoFormUrlAction(kind, value).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (res.ok) {
        onSaved(res.forms);
        setValue(res.forms[kind].url);
        setStatus({ ok: true, text: t("settings.saved") });
      } else {
        setStatus({ ok: false, text: poErrorText(res.error, t) });
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <label htmlFor={id} style={labelStyle}>{t(`settings.po.${kind}`)}</label>
        <span style={hintStyle}>{t(`settings.po.${kind}Hint`)}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input
          id={id}
          type="url"
          inputMode="url"
          value={value}
          disabled={pending || !canEdit}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            setValue(e.target.value);
            setStatus(null);
          }}
          style={{
            ...inputStyle,
            flex: "1 1 320px",
            ...(form.isPlaceholder ? { border: "2px solid #D9A93E", background: "#FFFBEB" } : {}),
          }}
        />
        {canEdit && (
          <button type="button" onClick={handleSave} disabled={pending} style={{ ...primaryButtonStyle(pending), height: 38 }}>
            {pending ? t("settings.saving") : t("settings.save")}
          </button>
        )}
      </div>
      <span id={`${id}-hint`} style={form.isPlaceholder ? warnHintStyle : hintStyle}>
        {form.isPlaceholder && `${t("settings.po.placeholder")} `}
        {t("settings.po.rule")}
      </span>
      <SaveStatus status={status} />
      <div style={{ padding: "12px 14px", borderRadius: 8, background: "#F8FAF6", display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "#5F6B5A" }}>{t("settings.po.message")}</span>
        <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.5 }}>{form.message}</span>
      </div>
    </div>
  );
}

/** Minimum order for a product without tiers (BotSettings.fallbackMinPcs), typed "2.500" or "2500". */
function MinOrderField({ initialPcs, canEdit }: { initialPcs: number; canEdit: boolean }) {
  const t = useT();
  const lang = useLang();
  // Quantities are typed the Indonesian way ("2.500") in both languages, as in the catalog.
  const [value, setValue] = useState(formatNumber(initialPcs, "id"));
  const [savedPcs, setSavedPcs] = useState(initialPcs);
  const [status, setStatus] = useState<Status>(null);
  const [pending, startTransition] = useTransition();
  const typed = parseQty(value);

  function handleSave() {
    if (typed === null || typed > 1_000_000) return setStatus({ ok: false, text: t("settings.min.invalid") });
    setStatus(null);
    startTransition(async () => {
      const res = await saveBotSettingsAction({ fallbackMinPcs: typed }).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (res.ok) {
        setSavedPcs(res.settings.fallbackMinPcs);
        setValue(formatNumber(res.settings.fallbackMinPcs, "id"));
        setStatus({ ok: true, text: t("settings.saved") });
      } else {
        setStatus({ ok: false, text: t(res.error === "forbidden" ? "settings.err.forbidden" : res.error === "invalid" ? "settings.min.invalid" : "settings.err.failed") });
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label htmlFor="st-min" style={labelStyle}>{t("settings.min.label")}</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input
          id="st-min"
          type="text"
          inputMode="numeric"
          value={value}
          disabled={pending || !canEdit}
          onChange={(e) => {
            setValue(e.target.value);
            setStatus(null);
          }}
          style={{ ...inputStyle, width: 120 }}
        />
        <span style={{ fontSize: 13 }}>{minOrderHint(typed ?? savedPcs, lang)}</span>
        {canEdit && (
          <button type="button" onClick={handleSave} disabled={pending} style={primaryButtonStyle(pending)}>
            {pending ? t("settings.saving") : t("settings.save")}
          </button>
        )}
      </div>
      <SaveStatus status={status} />
    </div>
  );
}

/** Pemesanan & harga: the two PO form links, the fallback minimum order and each brand's price list. */
export function OrderingSettingsClient({
  initialForms,
  minPcs,
  priceLists,
  canEdit,
}: {
  initialForms: PoFormsSetting | null;
  minPcs: number | null;
  priceLists: BrandPriceList[] | null;
  canEdit: boolean;
}) {
  const t = useT();
  const [forms, setForms] = useState(initialForms);

  return (
    <>
      {forms ? (
        <>
          {PO_KINDS.map((kind) => (
            <PoFormField key={kind} kind={kind} forms={forms} onSaved={setForms} canEdit={canEdit} />
          ))}
          <span style={{ fontSize: 12.5, color: "#3B4540" }}>{t("settings.po.both")}</span>
        </>
      ) : (
        <span role="status" style={{ fontSize: 13, color: "#B91C1C" }}>{t("settings.err.load")}</span>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {minPcs !== null ? (
          <MinOrderField initialPcs={minPcs} canEdit={canEdit} />
        ) : (
          <span role="status" style={{ fontSize: 13, color: "#B91C1C" }}>{t("settings.err.load")}</span>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>{t("settings.priceLists.label")}</span>
          <span style={{ fontSize: 13, lineHeight: 1.6 }}>
            {priceLists === null ? (
              <span style={{ color: "#B91C1C" }}>{t("settings.err.load")}</span>
            ) : (
              BRAND_SLUGS.map((brand, i) => {
                const uploaded = !!priceLists.find((p) => p.brand === brand)?.url;
                return (
                  <span key={brand}>
                    {i > 0 && <br />}
                    <span style={{ color: uploaded ? undefined : "#92400E" }}>
                      {t(BRAND_TAG[brand].labelKey)}: {uploaded ? t("settings.priceLists.uploaded") : t("settings.priceLists.missing")}
                    </span>
                  </span>
                );
              })
            )}
            {" · "}
            <Link href="/catalog" style={{ color: "#445428" }}>{t("settings.priceLists.manage")}</Link>
          </span>
        </div>
      </div>
    </>
  );
}
