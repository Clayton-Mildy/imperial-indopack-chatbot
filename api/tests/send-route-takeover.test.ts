/**
 * send-route-takeover.test.ts
 * A staff reply typed in the dashboard (POST /api/v1/send) hands the chat to that staff member, a
 * resolved chat included: left resolved, the customer's next message would reopen it to the bot.
 * chakraSync's replayed phone replies keep the default (a resolved chat is left alone).
 *
 * Mocked - no DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  findConversationById: vi.fn(),
  insertMessage: vi.fn(async () => ({ id: 'msg-1' })),
  findPhoneNumberById: vi.fn(async () => ({ id: 'pn-1', phoneNumberId: 'test-send' })),
  sendTextMessage: vi.fn(async () => 'wamid.contoh-1'),
  markHumanTakeover: vi.fn(async () => true),
}));

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));
vi.mock('../src/repositories/conversations.js', () => ({ findConversationById: m.findConversationById, insertMessage: m.insertMessage }));
vi.mock('../src/repositories/phoneNumbers.js', () => ({ findPhoneNumberById: m.findPhoneNumberById }));
vi.mock('../src/services/whatsappSender.js', () => ({ sendTextMessage: m.sendTextMessage }));
vi.mock('../src/services/humanTakeover.js', () => ({ markHumanTakeover: m.markHumanTakeover }));
vi.mock('../src/db/client.js', () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 'contact-1', waId: '6281200000701' }] }) }) }) }),
}));

const Fastify = (await import('fastify')).default;
const { sendRoutes } = await import('../src/routes/dashboard/send.js');

const CONV_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  m.findConversationById.mockResolvedValue({ id: CONV_ID, contactId: 'contact-1', phoneNumberId: 'pn-1', status: 'resolved' });
});

describe('POST /api/v1/send', () => {
  it('takes the chat over for the sender, a resolved chat included', async () => {
    const app = Fastify();
    await app.register(sendRoutes);
    const res = await app.inject({ method: 'POST', url: '/api/v1/send', payload: { conversationId: CONV_ID, body: 'Halo kak, contoh balasan tim.', senderName: 'Admin Contoh' } });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(m.markHumanTakeover).toHaveBeenCalledWith(CONV_ID, 'Admin Contoh', { includeResolved: true });
  });
});
