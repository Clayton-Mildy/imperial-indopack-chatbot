"use client";

import { useEffect, useRef, useState } from "react";
import { saveTeamNotesAction } from "@/actions/conversationActions";
import { BrandTags } from "@/components/BrandTag";
import { nearestPriceLine, stampTime } from "@/lib/conversations/labels";
import { apiFileUrl } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import type { TKey } from "@/lib/i18n/core";
import { sizeText } from "@/lib/leads/items";
import type { OrderDetailKey, OrderPanel as OrderPanelData, TeamNotes } from "@/types/api";

// "Hot"/"Cold" stay in English, as on the leads screens: the sales team uses the words as-is.
const TEMPERATURE_BADGE: Record<string, { label: string; background: string; color: string }> = {
  hot: { label: "Hot", background: "#FBE3DA", color: "#9A2E12" },
  cold: { label: "Cold", background: "#E2EAF2", color: "#2F4A66" },
};

const ROW_KEY: Record<OrderDetailKey, TKey> = {
  name: "conversations.panel.row.name",
  business_name: "conversations.panel.row.business_name",
  model: "conversations.panel.row.model",
  size: "conversations.panel.row.size",
  qty: "conversations.panel.row.qty",
  design: "conversations.panel.row.design",
};

const NOTES_MAX = 2000;

const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#5F6B5A" };
const smallTag: React.CSSProperties = { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 9999 };

/**
 * The right column of Percakapan: which of the six order details the bot has, the customer's files,
 * the nearest catalog item per sized item, and the team's own notes (saved when the box loses focus).
 */
export function OrderPanel({ conversationId, panel }: { conversationId: string; panel: OrderPanelData | null }) {
  const t = useT();
  const lang = useLang();
  const now = new Date();

  return (
    <section
      aria-label={t("conversations.panel.title")}
      style={{
        flex: "0 0 300px",
        minWidth: 0,
        background: "#ffffff",
        borderLeft: "1px solid #E1E7DC",
        padding: 16,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        fontSize: 13,
        overflowY: "auto",
        color: "#1F2421",
      }}
    >
      {!panel ? (
        <>
          <b style={{ fontSize: 14 }}>{t("conversations.panel.title")}</b>
          <span style={{ fontSize: 12.5, color: "#B91C1C" }}>{t("conversations.panel.loadFailed")}</span>
        </>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <b style={{ fontSize: 14 }}>{t("conversations.panel.title")}</b>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: panel.detailsFilled >= 6 ? "#15803D" : "#92400E" }}>
              {t("conversations.panel.filled", { n: panel.detailsFilled })}
            </span>
          </div>

          {(panel.brands.length > 0 || panel.lead) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              <BrandTags brands={panel.brands} />
              {panel.lead?.temperature && TEMPERATURE_BADGE[panel.lead.temperature] && (
                <span
                  style={{
                    ...smallTag,
                    background: TEMPERATURE_BADGE[panel.lead.temperature].background,
                    color: TEMPERATURE_BADGE[panel.lead.temperature].color,
                  }}
                >
                  {TEMPERATURE_BADGE[panel.lead.temperature].label}
                </span>
              )}
              {panel.lead && (
                <span style={{ ...smallTag, borderRadius: 4, background: "#F1F5F1", color: "#3B4540" }}>
                  {t(`leads.status.${panel.lead.status}` as TKey)}
                </span>
              )}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {panel.details.map((row) => (
              <div key={row.key} style={{ display: "grid", gridTemplateColumns: "18px 70px 1fr", gap: 6, alignItems: "baseline" }}>
                <span
                  aria-label={t(row.filled ? "conversations.panel.filledMark" : "conversations.panel.emptyMark")}
                  style={{ color: row.filled ? "#15803D" : "#8A968A" }}
                >
                  {row.filled ? "✓" : "○"}
                </span>
                <span style={{ color: "#5F6B5A" }}>{t(ROW_KEY[row.key])}</span>
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  {row.value ? (row.key === "size" ? sizeText(row.value) : row.value) : <span style={{ color: "#8A968A" }}>—</span>}
                  {row.note?.kind === "out_of_catalog" && (
                    <>
                      {" "}
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#FEF3C7", color: "#92400E", whiteSpace: "nowrap" }}>
                        {t("conversations.panel.outOfCatalog")}
                      </span>
                    </>
                  )}
                  {row.note?.kind === "file_sent" && (
                    <span style={{ color: "#5F6B5A" }}> {t("conversations.panel.fileSent", { time: stampTime(row.note.at, now, lang) })}</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={sectionTitle}>{t("conversations.panel.files")}</span>
            {panel.files.length === 0 ? (
              <span style={{ fontSize: 12, color: "#8A968A" }}>{t("conversations.panel.noFiles")}</span>
            ) : (
              panel.files.map((f) => (
                <div key={f.messageId} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  {f.kind === "image" && f.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={apiFileUrl(f.url)}
                      alt={f.filename}
                      style={{ width: 72, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid #E2D3B2", flexShrink: 0 }}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      style={{ width: 72, height: 56, borderRadius: 6, border: "1px solid #E1E7DC", background: "#F8FAF6", display: "flex", alignItems: "center", justifyContent: "center", color: "#5F6B5A", flexShrink: 0 }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: "#3B4540", lineHeight: 1.5, minWidth: 0, overflowWrap: "anywhere" }}>
                    {f.filename || "—"}
                    <br />
                    <span style={{ color: "#5F6B5A" }}>{stampTime(f.at, now, lang)}</span>
                    {f.url && (
                      <>
                        {" · "}
                        <a href={apiFileUrl(f.url)} target="_blank" rel="noopener noreferrer" download={f.filename || undefined}>
                          {t("conversations.panel.download")}
                        </a>
                      </>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 8, background: "#F8FAF6" }}>
            <span style={sectionTitle}>{t("conversations.panel.nearest")}</span>
            {panel.nearest.length === 0 ? (
              <span style={{ fontSize: 12, color: "#8A968A" }}>{t("conversations.panel.noNearest")}</span>
            ) : (
              panel.nearest.map((m, i) => {
                const price = nearestPriceLine(m, lang);
                return (
                  <div key={`${m.productId}-${m.variantName}-${i}`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>
                      {m.productName} · {sizeText(m.variantName)}
                    </span>
                    {(price || !m.exact) && (
                      <span style={{ fontSize: 12, color: "#5F6B5A" }}>
                        {[price ? `${price}.` : null, m.exact ? null : t("conversations.panel.notExact")].filter(Boolean).join(" ")}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <TeamNotesBox key={conversationId} conversationId={conversationId} notes={panel.teamNotes} />
        </>
      )}
    </section>
  );
}

function TeamNotesBox({ conversationId, notes }: { conversationId: string; notes: TeamNotes }) {
  const t = useT();
  const lang = useLang();
  const [text, setText] = useState(notes.text);
  const [saved, setSaved] = useState<TeamNotes>(notes);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const focused = useRef(false);
  const savingRef = useRef(false);

  // The page refreshes every few seconds: take another staff member's notes only while this box is
  // not being edited and holds nothing unsaved.
  useEffect(() => {
    if (focused.current || savingRef.current || text !== saved.text) return;
    setText(notes.text);
    setSaved(notes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.text, notes.updatedAt, notes.updatedBy]);

  async function save() {
    focused.current = false;
    if (savingRef.current || text === saved.text) return;
    savingRef.current = true;
    setSaving(true);
    setFailed(false);
    const res = await saveTeamNotesAction(conversationId, text).catch(() => ({ ok: false as const }));
    savingRef.current = false;
    setSaving(false);
    if (res.ok) setSaved(res.notes);
    else setFailed(true);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor="cv-team-notes" style={sectionTitle}>
        {t("conversations.panel.notes")}
      </label>
      <textarea
        id="cv-team-notes"
        rows={3}
        value={text}
        maxLength={NOTES_MAX}
        placeholder={t("conversations.panel.notesPlaceholder")}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          setText(e.target.value);
          setFailed(false);
        }}
        onBlur={save}
        style={{ font: "inherit", fontSize: 12.5, padding: "8px 10px", border: "1px solid #D5DECF", borderRadius: 6, resize: "vertical", color: "#1F2421" }}
      />
      <span aria-live="polite" style={{ fontSize: 11.5, color: failed ? "#B91C1C" : "#5F6B5A" }}>
        {saving
          ? t("conversations.panel.notesSaving")
          : failed
            ? t("conversations.panel.notesFailed")
            : saved.updatedAt
              ? t("conversations.panel.notesSaved", { time: stampTime(saved.updatedAt, new Date(), lang), by: saved.updatedBy ?? "—" })
              : null}
      </span>
    </div>
  );
}
