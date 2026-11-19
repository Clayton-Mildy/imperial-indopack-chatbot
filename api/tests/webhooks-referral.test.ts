/** The click-to-WhatsApp referral (Meta's messages[].referral, passed through by Chakra) reaches the router payload. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const mockRoute = vi.fn();
const cfg: Record<string, string> = { NODE_ENV: 'development', META_WEBHOOK_SECRET: '', META_WEBHOOK_VERIFY_TOKEN: 't' };

vi.mock('../src/services/messageRouter.js', () => ({ routeInboundBaileysMessage: mockRoute }));
vi.mock('../src/services/metaClient.js', () => ({ downloadMedia: vi.fn() }));
vi.mock('../src/services/whatsappSender.js', () => ({ downloadMedia: vi.fn() }));
vi.mock('../src/config.js', () => ({ getConfig: () => cfg }));

const body = (referral?: Record<string, unknown>) => ({
  entry: [{ changes: [{ value: {
    contacts: [{ profile: { name: 'Contoh Budi' }, wa_id: '6281200007001' }],
    messages: [{ from: '6281200007001', id: 'wamid.ref1', timestamp: '1700000000', type: 'text', text: { body: 'halo' }, ...(referral ? { referral } : {}) }],
  } }] }],
});

async function post(payload: unknown) {
  const { webhookRoutes } = await import('../src/routes/webhooks.js');
  const app = Fastify();
  await app.register(webhookRoutes);
  await app.ready();
  const res = await app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
  expect(res.statusCode).toBe(200);
  await vi.waitFor(() => expect(mockRoute).toHaveBeenCalledTimes(1));
  await app.close();
  return mockRoute.mock.calls[0]![0];
}

describe('webhook referral', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SKIP_HMAC_IN_DEV = 'true';
    mockRoute.mockResolvedValue(undefined);
  });

  it('maps a click-to-WhatsApp referral into the payload', async () => {
    const payload = await post(body({ source_type: 'ad', source_id: '120200001', headline: 'Kertas Supreme cetak logo', body: 'ignored' }));
    expect(payload.referral).toEqual({ sourceType: 'ad', sourceId: '120200001', headline: 'Kertas Supreme cetak logo' });
  });

  it('a message without a referral carries none', async () => {
    const payload = await post(body());
    expect(payload.referral).toBeNull();
    expect(payload.text).toBe('halo');
  });
});
