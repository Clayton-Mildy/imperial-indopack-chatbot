/**
 * Regression: Meta image/document messages carry the customer's question in the
 * `caption` field, not `text.body`. The webhook must map that caption into the
 * inbound payload's `text` so RAG + the AI see it (otherwise it's silently lost
 * and the bot only reacts to the picture).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

const mockRoute = vi.fn();
const mockDownloadMedia = vi.fn();        // metaClient: the Graph fallback
const mockTransportDownload = vi.fn();    // whatsappSender: the active transport (Chakra in prod)
const cfg: Record<string, string> = { NODE_ENV: 'development', META_WEBHOOK_SECRET: '', META_WEBHOOK_VERIFY_TOKEN: 't' };

vi.mock('../src/services/messageRouter.js', () => ({
  routeInboundBaileysMessage: mockRoute,
}));
vi.mock('../src/services/metaClient.js', () => ({
  downloadMedia: mockDownloadMedia,
}));
vi.mock('../src/services/whatsappSender.js', () => ({
  downloadMedia: mockTransportDownload,
}));
vi.mock('../src/config.js', () => ({
  getConfig: () => cfg,
}));

async function buildApp() {
  const { webhookRoutes } = await import('../src/routes/webhooks.js');
  const app = Fastify();
  await app.register(webhookRoutes);
  await app.ready();
  return app;
}

function imageBody(caption: string | undefined) {
  return {
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: 'Kevin' }, wa_id: '628111' }],
      messages: [{ from: '628111', id: 'wamid.1', timestamp: '1700000000', type: 'image',
        image: { id: 'media-1', mime_type: 'image/jpeg', ...(caption ? { caption } : {}) } }],
    } }] }],
  };
}

describe('Meta webhook — image caption capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SKIP_HMAC_IN_DEV = 'true';
    mockDownloadMedia.mockResolvedValue({ base64: 'AAA', mimeType: 'image/jpeg' });
    mockRoute.mockResolvedValue(undefined);
  });

  it('maps image.caption into payload.text', async () => {
    const app = await buildApp();
    const caption = 'ada box kue ivory 20x20? butuh 2000 pcs';
    const res = await app.inject({ method: 'POST', url: '/webhook',
      headers: { 'content-type': 'application/json' }, payload: JSON.stringify(imageBody(caption)) });
    expect(res.statusCode).toBe(200);

    await vi.waitFor(() => expect(mockRoute).toHaveBeenCalledTimes(1));
    const payload = mockRoute.mock.calls[0][0];
    expect(payload.type).toBe('image');
    expect(payload.text).toBe(caption); // was previously null — the bug
    await app.close();
  });

  it('image without a caption still yields text=null (no crash)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/webhook',
      headers: { 'content-type': 'application/json' }, payload: JSON.stringify(imageBody(undefined)) });
    expect(res.statusCode).toBe(200);

    await vi.waitFor(() => expect(mockRoute).toHaveBeenCalledTimes(1));
    expect(mockRoute.mock.calls[0][0].text).toBeNull();
    await app.close();
  });
});

// UAT F-12: every non-text/image/document message arrived as 'other', so a voice note and a sticker
// were indistinguishable and both were told their "pesan suara/video" could not be opened.
describe('Meta webhook — media types reach the router distinguishable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SKIP_HMAC_IN_DEV = 'true';
    mockRoute.mockResolvedValue(undefined);
  });

  const bodyOfType = (type: string) => ({
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: 'Kevin' }, wa_id: '628111' }],
      messages: [{ from: '628111', id: `wamid.${type}`, timestamp: '1700000000', type }],
    } }] }],
  });

  it.each([
    ['audio', 'audio'],
    ['video', 'video'],
    ['sticker', 'other'],
    ['location', 'other'],
    ['contacts', 'other'],
  ])('%s arrives as %s', async (metaType, routed) => {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/webhook',
      headers: { 'content-type': 'application/json' }, payload: JSON.stringify(bodyOfType(metaType)) });
    await vi.waitFor(() => expect(mockRoute).toHaveBeenCalledTimes(1));
    expect(mockRoute.mock.calls[0][0].type).toBe(routed);
    expect(mockRoute.mock.calls[0][0].providerType).toBe(metaType);
    await app.close();
  });

  // Live 2026-10-06: two invisible events each drew "pesan ini belum bisa aku buka".
  it.each(['reaction', 'edit', 'revoke'])('a %s is not a message and never reaches the router', async (metaType) => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/webhook',
      headers: { 'content-type': 'application/json' }, payload: JSON.stringify(bodyOfType(metaType)) });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockRoute).not.toHaveBeenCalled();
    await app.close();
  });
});

// Since 2026-09-21 ChakraHQ's media API answers 404 for every newer inbound media id, so every
// customer photo was answered "can't open the photo". With a Meta token for the same WhatsApp
// account, Graph serves it instead.
describe('Meta webhook — photo media when Chakra has none', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SKIP_HMAC_IN_DEV = 'true';
    mockRoute.mockResolvedValue(undefined);
    cfg.WHATSAPP_TRANSPORT = 'chakra';
    mockTransportDownload.mockRejectedValue(new Error('Chakra has no record of media media-1 (404)'));
    mockDownloadMedia.mockResolvedValue({ base64: 'QkI=', mimeType: 'image/jpeg' });
  });
  afterEach(() => {
    delete cfg.WHATSAPP_TRANSPORT;
    delete cfg.META_ACCESS_TOKEN;
  });

  async function postPhoto() {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/webhook',
      headers: { 'content-type': 'application/json' }, payload: JSON.stringify(imageBody(undefined)) });
    await vi.waitFor(() => expect(mockRoute).toHaveBeenCalledTimes(1));
    await app.close();
    return mockRoute.mock.calls[0][0];
  }

  it('fetches the photo from Meta Graph when a Meta token is configured', async () => {
    cfg.META_ACCESS_TOKEN = 'meta-tok';
    const payload = await postPhoto();
    expect(mockDownloadMedia).toHaveBeenCalledWith('media-1');
    expect(payload.media).toMatchObject({ base64: 'QkI=', mimeType: 'image/jpeg' });
  });

  it('without a Meta token the photo still reaches the router, just without media', async () => {
    const payload = await postPhoto();
    expect(mockDownloadMedia).not.toHaveBeenCalled();
    expect(payload.type).toBe('image');
    expect(payload.media).toBeNull();
  });
});

// Plan 2 Task 10: a document whose bytes could not be downloaded still carries the name WhatsApp
// sent, so the stored row and the team hand-off can say which file it was.
describe('Meta webhook — document name without its media', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SKIP_HMAC_IN_DEV = 'true';
    mockRoute.mockResolvedValue(undefined);
  });

  async function postDocument() {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/webhook', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({
      entry: [{ changes: [{ value: {
        contacts: [{ profile: { name: 'Contoh' }, wa_id: '628120000051' }],
        messages: [{ from: '628120000051', id: 'wamid.D1', timestamp: '1700000000', type: 'document',
          document: { id: 'media-d1', mime_type: 'application/pdf', filename: 'logo-contoh.pdf' } }],
      } }] }],
    }) });
    await vi.waitFor(() => expect(mockRoute).toHaveBeenCalledTimes(1));
    await app.close();
    return mockRoute.mock.calls[0][0];
  }

  it('a failed download: no media, the filename kept', async () => {
    mockTransportDownload.mockRejectedValue(new Error('capture downloadMedia: no such file'));
    const payload = await postDocument();
    expect(payload).toMatchObject({ type: 'document', media: null, filename: 'logo-contoh.pdf' });
  });

  it('a downloaded document carries its name on the media too', async () => {
    mockTransportDownload.mockResolvedValue({ base64: 'JVBER', mimeType: 'application/pdf' });
    const payload = await postDocument();
    expect(payload.media).toEqual({ base64: 'JVBER', mimeType: 'application/pdf', filename: 'logo-contoh.pdf' });
    expect(payload.filename).toBe('logo-contoh.pdf');
  });
});
