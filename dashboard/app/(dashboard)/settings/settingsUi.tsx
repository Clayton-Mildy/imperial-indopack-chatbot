import type { CSSProperties, ReactNode } from "react";

// Pengaturan's shared look (Settings.dc.html): section cards, field labels, inputs, the Simpan button
// and the result line under it. Presentational only - no hooks - so server and client parts share it.

export const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: "#3B4540" };
export const hintStyle: CSSProperties = { fontSize: 11.5, color: "#5F6B5A", lineHeight: 1.5 };
/** Amber, for "still temporary / still the example" - not an error. */
export const warnHintStyle: CSSProperties = { ...hintStyle, color: "#92400E" };

export const inputStyle: CSSProperties = {
  font: "inherit",
  fontSize: 13.5,
  height: 38,
  padding: "0 12px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#ffffff",
  color: "#1F2421",
  boxSizing: "border-box",
  minWidth: 0,
};

/** The short number boxes inside a sentence ("setelah [3] bulan"). */
export const numberInputStyle: CSSProperties = { ...inputStyle, height: 36, width: 72, padding: "0 10px" };

export const sentenceRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13.5 };

export function primaryButtonStyle(busy: boolean): CSSProperties {
  return {
    font: "inherit",
    fontSize: 13,
    fontWeight: 600,
    height: 36,
    padding: "0 16px",
    border: 0,
    borderRadius: 6,
    background: busy ? "#6C9442" : "#586B34",
    color: "#ffffff",
    cursor: busy ? "default" : "pointer",
    flexShrink: 0,
  };
}

export function SettingsSection({ id, title, action, children, gap = 16 }: { id: string; title: string; action?: ReactNode; children: ReactNode; gap?: number }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      style={{ background: "#ffffff", border: "1px solid #E1E7DC", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap, scrollMarginTop: 16 }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h2 id={`${id}-title`} style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1F2421" }}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The line under a Simpan button: green when saved, red for an error. */
export function SaveStatus({ status }: { status: { ok: boolean; text: string } | null }) {
  if (!status) return null;
  return (
    <span role="status" style={{ fontSize: 12, color: status.ok ? "#15803D" : "#B91C1C" }}>
      {status.text}
    </span>
  );
}
