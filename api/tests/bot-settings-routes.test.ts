/**
 * bot-settings-routes.test.ts - GET|PATCH /api/v1/settings/bot, the per-field fallback of
 * getBotSettings and the po-form-url message, through Fastify inject. Needs DATABASE_URL.
 * Saves and restores the bot_settings and po_form_url rows.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { appSettings } from '../src/db/schema.js';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));

const { settingsRoutes } = await import('../src/routes/dashboard/settings.js');
const { getBotSettings } = await import('../src/repositories/appSettings.js');
const { DEFAULT_BOT_SETTINGS } = await import('../src/domain/botSettings.js');
const { poFormMessage, PO_FORM_PLACEHOLDER_URL } = await import('../src/domain/constants.js');

const KEYS = ['bot_settings', 'po_form_url'];

describe('bot settings routes', () => {
  const app = Fastify();
  const saved = new Map<string, unknown>();

  async function setRow(key: string, value: unknown | undefined) {
    const db = getDb();
    await db.delete(appSettings).where(eq(appSettings.key, key));
    if (value !== undefined) await db.insert(appSettings).values({ key, value });
  }

  beforeAll(async () => {
    await app.register(settingsRoutes);
    const db = getDb();
    for (const key of KEYS) {
      const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
      if (row) saved.set(key, row.value);
    }
    await setRow('bot_settings', undefined);
    await setRow('po_form_url', undefined);
  });

  afterAll(async () => {
    for (const key of KEYS) await setRow(key, saved.get(key));
    await app.close();
  });

  const patch = (payload: unknown) => app.inject({ method: 'PATCH', url: '/api/v1/settings/bot', payload: payload as object });

  it('patches one field and keeps the rest', async () => {
    const res = await patch({ botName: 'Sari' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ ...DEFAULT_BOT_SETTINGS, botName: 'Sari' });
    const got = await app.inject({ method: 'GET', url: '/api/v1/settings/bot' });
    expect(got.json().data.botName).toBe('Sari');
    expect(got.json().data.greeting).toBe(DEFAULT_BOT_SETTINGS.greeting);
    await patch({ whatsappSyncMinutes: 0 });
    expect((await getBotSettings())).toMatchObject({ botName: 'Sari', whatsappSyncMinutes: 0 });
  });

  it('refuses an empty greeting and a 2-minute reminder', async () => {
    for (const bad of [{ greeting: '' }, { teamReminderMinutes: 2 }, { signAs: 'x' }, { fallbackMinPcs: 0 }]) {
      const res = await patch(bad);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ data: null, error: 'VALIDATION_ERROR' });
    }
  });

  it('falls back per field on a bad stored row', async () => {
    await setRow('bot_settings', { botName: 5, greeting: 'Hai' });
    expect(await getBotSettings()).toEqual({ ...DEFAULT_BOT_SETTINGS, greeting: 'Hai' });
  });

  it('po-form-url reports the placeholder and the message', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/settings/po-form-url' });
    expect(res.json().data).toEqual({
      url: PO_FORM_PLACEHOLDER_URL,
      isPlaceholder: true,
      message: poFormMessage(PO_FORM_PLACEHOLDER_URL),
    });
  });
});
