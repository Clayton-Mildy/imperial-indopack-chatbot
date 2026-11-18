import { describe, it, expect } from 'vitest';
import { SECTIONS_TO_SYNC, syncPromptSections } from '../src/domain/promptSync.js';

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

  it('inserts a missing section in front of Escalation', () => {
    const live = shipped.filter((s) => s.name !== first);
    const { patched, actions } = syncPromptSections(live, shipped, baselineV1);
    expect(actions[first]).toBe('inserted');
    expect(patched.map((s) => s.name).indexOf(first)).toBe(patched.map((s) => s.name).indexOf('Escalation') - 1);
  });
});
