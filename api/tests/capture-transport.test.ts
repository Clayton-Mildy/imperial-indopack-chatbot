import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';

const DIR = mkdtempSync(join(tmpdir(), 'capture-'));
const LOG = join(DIR, 'logs', 'whatsapp-capture.jsonl');
const MEDIA = join(DIR, 'files');

type Capture = typeof import('../src/services/captureClient.js');
let c: Capture;
const saved = { ...process.env };

beforeAll(async () => {
  const { mkdirSync } = await import('fs');
  mkdirSync(MEDIA, { recursive: true });
  await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toFile(join(MEDIA, 'logo.png'));
  process.env['API_SECRET_KEY'] ??= 'test-secret';
  process.env['ANTHROPIC_API_KEY'] ??= 'test-key';
  process.env['WHATSAPP_TRANSPORT'] = 'capture';
  process.env['CAPTURE_LOG_PATH'] = LOG;
  process.env['CAPTURE_MEDIA_DIR'] = MEDIA;
  vi.resetModules();
  c = await import('../src/services/captureClient.js');
  const sender = await import('../src/services/whatsappSender.js');
  c = { ...c, sendTextMessage: sender.sendTextMessage, sendDocumentMessage: sender.sendDocumentMessage } as Capture;
});

afterAll(() => {
  process.env = saved;
  rmSync(DIR, { recursive: true, force: true });
});

describe('capture transport', () => {
  it('records a text in WhatsApp markup and returns a capture id', async () => {
    const id = await c.sendTextMessage('local-phone-70', '6281200007001@s.whatsapp.net', 'Harga **Rp 165.000**/rim');
    expect(id).toMatch(/^capture-/);
    expect(c.readCaptured(LOG, { to: '6281200007001' }).at(-1)).toMatchObject({
      kind: 'text', text: 'Harga *Rp 165.000*/rim', phoneNumberId: 'local-phone-70', to: '6281200007001',
    });
  });

  it('records a document with its file name', async () => {
    await c.sendDocumentMessage('local-phone-70', '6281200007001', '/uploads/catalogs/a.pdf', 'Daftar Harga Kertas Supreme.pdf');
    expect(c.readCaptured(LOG).at(-1)).toMatchObject({ kind: 'document', filename: 'Daftar Harga Kertas Supreme.pdf' });
  });

  it('serves inbound media from the fixtures folder', async () => {
    expect(await c.downloadMedia('logo.png')).toMatchObject({ mimeType: 'image/png' });
  });

  it('refuses a media id outside the folder', async () => {
    await expect(c.downloadMedia('../.env')).rejects.toThrow();
  });

  it('refuses capture in production', async () => {
    process.env['NODE_ENV'] = 'production';
    vi.resetModules();
    const sender = await import('../src/services/whatsappSender.js');
    await expect(sender.sendTextMessage('p', '1', 'x')).rejects.toThrow(/local testing only/);
  });
});
