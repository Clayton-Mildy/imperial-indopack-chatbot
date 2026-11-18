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
  it('signs as Imperial Indopack when set', () =>
    expect(buildBotSettingsBlock({ ...DEFAULT_BOT_SETTINGS, signAs: 'imperial_indopack' })).toContain('selalu Imperial Indopack.'));
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
