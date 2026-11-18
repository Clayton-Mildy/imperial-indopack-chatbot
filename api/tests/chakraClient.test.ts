/**
 * chakraClient sends via ChakraHQ's plugin-scoped pass-through endpoint and reads the
 * message id from Chakra's `_data.whatsappMessageId` (not Meta's `messages[0].id`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    CHAKRA_BASE_URL: 'https://api.chakrahq.com',
    CHAKRA_PLUGIN_ID: 'plug-123',
    CHAKRA_API_VERSION: 'v22.0',
    CHAKRA_ACCESS_TOKEN: 'tok-abc',
  }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

async function importClient() {
  return import('../src/services/chakraClient.js');
}

describe('chakraClient.sendTextMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs to the plugin-scoped URL with a Meta-shaped body and returns whatsappMessageId', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ _data: { whatsappMessageId: 'chk-1' } }) });
    const { sendTextMessage } = await importClient();

    const id = await sendTextMessage('PN1', '628111@s.whatsapp.net', 'halo');

    expect(id).toBe('chk-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.chakrahq.com/v1/ext/plugin/whatsapp/plug-123/api/v22.0/PN1/messages');
    expect(opts.headers.Authorization).toBe('Bearer tok-abc');
    expect(JSON.parse(opts.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '628111', // JID suffix stripped
      type: 'text',
      text: { body: 'halo' },
    });
  });

  it('throws on a non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' });
    const { sendTextMessage } = await importClient();
    await expect(sendTextMessage('PN1', '628111', 'x')).rejects.toThrow(/Chakra API error 401/);
  });
});

// Chakra's Show Media API answers with a 302 to a presigned S3 url. S3 rejects a request that also
// carries our Authorization header ("Only one auth mechanism allowed"), and since 2026-09-21 it
// answers 404 for every newer inbound media id.
describe('chakraClient.downloadMedia', () => {
  beforeEach(() => vi.clearAllMocks());

  const s3 = 'https://chakra-document-uploads.s3.amazonaws.com/x.jpg?AWSAccessKeyId=A&Signature=S&Expires=1';

  it('follows the redirect by hand, without the Authorization header', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: s3 } }))
      .mockResolvedValueOnce(new Response(Buffer.from('JPEGDATA'), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const { downloadMedia } = await importClient();

    const file = await downloadMedia('123');

    expect(Buffer.from(file.base64, 'base64').toString()).toBe('JPEGDATA');
    expect(file.mimeType).toBe('image/jpeg');
    const [firstUrl, firstOpts] = fetchMock.mock.calls[0];
    expect(firstUrl).toBe('https://api.chakrahq.com/v2/whatsapp/v22.0/media/123/show');
    expect(firstOpts.headers.Authorization).toBe('Bearer tok-abc');
    expect(firstOpts.redirect).toBe('manual');
    const [secondUrl, secondOpts] = fetchMock.mock.calls[1];
    expect(secondUrl).toBe(s3);
    expect(secondOpts.headers?.Authorization).toBeUndefined();
  });

  it('says plainly when Chakra has no record of the media', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    const { downloadMedia } = await importClient();
    await expect(downloadMedia('999')).rejects.toThrow(/no record of media 999/);
  });

  it('never returns an empty file as a photo', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(0), { status: 200 }));
    const { downloadMedia } = await importClient();
    await expect(downloadMedia('123')).rejects.toThrow(/empty body/);
  });
});
