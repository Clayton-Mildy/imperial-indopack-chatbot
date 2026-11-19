"use client";

import { useState } from "react";
import { gramasiProblem } from "@/lib/catalog/productForm";
import { MAX_TEXT_LENGTH } from "@/lib/catalog/productForm";
import { useT } from "@/lib/i18n/LangProvider";

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
const dashedBtn: React.CSSProperties = { ...btn, border: "1px dashed #B9C7AE", color: "#445428" };
const textInput: React.CSSProperties = {
  font: "inherit",
  fontSize: 13.5,
  height: 36,
  padding: "0 12px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#ffffff",
  color: "#1F2421",
  boxSizing: "border-box",
  width: 180,
};
const invalidInput: React.CSSProperties = { border: "2px solid #DC2626" };
const errText: React.CSSProperties = { fontSize: 11.5, color: "#B91C1C" };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#3B4540" };

/** The inline message for a blank or already-used gramasi, in the form's own error style. */
function Problem({ id, problem }: { id: string; problem: "blank" | "exists" | null }) {
  const t = useT();
  if (!problem) return null;
  return (
    <span id={id} role="alert" style={errText}>
      {t(problem === "blank" ? "catalog.form.err.gsm_blank" : "catalog.form.err.gsm_exists")}
    </span>
  );
}

/** The heading of one gramasi section: its name, [Ubah gramasi] (inline rename) and [Hapus gramasi] (confirmed). */
export function GramasiHeader({
  gsm,
  all,
  onRename,
  onRemove,
}: {
  gsm: string;
  /** Every gramasi on the product (this one included). */
  all: string[];
  onRename: (to: string) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(gsm);
  const [problem, setProblem] = useState<"blank" | "exists" | null>(null);

  function save() {
    const p = gramasiProblem(
      all.filter((g) => g !== gsm),
      text
    );
    setProblem(p);
    if (p) return;
    setEditing(false);
    if (text.trim() !== gsm) onRename(text);
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 10, paddingTop: 4 }}>
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="pf-rename-gsm" style={labelStyle}>
            {t("catalog.form.gramasiPrompt")}
          </label>
          <span style={{ display: "flex", gap: 8 }}>
            <input
              id="pf-rename-gsm"
              type="text"
              value={text}
              maxLength={MAX_TEXT_LENGTH}
              aria-invalid={problem ? true : undefined}
              onChange={(e) => {
                setText(e.target.value);
                setProblem(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              style={{ ...textInput, ...(problem ? invalidInput : {}) }}
            />
            <button type="button" onClick={save} style={btn}>
              {t("common.save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setProblem(null);
              }}
              style={btn}
            >
              {t("common.cancel")}
            </button>
          </span>
          <Problem id="pf-rename-gsm-err" problem={problem} />
        </div>
      ) : (
        <>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{gsm}</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                setText(gsm);
                setEditing(true);
              }}
              style={btn}
            >
              {t("catalog.form.renameGramasi")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t("catalog.form.removeGramasiConfirm", { gsm }))) onRemove();
              }}
              style={dangerBtn}
            >
              {t("catalog.form.removeGramasi")}
            </button>
          </span>
        </>
      )}
    </div>
  );
}

/**
 * "+ Tambah gramasi": asks for the gramasi and offers "Salin ukuran dari <gsm>" for each existing one. On a
 * product with no gramasi it first asks which gramasi the sizes already there are (firstGramasiPrompt).
 */
export function AddGramasi({
  existing,
  onAdd,
}: {
  /** The product's gramasi; empty when it has none yet. */
  existing: string[];
  /** first: set only on a no-gramasi product. copyFrom: the gramasi whose sizes to copy. */
  onAdd: (gsm: string, copyFrom: string | undefined, first: string | undefined) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState("");
  const [gsm, setGsm] = useState("");
  const [problem, setProblem] = useState<{ field: "first" | "gsm"; kind: "blank" | "exists" } | null>(null);
  const none = existing.length === 0;

  function reset() {
    setOpen(false);
    setFirst("");
    setGsm("");
    setProblem(null);
  }

  function submit(copyFrom: string | undefined) {
    if (none) {
      const p1 = gramasiProblem([], first);
      if (p1) return setProblem({ field: "first", kind: p1 });
      const p2 = gramasiProblem([first], gsm);
      if (p2) return setProblem({ field: "gsm", kind: p2 });
    } else {
      const p = gramasiProblem(existing, gsm);
      if (p) return setProblem({ field: "gsm", kind: p });
    }
    onAdd(gsm, copyFrom, none ? first : undefined);
    reset();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ ...dashedBtn, alignSelf: "flex-start", fontSize: 13, height: 36, padding: "0 14px" }}>
        {t("catalog.form.addGramasi")}
      </button>
    );
  }

  const row = (id: string, label: string, value: string, set: (v: string) => void, which: "first" | "gsm") => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={MAX_TEXT_LENGTH}
        aria-invalid={problem?.field === which ? true : undefined}
        onChange={(e) => {
          set(e.target.value);
          setProblem(null);
        }}
        style={{ ...textInput, ...(problem?.field === which ? invalidInput : {}) }}
      />
      {problem?.field === which && <Problem id={`${id}-err`} problem={problem.kind} />}
    </div>
  );

  // On a no-gramasi product the sizes there get the gramasi typed first, so that is the one to copy from.
  const sources = none ? (first.trim() ? [first.trim()] : []) : existing;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", border: "1px dashed #B9C7AE", borderRadius: 8 }}>
      {none && row("pf-first-gsm", t("catalog.form.firstGramasiPrompt"), first, setFirst, "first")}
      {row("pf-new-gsm", t("catalog.form.gramasiPrompt"), gsm, setGsm, "gsm")}
      <span style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={() => submit(undefined)} style={btn}>
          {t("catalog.form.addGramasi")}
        </button>
        {sources.map((g) => (
          <button key={g} type="button" onClick={() => submit(g)} style={btn}>
            {t("catalog.form.copySizesFrom", { gsm: g })}
          </button>
        ))}
        <button type="button" onClick={reset} style={btn}>
          {t("common.cancel")}
        </button>
      </span>
    </div>
  );
}
