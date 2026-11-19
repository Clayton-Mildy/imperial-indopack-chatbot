"use client";

import { useEffect, useState } from "react";
import { deleteProductAction, setProductActiveAction } from "@/actions/catalogActions";
import { useT } from "@/lib/i18n/LangProvider";
import type { CatalogProduct } from "@/types/api";

const footerBtn: React.CSSProperties = {
  font: "inherit",
  fontSize: 13,
  fontWeight: 500,
  height: 36,
  padding: "0 16px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#ffffff",
  color: "#1F2421",
  cursor: "pointer",
};

/**
 * Hapus produk: "Hapus permanen" stays disabled until the ack box is ticked; "Nonaktifkan saja"
 * switches the bot's offer off instead and closes. Both server actions revalidate /catalog. With
 * `onDone`, a finished delete or deactivation is reported there instead of closing (the edit page
 * leaves for the catalog after a delete).
 */
export function DeleteProductDialog({
  product,
  onClose,
  onDone,
}: {
  product: CatalogProduct;
  onClose: () => void;
  onDone?: (kind: "delete" | "deactivate") => void;
}) {
  const t = useT();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<"delete" | "deactivate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tiers = product.sizes.reduce((n, s) => n + s.tiers.length, 0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && busy === null) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function run(kind: "delete" | "deactivate") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const res = kind === "delete" ? await deleteProductAction(product.id) : await setProductActiveAction(product.id, false);
      if (res.ok) return onDone ? onDone(kind) : onClose();
      setError(res.error ?? t("catalog.err.saveFailed"));
    } catch {
      setError(t("common.err.network"));
    }
    setBusy(null);
  }

  const canDelete = ack && busy === null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(31, 36, 33, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && busy === null) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dp-title"
        aria-describedby="dp-desc"
        style={{
          width: "100%",
          maxWidth: 520,
          background: "#ffffff",
          borderRadius: 12,
          boxShadow: "0 12px 32px rgba(31, 36, 33, 0.18)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: "#1F2421",
        }}
      >
        <div style={{ padding: "20px 22px 0", display: "flex", gap: 14, alignItems: "flex-start" }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "#FEE2E2",
              color: "#B91C1C",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
            </svg>
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <span id="dp-title" style={{ fontSize: 16, fontWeight: 700, overflowWrap: "anywhere" }}>
              {t("catalog.delete.title", { name: product.name })}
            </span>
            <span id="dp-desc" style={{ fontSize: 13, color: "#3B4540", lineHeight: 1.55 }}>
              {t("catalog.delete.desc", { sizes: product.sizes.length, tiers })}
            </span>
          </div>
        </div>

        <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ padding: "12px 14px", borderRadius: 8, background: "#F5F8F2", fontSize: 12.5, color: "#3B4540", lineHeight: 1.5 }}>
            {t("catalog.delete.pausePre")}{" "}
            <button
              type="button"
              onClick={() => run("deactivate")}
              disabled={busy !== null}
              style={{
                font: "inherit",
                fontWeight: 600,
                padding: 0,
                border: 0,
                background: "none",
                color: "#445428",
                textDecoration: "underline",
                cursor: busy !== null ? "not-allowed" : "pointer",
              }}
            >
              {t("catalog.delete.deactivate")}
            </button>
            {t("catalog.delete.pausePost")}
          </div>
          <label htmlFor="dp-ack" style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, lineHeight: 1.5, cursor: "pointer" }}>
            <input
              id="dp-ack"
              type="checkbox"
              checked={ack}
              disabled={busy !== null}
              onChange={(e) => setAck(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              {t("catalog.delete.ackPre")}
              <b>{t("catalog.delete.ackStrong")}</b>
              {t("catalog.delete.ackPost")}
            </span>
          </label>
          {error && (
            <span role="alert" style={{ fontSize: 12.5, color: "#B91C1C" }}>
              {error}
            </span>
          )}
        </div>

        <div style={{ marginTop: "auto", padding: "14px 22px", borderTop: "1px solid #EEF2EA", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            style={{ ...footerBtn, cursor: busy !== null ? "not-allowed" : "pointer" }}
          >
            {t("catalog.delete.cancel")}
          </button>
          <button
            type="button"
            onClick={() => run("delete")}
            disabled={!canDelete}
            style={{
              ...footerBtn,
              fontWeight: 600,
              border: 0,
              background: canDelete ? "#B91C1C" : "#E8B4B4",
              color: "#ffffff",
              cursor: canDelete ? "pointer" : "not-allowed",
            }}
          >
            {busy === "delete" ? t("catalog.delete.deleting") : t("catalog.delete.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
