"use client";

import { useEffect, useState, useTransition } from "react";
import type { PromptSection, PhoneNumber } from "@/types/api";
import { useT } from "@/lib/i18n/LangProvider";
import { sectionLabel } from "@/lib/settings";
import { replaceNumberPromptAction, savePromptDefaults } from "@/actions/settingsActions";
import { SaveStatus, primaryButtonStyle } from "./settingsUi";

const ghostButton: React.CSSProperties = {
  font: "inherit",
  fontSize: 13,
  fontWeight: 500,
  height: 36,
  padding: "0 14px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#ffffff",
  color: "#1F2421",
  cursor: "pointer",
};

/**
 * A number with its own non-empty sections is answered from those, not the shared ones
 * (api/src/services/aiLayer.ts resolveIdentitySection) - edits here would not reach it.
 */
function hasOwnSections(n: PhoneNumber): boolean {
  return Array.isArray(n.promptSections) && n.promptSections.length > 0;
}

const numberName = (n: PhoneNumber): string => (n.label ? `${n.label} (${n.number})` : n.number);

/**
 * The confirmed step before a number's own sections are deleted: says plainly they are replaced by the
 * shared ones and cannot be restored, and "Hapus dan ganti" stays off until that is acknowledged.
 */
function ReplaceDialog({ number, onClose, onReplaced }: { number: PhoneNumber; onClose: () => void; onReplaced: () => void }) {
  const t = useT();
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await replaceNumberPromptAction(number.id).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (res.ok) onReplaced();
      else setError(res.error === "forbidden" ? t("settings.err.forbidden") : t("settings.prompt.overrideFailed"));
    });
  }

  const canConfirm = ack && !pending;
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(31, 36, 33, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="st-replace-title"
        aria-describedby="st-replace-desc"
        style={{ width: "100%", maxWidth: 520, background: "#ffffff", borderRadius: 12, boxShadow: "0 12px 32px rgba(31, 36, 33, 0.18)", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14, color: "#1F2421" }}
      >
        <span id="st-replace-title" style={{ fontSize: 16, fontWeight: 700, overflowWrap: "anywhere" }}>
          {t("settings.prompt.replaceTitle", { number: numberName(number) })}
        </span>
        <span id="st-replace-desc" style={{ fontSize: 13, color: "#3B4540", lineHeight: 1.55 }}>
          {t("settings.prompt.replaceDesc", { n: number.promptSections?.length ?? 0 })}
        </span>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, lineHeight: 1.45, cursor: pending ? "default" : "pointer" }}>
          <input type="checkbox" checked={ack} disabled={pending} onChange={(e) => setAck(e.target.checked)} style={{ width: 16, height: 16, marginTop: 1, accentColor: "#B91C1C", flexShrink: 0 }} />
          <span>{t("settings.prompt.replaceAck")}</span>
        </label>
        {error && <span role="status" style={{ fontSize: 12, color: "#B91C1C" }}>{error}</span>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={onClose} disabled={pending} style={ghostButton}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!canConfirm}
            style={{ ...ghostButton, border: 0, fontWeight: 600, background: canConfirm ? "#B91C1C" : "#F1F5F9", color: canConfirm ? "#ffffff" : "#94A3B8", cursor: canConfirm ? "pointer" : "not-allowed" }}
          >
            {pending ? t("settings.prompt.replacing") : t("settings.prompt.replaceConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Numbers still on their own instructions: say so, show those sections read-only (one expandable row
 * each, so the text can still be read and copied), and - admins only - replace them with the shared
 * ones after a confirmation (ReplaceDialog; logged by the action).
 */
function OverrideNotice({ numbers, canEdit }: { numbers: PhoneNumber[]; canEdit: boolean }) {
  const t = useT();
  const [overridden, setOverridden] = useState(() => numbers.filter(hasOwnSections));
  const [confirming, setConfirming] = useState<PhoneNumber | null>(null);

  if (overridden.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {overridden.map((n) => (
        <div key={n.id} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 8, background: "#FFFBEB", border: "1px solid #F3DC94", fontSize: 13, color: "#78350F" }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span>{t("settings.prompt.override", { number: numberName(n) })}</span>
            {canEdit && (
              <button type="button" onClick={() => setConfirming(n)} style={{ ...ghostButton, height: 32 }}>
                {t("settings.prompt.replace")}
              </button>
            )}
          </div>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t("settings.prompt.ownSections", { n: n.promptSections?.length ?? 0 })}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(n.promptSections ?? []).map((s, i) => (
              <details key={`${i}-${s.name}`} style={{ background: "#ffffff", border: "1px solid #F3DC94", borderRadius: 6, color: "#1F2421" }}>
                <summary style={{ padding: "6px 10px", cursor: "pointer", fontSize: 12.5 }}>{sectionLabel(s.name, t)}</summary>
                <div style={{ padding: "0 10px 10px", fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#3B4540" }}>{s.content}</div>
              </details>
            ))}
          </div>
        </div>
      ))}
      {confirming && (
        <ReplaceDialog
          number={confirming}
          onClose={() => setConfirming(null)}
          onReplaced={() => {
            setOverridden((list) => list.filter((x) => x.id !== confirming.id));
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Instruksi bot: one tile per instruction section, labelled the way staff say it (sectionLabel), each
 * with Ubah. Ubah opens that section's text below the tiles; Simpan saves the whole list with only that
 * section changed (the API replaces the list). Section names are never edited here - the shipped
 * prompt updates match sections by name.
 */
export function PromptSettingsClient({
  initialSections,
  numbers,
  canEdit,
}: {
  initialSections: PromptSection[];
  numbers: PhoneNumber[];
  canEdit: boolean;
}) {
  const t = useT();
  const [sections, setSections] = useState(initialSections);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function open(idx: number) {
    setEditing(idx);
    setDraft(sections[idx].content);
    setStatus(null);
  }

  function handleSave() {
    if (editing === null) return;
    if (draft.trim() === "") return setStatus({ ok: false, text: t("settings.prompt.emptyContent") });
    const next = sections.map((s, i) => (i === editing ? { ...s, content: draft } : s));
    setStatus(null);
    startTransition(async () => {
      const res = await savePromptDefaults(next).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (res.ok) {
        setSections(next);
        setEditing(null);
        setStatus({ ok: true, text: t("settings.prompt.saved") });
      } else {
        setStatus({ ok: false, text: res.error === "forbidden" ? t("settings.err.forbidden") : res.error === "invalid" ? t("settings.prompt.emptyContent") : t("settings.prompt.saveFailed") });
      }
    });
  }

  if (sections.length === 0) {
    return <span role="status" style={{ fontSize: 13, color: "#B91C1C" }}>{t("settings.prompt.loadFailed")}</span>;
  }

  return (
    <>
      <OverrideNotice numbers={numbers} canEdit={canEdit} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8, fontSize: 13 }}>
        {sections.map((s, idx) => {
          const active = editing === idx;
          return (
            <button
              key={`${idx}-${s.name}`}
              type="button"
              onClick={() => open(idx)}
              aria-expanded={active}
              aria-controls="st-prompt-editor"
              style={{
                font: "inherit",
                fontSize: 13,
                textAlign: "left",
                padding: "10px 12px",
                border: active ? "1.5px solid #586B34" : "1px solid #E1E7DC",
                borderRadius: 6,
                background: active ? "#F5F8F2" : "#ffffff",
                color: "#1F2421",
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                cursor: "pointer",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sectionLabel(s.name, t)}</span>
              <span style={{ color: "#5F6B5A", flexShrink: 0 }}>{t("settings.prompt.edit")}</span>
            </button>
          );
        })}
      </div>
      {editing !== null && (
        <div id="st-prompt-editor" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label htmlFor="st-prompt-text" style={{ fontSize: 12, fontWeight: 600, color: "#3B4540" }}>
            {t("settings.prompt.editing", { name: sectionLabel(sections[editing].name, t) })}
          </label>
          <textarea
            id="st-prompt-text"
            rows={14}
            value={draft}
            readOnly={!canEdit}
            onChange={(e) => {
              setDraft(e.target.value);
              setStatus(null);
            }}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              fontSize: 13,
              fontFamily: "inherit",
              lineHeight: 1.5,
              color: "#1F2421",
              background: canEdit ? "#ffffff" : "#F8FAF6",
              border: "1px solid #D5DECF",
              borderRadius: 6,
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {canEdit && (
              <button type="button" onClick={handleSave} disabled={pending} style={primaryButtonStyle(pending)}>
                {pending ? t("settings.saving") : t("settings.save")}
              </button>
            )}
            <button type="button" onClick={() => { setEditing(null); setStatus(null); }} disabled={pending} style={ghostButton}>
              {t("common.cancel")}
            </button>
            <SaveStatus status={status} />
          </div>
        </div>
      )}
      {editing === null && <SaveStatus status={status} />}
    </>
  );
}
