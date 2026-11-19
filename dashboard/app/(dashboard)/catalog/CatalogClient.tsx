"use client";

import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { BASE_PATH } from "@/lib/basePath";
import { useRouter } from "next/navigation";
import type { Brand, CatalogImageResult, CatalogImportResult, Category, Product, ProductVariant, StockStatus, Uom } from "@/types/api";
import { FileUploadField } from "@/components/FileUploadField";
import {
  createProductAction,
  updateProductAction,
  deleteProductAction,
  createVariantAction,
  updateVariantAction,
  deleteVariantAction,
} from "@/actions/catalogActions";
import { getProducts } from "@/lib/api/catalog";
import { useT } from "@/lib/i18n/LangProvider";
import type { TFn, TKey } from "@/lib/i18n/core";

// ─── Shared styles ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#1F1F1F",
  marginBottom: 5,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 13,
  color: "#0A0A0A",
  background: "white",
  border: "1px solid #CBD5E1",
  borderRadius: 4,
  outline: "none",
  boxSizing: "border-box",
};

const btnPrimaryStyle: React.CSSProperties = {
  height: 36,
  padding: "0 16px",
  background: "#586B34",
  color: "white",
  border: "none",
  borderRadius: 4,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

// Photos per request of a bulk "Upload Foto"; the API refuses more than 10.
const PHOTO_BATCH = 8;

const btnSecondaryStyle: React.CSSProperties = {
  height: 36,
  padding: "0 16px",
  background: "white",
  color: "#1F1F1F",
  border: "1px solid #CBD5E1",
  borderRadius: 4,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const iconBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "1px solid #E2E8F0",
  borderRadius: 4,
  cursor: "pointer",
  color: "#64748B",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:50070";

function resolveImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${API_URL}${path}`;
}

function formatPrice(priceIdr: number | null): string {
  if (priceIdr === null) return "—";
  return `Rp ${priceIdr.toLocaleString("id-ID")}`;
}

const STOCK_KEYS: Record<StockStatus, TKey> = {
  normal: "catalog.stock.normal",
  no_stock: "catalog.stock.noStock",
  price_rise: "catalog.stock.priceRise",
  price_drop: "catalog.stock.priceDrop",
};

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      style={{
        width: 32,
        height: 18,
        borderRadius: 9,
        background: on ? "#586B34" : "#CBD5E1",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        position: "relative",
        transition: "background 0.15s",
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 14 : 2,
          width: 14,
          height: 14,
          borderRadius: 7,
          background: "white",
          transition: "left 0.15s",
          boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

// ─── Stock Status Dot ─────────────────────────────────────────────────────────

function StockDot({ status }: { status: StockStatus }) {
  const colors: Record<StockStatus, string> = {
    normal: "#94A3B8",
    no_stock: "#DC2626",
    price_rise: "#D97706",
    price_drop: "#16A34A",
  };
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: 999,
        background: colors[status],
        flexShrink: 0,
      }}
    />
  );
}

// ─── Stock Status Badge ───────────────────────────────────────────────────────

function StockBadge({ status }: { status: StockStatus }) {
  const t = useT();
  const cfg: Record<StockStatus, { bg: string; color: string }> = {
    normal:     { bg: "#F1F5F9", color: "#334155" },
    no_stock:   { bg: "#FEE2E2", color: "#B91C1C" },
    price_rise: { bg: "#FEF3C7", color: "#92400E" },
    price_drop: { bg: "#DCFCE7", color: "#15803D" },
  };
  const { bg, color } = cfg[status];
  const label = t(STOCK_KEYS[status]);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", background: bg, color, borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
      <StockDot status={status} />
      {label}
    </span>
  );
}

// ─── Stock Status Selector ────────────────────────────────────────────────────

function StockStatusSelect({
  value,
  onChange,
}: {
  value: StockStatus;
  onChange: (v: StockStatus) => void;
}) {
  const t = useT();
  const options: { value: StockStatus; label: string }[] = [
    { value: "normal", label: t("catalog.stock.normal") },
    { value: "no_stock", label: t("catalog.stock.noStock") },
    { value: "price_rise", label: t("catalog.stock.priceRise") },
    { value: "price_drop", label: t("catalog.stock.priceDrop") },
  ];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          style={{
            height: 30,
            padding: "0 12px",
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 4,
            border: "1px solid",
            cursor: "pointer",
            borderColor: value === opt.value ? "#586B34" : "#CBD5E1",
            background: value === opt.value ? "#EAF2DD" : "white",
            color: value === opt.value ? "#3E4C24" : "#64748B",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Confirm Delete Modal ─────────────────────────────────────────────────────

function ConfirmDeleteModal({
  title,
  description,
  onConfirm,
  onCancel,
  pending,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  const t = useT();
  const [checked, setChecked] = useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(10,10,10,0.55)" }} onClick={onCancel} />
      <div style={{ position: "relative", background: "white", borderRadius: 8, width: 440, padding: 28, boxShadow: "0 10px 25px rgba(0,0,0,0.15)" }}>
        {/* Icon */}
        <div style={{ width: 44, height: 44, borderRadius: 22, background: "#FEE2E2", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
          </svg>
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0A0A0A", margin: "0 0 8px" }}>{title}</h3>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 20px", lineHeight: 1.5 }}>{description}</p>
        {/* Checkbox confirmation */}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 24 }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={{ width: 16, height: 16, marginTop: 1, accentColor: "#B91C1C", cursor: "pointer", flexShrink: 0 }}
          />
          <span style={{ fontSize: 13, color: "#1F1F1F", lineHeight: 1.4 }}>
            {t("catalog.deleteAckPre")}<strong>{t("catalog.deleteAckStrong")}</strong>{t("catalog.deleteAckPost")}
          </span>
        </label>
        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} disabled={pending} style={{ height: 36, padding: "0 16px", background: "white", color: "#1F1F1F", border: "1px solid #CBD5E1", borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            {t("catalog.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={!checked || pending}
            style={{ height: 36, padding: "0 16px", background: checked && !pending ? "#B91C1C" : "#F1F5F9", color: checked && !pending ? "white" : "#94A3B8", border: "none", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: checked && !pending ? "pointer" : "not-allowed", transition: "all 0.15s" }}
          >
            {pending ? t("catalog.deleting") : t("catalog.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Close Icon ───────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,6 5,6 21,6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
    >
      <polyline points="9,18 15,12 9,6" />
    </svg>
  );
}

// ─── Modal Wrapper ────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
    >
      <div style={{ background: "white", borderRadius: 8, width: "90vw", maxWidth: 900, maxHeight: "92vh", overflow: "auto", boxShadow: "0 10px 25px rgba(0,0,0,0.15)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "white", zIndex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#0A0A0A" }}>{title}</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748B", display: "flex", alignItems: "center", padding: 4 }}>
            <CloseIcon />
          </button>
        </div>
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
        <div style={{ padding: "14px 20px", borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "flex-end", gap: 8, position: "sticky", bottom: 0, background: "white" }}>
          {footer}
        </div>
      </div>
    </div>
  );
}

// ─── Product Modal ────────────────────────────────────────────────────────────

const uomSelectStyle: React.CSSProperties = {
  height: 34,
  padding: "0 8px",
  fontSize: 12,
  color: "#0A0A0A",
  background: "white",
  border: "1px solid #CBD5E1",
  borderRadius: 4,
  outline: "none",
  boxSizing: "border-box",
  cursor: "pointer",
  width: "100%",
};

type InlineVariantRow = {
  id: string; // local key only
  name: string;
  sku: string;
  imageUrl: string;
  priceIdr: string;
  mpPriceIdr: string;
  isiCtn: string;
  isiBox: string;
  uomPriceId: string;
  mpUomId: string;
  uomCtnId: string;
  uomBoxId: string;
  minOrderQty: string;
  minOrderUomId: string;
  stockStatus: StockStatus;
  isActive: boolean;
};

function newVariantRow(): InlineVariantRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: "",
    sku: "",
    imageUrl: "",
    priceIdr: "",
    mpPriceIdr: "",
    isiCtn: "",
    isiBox: "",
    uomPriceId: "",
    mpUomId: "",
    uomCtnId: "",
    uomBoxId: "",
    minOrderQty: "",
    minOrderUomId: "",
    stockStatus: "normal",
    isActive: true,
  };
}

function InlineVariantEditor({
  uomList,
  variants,
  variantErrors,
  onChange,
  onAdd,
  onRemove,
}: {
  uomList: Uom[];
  variants: InlineVariantRow[];
  variantErrors: Record<string, Record<string, string>>;
  onChange: (id: string, field: keyof InlineVariantRow, value: string | boolean | StockStatus) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  const cellInput: React.CSSProperties = {
    width: "100%",
    height: 34,
    padding: "0 8px",
    fontSize: 12,
    color: "#0A0A0A",
    background: "white",
    border: "1px solid #CBD5E1",
    borderRadius: 4,
    outline: "none",
    boxSizing: "border-box",
  };
  const colLabel: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 4,
    display: "block",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {variants.map((v) => {
        const errs = variantErrors[v.id] ?? {};
        return (
          <div
            key={v.id}
            style={{ border: "1px solid #E2E8F0", borderRadius: 6, padding: "12px", background: "#F8FAFC", display: "flex", flexDirection: "column", gap: 8 }}
          >
            {/* Header row with delete */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {t("catalog.variantN", { n: variants.indexOf(v) + 1 })}
              </span>
              <button
                type="button"
                onClick={() => onRemove(v.id)}
                disabled={variants.length <= 1}
                title={t("catalog.removeVariant")}
                style={{ background: "transparent", border: "none", cursor: variants.length <= 1 ? "not-allowed" : "pointer", color: "#DC2626", opacity: variants.length <= 1 ? 0.3 : 1, display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 500, padding: 0 }}
              >
                <CloseIcon /> {t("catalog.delete")}
              </button>
            </div>

            {/* Row 1: name + sku + image */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
              <div>
                <label style={colLabel}>{t("catalog.variantName")} <span style={{ color: "#DC2626" }}>*</span></label>
                <input
                  value={v.name}
                  onChange={(e) => onChange(v.id, "name", e.target.value)}
                  placeholder={t("catalog.variantNameEx")}
                  style={{ ...cellInput, borderColor: errs.name ? "#DC2626" : "#CBD5E1" }}
                />
                {errs.name && <p style={{ fontSize: 11, color: "#DC2626", margin: "3px 0 0" }}>{errs.name}</p>}
              </div>
              <div>
                <label style={colLabel}>SKU <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{t("catalog.optional")}</span></label>
                <input
                  value={v.sku}
                  onChange={(e) => onChange(v.id, "sku", e.target.value)}
                  style={{ ...cellInput, fontFamily: "JetBrains Mono, monospace" }}
                />
              </div>
              <div>
                <FileUploadField
                  label={t("catalog.image")}
                  accept="image/jpeg,image/png"
                  uploadEndpoint="/api/upload-image"
                  currentUrl={v.imageUrl}
                  onUploaded={(url) => onChange(v.id, "imageUrl", url)}
                  previewType="image"
                  optional
                />
              </div>
            </div>

            {/* Row 2: price + uom price + isi ctn + uom ctn */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
              <div>
                <label style={colLabel}>{t("catalog.priceIdr")} <span style={{ color: "#DC2626" }}>*</span></label>
                <input
                  value={v.priceIdr}
                  onChange={(e) => onChange(v.id, "priceIdr", e.target.value)}
                  placeholder="150000"
                  style={{ ...cellInput, borderColor: errs.priceIdr ? "#DC2626" : "#CBD5E1" }}
                />
                {errs.priceIdr && <p style={{ fontSize: 11, color: "#DC2626", margin: "3px 0 0" }}>{errs.priceIdr}</p>}
              </div>
              <div>
                <label style={colLabel}>{t("catalog.priceUnit")} <span style={{ color: "#DC2626" }}>*</span></label>
                <select value={v.uomPriceId} onChange={(e) => onChange(v.id, "uomPriceId", e.target.value)} style={{ ...uomSelectStyle, borderColor: errs.uomPriceId ? "#DC2626" : "#CBD5E1" }}>
                  <option value="">{t("catalog.choose")}</option>
                  {uomList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                {errs.uomPriceId && <p style={{ fontSize: 11, color: "#DC2626", margin: "3px 0 0" }}>{errs.uomPriceId}</p>}
              </div>
              <div>
                <label style={colLabel}>{t("catalog.isiCtn")} <span style={{ color: "#DC2626" }}>*</span></label>
                <input
                  value={v.isiCtn}
                  onChange={(e) => onChange(v.id, "isiCtn", e.target.value)}
                  placeholder="12"
                  style={{ ...cellInput, borderColor: errs.isiCtn ? "#DC2626" : "#CBD5E1" }}
                />
                {errs.isiCtn && <p style={{ fontSize: 11, color: "#DC2626", margin: "3px 0 0" }}>{errs.isiCtn}</p>}
              </div>
              <div>
                <label style={colLabel}>{t("catalog.ctnUnit")} <span style={{ color: "#DC2626" }}>*</span></label>
                <select value={v.uomCtnId} onChange={(e) => onChange(v.id, "uomCtnId", e.target.value)} style={{ ...uomSelectStyle, borderColor: errs.uomCtnId ? "#DC2626" : "#CBD5E1" }}>
                  <option value="">{t("catalog.choose")}</option>
                  {uomList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                {errs.uomCtnId && <p style={{ fontSize: 11, color: "#DC2626", margin: "3px 0 0" }}>{errs.uomCtnId}</p>}
              </div>
            </div>

            {/* Row 2b: MP + min order. MP carries its OWN unit, so the unit is a separate
                select rather than inherited from Satuan Harga. (Replaced in Task 17.) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
              <div>
                <label style={colLabel}>{t("catalog.mpPrice")} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{t("catalog.endUser")}</span></label>
                <input
                  value={v.mpPriceIdr}
                  onChange={(e) => onChange(v.id, "mpPriceIdr", e.target.value)}
                  placeholder="160000"
                  style={cellInput}
                />
              </div>
              <div>
                <label style={colLabel}>{t("catalog.mpUnit")}</label>
                <select value={v.mpUomId} onChange={(e) => onChange(v.id, "mpUomId", e.target.value)} style={uomSelectStyle}>
                  <option value="">{t("catalog.choose")}</option>
                  {uomList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label style={colLabel}>{t("catalog.minOrder")} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{t("catalog.optional")}</span></label>
                <input
                  value={v.minOrderQty}
                  onChange={(e) => onChange(v.id, "minOrderQty", e.target.value)}
                  placeholder="1"
                  style={cellInput}
                />
              </div>
              <div>
                <label style={colLabel}>{t("catalog.minOrderUnit")}</label>
                <select value={v.minOrderUomId} onChange={(e) => onChange(v.id, "minOrderUomId", e.target.value)} style={uomSelectStyle}>
                  <option value="">{t("catalog.choose")}</option>
                  {uomList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>

            {/* Row 3: isi box + uom box + stock status + active */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
              <div>
                <label style={colLabel}>{t("catalog.isiBox")} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{t("catalog.optional")}</span></label>
                <input
                  value={v.isiBox}
                  onChange={(e) => onChange(v.id, "isiBox", e.target.value)}
                  placeholder="6"
                  style={cellInput}
                />
              </div>
              <div>
                <label style={colLabel}>{t("catalog.boxUnit")} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{t("catalog.optional")}</span></label>
                <select value={v.uomBoxId} onChange={(e) => onChange(v.id, "uomBoxId", e.target.value)} style={uomSelectStyle}>
                  <option value="">{t("catalog.choose")}</option>
                  {uomList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label style={colLabel}>{t("catalog.stockStatus")}</label>
                <select
                  value={v.stockStatus}
                  onChange={(e) => onChange(v.id, "stockStatus", e.target.value as StockStatus)}
                  style={uomSelectStyle}
                >
                  <option value="normal">{t("catalog.stock.normal")}</option>
                  <option value="no_stock">{t("catalog.stock.noStock")}</option>
                  <option value="price_rise">{t("catalog.stock.priceRise")}</option>
                  <option value="price_drop">{t("catalog.stock.priceDrop")}</option>
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 1 }}>
                <span style={{ fontSize: 11, color: "#64748B" }}>{t("catalog.active")}</span>
                <Toggle on={v.isActive} onChange={() => onChange(v.id, "isActive", !v.isActive)} />
              </div>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        style={{ background: "transparent", border: "none", color: "#445428", fontSize: 12, fontWeight: 500, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "flex-start" }}
      >
        <PlusIcon size={12} /> {t("catalog.addVariant")}
      </button>
    </div>
  );
}

function friendlyError(e: unknown, context: "produk" | "varian", t: TFn): string {
  const msg = e instanceof Error ? e.message : String(e);
  const what = t(context === "produk" ? "catalog.what.product" : "catalog.what.variant");
  if (msg.includes("CONFLICT") || msg.includes("unique") || msg.includes("duplicate"))
    return t("catalog.err.duplicate", { what });
  if (msg.includes("VALIDATION_ERROR") || msg.includes("validation"))
    return t("catalog.err.validation");
  if (msg.includes("NOT_FOUND"))
    return t(context === "produk" ? "catalog.err.productNotFound" : "catalog.err.variantNotFound");
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch"))
    return t("catalog.err.network");
  return t("catalog.err.save", { what });
}

// ─── Multi-Product Select ─────────────────────────────────────────────────────

function MultiProductSelect({
  label,
  allProducts,
  selectedIds,
  onChange,
  excludeIds,
  maxSelect = 8,
}: {
  label: string;
  allProducts: Product[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  excludeIds?: string[];
  maxSelect?: number;
}) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const available = allProducts
    .filter((p) => !(excludeIds ?? []).includes(p.id))
    .filter((p) => !filter.trim() || p.name.toLowerCase().includes(filter.toLowerCase()));
  const selectedProducts = allProducts.filter((p) => selectedIds.includes(p.id));

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else if (selectedIds.length < maxSelect) {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <div>
      <label style={labelStyle}>
        {label}{" "}
        <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#64748B" }}>{t("catalog.multiHint", { max: maxSelect })}</span>
      </label>
      {selectedProducts.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
          {selectedProducts.map((p) => (
            <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", background: "#EFF6FF", color: "#1D4ED8", borderRadius: 4, fontSize: 12, fontWeight: 500 }}>
              {p.name}
              <button type="button" onClick={() => toggle(p.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#1D4ED8", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center" }}>×</button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t("catalog.searchProduct")}
        style={{ ...inputStyle, height: 30, fontSize: 12, marginBottom: 4 }}
      />
      <div style={{ border: "1px solid #CBD5E1", borderRadius: 4, maxHeight: 120, overflowY: "auto", background: "white" }}>
        {available.length === 0 ? (
          <div style={{ padding: "8px 10px", color: "#94A3B8", fontSize: 12 }}>{t("catalog.noProducts")}</div>
        ) : (
          available.map((p) => {
            const sel = selectedIds.includes(p.id);
            const maxed = !sel && selectedIds.length >= maxSelect;
            return (
              <label
                key={p.id}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", cursor: maxed ? "not-allowed" : "pointer", background: sel ? "#EFF6FF" : "transparent", fontSize: 12, color: maxed ? "#94A3B8" : "#0A0A0A" }}
              >
                <input
                  type="checkbox"
                  checked={sel}
                  disabled={maxed}
                  onChange={() => toggle(p.id)}
                  style={{ margin: 0, accentColor: "#1D4ED8", flexShrink: 0 }}
                />
                {p.name}
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Product Modal ────────────────────────────────────────────────────────────

function ProductModal({
  brands,
  uomList,
  categories,
  onClose,
  onSaved,
  editing,
}: {
  brands: Brand[];
  uomList: Uom[];
  categories: Category[];
  onClose: () => void;
  onSaved: (product: Product) => void;
  editing?: Product;
}) {
  const t = useT();
  const isCreate = !editing;

  const [brandId, setBrandId] = useState(editing?.brandId ?? brands[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [fungsi, setFungsi] = useState(editing?.fungsi ?? "");
  const [usp, setUsp] = useState(editing?.usp ?? "");
  const [kataKunci, setKataKunci] = useState(editing?.kataKunci ?? "");
  const [kelengkapan, setKelengkapan] = useState(editing?.kelengkapan ?? "");
  const [bahan, setBahan] = useState(editing?.bahan ?? "");
  const [ketebalan, setKetebalan] = useState(editing?.ketebalan ?? "");
  const [imageUrl, setImageUrl] = useState(editing?.imageUrl ?? "");
  const [tier, setTier] = useState<string>(editing?.tier ?? "");
  const [upsellProductId, setUpsellProductId] = useState<string>(editing?.upsellProductId ?? "");
  const [relatedProductIds, setRelatedProductIds] = useState<string[]>(
    Array.isArray(editing?.relatedProductIds) ? (editing.relatedProductIds as string[]) : []
  );
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [upsellSearch, setUpsellSearch] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    getProducts({ limit: 999 }).then((r) => setAllProducts(r.products)).catch(() => {});
  }, []);

  // CREATE-only: inline variants
  const [variants, setVariants] = useState<InlineVariantRow[]>([newVariantRow()]);
  const [variantErrors, setVariantErrors] = useState<Record<string, Record<string, string>>>({});

  function handleVariantChange(id: string, field: keyof InlineVariantRow, value: string | boolean | StockStatus) {
    setVariants((prev) => prev.map((v) => v.id === id ? { ...v, [field]: value } : v));
    // clear error on field change
    if (field === "name") {
      setVariantErrors((prev) => {
        const updated = { ...prev };
        if (updated[id]) updated[id] = { ...updated[id], name: "" };
        return updated;
      });
    }
  }

  function handleAddVariant() {
    setVariants((prev) => [...prev, newVariantRow()]);
  }

  function handleRemoveVariant(id: string) {
    if (variants.length <= 1) return;
    setVariants((prev) => prev.filter((v) => v.id !== id));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!brandId) errs.brandId = t("catalog.v.brandRequired");
    if (!name.trim()) errs.name = t("catalog.v.productNameRequired");
    setFieldErrors(errs);

    if (isCreate) {
      const vErrs: Record<string, Record<string, string>> = {};
      for (const v of variants) {
        const ve: Record<string, string> = {};
        if (!v.name.trim()) ve.name = t("catalog.v.variantNameRequired");
        if (!v.priceIdr.trim()) ve.priceIdr = t("catalog.v.priceRequired");
        if (!v.uomPriceId) ve.uomPriceId = t("catalog.v.priceUnitRequired");
        if (!v.isiCtn.trim()) ve.isiCtn = t("catalog.v.isiCtnRequired");
        if (!v.uomCtnId) ve.uomCtnId = t("catalog.v.ctnUnitRequired");
        if (Object.keys(ve).length > 0) vErrs[v.id] = ve;
      }
      setVariantErrors(vErrs);
      return Object.keys(errs).length === 0 && Object.keys(vErrs).length === 0;
    }

    return Object.keys(errs).length === 0;
  }

  function handleSubmit() {
    setError(null);
    if (!validate()) return;

    const productData = {
      brandId,
      categoryId: categoryId || null,
      name,
      description: description.trim() || null,
      fungsi: fungsi.trim() || null,
      usp: usp.trim() || null,
      kataKunci: kataKunci.trim() || null,
      kelengkapan: kelengkapan.trim() || null,
      bahan: bahan.trim() || null,
      ketebalan: ketebalan.trim() || null,
      imageUrl: imageUrl || null,
      tier: tier || null,
      upsellProductId: upsellProductId || null,
      relatedProductIds: relatedProductIds.length > 0 ? relatedProductIds : null,
    };

    startTransition(async () => {
      try {
        let product: Product;
        if (editing) {
          const res = await updateProductAction(editing.id, productData);
          if (res.error === "NAME_EXISTS") {
            setFieldErrors((p) => ({ ...p, name: t("catalog.productNameTaken") }));
            return;
          }
          if (!res.data) { setError(t("catalog.productSaveFailed")); return; }
          product = res.data;
        } else {
          const res = await createProductAction(productData);
          if (res.error === "NAME_EXISTS") {
            setFieldErrors((p) => ({ ...p, name: t("catalog.productNameTaken") }));
            return;
          }
          if (!res.data) { setError(t("catalog.productSaveFailed")); return; }
          product = res.data;

          // Create variants — rollback (delete product) if any variant fails
          const createdVariants: import("@/types/api").ProductVariant[] = [];
          for (const v of variants) {
            const vRes = await createVariantAction(product.id, {
              name: v.name,
              sku: v.sku || null,
              imageUrl: v.imageUrl || null,
              priceIdr: v.priceIdr ? parseFloat(v.priceIdr) : null,
              mpPriceIdr: v.mpPriceIdr ? parseFloat(v.mpPriceIdr) : null,
              isiCtn: v.isiCtn ? parseInt(v.isiCtn, 10) : null,
              isiBox: v.isiBox ? parseInt(v.isiBox, 10) : null,
              uomPriceId: v.uomPriceId || null,
              mpUomId: v.mpUomId || null,
              uomCtnId: v.uomCtnId || null,
              uomBoxId: v.uomBoxId || null,
              minOrderQty: v.minOrderQty ? parseInt(v.minOrderQty, 10) : null,
              minOrderUomId: v.minOrderUomId || null,
              stockStatus: v.stockStatus,
              isActive: v.isActive,
            }, true);
            if (!vRes.data) {
              await deleteProductAction(product.id);
              setError(vRes.error === "NAME_EXISTS"
                ? t("catalog.variantNameTakenIn", { name: v.name })
                : t("catalog.variantsSaveFailedCheck"));
              return;
            }
            createdVariants.push(vRes.data);
          }
          product = { ...product, variants: createdVariants };
        }
        onSaved(product);
        onClose();
      } catch (e) {
        setError(friendlyError(e, "produk", t));
      }
    });
  }

  return (
    <Modal
      title={editing ? t("catalog.product.edit") : t("catalog.product.add")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={btnSecondaryStyle} disabled={pending}>{t("catalog.cancel")}</button>
          <button onClick={handleSubmit} style={btnPrimaryStyle} disabled={pending}>
            {pending ? t("catalog.saving") : t("catalog.save")}
          </button>
        </>
      }
    >
      {error && (
        <div style={{ padding: "10px 14px", background: "#FEE2E2", color: "#B91C1C", borderRadius: 4, fontSize: 13 }}>{error}</div>
      )}

      {/* Section 1 — Produk */}
      {isCreate && (
        <div style={{ fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #E2E8F0", paddingBottom: 6 }}>
          {t("catalog.sec.product")}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>{t("catalog.brand")} <span style={{ color: "#DC2626" }}>*</span></label>
          <select value={brandId} onChange={(e) => { setBrandId(e.target.value); setFieldErrors((p) => ({ ...p, brandId: "" })); }}
            style={{ ...inputStyle, borderColor: fieldErrors.brandId ? "#DC2626" : "#CBD5E1" }}>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {fieldErrors.brandId && <p style={{ fontSize: 12, color: "#DC2626", margin: "4px 0 0" }}>{fieldErrors.brandId}</p>}
        </div>
        <div>
          <label style={labelStyle}>{t("catalog.productName")} <span style={{ color: "#DC2626" }}>*</span></label>
          <input value={name} onChange={(e) => { setName(e.target.value); setFieldErrors((p) => ({ ...p, name: "" })); }}
            style={{ ...inputStyle, borderColor: fieldErrors.name ? "#DC2626" : "#CBD5E1" }} />
          {fieldErrors.name && <p style={{ fontSize: 12, color: "#DC2626", margin: "4px 0 0" }}>{fieldErrors.name}</p>}
        </div>
      </div>

      <div>
        <label style={labelStyle}>
          {t("catalog.category")}{" "}
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#64748B" }}>{t("catalog.optional")}</span>
        </label>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={inputStyle}>
          <option value="">{t("catalog.noCategory")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label style={labelStyle}>
          {t("catalog.productDescription")}
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#64748B" }}>{t("catalog.productDescriptionHint")}</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("catalog.productDescriptionPh")}
          rows={3}
          style={{ ...inputStyle, height: "auto", padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }}
        />
      </div>

      {/* Section — Pengetahuan Produk (dipakai AI untuk menjawab customer) */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #E2E8F0", paddingBottom: 6, marginTop: 4 }}>
        {t("catalog.sec.knowledge")}
      </div>

      <div>
        <label style={labelStyle}>{t("catalog.fungsi")}</label>
        <textarea value={fungsi} onChange={(e) => setFungsi(e.target.value)} rows={2}
          placeholder={t("catalog.fungsiPh")}
          style={{ ...inputStyle, height: "auto", padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }} />
      </div>
      <div>
        <label style={labelStyle}>{t("catalog.uspLabel")}</label>
        <textarea value={usp} onChange={(e) => setUsp(e.target.value)} rows={3}
          placeholder={t("catalog.uspPh")}
          style={{ ...inputStyle, height: "auto", padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }} />
      </div>
      <div>
        <label style={labelStyle}>{t("catalog.kataKunci")}</label>
        <textarea value={kataKunci} onChange={(e) => setKataKunci(e.target.value)} rows={2}
          placeholder={t("catalog.kataKunciPh")}
          style={{ ...inputStyle, height: "auto", padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>{t("catalog.kelengkapan")}</label>
          <input value={kelengkapan} onChange={(e) => setKelengkapan(e.target.value)} placeholder={t("catalog.kelengkapanPh")} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>{t("catalog.bahan")}</label>
          <input value={bahan} onChange={(e) => setBahan(e.target.value)} placeholder={t("catalog.bahanPh")} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>{t("catalog.ketebalan")}</label>
          <input value={ketebalan} onChange={(e) => setKetebalan(e.target.value)} placeholder={t("catalog.ketebalanPh")} style={inputStyle} />
        </div>
      </div>

      <div>
        <FileUploadField
          label={t("catalog.productImage")}
          accept="image/jpeg,image/png"
          uploadEndpoint="/api/upload-image"
          currentUrl={imageUrl}
          onUploaded={(url) => setImageUrl(url)}
          previewType="image"
          optional
        />
      </div>

      {/* Section — Relasi Produk */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #E2E8F0", paddingBottom: 6, marginTop: 4 }}>
        {t("catalog.sec.relations")}
      </div>

      <div>
        <label style={labelStyle}>
          {t("catalog.tier")}{" "}
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#64748B" }}>{t("catalog.optional")}</span>
        </label>
        <select value={tier} onChange={(e) => setTier(e.target.value)} style={inputStyle}>
          <option value="">{t("catalog.noTier")}</option>
          <option value="economic">{t("catalog.tier.economic")}</option>
          <option value="mid">{t("catalog.tier.mid")}</option>
          <option value="premium">{t("catalog.tier.premium")}</option>
        </select>
      </div>

      <div>
        <label style={labelStyle}>
          {t("catalog.upsell")}{" "}
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#64748B" }}>{t("catalog.upsellHint")}</span>
        </label>
        <input
          type="text"
          value={upsellSearch}
          onChange={(e) => setUpsellSearch(e.target.value)}
          placeholder={t("catalog.upsellSearchPh")}
          style={{ ...inputStyle, height: 30, fontSize: 12, marginBottom: 4 }}
        />
        <select
          value={upsellProductId}
          onChange={(e) => setUpsellProductId(e.target.value)}
          style={inputStyle}
        >
          <option value="">{t("catalog.none")}</option>
          {allProducts
            .filter((p) => p.id !== editing?.id)
            .filter((p) => !upsellSearch.trim() || p.name.toLowerCase().includes(upsellSearch.toLowerCase()))
            .map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
        </select>
        {upsellProductId && (
          <button type="button" onClick={() => setUpsellProductId("")} style={{ marginTop: 4, background: "none", border: "none", cursor: "pointer", color: "#445428", fontSize: 12, padding: 0 }}>
            {t("catalog.clearSelection")}
          </button>
        )}
      </div>

      <MultiProductSelect
        label={t("catalog.related")}
        allProducts={allProducts}
        selectedIds={relatedProductIds}
        onChange={setRelatedProductIds}
        excludeIds={[editing?.id ?? "", upsellProductId].filter(Boolean)}
        maxSelect={8}
      />

      {/* Section 2 — Varian (CREATE only) */}
      {isCreate && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #E2E8F0", paddingBottom: 6, marginTop: 4 }}>
            {t("catalog.sec.variants")} <span style={{ color: "#DC2626" }}>*</span>
            <span style={{ fontSize: 10, fontWeight: 400, textTransform: "none", color: "#94A3B8", letterSpacing: 0 }}>{t("catalog.variantsHint")}</span>
          </div>
          <InlineVariantEditor
            uomList={uomList}
            variants={variants}
            variantErrors={variantErrors}
            onChange={handleVariantChange}
            onAdd={handleAddVariant}
            onRemove={handleRemoveVariant}
          />
        </>
      )}
    </Modal>
  );
}

// ─── Variant Modal ────────────────────────────────────────────────────────────

function VariantModal({
  productId,
  uomList,
  onClose,
  onSaved,
  editing,
}: {
  productId: string;
  uomList: Uom[];
  onClose: () => void;
  onSaved: (variant: ProductVariant) => void;
  editing?: ProductVariant;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [sku, setSku] = useState(editing?.sku ?? "");
  const t = useT();
  const [variantDescription, setVariantDescription] = useState(editing?.description ?? "");
  const [imageUrl, setImageUrl] = useState(editing?.imageUrl ?? "");
  const [priceIdr, setPriceIdr] = useState(editing?.priceIdr != null ? String(editing.priceIdr) : "");
  const [mpPriceIdr, setMpPriceIdr] = useState(editing?.mpPriceIdr != null ? String(editing.mpPriceIdr) : "");
  const [minOrderQty, setMinOrderQty] = useState(editing?.minOrderQty != null ? String(editing.minOrderQty) : "");
  const [isiCtn, setIsiCtn] = useState(editing?.isiCtn != null ? String(editing.isiCtn) : "");
  const [isiBox, setIsiBox] = useState(editing?.isiBox != null ? String(editing.isiBox) : "");
  const [uomPriceId, setUomPriceId] = useState(editing?.uomPriceId ?? "");
  const [uomCtnId, setUomCtnId] = useState(editing?.uomCtnId ?? "");
  const [uomBoxId, setUomBoxId] = useState(editing?.uomBoxId ?? "");
  const [mpUomId, setMpUomId] = useState(editing?.mpUomId ?? "");
  const [minOrderUomId, setMinOrderUomId] = useState(editing?.minOrderUomId ?? "");
  const [uomCtnManual, setUomCtnManual] = useState(
    editing != null && editing.uomCtnId !== editing.uomPriceId
  );
  const [uomBoxManual, setUomBoxManual] = useState(
    editing != null && editing.uomBoxId !== editing.uomPriceId
  );
  const [stockStatus, setStockStatus] = useState<StockStatus>(editing?.stockStatus ?? "normal");
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function handleChangePriceUom(v: string) {
    setUomPriceId(v);
    if (!uomCtnManual) setUomCtnId(v);
    if (!uomBoxManual) setUomBoxId(v);
  }

  function handleChangeCtnUom(v: string) {
    setUomCtnId(v);
    setUomCtnManual(true);
  }

  function handleChangeBoxUom(v: string) {
    setUomBoxId(v);
    setUomBoxManual(true);
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t("catalog.v.variantNameRequired");
    if (!priceIdr.trim()) errs.priceIdr = t("catalog.v.priceRequired");
    else if (isNaN(parseFloat(priceIdr))) errs.priceIdr = t("catalog.v.priceNumber");
    if (!uomPriceId) errs.uomPriceId = t("catalog.v.priceUnitRequired");
    if (!isiCtn.trim()) errs.isiCtn = t("catalog.v.isiCtnRequired");
    else if (!Number.isInteger(parseFloat(isiCtn)) || parseFloat(isiCtn) < 0) errs.isiCtn = t("catalog.v.isiCtnInt");
    if (!uomCtnId) errs.uomCtnId = t("catalog.v.ctnUnitRequired");
    if (isiBox && (!Number.isInteger(parseFloat(isiBox)) || parseFloat(isiBox) < 0)) errs.isiBox = t("catalog.v.isiBoxInt");
    // Not required: a variant with no MP renders "tanya tim", which is a deliberate hand-off.
    if (mpPriceIdr.trim() && isNaN(parseFloat(mpPriceIdr))) errs.mpPriceIdr = t("catalog.v.mpNumber");
    if (minOrderQty.trim() && (!Number.isInteger(parseFloat(minOrderQty)) || parseFloat(minOrderQty) < 0)) errs.minOrderQty = t("catalog.v.minOrderInt");
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit() {
    setError(null);
    if (!validate()) return;
    const data = {
      name,
      sku: sku || null,
      description: variantDescription.trim() || null,
      imageUrl: imageUrl || null,
      priceIdr: priceIdr ? parseFloat(priceIdr) : null,
      mpPriceIdr: mpPriceIdr ? parseFloat(mpPriceIdr) : null,
      isiCtn: isiCtn ? parseFloat(isiCtn) : null,
      isiBox: isiBox ? parseFloat(isiBox) : null,
      uomPriceId: uomPriceId || null,
      mpUomId: mpUomId || null,
      uomCtnId: uomCtnId || null,
      uomBoxId: uomBoxId || null,
      minOrderQty: minOrderQty ? parseInt(minOrderQty, 10) : null,
      minOrderUomId: minOrderUomId || null,
      stockStatus,
      isActive,
    };

    startTransition(async () => {
      const res = editing
        ? await updateVariantAction(editing.id, data)
        : await createVariantAction(productId, data);
      if (!res.data) {
        setError(res.error === "NAME_EXISTS"
          ? t("catalog.variantNameTaken")
          : t("catalog.variantSaveFailed"));
        return;
      }
      onSaved(res.data);
      onClose();
    });
  }

  return (
    <Modal
      title={editing ? t("catalog.variant.edit") : t("catalog.addVariant")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={btnSecondaryStyle} disabled={pending}>{t("catalog.cancel")}</button>
          <button onClick={handleSubmit} style={btnPrimaryStyle} disabled={pending}>
            {pending ? t("catalog.saving") : t("catalog.save")}
          </button>
        </>
      }
    >
      {error && (
        <div style={{ padding: "10px 14px", background: "#FEE2E2", color: "#B91C1C", borderRadius: 4, fontSize: 13 }}>{error}</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>{t("catalog.variantName")} <span style={{ color: "#DC2626" }}>*</span></label>
          <input value={name} onChange={(e) => { setName(e.target.value); setFieldErrors((p) => ({ ...p, name: "" })); }}
            placeholder={t("catalog.variantNameEx2")} style={{ ...inputStyle, borderColor: fieldErrors.name ? "#DC2626" : "#CBD5E1" }} />
          {fieldErrors.name && <p style={{ fontSize: 12, color: "#DC2626", margin: "4px 0 0" }}>{fieldErrors.name}</p>}
        </div>
        <div>
          <label style={labelStyle}>{t("catalog.skuOptional")}</label>
          <input value={sku} onChange={(e) => setSku(e.target.value)} style={{ ...inputStyle, fontFamily: "JetBrains Mono, monospace" }} />
        </div>
        <div>
          <FileUploadField
            label={t("catalog.image")}
            accept="image/jpeg,image/png"
            uploadEndpoint="/api/upload-image"
            currentUrl={imageUrl}
            onUploaded={(url) => setImageUrl(url)}
            previewType="image"
            optional
          />
        </div>
      </div>

      <div>
        <label style={labelStyle}>{t("catalog.variantDescription")}</label>
        <textarea
          value={variantDescription}
          onChange={(e) => setVariantDescription(e.target.value)}
          placeholder={t("catalog.variantDescriptionPh")}
          rows={3}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>{t("catalog.priceUnit")} <span style={{ color: "#DC2626" }}>*</span></label>
          <select value={uomPriceId} onChange={(e) => { handleChangePriceUom(e.target.value); setFieldErrors((p) => ({ ...p, uomPriceId: "" })); }} style={{ ...inputStyle, cursor: "pointer", borderColor: fieldErrors.uomPriceId ? "#DC2626" : "#CBD5E1" }}>
            <option value="">{t("catalog.choose")}</option>
            {uomList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {fieldErrors.uomPriceId && <p style={{ fontSize: 12, color: "#DC2626", margin: "4px 0 0" }}>{fieldErrors.uomPriceId}</p>}
        </div>
        <div>
          <label style={labelStyle}>{t("catalog.ctnUnit")} <span style={{ color: "#DC2626" }}>*</span></label>
          <select value={uomCtnId} onChange={(e) => { handleChangeCtnUom(e.target.value); setFieldErrors((p) => ({ ...p, uomCtnId: "" })); }} style={{ ...inputStyle, cursor: "pointer", borderColor: fieldErrors.uomCtnId ? "#DC2626" : "#CBD5E1" }}>
            <option value="">{t("catalog.choose")}</option>
            {uomList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {fieldErrors.uomCtnId && <p style={{ fontSize: 12, color: "#DC2626", margin: "4px 0 0" }}>{fieldErrors.uomCtnId}</p>}
        </div>
        <div>
          <label style={labelStyle}>{t("catalog.boxUnitOptional")}</label>
          <select value={uomBoxId} onChange={(e) => handleChangeBoxUom(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="">{t("catalog.choose")}</option>
            {uomList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>{t("catalog.priceIdr")} <span style={{ color: "#DC2626" }}>*</span></label>
          <input value={priceIdr} onChange={(e) => { setPriceIdr(e.target.value); setFieldErrors((p) => ({ ...p, priceIdr: "" })); }}
            placeholder="150000" style={{ ...inputStyle, borderColor: fieldErrors.priceIdr ? "#DC2626" : "#CBD5E1" }} />
          {fieldErrors.priceIdr && <p style={{ fontSize: 12, color: "#DC2626", margin: "4px 0 0" }}>{fieldErrors.priceIdr}</p>}
        </div>
        <div>
          <label style={labelStyle}>{t("catalog.isiCtn")} <span style={{ color: "#DC2626" }}>*</span></label>
          <input value={isiCtn} onChange={(e) => { setIsiCtn(e.target.value); setFieldErrors((p) => ({ ...p, isiCtn: "" })); }}
            placeholder="12" style={{ ...inputStyle, borderColor: fieldErrors.isiCtn ? "#DC2626" : "#CBD5E1" }} />
          {fieldErrors.isiCtn && <p style={{ fontSize: 12, color: "#DC2626", margin: "4px 0 0" }}>{fieldErrors.isiCtn}</p>}
        </div>
        <div>
          <label style={labelStyle}>{t("catalog.isiBoxOptional")}</label>
          <input value={isiBox} onChange={(e) => { setIsiBox(e.target.value); setFieldErrors((p) => ({ ...p, isiBox: "" })); }}
            placeholder="6" style={{ ...inputStyle, borderColor: fieldErrors.isiBox ? "#DC2626" : "#CBD5E1" }} />
          {fieldErrors.isiBox && <p style={{ fontSize: 12, color: "#DC2626", margin: "4px 0 0" }}>{fieldErrors.isiBox}</p>}
        </div>
      </div>

      {/* MP + min order. MP carries its OWN unit. Left blank the AI answers "tanya tim" for
          that variant, which is a deliberate hand-off, not a gap. (Replaced in Task 17.) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>{t("catalog.mpPriceEndUser")}</label>
          <input value={mpPriceIdr} onChange={(e) => { setMpPriceIdr(e.target.value); setFieldErrors((p) => ({ ...p, mpPriceIdr: "" })); }}
            placeholder="160000" style={{ ...inputStyle, borderColor: fieldErrors.mpPriceIdr ? "#DC2626" : "#CBD5E1" }} />
          {fieldErrors.mpPriceIdr
            ? <p style={{ fontSize: 12, color: "#DC2626", margin: "4px 0 0" }}>{fieldErrors.mpPriceIdr}</p>
            : <p style={{ fontSize: 11, color: "#94A3B8", margin: "4px 0 0" }}>{t("catalog.mpBlankHint")}</p>}
        </div>
        <div>
          <label style={labelStyle}>{t("catalog.mpUnit")}</label>
          <select value={mpUomId} onChange={(e) => setMpUomId(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="">{t("catalog.choose")}</option>
            {uomList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("catalog.minOrderOptional")}</label>
          <input value={minOrderQty} onChange={(e) => { setMinOrderQty(e.target.value); setFieldErrors((p) => ({ ...p, minOrderQty: "" })); }}
            placeholder="1" style={{ ...inputStyle, borderColor: fieldErrors.minOrderQty ? "#DC2626" : "#CBD5E1" }} />
          {fieldErrors.minOrderQty && <p style={{ fontSize: 12, color: "#DC2626", margin: "4px 0 0" }}>{fieldErrors.minOrderQty}</p>}
        </div>
        <div>
          <label style={labelStyle}>{t("catalog.minOrderUnit")}</label>
          <select value={minOrderUomId} onChange={(e) => setMinOrderUomId(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="">{t("catalog.choose")}</option>
            {uomList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label style={labelStyle}>{t("catalog.stockStatus")}</label>
        <StockStatusSelect value={stockStatus} onChange={setStockStatus} />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", border: "1px solid #E2E8F0", borderRadius: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#1F1F1F" }}>{t("catalog.activeToAi")}</div>
        <Toggle on={isActive} onChange={() => setIsActive(!isActive)} />
      </div>
    </Modal>
  );
}

// ─── Variant Table ────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "#0A0A0A",
  verticalAlign: "middle",
};

function VariantsTable({
  product,
  uomList,
  onProductChange,
  searchTerm,
  isAdmin,
}: {
  product: Product;
  uomList: Uom[];
  onProductChange: (updated: Product) => void;
  searchTerm?: string;
  isAdmin: boolean;
}) {
  const t = useT();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | undefined>();
  const [deletingVariantId, setDeletingVariantId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const allVariants = [...(product.variants ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );
  const productNameMatches = searchTerm?.trim()
    ? product.name.toLowerCase().includes(searchTerm.toLowerCase())
    : false;
  const variants = searchTerm?.trim() && !productNameMatches
    ? allVariants.filter((v) => v.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : allVariants;

  function handleVariantSaved(variant: ProductVariant) {
    const existing = variants.find((v) => v.id === variant.id);
    const newVariants = existing
      ? variants.map((v) => (v.id === variant.id ? variant : v))
      : [...variants, variant];
    onProductChange({ ...product, variants: newVariants });
  }

  function handleDeleteVariant(id: string) {
    setDeletingVariantId(id);
  }

  function confirmDeleteVariant() {
    if (!deletingVariantId) return;
    const id = deletingVariantId;
    startTransition(async () => {
      try {
        await deleteVariantAction(id);
        onProductChange({ ...product, variants: variants.filter((v) => v.id !== id) });
      } catch (err) {
        console.error("[catalog] Delete variant failed:", err);
      } finally {
        setDeletingVariantId(null);
      }
    });
  }

  function handleToggleVariantActive(variant: ProductVariant) {
    startTransition(async () => {
      const res = await updateVariantAction(variant.id, { isActive: !variant.isActive });
      if (res.data) handleVariantSaved(res.data);
    });
  }

  return (
    <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, overflow: "hidden" }}>
      {variants.length === 0 ? (
        <div style={{ padding: "16px 20px", fontSize: 13, color: "#94A3B8" }}>{t("catalog.noVariants")}</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #E2E8F0" }}>
              <th style={{ ...thStyle, width: 40 }}>{t("catalog.col.photo")}</th>
              <th style={thStyle}>{t("catalog.col.variant")}</th>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>{t("catalog.col.price")}</th>
              <th style={thStyle} title={t("catalog.mpTitle")}>MP</th>
              <th style={thStyle}>{t("catalog.isiCtn")}</th>
              <th style={thStyle}>{t("catalog.isiBox")}</th>
              <th style={thStyle}>{t("catalog.col.status")}</th>
              {isAdmin && <th style={thStyle}>{t("catalog.active")}</th>}
              {isAdmin && <th style={thStyle}></th>}
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => {
              const uomPriceName = v.uomPrice?.name ?? uomList.find((u) => u.id === v.uomPriceId)?.name ?? null;
              const uomCtnName = v.uomCtn?.name ?? uomList.find((u) => u.id === v.uomCtnId)?.name ?? null;
              const priceDisplay = v.priceIdr != null
                ? `${formatPrice(v.priceIdr)}${uomPriceName ? ` / ${uomPriceName}` : ""}`
                : "—";
              // MP carries its own unit: a variant priced per Lusin still quotes MP per piece.
              const mpUomName = v.mpUom?.name ?? uomList.find((u) => u.id === v.mpUomId)?.name ?? null;
              const mpDisplay = v.mpPriceIdr != null
                ? `${formatPrice(v.mpPriceIdr)}${mpUomName ? ` / ${mpUomName}` : ""}`
                : null;
              const ctnDisplay = v.isiCtn != null
                ? `${v.isiCtn}${uomCtnName ? ` ${uomCtnName}` : ""}`
                : null;
              return (
              <tr key={v.id} style={{ borderBottom: "1px solid #F1F5F9", opacity: !v.isActive ? 0.65 : 1 }}>
                <td style={{ ...tdStyle, width: 40 }}>
                  {v.imageUrl && (
                    <img src={resolveImageUrl(v.imageUrl)!} alt={v.name} onClick={() => setPreviewImage(resolveImageUrl(v.imageUrl)!)} style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4, border: "1px solid #E2E8F0", cursor: "pointer" }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  )}
                </td>
                <td style={{ ...tdStyle, fontWeight: 500 }}>{v.name}</td>
                <td style={tdStyle}>
                  {v.sku ? (
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>{v.sku}</span>
                  ) : (
                    <span style={{ color: "#94A3B8" }}>—</span>
                  )}
                </td>
                <td style={tdStyle}>{priceDisplay}</td>
                <td style={tdStyle}>
                  {mpDisplay ?? <span style={{ color: "#94A3B8" }} title={t("catalog.askTeamTitle")}>{t("catalog.askTeam")}</span>}
                </td>
                <td style={tdStyle}>{ctnDisplay ?? <span style={{ color: "#94A3B8" }}>—</span>}</td>
                <td style={tdStyle}>{v.isiBox ?? <span style={{ color: "#94A3B8" }}>—</span>}</td>
                <td style={tdStyle}><StockBadge status={v.stockStatus} /></td>
                {isAdmin && (
                  <td style={tdStyle}>
                    <Toggle on={v.isActive} onChange={() => handleToggleVariantActive(v)} disabled={pending} />
                  </td>
                )}
                {isAdmin && (
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        style={iconBtnStyle}
                        title={t("catalog.variant.edit")}
                        onClick={() => setEditingVariant(v)}
                        disabled={pending}
                      >
                        <PencilIcon />
                      </button>
                      <button
                        style={{ ...iconBtnStyle, color: "#B91C1C" }}
                        title={t("catalog.variant.delete")}
                        onClick={() => handleDeleteVariant(v.id)}
                        disabled={pending}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {isAdmin && (
        <div style={{ padding: "10px 16px", borderTop: variants.length > 0 ? "1px solid #E2E8F0" : "none" }}>
          <button
            onClick={() => { setEditingVariant(undefined); setShowAddModal(true); }}
            style={{ background: "transparent", border: "none", color: "#445428", fontSize: 12, fontWeight: 500, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <PlusIcon size={12} /> {t("catalog.addVariant")}
          </button>
        </div>
      )}

      {(showAddModal || editingVariant) && (
        <VariantModal
          productId={product.id}
          uomList={uomList}
          editing={editingVariant}
          onClose={() => { setShowAddModal(false); setEditingVariant(undefined); }}
          onSaved={(v) => { handleVariantSaved(v); setShowAddModal(false); setEditingVariant(undefined); }}
        />
      )}

      {deletingVariantId && (
        <ConfirmDeleteModal
          title={t("catalog.variant.delete")}
          description={t("catalog.deleteVariantDesc", { name: variants.find(v => v.id === deletingVariantId)?.name ?? "" })}
          onConfirm={confirmDeleteVariant}
          onCancel={() => setDeletingVariantId(null)}
          pending={pending}
        />
      )}

      {/* Image lightbox */}
      {previewImage && <ImageLightbox src={previewImage} onClose={() => setPreviewImage(null)} />}
    </div>
  );
}

// ─── Product Row ──────────────────────────────────────────────────────────────

// The row labels double as lookup keys below, so they stay as identifiers; only what is shown is translated.
const KNOWLEDGE_ABBR: Record<string, TKey> = {
  Fungsi: "catalog.abbr.fungsi",
  Bahan: "catalog.abbr.bahan",
  Ketebalan: "catalog.abbr.ketebalan",
  Kelengkapan: "catalog.abbr.kelengkapan",
  Keunggulan: "catalog.abbr.usp",
  "Kata Kunci": "catalog.abbr.kataKunci",
};

const KNOWLEDGE_LABEL: Record<string, TKey> = {
  Fungsi: "catalog.fungsi",
  Bahan: "catalog.bahan",
  Ketebalan: "catalog.ketebalan",
  Kelengkapan: "catalog.kelengkapan",
  Keunggulan: "catalog.keunggulan",
  "Kata Kunci": "catalog.kataKunci",
};

/** "a, b, a" -> ["a", "b"], preserving order. Kata Kunci is a list, not prose. */
function splitKeywords(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== "" && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

/**
 * The real USP and Kelengkapan values are blank-line-separated bullet blobs. Rendering them with
 * `white-space: pre-line` preserved every one of those blank lines and made a six-field panel
 * scroll off the screen; splitting and dropping the blanks roughly halves the height.
 */
function KnowledgeValue({ value }: { value: string }) {
  const lines = value.split("\n").map((l) => l.trim()).filter(Boolean);
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? lines : lines.slice(0, 3);
  return (
    <div style={{ fontSize: 12, lineHeight: 1.4, color: "#475569" }}>
      {shown.map((line, i) => (
        <div key={i} style={{ marginBottom: lines.length > 1 ? 1 : 0 }}>
          {lines.length > 1 ? `• ${line}` : line}
        </div>
      ))}
      {lines.length > 3 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ marginTop: 2, padding: 0, border: "none", background: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#1D4ED8" }}
        >
          {expanded ? t("catalog.collapse") : t("catalog.moreLines", { n: lines.length - 3 })}
        </button>
      )}
    </div>
  );
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const t = useT();
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}
    >
      <img
        src={src}
        alt={t("catalog.preview")}
        style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 6, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        style={{ position: "absolute", top: 16, right: 16, width: 36, height: 36, borderRadius: 999, background: "rgba(255,255,255,0.15)", border: "none", color: "white", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        ✕
      </button>
    </div>
  );
}

function ProductRow({
  product,
  brands,
  uomList,
  categories,
  onProductChange,
  onProductDelete,
  searchTerm,
  isAdmin,
}: {
  product: Product;
  brands: Brand[];
  uomList: Uom[];
  categories: Category[];
  onProductChange: (updated: Product) => void;
  onProductDelete: (id: string) => void;
  searchTerm?: string;
  isAdmin: boolean;
}) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const t = useT();
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The photo the AI compares a customer's photo against (api/src/services/photoMatch.ts):
  // the product's own, else its first variant's. Shown on every product so a missing one is
  // visible without opening anything.
  const variantPhoto = (product.variants ?? []).find((v) => v.imageUrl)?.imageUrl ?? null;
  const referencePhoto = resolveImageUrl(product.imageUrl || variantPhoto);

  const brandName = product.brand?.name ?? brands.find((b) => b.id === product.brandId)?.name ?? product.brandId;
  const categoryName = product.category?.name ?? (product.categoryId ? categories.find((c) => c.id === product.categoryId)?.name : null);
  const knowledgeRows: [string, string | null | undefined][] = [
    ["Fungsi", product.fungsi],
    ["Bahan", product.bahan],
    ["Ketebalan", product.ketebalan],
    ["Kelengkapan", product.kelengkapan],
    ["Keunggulan", product.usp],
    ["Kata Kunci", product.kataKunci],
  ];
  const hasKnowledge = knowledgeRows.some(([, v]) => v);
  const filledCount = knowledgeRows.filter(([, v]) => (v ?? "").trim()).length;

  function handleDelete() {
    setShowDeleteConfirm(true);
  }

  function confirmDelete() {
    startTransition(async () => {
      try {
        await deleteProductAction(product.id);
        onProductDelete(product.id);
      } catch (err) {
        console.error("[catalog] Delete product failed:", err);
      } finally {
        setShowDeleteConfirm(false);
      }
    });
  }

  return (
    <div style={{ border: "1px solid #E2E8F0", borderRadius: 6, overflow: "hidden", background: "white" }}>
      {showDeleteConfirm && (
        <ConfirmDeleteModal
          title={t("catalog.product.delete")}
          description={t("catalog.deleteProductDesc", { name: product.name, count: (product.variants ?? []).length })}
          onConfirm={confirmDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          pending={pending}
        />
      )}
      {/* Product row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
        }}
      >
        {/* Product photo */}
        {referencePhoto ? (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <img
              src={referencePhoto}
              alt={product.name}
              title={product.imageUrl ? t("catalog.photoTitle") : t("catalog.photoFromVariantTitle")}
              onClick={() => setPreviewImage(referencePhoto)}
              style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 4, border: "1px solid #E2E8F0", cursor: "zoom-in", display: "block" }}
            />
            {!product.imageUrl && (
              <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(15,23,42,0.65)", color: "white", fontSize: 9, textAlign: "center", borderRadius: "0 0 4px 4px" }}>{t("catalog.photoFromVariantBadge")}</span>
            )}
          </div>
        ) : (
          <div
            title={t("catalog.noPhotoTitle")}
            style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 4, border: "1px dashed #CBD5E1", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 9, lineHeight: 1.2, color: "#94A3B8" }}
          >
            {t("catalog.noPhoto")}
          </div>
        )}
        {previewImage && <ImageLightbox src={previewImage} onClose={() => setPreviewImage(null)} />}

        {/* Product info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#0A0A0A" }}>{product.name}</span>
            <span
              style={{
                display: "inline-block",
                padding: "1px 7px",
                background: "#F1F5F9",
                color: "#334155",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {brandName}
            </span>
            {categoryName && (
              <span
                style={{
                  display: "inline-block",
                  padding: "1px 7px",
                  background: "#EFF6FF",
                  color: "#1D4ED8",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                {categoryName}
              </span>
            )}
            {product.tier === "economic" && (
              <span style={{ display: "inline-block", padding: "1px 7px", background: "#F1F5F9", color: "#64748B", borderRadius: 4, fontSize: 11, fontWeight: 500 }}>{t("catalog.tier.economic")}</span>
            )}
            {product.tier === "mid" && (
              <span style={{ display: "inline-block", padding: "1px 7px", background: "#EFF6FF", color: "#1D4ED8", borderRadius: 4, fontSize: 11, fontWeight: 500 }}>{t("catalog.tier.mid")}</span>
            )}
            {product.tier === "premium" && (
              <span style={{ display: "inline-block", padding: "1px 7px", background: "#FEF3C7", color: "#B45309", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>★ {t("catalog.tier.premium")}</span>
            )}
          </div>
          {product.description && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748B", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {product.description}
            </p>
          )}
          {/* Coverage at a glance: which of the six AI fields are filled, without expanding.
              The team is working through the blanks right now, and the old UI made a gap
              invisible until you opened the panel on every single product. */}
          <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            <button
              onClick={() => setShowKnowledge((v) => !v)}
              style={{ padding: 0, border: "none", background: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#1D4ED8", display: "inline-flex", alignItems: "center", gap: 3, marginRight: 2 }}
            >
              <ChevronIcon open={showKnowledge} /> {t("catalog.knowledgeCount", { n: filledCount })}
            </button>
            {knowledgeRows.map(([label, value]) => {
              const on = Boolean((value ?? "").trim());
              return (
                <span
                  key={label}
                  title={on ? t("catalog.filled", { label: t(KNOWLEDGE_LABEL[label]) }) : t("catalog.empty", { label: t(KNOWLEDGE_LABEL[label]) })}
                  style={{
                    padding: "0 6px", borderRadius: 3, fontSize: 10, lineHeight: "16px", fontWeight: 600,
                    background: on ? "#EFF6FF" : "transparent",
                    color: on ? "#1D4ED8" : "#CBD5E1",
                    border: on ? "1px solid #DBEAFE" : "1px dashed #E2E8F0",
                  }}
                >
                  {KNOWLEDGE_ABBR[label] ? t(KNOWLEDGE_ABBR[label]) : label}
                </span>
              );
            })}
          </div>
          {showKnowledge && (
            hasKnowledge ? (
              <div
                style={{
                  marginTop: 6, padding: "8px 10px", background: "#F8FAFC", border: "1px solid #E2E8F0",
                  borderRadius: 6, display: "grid", gap: 8,
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                }}
              >
                {knowledgeRows.filter(([, v]) => (v ?? "").trim()).map(([label, value]) => (
                  <div key={label} style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#94A3B8", marginBottom: 2 }}>
                      {KNOWLEDGE_LABEL[label] ? t(KNOWLEDGE_LABEL[label]) : label}
                    </div>
                    {label === "Kata Kunci" ? (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {splitKeywords(value!).map((kw) => (
                          <span key={kw} style={{ padding: "0 6px", background: "#F1F5F9", color: "#475569", borderRadius: 3, fontSize: 11, lineHeight: "18px" }}>
                            {kw}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <KnowledgeValue value={value!} />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 6, padding: "8px 10px", background: "#F8FAFC", border: "1px dashed #E2E8F0", borderRadius: 6, fontSize: 12, color: "#94A3B8" }}>
                {t("catalog.noKnowledge")}
              </div>
            )
          )}
        </div>

        {/* Edit / Delete — admin only */}
        {isAdmin && (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button
              style={iconBtnStyle}
              title={t("catalog.product.edit")}
              onClick={() => setShowEditModal(true)}
              disabled={pending}
            >
              <PencilIcon />
            </button>
            <button
              style={{ ...iconBtnStyle, color: "#B91C1C" }}
              title={t("catalog.product.delete")}
              onClick={handleDelete}
              disabled={pending}
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </div>

      {/* Inline variants — always visible */}
      <div style={{ borderTop: "1px solid #E2E8F0", padding: "12px 16px" }}>
        <VariantsTable
          product={product}
          uomList={uomList}
          onProductChange={onProductChange}
          searchTerm={searchTerm}
          isAdmin={isAdmin}
        />
      </div>

      {showEditModal && (
        <ProductModal
          brands={brands}
          uomList={uomList}
          categories={categories}
          editing={product}
          onClose={() => setShowEditModal(false)}
          onSaved={(updated) => {
            onProductChange(updated);
            setShowEditModal(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Main Catalog Client ──────────────────────────────────────────────────────

interface Props {
  brands: Brand[];
  products: Product[];
  uomList: Uom[];
  categoryList: Category[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  currentPage: number;
  currentLimit: number;
  currentBrandId: string;
  currentSearch: string;
  currentStatus: string;
  currentCategoryId: string;
  isAdmin: boolean;
}

const PAGE_LIMIT_OPTIONS = [10, 25, 50, 100, 0] as const; // 0 = semua

export function CatalogClient({
  brands,
  products: initialProducts,
  uomList,
  categoryList,
  meta,
  currentPage,
  currentLimit,
  currentBrandId,
  currentSearch,
  currentStatus,
  currentCategoryId,
  isAdmin,
}: Props) {
  const t = useT();
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [showAddModal, setShowAddModal] = useState(false);

  // Keep local product list in sync when server re-fetches (props change on navigation)
  useEffect(() => {
    setProducts(initialProducts);
  }, [initialProducts]);

  // Build a URL for a given set of filter/page overrides
  function buildUrl(overrides: {
    page?: number;
    limit?: number;
    brandId?: string;
    search?: string;
    status?: string;
    categoryId?: string;
  }) {
    const p = overrides.page ?? currentPage;
    const l = overrides.limit ?? currentLimit;
    const b = overrides.brandId ?? currentBrandId;
    const s = overrides.search ?? currentSearch;
    const st = overrides.status !== undefined ? overrides.status : currentStatus;
    const c = overrides.categoryId !== undefined ? overrides.categoryId : currentCategoryId;
    const qs = new URLSearchParams();
    qs.set("page", String(p));
    qs.set("limit", String(l));
    if (b && b !== "all") qs.set("brandId", b);
    if (s) qs.set("search", s);
    if (st) qs.set("status", st);
    if (c) qs.set("categoryId", c);
    return `/catalog?${qs.toString()}`;
  }

  // Debounced search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchInput, setSearchInput] = useState(currentSearch);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        router.push(buildUrl({ page: 1, search: value }));
      }, 400);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentPage, currentLimit, currentBrandId, currentStatus]
  );

  // Sync search input when URL changes (e.g. user uses back button)
  useEffect(() => {
    setSearchInput(currentSearch);
  }, [currentSearch]);

  // Mutation callbacks — after add/edit/delete, refresh the current page from server
  function handleProductChange(updated: Product) {
    setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  function handleProductDelete(id: string) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    // If we just deleted the last item on a non-first page, go back one page
    if (products.length === 1 && currentPage > 1) {
      router.push(buildUrl({ page: currentPage - 1 }));
    } else {
      router.refresh();
    }
  }

  function handleProductAdded(product: Product) {
    // After adding, refresh page 1 so new product appears
    setProducts((prev) => [product, ...prev]);
    router.push(buildUrl({ page: 1 }));
  }

  const totalPages = meta.totalPages;
  const total = meta.total;
  const limit = currentLimit;

  const pageNums: number[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pageNums.push(i);
  } else {
    pageNums.push(1);
    if (currentPage > 3) pageNums.push(-1); // ellipsis
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pageNums.push(i);
    if (currentPage < totalPages - 2) pageNums.push(-2); // ellipsis
    pageNums.push(totalPages);
  }

  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<CatalogImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE_PATH}/api/catalog-import`, { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok || body.error) setImportError(body.error ?? `HTTP ${res.status}`);
      else {
        setImportResult(body.data as CatalogImportResult);
        router.refresh();
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      e.target.value = ""; // so re-uploading the same file fires onChange again
    }
  }

  // Bulk catalog photos: a folder's worth of files named after the product or variant code. Sent in
  // small batches - hundreds of phone photos in one request would pass the tunnel's body limit.
  const photosRef = useRef<HTMLInputElement>(null);
  const [photoProgress, setPhotoProgress] = useState<{ done: number; total: number } | null>(null);
  const [photoResults, setPhotoResults] = useState<CatalogImageResult[] | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function handlePhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setPhotoResults(null);
    setPhotoError(null);
    setPhotoProgress({ done: 0, total: files.length });
    const all: CatalogImageResult[] = [];
    try {
      for (let i = 0; i < files.length; i += PHOTO_BATCH) {
        const batch = files.slice(i, i + PHOTO_BATCH);
        const form = new FormData();
        for (const f of batch) form.append("files", f, f.name);
        const res = await fetch(`${BASE_PATH}/api/catalog-images`, { method: "POST", body: form });
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        if (!res.ok || body.error) {
          setPhotoError(t("catalog.photoErrorAfter", { error: body.error ?? `HTTP ${res.status}`, done: i, total: files.length }));
          break;
        }
        all.push(...(body.data.results as CatalogImageResult[]));
        setPhotoProgress({ done: Math.min(i + PHOTO_BATCH, files.length), total: files.length });
      }
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhotoResults(all);
      setPhotoProgress(null);
      router.refresh();
    }
  }

  const navBtnStyle = (active?: boolean, disabled?: boolean): React.CSSProperties => ({
    height: 32, minWidth: 32, padding: "0 10px",
    fontSize: 13, fontWeight: active ? 700 : 400,
    borderRadius: 4, border: "1px solid",
    borderColor: active ? "#586B34" : "#E2E8F0",
    background: active ? "#EAF2DD" : "white",
    color: active ? "#3E4C24" : disabled ? "#CBD5E1" : "#1F1F1F",
    cursor: disabled ? "not-allowed" : "pointer",
  });

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: 32 }}>
      {/* Heading row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0A0A0A" }}>{t("catalog.title")}</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Always the whole catalog, not the filtered view. Plain anchor - the browser
              downloads it; no blob, no client fetch. */}
          <a
            href={`${BASE_PATH}/api/catalog-export`}
            download
            style={{ ...btnSecondaryStyle, display: "flex", alignItems: "center", textDecoration: "none" }}
          >
            {t("catalog.exportExcel")}
          </a>
          {isAdmin && (
            <>
              <input
                ref={importRef}
                type="file"
                accept=".xlsx"
                onChange={handleImport}
                style={{ display: "none" }}
              />
              <button
                onClick={() => importRef.current?.click()}
                disabled={importing}
                title={t("catalog.importTitle")}
                style={{ ...btnSecondaryStyle, display: "flex", alignItems: "center", cursor: importing ? "wait" : "pointer" }}
              >
                {importing ? t("catalog.importing") : t("catalog.importExcel")}
              </button>
              <input
                ref={photosRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handlePhotos}
                style={{ display: "none" }}
              />
              <button
                onClick={() => photosRef.current?.click()}
                disabled={photoProgress !== null}
                title={t("catalog.uploadPhotosTitle")}
                style={{ ...btnSecondaryStyle, display: "flex", alignItems: "center", cursor: photoProgress ? "wait" : "pointer" }}
              >
                {photoProgress ? t("catalog.uploadingPhotos", { done: photoProgress.done, total: photoProgress.total }) : t("catalog.uploadPhotos")}
              </button>
            </>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowAddModal(true)}
              style={{ height: 36, padding: "0 14px", background: "#586B34", color: "white", border: "none", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
            >
              <PlusIcon /> {t("catalog.addProduct")}
            </button>
          )}
        </div>
      </div>

      {(importResult || importError) && (
        <div
          style={{
            marginBottom: 16, padding: "10px 12px", borderRadius: 6, fontSize: 13,
            border: `1px solid ${importError ? "#FECACA" : "#BBF7D0"}`,
            background: importError ? "#FEF2F2" : "#F0FDF4",
            color: importError ? "#991B1B" : "#166534",
          }}
        >
          {importError ? (
            <span>{t("catalog.importFailed", { error: importError })}</span>
          ) : importResult ? (
            <>
              <div style={{ fontWeight: 600 }}>
                {t("catalog.importSummary", {
                  pc: importResult.productsCreated,
                  pu: importResult.productsUpdated,
                  vc: importResult.variantsCreated,
                  vu: importResult.variantsUpdated,
                })}
                {importResult.lookupsCreated > 0 && t("catalog.importLookups", { n: importResult.lookupsCreated })}.
              </div>
              <div style={{ marginTop: 2, color: "#3F6212" }}>
                {t("catalog.importUntouched", { n: importResult.untouched })}
              </div>
              {importResult.errors.length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#92400E" }}>
                  {importResult.errors.map((err, i) => (
                    <li key={i}>{err.row > 0 ? t("catalog.importRow", { row: err.row }) : ""}{err.reason}</li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
          <button
            onClick={() => { setImportResult(null); setImportError(null); }}
            style={{ marginTop: 6, padding: 0, border: "none", background: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "inherit", textDecoration: "underline" }}
          >
            {t("catalog.close")}
          </button>
        </div>
      )}

      {(photoResults || photoError) && (() => {
        const matched = photoResults?.filter((r) => r.status === "matched") ?? [];
        const notMatched = photoResults?.filter((r) => r.status !== "matched") ?? [];
        const products = matched.filter((r) => r.status === "matched" && r.target.kind === "product").length;
        return (
          <div
            style={{
              marginBottom: 16, padding: "10px 12px", borderRadius: 6, fontSize: 13,
              border: `1px solid ${photoError || notMatched.length ? "#FDE68A" : "#BBF7D0"}`,
              background: photoError || notMatched.length ? "#FFFBEB" : "#F0FDF4",
              color: "#1F2937",
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {t("catalog.photoSummary", { matched: matched.length, products, variants: matched.length - products })}
              {notMatched.length > 0 && t("catalog.photoNotAttached", { n: notMatched.length })}.
            </div>
            {photoError && <div style={{ marginTop: 2, color: "#991B1B" }}>{t("catalog.photoStopped", { error: photoError })}</div>}
            {notMatched.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#92400E" }}>
                {notMatched.map((r, i) => (
                  <li key={i}>
                    {r.file}:{" "}
                    {r.status === "unmatched" ? t("catalog.photoUnmatched")
                      : r.status === "ambiguous" ? t("catalog.photoAmbiguous", { options: r.options.join("; ") })
                      : r.status === "rejected" ? r.reason : ""}
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => { setPhotoResults(null); setPhotoError(null); }}
              style={{ marginTop: 6, padding: 0, border: "none", background: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "inherit", textDecoration: "underline" }}
            >
              {t("catalog.close")}
            </button>
          </div>
        );
      })()}

      {/* Filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {/* Brand filter */}
        <select
          value={currentBrandId}
          onChange={(e) => router.push(buildUrl({ page: 1, brandId: e.target.value }))}
          style={{ height: 36, padding: "0 10px", fontSize: 13, color: "#0A0A0A", background: "white", border: "1px solid #CBD5E1", borderRadius: 4, outline: "none", width: 180, cursor: "pointer" }}
        >
          <option value="all">{t("catalog.allBrands")}</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>

        {/* Category filter */}
        <select
          value={currentCategoryId}
          onChange={(e) => router.push(buildUrl({ page: 1, categoryId: e.target.value }))}
          style={{ height: 36, padding: "0 10px", fontSize: 13, color: "#0A0A0A", background: "white", border: "1px solid #CBD5E1", borderRadius: 4, outline: "none", width: 180, cursor: "pointer" }}
        >
          <option value="">{t("catalog.allCategories")}</option>
          {categoryList.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={currentStatus}
          onChange={(e) => router.push(buildUrl({ page: 1, status: e.target.value }))}
          style={{ height: 36, padding: "0 10px", fontSize: 13, color: "#0A0A0A", background: "white", border: "1px solid #CBD5E1", borderRadius: 4, outline: "none", width: 160, cursor: "pointer" }}
        >
          <option value="">{t("catalog.allStatuses")}</option>
          <option value="normal">{t("catalog.stock.normal")}</option>
          <option value="no_stock">{t("catalog.stock.noStock")}</option>
          <option value="price_rise">{t("catalog.stock.priceRise")}</option>
          <option value="price_drop">{t("catalog.stock.priceDrop")}</option>
        </select>

        {/* Search */}
        <input
          type="text"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t("catalog.searchPh")}
          style={{ height: 36, padding: "0 10px", fontSize: 13, color: "#0A0A0A", background: "white", border: "1px solid #CBD5E1", borderRadius: 4, outline: "none", width: 200, boxSizing: "border-box" }}
        />

        <div style={{ flex: 1 }} />

        {/* Limit changer */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#64748B" }}>{t("catalog.show")}</span>
          <select
            value={limit}
            onChange={(e) => router.push(buildUrl({ page: 1, limit: Number(e.target.value) }))}
            style={{ height: 32, padding: "0 8px", fontSize: 13, color: "#0A0A0A", background: "white", border: "1px solid #CBD5E1", borderRadius: 4, outline: "none", cursor: "pointer" }}
          >
            {PAGE_LIMIT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt === 0 ? t("catalog.all") : opt}</option>
            ))}
          </select>
        </div>

        <span style={{ fontSize: 12, color: "#94A3B8" }}>
          {t("catalog.productCount", { n: total })}
        </span>
      </div>

      {/* Product list */}
      {products.length === 0 ? (
        <div style={{ padding: "48px 24px", textAlign: "center", color: "#64748B", fontSize: 14, background: "white", border: "1px solid #E2E8F0", borderRadius: 6 }}>
          {t("catalog.noProducts")}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {products.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                brands={brands}
                uomList={uomList}
                categories={categoryList}
                onProductChange={handleProductChange}
                onProductDelete={handleProductDelete}
                searchTerm={currentSearch}
                isAdmin={isAdmin}
              />
            ))}
          </div>

          {/* Pagination */}
          {limit !== 0 && totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 20 }}>
              <span style={{ fontSize: 12, color: "#64748B" }}>
                {t("catalog.showing", { from: (currentPage - 1) * limit + 1, to: Math.min(currentPage * limit, total), total })}
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => router.push(buildUrl({ page: 1 }))}
                  disabled={currentPage === 1}
                  style={navBtnStyle(false, currentPage === 1)}
                >«</button>
                <button
                  onClick={() => router.push(buildUrl({ page: Math.max(1, currentPage - 1) }))}
                  disabled={currentPage === 1}
                  style={navBtnStyle(false, currentPage === 1)}
                >‹</button>
                {pageNums.map((n, i) =>
                  n < 0 ? (
                    <span key={`ellipsis-${i}`} style={{ height: 32, padding: "0 4px", display: "flex", alignItems: "center", color: "#94A3B8" }}>…</span>
                  ) : (
                    <button key={n} onClick={() => router.push(buildUrl({ page: n }))} style={navBtnStyle(n === currentPage)}>{n}</button>
                  )
                )}
                <button
                  onClick={() => router.push(buildUrl({ page: Math.min(totalPages, currentPage + 1) }))}
                  disabled={currentPage === totalPages}
                  style={navBtnStyle(false, currentPage === totalPages)}
                >›</button>
                <button
                  onClick={() => router.push(buildUrl({ page: totalPages }))}
                  disabled={currentPage === totalPages}
                  style={navBtnStyle(false, currentPage === totalPages)}
                >»</button>
              </div>
            </div>
          )}
        </>
      )}

      {showAddModal && (
        <ProductModal
          brands={brands}
          uomList={uomList}
          categories={categoryList}
          onClose={() => setShowAddModal(false)}
          onSaved={(product) => {
            handleProductAdded(product);
            setShowAddModal(false);
          }}
        />
      )}
    </main>
  );
}
