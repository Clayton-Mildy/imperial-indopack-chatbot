/**
 * With WHATSAPP_TRANSPORT=chakra the webhook verifies Chakra's HMAC:
 * header `x-chakra-signature-256`, raw hex (NO `sha256=` prefix), CHAKRA_WEBHOOK_SECRET.
 * The body itself is Meta-format (pass-through), so routing is unchanged.
 */
import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const mockRoute = vi.fn();
const SECRET = 'chakra-secret';

vi.mock('../src/services/messageRouter.js', () => ({ routeInboundBaileysMessage: mockRoute }));
vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    NODE_ENV: 'production',
    WHATSAPP_TRANSPORT: 'chakra',
    CHAKRA_WEBHOOK_SECRET: SECRET,
    CHAKRA_BASE_URL: 'https://api.chakrahq.com',
    CHAKRA_PLUGIN_ID: 'p',
    CHAKRA_API_VERSION: 'v22.0',
    CHAKRA_ACCESS_TOKEN: 't',
    META_WEBHOOK_SECRET: '',
    META_WEBHOOK_VERIFY_TOKEN: '',
  }),
}));

const textBody = JSON.stringify({
  entry: [{ changes: [{ value: {
    contacts: [{ profile: { name: 'Kevin' }, wa_id: '628111' }],
    messages: [{ from: '628111', id: 'wamid.1', timestamp: '1700000000', type: 'text', text: { body: 'halo' } }],
  } }] }],
});

function chakraSig(raw: string): string {
  return crypto.createHmac('sha256', SECRET).update(raw).digest('hex'); // no sha256= prefix
}

async function buildApp() {
  const { webhookRoutes } = await import('../src/routes/webhooks.js');
  const app = Fastify();
  await app.register(webhookRoutes);
  await app.ready();
  return app;
}

describe('Chakra webhook — HMAC verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SKIP_HMAC_IN_DEV;
    mockRoute.mockResolvedValue(undefined);
  });

  it('accepts and routes a correctly-signed Meta-format body', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/webhook',
      headers: { 'content-type': 'application/json', 'x-chakra-signature-256': chakraSig(textBody) },
      payload: textBody });
    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(mockRoute).toHaveBeenCalledTimes(1));
    expect(mockRoute.mock.calls[0][0].text).toBe('halo');
    await app.close();
  });

  it('ignores a body with a bad signature (200, not routed)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/webhook',
      headers: { 'content-type': 'application/json', 'x-chakra-signature-256': 'deadbeef' },
      payload: textBody });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockRoute).not.toHaveBeenCalled();
    await app.close();
  });
});
