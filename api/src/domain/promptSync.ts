/**
 * Which prompt sections `scripts/reseed-prompt-defaults.ts` pushes into the live per-number
 * snapshots, and which it deliberately leaves alone.
 *
 * Lives here, not in the script, because the script runs its patch on import (top-level await
 * against the DB) so nothing can read these lists without also rewriting the database. Keeping
 * them importable is what lets tests/production-audit-fixes.test.ts assert that every section in
 * SYSTEM_PROMPT_SECTIONS is classified — the trap being that a section you edit but never list
 * here silently keeps serving its old text on every live number.
 */

export const SECTIONS_TO_SYNC = [
  'Rules',
  'Kebijakan Reseller/Agen',
  'Playbook Rekomendasi per Kategori',
  'Decision Principles',
  'Product Recommendation Format',
  'Kebijakan Harga',
  'Kebijakan Diskon Reseller',
  'Escalation',
  // Behavioural sections, added after an audit found them silently unsyncable: an edit to Tone
  // (the one-emoji / one-bold / register rules) or to Mission/Scope/Conversation Objective passed
  // tsc and tests and looked deployed, while every live number kept serving its old snapshot.
  'Mission',
  'Tone',
  'Conversation Objective',
  'Scope',
];

/** Sections deliberately NOT synced, each with the reason it must stay per-number. */
export const SECTIONS_NOT_SYNCED: Record<string, string> = {
  // resolveIdentitySection() serves each phone number its own snapshot, so a second number can
  // front a different agent name or brand; overwriting it from constants.ts would silently rename
  // whoever that number's customers have been talking to.
  Identity: 'per-number persona - a second WhatsApp number may front a different agent/brand',
};

export type SyncAction = 'unchanged' | 'updated' | 'inserted' | 'kept-edited';

/**
 * One prompt (the defaults, or one number's snapshot) brought up to the shipped sections.
 *
 * update.ps1 runs this on every deploy, so it must not undo a section staff edited in the dashboard
 * (routes/dashboard/numbers.ts). `baseline` is what the previous sync shipped, per section name: a
 * live section still equal to it was never touched by hand and is replaced; one that differs from
 * both was edited and is kept, and reported. With no baseline for a section (the first sync, or a
 * section new to the list) the shipped text wins, as it always did when this was run by hand.
 * `force` replaces edited sections too.
 */
export function syncPromptSections(
  live: { name: string; content: string }[],
  shipped: { name: string; content: string }[],
  baseline: Record<string, string>,
  force = false
): { patched: { name: string; content: string }[]; actions: Record<string, SyncAction> } {
  const patched = [...live];
  const actions: Record<string, SyncAction> = {};
  for (const name of SECTIONS_TO_SYNC) {
    const src = shipped.find((s) => s.name === name);
    if (!src) throw new Error(`shipped prompt is missing "${name}"`);
    const idx = patched.findIndex((s) => s.name === name);
    if (idx === -1) {
      const escIdx = patched.findIndex((s) => s.name === 'Escalation');
      patched.splice(escIdx === -1 ? patched.length : escIdx, 0, src);
      actions[name] = 'inserted';
    } else if (patched[idx].content === src.content) {
      actions[name] = 'unchanged';
    } else if (!force && name in baseline && patched[idx].content !== baseline[name]) {
      actions[name] = 'kept-edited';
    } else {
      patched[idx] = src;
      actions[name] = 'updated';
    }
  }
  return { patched, actions };
}
