import { describe, it, expect } from 'vitest';
import { SECTIONS_TO_SYNC, SECTIONS_NOT_SYNCED, SECTIONS_RETIRED, syncPromptSections } from '../src/domain/promptSync.js';
import { SYSTEM_PROMPT_SECTIONS } from '../src/domain/constants.js';

// update.ps1 runs reseed-prompt-defaults on every deploy (2026-11-02), so it must ship a prompt change
// without undoing what staff typed into a number's prompt in the dashboard.
describe('syncPromptSections', () => {
  const shipped = SECTIONS_TO_SYNC.map((name) => ({ name, content: `${name} v2` }));
  const v1 = SECTIONS_TO_SYNC.map((name) => ({ name, content: `${name} v1` }));
  const baselineV1 = Object.fromEntries(v1.map((s) => [s.name, s.content]));
  const [first] = SECTIONS_TO_SYNC;

  it('replaces a section nobody edited since the last sync', () => {
    const { patched, actions } = syncPromptSections(v1, shipped, baselineV1);
    expect(patched).toEqual(shipped);
    expect(Object.values(actions).every((a) => a === 'updated')).toBe(true);
  });

  it('keeps a section edited in the dashboard, and reports it', () => {
    const live = v1.map((s) => (s.name === first ? { ...s, content: 'typed by staff' } : s));
    const { patched, actions } = syncPromptSections(live, shipped, baselineV1);
    expect(patched.find((s) => s.name === first)!.content).toBe('typed by staff');
    expect(actions[first]).toBe('kept-edited');
  });

  it('replaces an edited section with --force', () => {
    const live = v1.map((s) => (s.name === first ? { ...s, content: 'typed by staff' } : s));
    expect(syncPromptSections(live, shipped, baselineV1, true).patched.find((s) => s.name === first)!.content).toBe(`${first} v2`);
  });

  it('ships over everything with no baseline yet - the first sync, as when it was run by hand', () => {
    const live = v1.map((s) => (s.name === first ? { ...s, content: 'typed by staff' } : s));
    expect(syncPromptSections(live, shipped, {}).patched).toEqual(shipped);
  });

  it('leaves a section already matching, and unsynced sections, alone', () => {
    const live = [{ name: 'Identity', content: 'Kamu adalah Sari' }, ...shipped];
    const { patched, actions } = syncPromptSections(live, shipped, baselineV1);
    expect(patched).toEqual(live);
    expect(Object.values(actions).every((a) => a === 'unchanged')).toBe(true);
  });

  it('inserts a missing section after the one it follows in the shipped prompt', () => {
    const second = SECTIONS_TO_SYNC[1]!;
    const live = shipped.filter((s) => s.name !== second);
    const { patched, actions } = syncPromptSections(live, shipped, baselineV1);
    expect(actions[second]).toBe('inserted');
    expect(patched.map((s) => s.name)).toEqual(shipped.map((s) => s.name));
  });

  it('inserts a section with nothing before it at the front', () => {
    const { patched } = syncPromptSections(shipped.filter((s) => s.name !== first), shipped, baselineV1);
    expect(patched[0]!.name).toBe(first);
  });
});

// A database seeded before the Imperial Indopack prompt still holds Legacy's sections: on deploy they
// go, and the new ones take their place in the shipped order.
describe('syncPromptSections - the Legacy prompt replaced', () => {
  const LEGACY = ['Identity', 'Mission', 'Tone', 'Conversation Objective', 'Decision Principles', 'Rules',
    'Playbook Rekomendasi per Kategori', 'Scope', 'Product Recommendation Format', 'Kebijakan Reseller/Agen',
    'Kebijakan Harga', 'Kebijakan Diskon Reseller', 'Escalation'].map((name) => ({ name, content: `${name} legacy` }));

  it('removes every retired section, even one staff edited, and reports it', () => {
    const { patched, actions } = syncPromptSections(LEGACY, SYSTEM_PROMPT_SECTIONS, {});
    for (const name of SECTIONS_RETIRED) {
      expect(patched.map((s) => s.name)).not.toContain(name);
      if (LEGACY.some((s) => s.name === name)) expect(actions[name]).toBe('removed');
    }
  });

  it('ends in the shipped order, with the per-number Identity kept', () => {
    const { patched } = syncPromptSections(LEGACY, SYSTEM_PROMPT_SECTIONS, {});
    expect(patched.map((s) => s.name)).toEqual(SYSTEM_PROMPT_SECTIONS.map((s) => s.name));
    expect(patched[0]).toEqual({ name: 'Identity', content: 'Identity legacy' });
  });

  it('keeps a section staff added that was never shipped', () => {
    const live = [...SYSTEM_PROMPT_SECTIONS, { name: 'Promo Lebaran', content: 'diskon' }];
    expect(syncPromptSections(live, SYSTEM_PROMPT_SECTIONS, {}).patched.map((s) => s.name)).toContain('Promo Lebaran');
  });

  it('retires only names that are no longer shipped', () => {
    const shippedNames = SYSTEM_PROMPT_SECTIONS.map((s) => s.name);
    expect(SECTIONS_RETIRED.filter((n) => shippedNames.includes(n))).toEqual([]);
    expect([...SECTIONS_TO_SYNC, ...Object.keys(SECTIONS_NOT_SYNCED)].sort()).toEqual([...shippedNames].sort());
  });
});
