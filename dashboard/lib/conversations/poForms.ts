import type { PoFormChoice, PoFormKind, PoFormsSetting } from "@/types/api";

/** Both forms, cetak first, as the API lists and sends them (api/src/domain/poForms.ts). */
export const PO_FORM_KINDS: readonly PoFormKind[] = ["cetak", "plano"];
/** What staff can pick in the quick-send PO dialog. */
export const PO_FORM_CHOICES: readonly PoFormChoice[] = ["cetak", "plano", "both"];

export function isPoFormChoice(v: unknown): v is PoFormChoice {
  return typeof v === "string" && (PO_FORM_CHOICES as readonly string[]).includes(v);
}

/**
 * The dialog's preselection: the form(s) the bot would send for this order - the order panel's
 * suggestedPoForms (cetak with a design, plano without). One form is that form; anything else
 * (design unknown or mixed, nothing loaded) is both.
 */
export function defaultPoFormChoice(suggested: readonly PoFormKind[] | null | undefined): PoFormChoice {
  const only = suggested?.length === 1 ? suggested[0] : undefined;
  return only === "cetak" || only === "plano" ? only : "both";
}

export function poFormChoiceKinds(choice: PoFormChoice): PoFormKind[] {
  return choice === "both" ? [...PO_FORM_KINDS] : [choice];
}

/**
 * What the dialog shows for a choice: the exact message a send carries, or the chosen forms whose
 * link is still the placeholder - then nothing can be sent (the API refuses it too).
 */
export function poFormPreview(setting: PoFormsSetting, choice: PoFormChoice): { ok: true; message: string } | { ok: false; unset: PoFormKind[] } {
  const unset = poFormChoiceKinds(choice).filter((k) => setting[k].isPlaceholder);
  if (unset.length > 0) return { ok: false, unset };
  return { ok: true, message: choice === "both" ? setting.both.message : setting[choice].message };
}

/**
 * The dialog's copy for chosen forms that are still the placeholder. One chosen form unset while the
 * other form is set: that form's line, which offers the other one. The other is unset too (or both were
 * chosen): the generic "link belum diatur" line, never "atau pilih" a form that cannot go either.
 */
export function poUnsetKey(
  setting: PoFormsSetting,
  unset: readonly PoFormKind[],
): "conversations.quick.poUnset.cetak" | "conversations.quick.poUnset.plano" | "conversations.quick.poPlaceholder" {
  const only = unset.length === 1 ? unset[0] : undefined;
  if (only === "cetak" && !setting.plano.isPlaceholder) return "conversations.quick.poUnset.cetak";
  if (only === "plano" && !setting.cetak.isPlaceholder) return "conversations.quick.poUnset.plano";
  return "conversations.quick.poPlaceholder";
}
