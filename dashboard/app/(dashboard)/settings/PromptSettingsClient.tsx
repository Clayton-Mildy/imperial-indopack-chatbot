"use client";

import { useState, useTransition } from "react";
import type { PromptSection, PhoneNumber } from "@/types/api";
import { useT } from "@/lib/i18n/LangProvider";
import { sectionLabel } from "@/lib/settings";
import { savePromptDefaults } from "@/actions/settingsActions";
import { updatePromptSections } from "@/actions/numberActions";
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

/** Numbers still on their own instructions: say so, and let staff put them on the shared ones. */
function OverrideNotice({ numbers, canEdit }: { numbers: PhoneNumber[]; canEdit: boolean }) {
  const t = useT();
  const [overridden, setOverridden] = useState(() => numbers.filter(hasOwnSections));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function putOnShared(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await updatePromptSections(id, null);
        setOverridden((list) => list.filter((n) => n.id !== id));
      } catch {
        setError(t("settings.prompt.overrideFailed"));
      }
    });
  }

  if (overridden.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {overridden.map((n) => (
        <div
          key={n.id}
          style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: "#FFFBEB", border: "1px solid #F3DC94", fontSize: 13, color: "#78350F" }}
        >
          <span>{t("settings.prompt.override", { number: n.label ? `${n.label} (${n.number})` : n.number })}</span>
          {canEdit && (
            <button type="button" disabled={pending} onClick={() => putOnShared(n.id)} style={{ ...ghostButton, height: 32 }}>
              {t("settings.prompt.useShared")}
            </button>
          )}
        </div>
      ))}
      {error && <span role="status" style={{ fontSize: 12, color: "#B91C1C" }}>{error}</span>}
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
