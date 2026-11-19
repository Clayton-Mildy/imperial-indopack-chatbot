"use client";

import { useState, useTransition, useCallback } from "react";
import type { PromptSection, PhoneNumber } from "@/types/api";
import { useT } from "@/lib/i18n/LangProvider";
import type { TFn } from "@/lib/i18n/core";
import { savePromptDefaults } from "@/actions/settingsActions";
import { updatePromptSections } from "@/actions/numberActions";

// ─── Styles ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  height: 30,
  padding: "0 8px",
  fontSize: 13,
  color: "#0A0A0A",
  background: "white",
  border: "1px solid #CBD5E1",
  borderRadius: 4,
  outline: "none",
  minWidth: 0,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "Inter, sans-serif",
  color: "#0A0A0A",
  background: "white",
  border: "1px solid #CBD5E1",
  borderRadius: 4,
  outline: "none",
  boxSizing: "border-box",
  resize: "vertical",
  lineHeight: 1.5,
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

const btnGhostStyle: React.CSSProperties = {
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

// ─── Error Helper ─────────────────────────────────────────────────────────────

function friendlyError(e: unknown, t: TFn): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("VALIDATION") || msg.includes("validation"))
    return t("common.err.validation");
  if (msg.includes("NOT_FOUND")) return t("common.err.notFound");
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch"))
    return t("common.err.network");
  return t("common.err.generic");
}

// ─── Section Editor ───────────────────────────────────────────────────────────

function SectionEditor({
  sections,
  onChange,
  disabled = false,
}: {
  sections: PromptSection[];
  onChange: (sections: PromptSection[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  function updateName(idx: number, name: string) {
    const next = sections.map((s, i) => (i === idx ? { ...s, name } : s));
    onChange(next);
  }

  function updateContent(idx: number, content: string) {
    const next = sections.map((s, i) => (i === idx ? { ...s, content } : s));
    onChange(next);
  }

  function removeSection(idx: number) {
    onChange(sections.filter((_, i) => i !== idx));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {sections.map((section, idx) => {
        return (
          <div key={idx}>
            {/* Section header row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingTop: idx === 0 ? 0 : 14 }}>
              <input
                value={section.name}
                onChange={(e) => updateName(idx, e.target.value)}
                placeholder={t("settings.prompt.sectionName")}
                disabled={disabled}
                style={{
                  ...inputStyle,
                  flex: 1,
                  background: disabled ? "#F8FAFC" : "white",
                  color: disabled ? "#64748B" : "#0A0A0A",
                  cursor: disabled ? "default" : "text",
                }}
              />
              {!disabled && (
                <button
                  onClick={() => removeSection(idx)}
                  title={t("settings.prompt.removeSection")}
                  style={{
                    width: 28, height: 28,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "#FEE2E2", color: "#B91C1C",
                    border: "none", borderRadius: 4, cursor: "pointer", flexShrink: 0,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>
                  </svg>
                </button>
              )}
            </div>

            {/* Content textarea */}
            <textarea
              rows={6}
              value={section.content}
              onChange={(e) => updateContent(idx, e.target.value)}
              placeholder={t("settings.prompt.sectionContent", { name: section.name })}
              disabled={disabled}
              style={{
                ...textareaStyle,
                background: disabled ? "#F8FAFC" : "white",
                color: disabled ? "#64748B" : "#0A0A0A",
                cursor: disabled ? "default" : "text",
              }}
            />

            {/* Separator */}
            {idx < sections.length - 1 && (
              <div style={{ height: 1, background: "#E2E8F0", marginTop: 14 }} />
            )}
          </div>
        );
      })}

    </div>
  );
}

// ─── Default Prompt Card ──────────────────────────────────────────────────────

function DefaultPromptCard({
  sections,
  onSectionsChange,
  onSaved,
}: {
  sections: PromptSection[];
  onSectionsChange: (s: PromptSection[]) => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [savedMsg, setSavedMsg] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await savePromptDefaults(sections);
      if (result.ok) {
        setSavedMsg(true);
        setEditing(false);
        setTimeout(() => setSavedMsg(false), 3000);
        onSaved();
      } else {
        setError(result.error ?? t("settings.prompt.default.saveFailed"));
      }
    });
  }

  function handleCancel() {
    setEditing(false);
    setError(null);
  }

  return (
    <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0A0A0A", margin: 0 }}>
          {t("settings.prompt.default.title")}
        </h3>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            style={{ height: 30, padding: "0 12px", background: "white", color: "#1F1F1F", border: "1px solid #CBD5E1", borderRadius: 4, fontSize: 12, fontWeight: 500, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            {t("common.edit")}
          </button>
        )}
      </div>
      <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 16px" }}>
        {t("settings.prompt.default.desc")}{!editing && <span style={{ color: "#94A3B8" }}>{t("settings.prompt.default.editHint")}</span>}
      </p>

      <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 16 }}>
        <SectionEditor sections={sections} onChange={onSectionsChange} disabled={!editing} />
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: "#FEE2E2", color: "#B91C1C", borderRadius: 4, fontSize: 13 }}>
          {error}
        </div>
      )}

      {editing && (
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={handleSave} disabled={pending} style={btnPrimaryStyle}>
            {pending ? t("common.saving") : t("settings.prompt.default.save")}
          </button>
          <button onClick={handleCancel} disabled={pending} style={btnGhostStyle}>
            {t("common.cancel")}
          </button>
          {savedMsg && (
            <span style={{ fontSize: 13, color: "#15803D", fontWeight: 500 }}>{t("settings.prompt.saved")}</span>
          )}
        </div>
      )}
      {!editing && savedMsg && (
        <span style={{ display: "block", marginTop: 12, fontSize: 13, color: "#15803D", fontWeight: 500 }}>{t("settings.prompt.saved")}</span>
      )}
    </div>
  );
}

// ─── Per-Number Prompt Card ───────────────────────────────────────────────────

function PerNumberPromptCard({ defaultSections, numbers }: { defaultSections: PromptSection[]; numbers: PhoneNumber[] }) {
  const t = useT();
  const [selectedId, setSelectedId] = useState<string>("");
  // followingDefault: true when promptSections === null (no custom sections)
  const [followingDefault, setFollowingDefault] = useState<boolean>(true);
  const [sections, setSections] = useState<PromptSection[]>([]);
  const [pending, startTransition] = useTransition();
  const [savedMsg, setSavedMsg] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedNumber = numbers.find((n) => n.id === selectedId) ?? null;

  const loadSectionsForNumber = useCallback((num: PhoneNumber, defaults: PromptSection[]) => {
    if (num.promptSections !== null && num.promptSections !== undefined) {
      // Has custom sections
      setFollowingDefault(false);
      setSections(num.promptSections.length > 0 ? num.promptSections : defaults.length > 0 ? defaults : [{ name: "Default", content: "" }]);
    } else {
      // promptSections is null → following default
      setFollowingDefault(true);
      setSections([]);
    }
  }, []);

  function handleSelectNumber(id: string) {
    setSelectedId(id);
    setSavedMsg(false);
    setError(null);
    if (!id) {
      setSections([]);
      setFollowingDefault(true);
      return;
    }
    const num = numbers.find((n) => n.id === id);
    if (num) loadSectionsForNumber(num, defaultSections);
  }

  function handleCheckboxChange(checked: boolean) {
    if (checked) {
      // Switching to "following default" — save null immediately
      setError(null);
      startTransition(async () => {
        try {
          await updatePromptSections(selectedId, null);
          setFollowingDefault(true);
          setSections([]);
          setSavedMsg(true);
          setTimeout(() => setSavedMsg(false), 3000);
        } catch (e) {
          setError(friendlyError(e, t));
        }
      });
    } else {
      // Switching to custom — copy defaults into local state, wait for explicit save
      setFollowingDefault(false);
      setSections(defaultSections.length > 0 ? [...defaultSections] : [{ name: "Default", content: "" }]);
      setSavedMsg(false);
    }
  }

  function handleSave() {
    if (!selectedId) return;
    setError(null);
    startTransition(async () => {
      try {
        await updatePromptSections(selectedId, sections);
        setSavedMsg(true);
        setTimeout(() => setSavedMsg(false), 3000);
      } catch (e) {
        setError(friendlyError(e, t));
      }
    });
  }

  return (
    <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, padding: "20px 24px" }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0A0A0A", margin: 0, paddingBottom: 4 }}>
        {t("settings.prompt.perNumber.title")}
      </h3>

      <div style={{ marginTop: 14, borderTop: "1px solid #F1F5F9", paddingTop: 16 }}>
        {/* Number selector */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1F1F1F", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.02em" }}>
            {t("settings.prompt.pickNumberLabel")}
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              value={selectedId}
              onChange={(e) => handleSelectNumber(e.target.value)}
              style={{
                flex: 1,
                height: 36,
                padding: "0 10px",
                fontSize: 13,
                color: "#0A0A0A",
                background: "white",
                border: "1px solid #CBD5E1",
                borderRadius: 4,
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="">{t("settings.prompt.pickNumberOption")}</option>
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label ? `${n.label} (${n.number})` : n.number}
                </option>
              ))}
            </select>
            {/* Status badge — only shown when a number is selected */}
            {selectedId && (
              followingDefault ? (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                  background: "#DCFCE7", color: "#15803D", whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  {t("settings.prompt.badgeDefault")}
                </span>
              ) : (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                  background: "#FEF3C7", color: "#B45309", whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  {t("settings.prompt.badgeCustom")}
                </span>
              )
            )}
          </div>
        </div>

        {/* Section editor or placeholder */}
        {!selectedId ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "#94A3B8" }}>
            {t("settings.prompt.pickNumberHint")}
          </div>
        ) : (
          <>
            {/* "Gunakan Prompt Default" checkbox */}
            <div style={{ marginBottom: 16, padding: "12px 14px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 4 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: pending ? "not-allowed" : "pointer" }}>
                <input
                  type="checkbox"
                  checked={followingDefault}
                  disabled={pending}
                  onChange={(e) => handleCheckboxChange(e.target.checked)}
                  style={{ width: 15, height: 15, marginTop: 2, accentColor: "#15803D", cursor: pending ? "not-allowed" : "pointer", flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0A0A0A", lineHeight: 1.4 }}>{t("settings.prompt.useDefault")}</div>
                  <div style={{ fontSize: 12, color: "#64748B", marginTop: 2, lineHeight: 1.4 }}>
                    {t("settings.prompt.useDefaultHint")}
                  </div>
                </div>
              </label>
            </div>

            {followingDefault ? (
              <>
                <div style={{ padding: "14px 16px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 4, fontSize: 13, color: "#15803D" }}>
                  {t("settings.prompt.followingNote")}
                </div>
                {savedMsg && (
                  <span style={{ display: "block", marginTop: 10, fontSize: 13, color: "#15803D", fontWeight: 500 }}>{t("settings.prompt.saved")}</span>
                )}
                {error && (
                  <div style={{ marginTop: 12, padding: "10px 14px", background: "#FEE2E2", color: "#B91C1C", borderRadius: 4, fontSize: 13 }}>
                    {error}
                  </div>
                )}
              </>
            ) : (
              <>
                <SectionEditor sections={sections} onChange={setSections} />

                {error && (
                  <div style={{ marginTop: 12, padding: "10px 14px", background: "#FEE2E2", color: "#B91C1C", borderRadius: 4, fontSize: 13 }}>
                    {error}
                  </div>
                )}

                <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={handleSave} disabled={pending} style={btnPrimaryStyle}>
                    {pending ? t("common.saving") : t("settings.prompt.saveForNumber")}
                  </button>
                  {savedMsg && (
                    <span style={{ fontSize: 13, color: "#15803D", fontWeight: 500 }}>{t("settings.prompt.saved")}</span>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function PromptSettingsClient({
  initialDefaults,
  initialNumbers,
}: {
  initialDefaults: PromptSection[];
  initialNumbers: PhoneNumber[];
}) {
  const [defaultSections, setDefaultSections] = useState<PromptSection[]>(
    initialDefaults.length > 0 ? initialDefaults : [{ name: "Identity", content: "" }]
  );

  return (
    <>
      <DefaultPromptCard
        sections={defaultSections}
        onSectionsChange={setDefaultSections}
        onSaved={() => {}}
      />
      <PerNumberPromptCard defaultSections={defaultSections} numbers={initialNumbers} />
    </>
  );
}
