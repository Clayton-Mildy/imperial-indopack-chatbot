"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteReferenceImageAction,
  previewProductAction,
  saveProductAction,
  setProductActiveAction,
} from "@/actions/catalogActions";
import { DeleteProductDialog } from "@/components/catalog/DeleteProductDialog";
import { ProductHistory, ProductUsage } from "@/components/catalog/ProductHistory";
import { BASE_PATH } from "@/lib/basePath";
import { BRAND_SLUGS, BRAND_TAG, type BrandSlug } from "@/lib/brands";
import {
  FINISHING_OPTIONS,
  MAX_REFERENCE_PHOTOS,
  MAX_TEXT_LENGTH,
  MAX_USE_LENGTH,
  PRINT_OPTIONS,
  copyTiersToOtherSizes,
  defaultPriceUnit,
  describeChange,
  displaySize,
  emptyForm,
  emptySize,
  errorMessage,
  formErrors,
  fromCatalogProduct,
  isJpgOrPng,
  nextTierRow,
  parseQty,
  parseRupiah,
  previousPrice,
  sizeChange,
  toDraft,
  type ProductFormState,
  type SizeRow,
  type TierRow,
} from "@/lib/catalog/productForm";
import { apiFileUrl, formatQty } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { formatNumber, formatRupiah, type TKey } from "@/lib/i18n/core";
import { IMAGE_MAX_BYTES } from "@/lib/uploadLimit";
import type { CatalogProductDetail, ProductDraft, ProductInputError, ProductPreview } from "@/types/api";

/** The preview is asked for this long after the last edit. */
const PREVIEW_DELAY_MS = 400;

const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #E1E7DC",
  borderRadius: 8,
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};
const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700 };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#3B4540" };
const hint: React.CSSProperties = { fontSize: 11.5, color: "#5F6B5A" };
const errText: React.CSSProperties = { fontSize: 11.5, color: "#B91C1C" };
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 };
const input: React.CSSProperties = {
  font: "inherit",
  fontSize: 13.5,
  height: 38,
  padding: "0 12px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#ffffff",
  color: "#1F2421",
  boxSizing: "border-box",
  width: "100%",
};
const cellInput: React.CSSProperties = { ...input, fontSize: 13, height: 34, padding: "0 10px" };
const invalid: React.CSSProperties = { border: "2px solid #DC2626" };
const changedInput: React.CSSProperties = { border: "2px solid #D9A93E", background: "#FFFBEB" };
const btn: React.CSSProperties = {
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
const dangerBtn: React.CSSProperties = { ...btn, fontWeight: 400, padding: "0 10px", border: "1px solid #F1C9C9", color: "#B91C1C" };
const dashedBtn: React.CSSProperties = { ...btn, height: 30, padding: "0 10px", border: "1px dashed #B9C7AE", color: "#445428" };
const headerBtn: React.CSSProperties = {
  font: "inherit",
  fontSize: 13,
  fontWeight: 500,
  height: 34,
  padding: "0 14px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#ffffff",
  color: "#1F2421",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  cursor: "pointer",
};
const linkBtn: React.CSSProperties = {
  font: "inherit",
  padding: 0,
  border: 0,
  background: "none",
  color: "#445428",
  textDecoration: "underline",
  cursor: "pointer",
};
const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};
const TIER_GRID = "1fr 0.9fr 1.3fr 0.9fr 1.1fr 0.5fr";
const LOCKED_GRID = "1fr 1.3fr 1.2fr";
const QTY_CODES = new Set<ProductInputError["code"]>(["qty_missing", "qty_invalid", "duplicate_tier", "tier_order"]);
const PRICE_CODES = new Set<ProductInputError["code"]>(["price_missing", "price_invalid"]);

/** Amber, not red: a required marker is a cue, not an error. */
function Required() {
  const t = useT();
  return (
    <span title={t("catalog.form.required")} style={{ color: "#8A6A2A", marginLeft: 2 }}>
      *
    </span>
  );
}

/** Reformat a typed number the Indonesian way once the field is left, so staff see how it was read. */
function tidy(text: string, parse: (s: string) => number | null): string {
  const n = parse(text);
  return n === null ? text : formatNumber(n, "id");
}

/** Removing a size or tier shifts the indexes the last API errors point at; follow it until the next preview. */
function shiftErrors(errors: ProductInputError[], sizeIndex: number, tierIndex?: number): ProductInputError[] {
  return errors.flatMap((e) => {
    if (tierIndex === undefined) {
      if (e.sizeIndex === sizeIndex) return [];
      return e.sizeIndex !== undefined && e.sizeIndex > sizeIndex ? [{ ...e, sizeIndex: e.sizeIndex - 1 }] : [e];
    }
    if (e.sizeIndex !== sizeIndex || e.tierIndex === undefined) return [e];
    if (e.tierIndex === tierIndex) return [];
    return e.tierIndex > tierIndex ? [{ ...e, tierIndex: e.tierIndex - 1 }] : [e];
  });
}

interface PendingPhoto {
  file: File;
  url: string;
}

/**
 * Tambah Produk (no `detail`) and Ubah Produk. The form keeps what is typed; 400 ms after the last edit
 * the API previews the draft - how the bot will read it, every problem by size and tier, and on an edit
 * the changes a save would record. Simpan stays disabled while there are problems or a save is running.
 */
export function ProductForm({ detail, photosFailed = 0 }: { detail?: CatalogProductDetail; photosFailed?: number }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const stored = detail?.product ?? null;
  const productId = stored?.id ?? null;
  const editing = stored !== null;

  const [form, setForm] = useState<ProductFormState>(() => (stored ? fromCatalogProduct(stored) : emptyForm("kertas_supreme")));
  const initial = useMemo(() => (stored ? fromCatalogProduct(stored) : null), [stored]);
  const [unlocked, setUnlocked] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<ProductPreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [serverErrors, setServerErrors] = useState<ProductInputError[]>([]);
  const [takenName, setTakenName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [activeBusy, setActiveBusy] = useState(false);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [photosNotice, setPhotosNotice] = useState(photosFailed);

  const draft = useMemo(() => toDraft(form), [form]);
  const draftJson = useMemo(() => JSON.stringify(draft), [draft]);
  const errors = useMemo(() => formErrors(form, serverErrors), [form, serverErrors]);
  const nameTaken = takenName !== null && form.name.trim().toLowerCase() === takenName;
  const blocked = errors.length > 0 || nameTaken;
  const photoCount = stored ? stored.referenceImages.length : pending.length;

  // The preview: at once on open, then 400 ms after the last edit. Only the newest answer counts.
  const previewSeq = useRef(0);
  const firstPreview = useRef(true);
  useEffect(() => {
    const seq = ++previewSeq.current;
    const delay = firstPreview.current ? 0 : PREVIEW_DELAY_MS;
    firstPreview.current = false;
    const timer = setTimeout(() => {
      previewProductAction(productId, JSON.parse(draftJson) as ProductDraft)
        .then((p) => {
          if (seq !== previewSeq.current) return;
          setPreview(p);
          setServerErrors(p.errors);
          setPreviewFailed(false);
        })
        .catch(() => {
          if (seq === previewSeq.current) setPreviewFailed(true);
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [draftJson, productId]);

  // Picked photos wait in memory (create page) as object URLs; free them when the page goes.
  const pendingRef = useRef<PendingPhoto[]>([]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  // ─── Form edits ──────────────────────────────────────────────────────────────

  function set<K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** On the create page a brand switch also moves every still-unpriced tier to that brand's price unit. */
  function setBrand(brand: BrandSlug) {
    setForm((f) => ({
      ...f,
      brand,
      sizes: editing
        ? f.sizes
        : f.sizes.map((s) => ({
            ...s,
            tiers: s.tiers.map((tier) => (tier.price.trim() ? tier : { ...tier, priceUnit: defaultPriceUnit(brand) })),
          })),
    }));
  }

  function updateSize(si: number, patch: Partial<SizeRow>) {
    setForm((f) => ({ ...f, sizes: f.sizes.map((s, i) => (i === si ? { ...s, ...patch } : s)) }));
  }

  function updateTier(si: number, ti: number, patch: Partial<TierRow>) {
    setForm((f) => ({
      ...f,
      sizes: f.sizes.map((s, i) => (i !== si ? s : { ...s, tiers: s.tiers.map((row, j) => (j === ti ? { ...row, ...patch } : row)) })),
    }));
  }

  function addTier(si: number) {
    setForm((f) => ({
      ...f,
      sizes: f.sizes.map((s, i) => (i !== si ? s : { ...s, tiers: [...s.tiers, nextTierRow(s, f.brand)] })),
    }));
  }

  function removeTier(si: number, ti: number) {
    setForm((f) => ({
      ...f,
      sizes: f.sizes.map((s, i) => (i !== si ? s : { ...s, tiers: s.tiers.filter((_, j) => j !== ti) })),
    }));
    setServerErrors((errs) => shiftErrors(errs, si, ti));
  }

  function addSize() {
    setForm((f) => ({ ...f, sizes: [...f.sizes, emptySize(f.brand)] }));
  }

  function removeSize(si: number) {
    setForm((f) => ({ ...f, sizes: f.sizes.filter((_, i) => i !== si) }));
    setServerErrors((errs) => shiftErrors(errs, si));
  }

  // ─── Save ────────────────────────────────────────────────────────────────────

  function photoErrorText(status: number, code: unknown): string {
    if (status === 409 || code === "REFERENCE_IMAGE_LIMIT") return t("catalog.form.photoErr.limit");
    if (status === 413 || code === "FILE_TOO_LARGE") return t("catalog.form.photoErr.size");
    if (code === "UNSUPPORTED_MIME_TYPE") return t("catalog.form.photoErr.type");
    if (code === "INVALID_IMAGE") return t("catalog.form.photoErr.invalid");
    if (code === "FORBIDDEN") return t("catalog.err.forbidden");
    return t("catalog.form.photoErr.failed");
  }

  async function uploadPhoto(id: string, file: File): Promise<string | null> {
    const body = new FormData();
    body.append("file", file, file.name);
    try {
      const res = await fetch(`${BASE_PATH}/api/reference-images/${encodeURIComponent(id)}`, { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      return res.ok && !json.error ? null : photoErrorText(res.status, json.error);
    } catch {
      return t("catalog.form.photoErr.failed");
    }
  }

  async function save() {
    if (saving || blocked) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await saveProductAction(productId, draft);
      if (!res.ok) {
        if (res.error === "VALIDATION_ERROR") {
          setServerErrors(res.details ?? []);
          if (!res.details?.length) setSaveError(t("catalog.form.err.invalid"));
        } else if (res.error === "NAME_TAKEN") {
          setTakenName(draft.name.trim().toLowerCase());
        } else {
          setSaveError(t("catalog.err.saveFailed"));
        }
        setSaving(false);
        return;
      }
      // A new product's photos upload once it exists, in the order they were picked (= sending order).
      let failed = 0;
      if (!editing) {
        for (const p of pending) if ((await uploadPhoto(res.id, p.file)) !== null) failed++;
      }
      // Still "saving" until the page is gone, so Simpan cannot be pressed twice.
      router.push(failed > 0 ? `/catalog/${res.id}?photos=${failed}` : "/catalog");
    } catch {
      setSaveError(t("common.err.network"));
      setSaving(false);
    }
  }

  // ─── Photos ──────────────────────────────────────────────────────────────────

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires
    if (!file) return;
    setPhotoError(null);
    if (!isJpgOrPng(file)) return setPhotoError(t("catalog.form.photoErr.type"));
    if (file.size > IMAGE_MAX_BYTES) return setPhotoError(t("catalog.form.photoErr.size"));
    if (photoCount >= MAX_REFERENCE_PHOTOS) return setPhotoError(t("catalog.form.photoErr.limit"));
    if (!productId) {
      setPending((p) => [...p, { file, url: URL.createObjectURL(file) }]);
      return;
    }
    setPhotoBusy(true);
    const error = await uploadPhoto(productId, file);
    setPhotoBusy(false);
    if (error) {
      setPhotoError(error);
    } else {
      setPhotosNotice(0);
      router.refresh();
    }
  }

  async function removeStoredPhoto(id: string) {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const res = await deleteReferenceImageAction(id);
      if (res.ok) router.refresh();
      else setPhotoError(t("catalog.form.photoErr.removeFailed"));
    } catch {
      setPhotoError(t("common.err.network"));
    }
    setPhotoBusy(false);
  }

  function removePendingPhoto(index: number) {
    setPending((p) => {
      const gone = p[index];
      if (gone) URL.revokeObjectURL(gone.url);
      return p.filter((_, i) => i !== index);
    });
  }

  // ─── Active flag (edit) ──────────────────────────────────────────────────────

  /** Switched at once (not on Simpan); the form follows, so a later save does not switch it back. */
  async function toggleActive() {
    if (!productId || activeBusy) return;
    const next = !form.isActive;
    setActiveBusy(true);
    setActiveError(null);
    try {
      const res = await setProductActiveAction(productId, next);
      if (res.ok) {
        set("isActive", next);
        router.refresh();
      } else {
        setActiveError(res.error ?? t("catalog.err.saveFailed"));
      }
    } catch {
      setActiveError(t("common.err.network"));
    }
    setActiveBusy(false);
  }

  // ─── Rendering helpers ───────────────────────────────────────────────────────

  const message = (e: ProductInputError) => errorMessage(e, form, t, lang);
  const topError = (code: ProductInputError["code"]) => errors.find((e) => e.code === code && e.sizeIndex === undefined);
  const sizeLabel = (s: SizeRow, si: number) => (s.size.trim() ? displaySize(s.size.trim()) : t("catalog.form.sizeN", { n: si + 1 }));
  const unitOptions = (
    <>
      <option value="rim">rim</option>
      <option value="pcs">pcs</option>
    </>
  );

  /** A select over the design's options, plus a stored value outside them so an edit keeps it. */
  function specSelect(id: string, key: "print" | "finishing", options: readonly string[], labelKey: TKey) {
    const value = form[key];
    const all = value && !options.includes(value) ? [...options, value] : options;
    return (
      <div style={field}>
        <label htmlFor={id} style={labelStyle}>
          {t(labelKey)}
        </label>
        <select id={id} value={value} onChange={(e) => set(key, e.target.value)} style={{ ...input, padding: "0 10px" }}>
          <option value="">{t("catalog.form.none")}</option>
          {all.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function errorLines(list: ProductInputError[], id?: string) {
    if (list.length === 0) return null;
    return (
      <span id={id} style={{ ...errText, display: "flex", flexDirection: "column", gap: 2 }}>
        {list.map((e) => (
          <span key={`${e.code}-${e.tierIndex ?? ""}`}>{message(e)}</span>
        ))}
      </span>
    );
  }

  function previousNote(s: SizeRow, row: TierRow) {
    if (!initial) return null;
    const prev = previousPrice(s, row, initial);
    if (!prev) return null;
    const price = row.priceUnit === prev.priceUnit ? formatRupiah(prev.priceIdr) : `${formatRupiah(prev.priceIdr)}/${prev.priceUnit}`;
    return <span style={{ fontSize: 11.5, color: "#92400E" }}>{t("catalog.form.previous", { price })}</span>;
  }

  function priceInput(s: SizeRow, si: number, row: TierRow, ti: number, priceErrs: ProductInputError[]) {
    const label = sizeLabel(s, si);
    const changed = initial ? previousPrice(s, row, initial) !== null : false;
    return (
      <input
        aria-label={t("catalog.form.aria.price", { size: label, n: ti + 1 })}
        aria-invalid={priceErrs.length > 0 || undefined}
        aria-describedby={priceErrs.length > 0 ? `pf-${si}-${ti}-price-err` : undefined}
        type="text"
        inputMode="numeric"
        placeholder="Rp"
        value={row.price}
        onChange={(e) => updateTier(si, ti, { price: e.target.value })}
        onBlur={(e) => updateTier(si, ti, { price: tidy(e.target.value, parseRupiah) })}
        style={{ ...cellInput, ...(priceErrs.length > 0 ? invalid : changed ? changedInput : {}) }}
      />
    );
  }

  function renderTierRow(s: SizeRow, si: number, row: TierRow, ti: number) {
    const label = sizeLabel(s, si);
    const rowErrs = errors.filter((e) => e.sizeIndex === si && e.tierIndex === ti);
    const qtyErrs = rowErrs.filter((e) => QTY_CODES.has(e.code));
    const priceErrs = rowErrs.filter((e) => PRICE_CODES.has(e.code));
    return (
      <div key={ti} style={{ display: "grid", gridTemplateColumns: TIER_GRID, gap: 8, padding: "6px 14px", alignItems: "start" }}>
        <div style={field}>
          <input
            aria-label={t("catalog.form.aria.qty", { size: label, n: ti + 1 })}
            aria-invalid={qtyErrs.length > 0 || undefined}
            aria-describedby={qtyErrs.length > 0 ? `pf-${si}-${ti}-qty-err` : undefined}
            type="text"
            inputMode="numeric"
            value={row.minQty}
            onChange={(e) => updateTier(si, ti, { minQty: e.target.value })}
            onBlur={(e) => updateTier(si, ti, { minQty: tidy(e.target.value, parseQty) })}
            style={{ ...cellInput, ...(qtyErrs.length > 0 ? invalid : {}) }}
          />
          {errorLines(qtyErrs, `pf-${si}-${ti}-qty-err`)}
        </div>
        <select
          aria-label={t("catalog.form.aria.unit", { size: label, n: ti + 1 })}
          value={row.qtyUnit}
          onChange={(e) => updateTier(si, ti, { qtyUnit: e.target.value as TierRow["qtyUnit"] })}
          style={{ ...cellInput, padding: "0 6px" }}
        >
          {unitOptions}
        </select>
        <div style={field}>
          {priceInput(s, si, row, ti, priceErrs)}
          {errorLines(priceErrs, `pf-${si}-${ti}-price-err`)}
          {previousNote(s, row)}
        </div>
        <select
          aria-label={t("catalog.form.aria.per", { size: label, n: ti + 1 })}
          value={row.priceUnit}
          onChange={(e) => updateTier(si, ti, { priceUnit: e.target.value as TierRow["priceUnit"] })}
          style={{ ...cellInput, padding: "0 6px" }}
        >
          {unitOptions}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, height: 34 }}>
          <input
            type="checkbox"
            checked={row.includesDelivery}
            onChange={(e) => updateTier(si, ti, { includesDelivery: e.target.checked })}
          />
          {t("catalog.form.deliveryIncluded")}
        </label>
        <button
          type="button"
          aria-label={t("catalog.form.aria.removeTier", { size: label, n: ti + 1 })}
          onClick={() => removeTier(si, ti)}
          style={{ font: "inherit", height: 34, border: 0, background: "transparent", color: "#8A949B", cursor: "pointer" }}
        >
          ✕
        </button>
      </div>
    );
  }

  /** Ubah Produk before "Ubah ukuran": minimums as text, price and delivery still editable. */
  function renderLockedTierRow(s: SizeRow, si: number, row: TierRow, ti: number) {
    const rowErrs = errors.filter((e) => e.sizeIndex === si && e.tierIndex === ti);
    const qtyErrs = rowErrs.filter((e) => QTY_CODES.has(e.code));
    const priceErrs = rowErrs.filter((e) => PRICE_CODES.has(e.code));
    const qty = parseQty(row.minQty);
    return (
      <div key={ti} style={{ display: "grid", gridTemplateColumns: LOCKED_GRID, gap: 8, padding: "6px 14px", alignItems: "start" }}>
        <div style={{ ...field, paddingTop: 8 }}>
          <span>{qty === null ? `${row.minQty} ${row.qtyUnit}` : formatQty(qty, row.qtyUnit, lang)}</span>
          {errorLines(qtyErrs, `pf-${si}-${ti}-qty-err`)}
        </div>
        <div style={field}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {priceInput(s, si, row, ti, priceErrs)}
            <span style={{ fontSize: 12, color: "#5F6B5A", whiteSpace: "nowrap" }}>/{row.priceUnit}</span>
          </span>
          {errorLines(priceErrs, `pf-${si}-${ti}-price-err`)}
          {previousNote(s, row)}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, height: 34 }}>
          <input
            type="checkbox"
            checked={row.includesDelivery}
            onChange={(e) => updateTier(si, ti, { includesDelivery: e.target.checked })}
          />
          {t("catalog.card.deliveryIncluded")}
        </label>
      </div>
    );
  }

  function renderSize(s: SizeRow, si: number) {
    const open = !initial || !s.id || unlocked.has(s.id);
    const label = sizeLabel(s, si);
    const sizeErrs = errors.filter((e) => e.sizeIndex === si && e.tierIndex === undefined);
    const hasErrors = errors.some((e) => e.sizeIndex === si);
    const change = initial ? sizeChange(s, initial) : null;
    const copiedNote = s.copiedFrom !== undefined && s.tiers.some((row) => !row.price.trim());
    const nameErrs = sizeErrs.filter((e) => e.code === "size_required" || e.code === "duplicate_size");
    const otherErrs = sizeErrs.filter((e) => e.code !== "size_required" && e.code !== "duplicate_size");
    const next = nextTierRow(s, form.brand);
    const nextQty = parseQty(next.minQty);
    const badge = change && (
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          padding: "1px 6px",
          borderRadius: 4,
          background: "#FEF3C7",
          color: "#92400E",
          marginLeft: 6,
        }}
      >
        {t(change === "new" ? "catalog.form.new" : "catalog.form.changed")}
      </span>
    );
    const copied = copiedNote && (
      <span style={{ fontSize: 12, color: "#B91C1C", fontWeight: 600 }}>
        {t("catalog.form.copied", { size: s.copiedFrom?.trim() ? displaySize(s.copiedFrom.trim()) : "—" })}
      </span>
    );
    return (
      <div
        key={s.id ?? `new-${si}`}
        style={{
          border: hasErrors ? "1px solid #E9B8B8" : change ? "2px solid #D9A93E" : "1px solid #DDE5D6",
          borderRadius: 8,
          overflow: "hidden",
          fontSize: 13,
        }}
      >
        {open ? (
          <div
            style={{
              padding: "12px 14px",
              background: hasErrors ? "#FFF7F7" : change ? "#FFFBEB" : "#F8FAF6",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-end",
              gap: 12,
            }}
          >
            <div style={field}>
              <label htmlFor={`pf-size-${si}`} style={labelStyle}>
                {t("catalog.form.size")}
                <Required />
                {badge}
              </label>
              <input
                id={`pf-size-${si}`}
                type="text"
                value={s.size}
                maxLength={MAX_TEXT_LENGTH}
                aria-required="true"
                aria-invalid={nameErrs.length > 0 || undefined}
                aria-describedby={nameErrs.length > 0 ? `pf-size-${si}-err` : undefined}
                onChange={(e) => updateSize(si, { size: e.target.value })}
                style={{ ...input, height: 36, width: 180, ...(nameErrs.length > 0 ? invalid : {}) }}
              />
              {errorLines(nameErrs, `pf-size-${si}-err`)}
            </div>
            {copied}
            <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                disabled={form.sizes.length < 2}
                onClick={() => setForm((f) => copyTiersToOtherSizes(f, si))}
                style={{ ...btn, ...(form.sizes.length < 2 ? { color: "#8A949B", cursor: "not-allowed" } : {}) }}
              >
                {t("catalog.form.copyTiers")}
              </button>
              <button
                type="button"
                aria-label={t("catalog.form.removeSizeAria", { size: label })}
                onClick={() => removeSize(si)}
                style={dangerBtn}
              >
                {t("catalog.form.removeSize")}
              </button>
            </span>
          </div>
        ) : (
          <div
            style={{
              padding: "10px 14px",
              background: hasErrors ? "#FFF7F7" : change ? "#FFFBEB" : "#F8FAF6",
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 700 }}>
                {label}
                {badge}
              </span>
              {copied}
              {errorLines(nameErrs)}
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                aria-label={t("catalog.form.editSizeAria", { size: label })}
                onClick={() => s.id && setUnlocked((u) => new Set(u).add(s.id!))}
                style={{ ...btn, fontSize: 12, height: 30, padding: "0 10px" }}
              >
                {t("catalog.form.editSize")}
              </button>
              <button
                type="button"
                aria-label={t("catalog.form.removeSizeAria", { size: label })}
                onClick={() => removeSize(si)}
                style={{ ...dangerBtn, fontSize: 12, height: 30 }}
              >
                {t("catalog.form.removeSize")}
              </button>
            </span>
          </div>
        )}

        {open ? (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 640 }}>
              <div
                aria-hidden="true"
                style={{
                  display: "grid",
                  gridTemplateColumns: TIER_GRID,
                  gap: 8,
                  padding: "8px 14px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#5F6B5A",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                <span>{t("catalog.form.col.from")}</span>
                <span>{t("catalog.form.col.unit")}</span>
                <span>{t("catalog.form.col.price")}</span>
                <span>{t("catalog.form.col.per")}</span>
                <span>{t("catalog.form.col.delivery")}</span>
                <span />
              </div>
              {s.tiers.map((row, ti) => renderTierRow(s, si, row, ti))}
            </div>
          </div>
        ) : (
          <div>
            <div
              aria-hidden="true"
              style={{
                display: "grid",
                gridTemplateColumns: LOCKED_GRID,
                gap: 8,
                padding: "8px 14px",
                fontSize: 11,
                fontWeight: 700,
                color: "#5F6B5A",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              <span>{t("catalog.form.col.fromShort")}</span>
              <span>{t("catalog.form.col.priceShort")}</span>
              <span>{t("catalog.form.col.delivery")}</span>
            </div>
            {s.tiers.map((row, ti) => renderLockedTierRow(s, si, row, ti))}
          </div>
        )}

        <div style={{ padding: "6px 14px 14px", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          {errorLines(otherErrs)}
          <button type="button" onClick={() => addTier(si)} style={dashedBtn}>
            {open || nextQty === null
              ? t("catalog.form.addTier")
              : t("catalog.form.addTierNext", { qty: formatNumber(nextQty, lang), unit: next.qtyUnit })}
          </button>
        </div>
      </div>
    );
  }

  function photoTile(key: string, src: string, name: string, n: number, onRemove: () => void) {
    return (
      <div key={key} style={{ width: 140, display: "flex", flexDirection: "column", gap: 6 }}>
        {/* A plain <img>: an API-hosted upload or a picked file's object URL, not a Next asset. */}
        <img
          src={src}
          alt={t("catalog.form.photoAlt", { n })}
          title={name}
          style={{ width: 140, height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid #DDE5D6", display: "block" }}
        />
        <span title={name} style={{ ...hint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}
        </span>
        <span style={hint}>
          {n} ·{" "}
          <button
            type="button"
            aria-label={t("catalog.form.photoRemoveAria", { n })}
            disabled={photoBusy}
            onClick={onRemove}
            style={{ ...linkBtn, fontSize: 11.5 }}
          >
            {t("catalog.form.photoRemove")}
          </button>
        </span>
      </div>
    );
  }

  // ─── Derived panels ──────────────────────────────────────────────────────────

  const dirty = initial !== null && JSON.stringify(toDraft(initial)) !== draftJson;
  const changes = preview?.changes ?? [];
  const banner: "changes" | "invalid" | null = !dirty ? null : changes.length > 0 ? "changes" : errors.length > 0 ? "invalid" : null;

  const checklist: { state: "ok" | "bad" | "info"; text: string }[] = [];
  if (!editing) {
    const nameErr = topError("name_required");
    checklist.push(
      nameTaken
        ? { state: "bad", text: t("catalog.form.err.name_taken") }
        : nameErr
          ? { state: "bad", text: message(nameErr) }
          : { state: "ok", text: t("catalog.form.check.name") }
    );
    const useErr = topError("use_required");
    checklist.push(useErr ? { state: "bad", text: message(useErr) } : { state: "ok", text: t("catalog.form.check.use") });
    const noSizes = topError("no_sizes");
    if (noSizes) checklist.push({ state: "bad", text: message(noSizes) });
    form.sizes.forEach((s, si) => {
      const label = sizeLabel(s, si);
      const errs = errors.filter((e) => e.sizeIndex === si);
      if (errs.length === 0) {
        checklist.push({ state: "ok", text: t("catalog.form.check.size", { size: label, n: s.tiers.length }) });
      } else {
        const summary = errs.every((e) => e.code === "price_missing")
          ? t("catalog.form.check.emptyPrices", { n: errs.length })
          : message(errs[0]!);
        checklist.push({ state: "bad", text: `${label}: ${summary}` });
      }
    });
    checklist.push({ state: "info", text: t("catalog.form.check.photos", { n: photoCount }) });
  }
  const CHECK_STYLE = { ok: { mark: "✓", color: "#586B34" }, bad: { mark: "✕", color: "#B91C1C" }, info: { mark: "○", color: "#5F6B5A" } };

  const nameErr = nameTaken ? t("catalog.form.err.name_taken") : topError("name_required") ? message(topError("name_required")!) : null;
  const useErr = topError("use_required");
  const noSizesErr = topError("no_sizes");
  const numbered = (n: number, key: TKey) => (editing ? t(key) : `${n} · ${t(key)}`);

  const photoInput = (
    <input
      id="pf-photo"
      type="file"
      accept="image/jpeg,image/png,.jpg,.jpeg,.png"
      disabled={photoBusy || photoCount >= MAX_REFERENCE_PHOTOS}
      onChange={pickPhoto}
      style={srOnly}
    />
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", color: "#1F2421" }}>
      {/* The design's header actions (the shared Header has no slot), with the unsaved-changes banner. */}
      <div
        style={{
          background: banner ? "#FEF3C7" : "#F2F5EF",
          borderBottom: `1px solid ${banner ? "#F3DC94" : "#E1E7DC"}`,
          padding: "10px 32px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "8px 16px",
        }}
      >
        <div style={{ flex: "1 1 320px", fontSize: 13, color: "#78350F", display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
          {banner === "changes" && (
            <>
              <b>{t("catalog.form.unsaved", { n: changes.length })}</b>
              <span>
                {changes.map((c) => describeChangeSafe(c)).join(". ")}. {t("catalog.form.unsavedNote")}
              </span>
            </>
          )}
          {banner === "invalid" && (
            <>
              <b>{t("catalog.form.unsavedInvalid")}</b>
              <span>{t("catalog.form.unsavedInvalidNote")}</span>
            </>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {saveError && (
            <span role="alert" style={{ fontSize: 12.5, color: "#B91C1C" }}>
              {saveError}
            </span>
          )}
          <Link
            href="/catalog"
            aria-disabled={saving || undefined}
            tabIndex={saving ? -1 : undefined}
            style={{ ...headerBtn, ...(saving ? { pointerEvents: "none", color: "#8A949B" } : {}) }}
          >
            {t("catalog.form.cancel")}
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={saving || blocked}
            style={{
              ...headerBtn,
              fontWeight: 600,
              border: 0,
              background: saving || blocked ? "#A9B79A" : "#586B34",
              color: "#ffffff",
              cursor: saving || blocked ? "not-allowed" : "pointer",
            }}
          >
            {saving ? t("catalog.form.saving") : t(editing ? "catalog.form.saveEdit" : "catalog.form.saveNew")}
          </button>
        </div>
      </div>

      <main style={{ flex: 1, overflowY: "auto", padding: "24px 32px 32px" }}>
        {photosNotice > 0 && (
          <div
            role="status"
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              borderRadius: 8,
              background: "#FBF6EC",
              border: "1px solid #E2D3B2",
              fontSize: 13,
              color: "#6E531E",
            }}
          >
            {t("catalog.form.photosFailed", { n: photosNotice })}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
          <form
            noValidate
            onSubmit={(e) => e.preventDefault()}
            style={{ flex: "999 1 560px", minWidth: 0 }}
          >
            <fieldset disabled={saving} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
              {/* ─── Produk ─── */}
              <section style={card}>
                <span style={sectionTitle}>{numbered(1, "catalog.form.section.product")}</span>
                {editing ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                    <div style={field}>
                      <label htmlFor="pf-brand" style={labelStyle}>
                        {t("catalog.form.brand")}
                      </label>
                      <select
                        id="pf-brand"
                        value={form.brand}
                        onChange={(e) => setBrand(e.target.value as BrandSlug)}
                        style={{ ...input, padding: "0 10px" }}
                      >
                        {BRAND_SLUGS.map((slug) => (
                          <option key={slug} value={slug}>
                            {t(BRAND_TAG[slug].labelKey)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {nameField()}
                  </div>
                ) : (
                  <>
                    <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                      <legend style={{ ...labelStyle, padding: 0, marginBottom: 8 }}>{t("catalog.form.brand")}</legend>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                        {BRAND_SLUGS.map((slug) => {
                          const checked = form.brand === slug;
                          return (
                            <label
                              key={slug}
                              htmlFor={`pf-brand-${slug}`}
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: 10,
                                padding: checked ? 12 : 13,
                                border: checked ? "2px solid #586B34" : "1px solid #D5DECF",
                                borderRadius: 8,
                                background: checked ? "#F5F8F2" : "#ffffff",
                                cursor: "pointer",
                              }}
                            >
                              <input
                                id={`pf-brand-${slug}`}
                                type="radio"
                                name="pf-brand"
                                checked={checked}
                                onChange={() => setBrand(slug)}
                                style={{ marginTop: 3 }}
                              />
                              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{t(BRAND_TAG[slug].labelKey)}</span>
                                <span style={{ fontSize: 12, color: "#5F6B5A" }}>
                                  {t(slug === "kertas_supreme" ? "catalog.form.brandDesc.kertas_supreme" : "catalog.form.brandDesc.imperial_indopack")}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                    {nameField()}
                  </>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                  <div style={field}>
                    <label htmlFor="pf-gsm" style={labelStyle}>
                      {t("catalog.form.gsm")}
                    </label>
                    <input
                      id="pf-gsm"
                      type="text"
                      value={form.gsm}
                      maxLength={MAX_TEXT_LENGTH}
                      onChange={(e) => set("gsm", e.target.value)}
                      style={input}
                    />
                  </div>
                  {specSelect("pf-print", "print", PRINT_OPTIONS, "catalog.form.print")}
                  {specSelect("pf-finish", "finishing", FINISHING_OPTIONS, "catalog.form.finishing")}
                </div>
                <div style={field}>
                  <label htmlFor="pf-use" style={labelStyle}>
                    {t("catalog.form.use")}
                    <Required />
                  </label>
                  <textarea
                    id="pf-use"
                    rows={2}
                    value={form.use}
                    maxLength={MAX_USE_LENGTH}
                    aria-required="true"
                    aria-invalid={useErr ? true : undefined}
                    aria-describedby={useErr ? "pf-use-err" : undefined}
                    onChange={(e) => set("use", e.target.value)}
                    style={{ ...input, height: "auto", padding: "10px 12px", resize: "vertical", ...(useErr ? invalid : {}) }}
                  />
                  {useErr && (
                    <span id="pf-use-err" style={errText}>
                      {message(useErr)}
                    </span>
                  )}
                  {!editing && <span style={hint}>{t("catalog.form.useHint")}</span>}
                </div>
                {!editing && (
                  <label htmlFor="pf-active" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                    <input id="pf-active" type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
                    <span>
                      <b>{t("catalog.form.activeLabel")}</b> · {t("catalog.form.activeHint")}
                    </span>
                  </label>
                )}
              </section>

              {/* ─── Ukuran & harga ─── */}
              <section style={{ ...card, gap: editing ? 14 : 16 }}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={sectionTitle}>{numbered(2, "catalog.form.section.sizes")}</span>
                  <span style={{ fontSize: 12, color: "#5F6B5A" }}>
                    {editing
                      ? t(form.brand === "kertas_supreme" ? "catalog.form.sizesSubEdit.kertas_supreme" : "catalog.form.sizesSubEdit.imperial_indopack")
                      : t("catalog.form.sizesSub")}
                  </span>
                </div>
                {noSizesErr && (
                  <span role="alert" style={{ ...errText, fontSize: 12.5 }}>
                    {message(noSizesErr)}
                  </span>
                )}
                {form.sizes.map((s, si) => renderSize(s, si))}
                <button type="button" onClick={addSize} style={{ ...dashedBtn, alignSelf: "flex-start", fontSize: 13, height: 36, padding: "0 14px" }}>
                  {t("catalog.form.addSize")}
                </button>
              </section>

              {/* ─── Foto referensi desain ─── */}
              <section style={{ ...card, gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={sectionTitle}>{numbered(3, "catalog.form.section.photos")}</span>
                  {!editing && <span style={{ fontSize: 12, color: "#5F6B5A" }}>{t("catalog.form.photosSub")}</span>}
                </div>
                {editing && photoCount === 0 ? (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 16,
                      padding: 16,
                      border: "2px dashed #D9C49A",
                      borderRadius: 8,
                      background: "#FBF6EC",
                    }}
                  >
                    <label
                      htmlFor="pf-photo"
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        height: 36,
                        padding: "0 14px",
                        borderRadius: 6,
                        background: "#8A6A2A",
                        color: "#ffffff",
                        display: "inline-flex",
                        alignItems: "center",
                        cursor: photoBusy ? "wait" : "pointer",
                      }}
                    >
                      {photoBusy ? t("catalog.form.photoUploading") : t("catalog.form.photoUpload")}
                    </label>
                    {photoInput}
                    <span style={{ flex: "1 1 260px", fontSize: 12.5, color: "#6E531E", lineHeight: 1.5 }}>{t("catalog.form.photoNone")}</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {stored
                      ? [...stored.referenceImages]
                          .sort((a, b) => a.sort - b.sort)
                          .map((img, i) =>
                            photoTile(img.id, apiFileUrl(img.imageUrl), img.imageUrl.split("/").pop() || img.imageUrl, i + 1, () =>
                              removeStoredPhoto(img.id)
                            )
                          )
                      : pending.map((p, i) => photoTile(p.url, p.url, p.file.name, i + 1, () => removePendingPhoto(i)))}
                    {photoCount < MAX_REFERENCE_PHOTOS && (
                      <label
                        htmlFor="pf-photo"
                        style={{
                          width: 140,
                          height: 120,
                          boxSizing: "border-box",
                          borderRadius: 8,
                          border: "2px dashed #B9C7AE",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 4,
                          fontSize: 12.5,
                          color: "#445428",
                          cursor: photoBusy ? "wait" : "pointer",
                          textAlign: "center",
                        }}
                      >
                        {photoBusy ? (
                          t("catalog.form.photoUploading")
                        ) : (
                          <>
                            <span style={{ fontSize: 20, lineHeight: 1 }}>+</span>
                            {t("catalog.form.photoUpload")}
                            <span style={{ fontSize: 11, color: "#5F6B5A" }}>{t("catalog.form.photoHint")}</span>
                          </>
                        )}
                      </label>
                    )}
                    {photoInput}
                  </div>
                )}
                {photoError && (
                  <span role="alert" style={{ ...errText, fontSize: 12.5 }}>
                    {photoError}
                  </span>
                )}
              </section>

              {/* ─── Berhenti menawarkan (edit) ─── */}
              {stored && (
                <section
                  style={{
                    ...card,
                    border: "1px solid #F1C9C9",
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 14,
                  }}
                >
                  <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{t("catalog.form.stop.title")}</span>
                    <span style={{ fontSize: 12.5, color: "#3B4540", lineHeight: 1.5 }}>{t("catalog.form.stop.desc")}</span>
                    {activeError && (
                      <span role="alert" style={{ ...errText, fontSize: 12.5 }}>
                        {activeError}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={toggleActive}
                      disabled={activeBusy}
                      style={{ ...headerBtn, fontWeight: 600, cursor: activeBusy ? "wait" : "pointer" }}
                    >
                      {t(form.isActive ? "catalog.form.deactivate" : "catalog.form.activate")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteOpen(true)}
                      style={{ ...headerBtn, fontWeight: 600, border: 0, background: "#B91C1C", color: "#ffffff" }}
                    >
                      {t("catalog.form.delete")}
                    </button>
                  </div>
                </section>
              )}
            </fieldset>
          </form>

          {/* ─── Right rail ─── */}
          <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 0 }}>
            {detail ? (
              <>
                <ProductHistory history={detail.history} />
                <ProductUsage usage={detail.usage} productName={detail.product.name} />
              </>
            ) : (
              <>
                <section style={{ ...card, padding: 16, gap: 10 }} aria-labelledby="pf-bot-title">
                  <span id="pf-bot-title" style={{ fontSize: 14, fontWeight: 600 }}>
                    {t("catalog.form.botView")}
                  </span>
                  <pre
                    style={{
                      margin: 0,
                      padding: 12,
                      background: "#252C30",
                      color: "#E3EBD9",
                      borderRadius: 6,
                      fontFamily: "ui-monospace, Menlo, monospace",
                      fontSize: 11.5,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      overflowX: "auto",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {preview ? preview.botText : previewFailed ? "—" : t("catalog.form.botLoading")}
                  </pre>
                  {previewFailed && <span style={{ ...hint, color: "#92400E" }}>{t("catalog.form.botFailed")}</span>}
                  {preview?.hiddenSizes.map((size, i) => (
                    <span key={i} style={hint}>
                      {t("catalog.form.hiddenSize", { size: size.trim() ? displaySize(size.trim()) : "—" })}
                    </span>
                  ))}
                </section>
                <section style={{ ...card, padding: 16, gap: 8, fontSize: 13 }} aria-labelledby="pf-check-title">
                  <span id="pf-check-title" style={{ fontSize: 14, fontWeight: 600 }}>
                    {t("catalog.form.checklist")}
                  </span>
                  {checklist.map((item, i) => (
                    <span key={i} style={{ color: CHECK_STYLE[item.state].color, overflowWrap: "anywhere" }}>
                      {CHECK_STYLE[item.state].mark} {item.text}
                    </span>
                  ))}
                </section>
              </>
            )}
          </div>
        </div>
      </main>

      {stored && deleteOpen && (
        <DeleteProductDialog
          product={stored}
          onClose={() => setDeleteOpen(false)}
          onDone={(kind) => {
            if (kind === "delete") {
              router.push("/catalog");
              return;
            }
            setDeleteOpen(false);
            set("isActive", false);
            router.refresh();
          }}
        />
      )}
    </div>
  );

  function nameField() {
    return (
      <div style={field}>
        <label htmlFor="pf-name" style={labelStyle}>
          {t("catalog.form.name")}
          <Required />
        </label>
        <input
          id="pf-name"
          type="text"
          value={form.name}
          maxLength={MAX_TEXT_LENGTH}
          aria-required="true"
          aria-invalid={nameErr ? true : undefined}
          aria-describedby={nameErr ? "pf-name-err" : undefined}
          onChange={(e) => set("name", e.target.value)}
          style={{ ...input, ...(nameErr ? invalid : {}) }}
        />
        {nameErr && (
          <span id="pf-name-err" style={errText}>
            {nameErr}
          </span>
        )}
        {!editing && <span style={hint}>{t("catalog.form.nameHint")}</span>}
      </div>
    );
  }

  function describeChangeSafe(c: Parameters<typeof describeChange>[0]) {
    return describeChange(c, t, lang).replace(/\.$/, "");
  }
}
