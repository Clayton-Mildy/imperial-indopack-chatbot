/**
 * bot-settings-routes.test.ts - GET|PATCH /api/v1/settings/bot, the per-field fallback of
 * getBotSettings and the two PO forms (GET|PATCH /api/v1/settings/po-forms), through Fastify inject.
 * Needs DATABASE_URL. Saves and restores the bot_settings row and the three PO link rows.
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
const { poFormMessage, poFormsMessage, PO_FORM_PLACEHOLDER_URL } = await import('../src/domain/constants.js');

const PO_KEYS = ['po_form_url', 'po_form_url_cetak', 'po_form_url_plano'];
const KEYS = ['bot_settings', ...PO_KEYS];

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
    for (const key of KEYS) await setRow(key, undefined);
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

  const poForms = (method: 'GET' | 'PATCH', payload?: unknown) =>
    app.inject({ method, url: '/api/v1/settings/po-forms', ...(payload !== undefined && { payload: payload as object }) });

  it('po-forms reports both placeholders and the message each form sends', async () => {
    const res = await poForms('GET');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: {
        cetak: { url: PO_FORM_PLACEHOLDER_URL, isPlaceholder: true, message: poFormMessage(PO_FORM_PLACEHOLDER_URL) },
        plano: { url: PO_FORM_PLACEHOLDER_URL, isPlaceholder: true, message: poFormMessage(PO_FORM_PLACEHOLDER_URL) },
        both: { message: poFormsMessage(['cetak', 'plano'], { cetak: PO_FORM_PLACEHOLDER_URL, plano: PO_FORM_PLACEHOLDER_URL }) },
      },
      error: null,
    });
  });

  it('PATCH po-forms sets one form and answers with both', async () => {
    const res = await poForms('PATCH', { kind: 'plano', url: 'https://forms.gle/ContohPlano' });
    expect(res.statusCode).toBe(200);
    const urls = { cetak: PO_FORM_PLACEHOLDER_URL, plano: 'https://forms.gle/ContohPlano' };
    expect(res.json().data).toEqual({
      cetak: { url: PO_FORM_PLACEHOLDER_URL, isPlaceholder: true, message: poFormMessage(PO_FORM_PLACEHOLDER_URL) },
      plano: { url: urls.plano, isPlaceholder: false, message: poFormMessage(urls.plano) },
      both: { message: poFormsMessage(['cetak', 'plano'], urls) },
    });
    await poForms('PATCH', { kind: 'cetak', url: 'https://forms.gle/ContohCetak' });
    const got = (await poForms('GET')).json().data;
    expect(got.cetak).toMatchObject({ url: 'https://forms.gle/ContohCetak', isPlaceholder: false });
    expect(got.plano).toMatchObject({ url: 'https://forms.gle/ContohPlano', isPlaceholder: false });
  });

  it('PATCH po-forms: https only, a known form, a url - else 400 and nothing changes', async () => {
    const before = (await poForms('GET')).json().data;
    for (const body of [
      { kind: 'cetak', url: 'http://forms.gle/x' },
      { kind: 'plano', url: 'not a url' },
      { kind: 'cetak', url: '' },
      { kind: 'lainnya', url: 'https://forms.gle/x' },
      { url: 'https://forms.gle/x' },
      { kind: 'cetak' },
    ]) {
      const res = await poForms('PATCH', body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ data: null, error: 'VALIDATION_ERROR' });
    }
    expect((await poForms('GET')).json().data).toEqual(before);
  });

  it('the old single-link route is gone', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/settings/po-form-url' })).statusCode).toBe(404);
  });
});
