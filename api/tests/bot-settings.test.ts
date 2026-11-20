import { describe, it, expect } from 'vitest';
import { buildBotSettingsBlock, DEFAULT_BOT_SETTINGS, formatMinOrder } from '../src/domain/botSettings.js';
import { shouldStartSync } from '../src/services/chakraSync.js';

describe('bot settings', () => {
  it('names the bot, keeps {merek} in the greeting and states the minimum', () => {
    const b = buildBotSettingsBlock({ ...DEFAULT_BOT_SETTINGS, botName: 'Sari' });
    expect(b).toContain('Nama kamu: Sari.');
    expect(b).toContain('menghubungi {merek}.');
    expect(b).toContain('2.500 pcs / 5 rim');
    expect(b).toContain('merek yang sedang dibahas');
  });
  it('signs as Imperial Indopack when set, and keeps the paper brand name out of the chat', () => {
    const b = buildBotSettingsBlock({ ...DEFAULT_BOT_SETTINGS, signAs: 'imperial_indopack' });
    expect(b).toContain('selalu Imperial Indopack');
    // Live 2026-11-20: set to Imperial Indopack, the bot still said "asisten virtual Imperial Indopack & Kertas Supreme".
    expect(b).toContain('JANGAN menyebut nama "Kertas Supreme" ke pelanggan');
    expect(b).toContain('hanya untuk pencatatan (field brands)');
  });
  it('the brand-discussed setting names no such ban', () =>
    expect(buildBotSettingsBlock(DEFAULT_BOT_SETTINGS)).not.toContain('JANGAN menyebut nama "Kertas Supreme"'));
  it('formats the minimum', () => {
    expect(formatMinOrder(2500)).toBe('2.500 pcs / 5 rim');
    expect(formatMinOrder(1200)).toBe('1.200 pcs');
  });
  it('decides when a sync is due', () => {
    expect(shouldStartSync(null, 0, 2)).toBe(true);
    expect(shouldStartSync(0, 119_000, 2)).toBe(false);
    expect(shouldStartSync(0, 120_000, 2)).toBe(true);
    expect(shouldStartSync(0, 1e9, 0)).toBe(false);
  });
});
