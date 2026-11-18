/**
 * webhooks-quoted-reply.test.ts
 * The quoted-reply feature was built against Meta's spec and carried over unchanged when the
 * transport switched to ChakraHQ, so for a while nobody could say whether Chakra's pass-through
 * forwarded `context` at all - and a stripped quote is indistinguishable from "the customer did
 * not reply to anything" everywhere downstream. Everything here is a REAL payload, captured off
 * the live tunnel on 2026-08-30 when a customer quote-replied to their own earlier message.
 *
 * That makes this a ground-truth regression guard, not a guess about the shape.
 */
import crypto from 'crypto';
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';

const SECRET = 'chakra-secret';

const mockRoute = vi.fn();
vi.mock('../src/services/messageRouter.js', () => ({ routeInboundBaileysMessage: mockRoute }));
vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    NODE_ENV: 'production', // sign for real - the HMAC path is what production runs
    WHATSAPP_TRANSPORT: 'chakra',
    CHAKRA_WEBHOOK_SECRET: SECRET, CHAKRA_BASE_URL: '', CHAKRA_PLUGIN_ID: '',
    CHAKRA_API_VERSION: 'v22.0', CHAKRA_ACCESS_TOKEN: '',
    META_WEBHOOK_SECRET: '', META_WEBHOOK_VERIFY_TOKEN: '',
  }),
}));

// Synthetic wamids in Meta's shape, built from the test number 628111000099.
const QUOTED_WAMID = 'wamid.HBgMNjI4MTExMDAwMDk5FQIAEhgWM0VCMEFBQUEwMDAwMTExMTIyMjIzMwA=';
const REPLY_WAMID = 'wamid.HBgMNjI4MTExMDAwMDk5FQIAEhgWM0VCMEJCQkIwMDAwNDQ0NDU1NTU2NgA=';

/** The shape ChakraHQ sends, with synthetic values. `from_user_id` is Chakra's own addition - Meta does not send it. */
function chakraBody(message: Record<string, unknown>): string {
  return JSON.stringify({
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: 'Pelanggan Contoh' }, wa_id: '628111000099' }],
      messages: [message],
    } }] }],
  });
}

const QUOTE_REPLY = {
  context: { from: '628111000099', from_user_id: 'ID.1000000000000001', id: QUOTED_WAMID },
  from: '628111000099',
  from_user_id: 'ID.1000000000000001',
  id: REPLY_WAMID,
  text: { body: 'can you read this?' },
  timestamp: '1788069196',
  type: 'text',
};

const PLAIN = {
  from: '628111000099',
  from_user_id: 'ID.1000000000000001',
  id: REPLY_WAMID,
  text: { body: 'hi' },
  timestamp: '1788069100',
  type: 'text',
};

async function post(body: string) {
  const { webhookRoutes } = await import('../src/routes/webhooks.js');
  const app = Fastify();
  await app.register(webhookRoutes);
  await app.ready();
  const res = await app.inject({
    method: 'POST', url: '/webhook',
    headers: {
      'content-type': 'application/json',
      // Raw hex, no `sha256=` prefix - Chakra's convention, not Meta's.
      'x-chakra-signature-256': crypto.createHmac('sha256', SECRET).update(body).digest('hex'),
    },
    payload: body,
  });
  // The handler answers 200 and processes afterwards (never make a provider wait on our AI),
  // so the router call lands a tick later.
  await new Promise((r) => setImmediate(r));
  await app.close();
  return res;
}

describe('ChakraHQ quoted replies', () => {
  it('parses the quoted wamid out of a real Chakra payload', async () => {
    mockRoute.mockClear();
    await post(chakraBody(QUOTE_REPLY));

    expect(mockRoute).toHaveBeenCalledTimes(1);
    const payload = mockRoute.mock.calls[0]![0] as { quotedWaMessageId: string | null; text: string };
    expect(payload.quotedWaMessageId).toBe(QUOTED_WAMID);
    // The reply's own text must survive alongside it - the quote is context, not a replacement.
    expect(payload.text).toBe('can you read this?');
  });

  // The other half of the same guarantee: a plain message must not look like a reply, or the
  // model gets told the customer answered something they never touched.
  it('leaves quotedWaMessageId null when the customer replied to nothing', async () => {
    mockRoute.mockClear();
    await post(chakraBody(PLAIN));

    const payload = mockRoute.mock.calls[0]![0] as { quotedWaMessageId: string | null };
    expect(payload.quotedWaMessageId).toBeNull();
  });

  // Chakra sends fields Meta does not (from_user_id, on both the message and inside context).
  // The parser must keep ignoring them rather than failing validation on an unknown key.
  it('ignores the Chakra-only fields Meta never sends', async () => {
    mockRoute.mockClear();
    await post(chakraBody(QUOTE_REPLY));

    expect(mockRoute).toHaveBeenCalledTimes(1);
    expect(mockRoute.mock.calls[0]![0]).not.toHaveProperty('from_user_id');
  });
});
