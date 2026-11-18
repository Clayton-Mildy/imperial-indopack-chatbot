/**
 * quoted-reply-context.test.ts
 * When a customer uses WhatsApp's reply/quote, the model has to be told WHICH message they
 * answered - otherwise it assumes the reply is about the most recent topic.
 *
 * The case that matters is the slow one: a customer who goes quiet and then, days later,
 * quote-replies to something far back in the thread. The quoted message may have aged out of
 * the 20-message context window entirely, so replaying history is not enough - its text has to
 * be carried into the live turn on its own. That is what these assert.
 *
 * They do NOT prove the quote arrives from ChakraHQ in production; nothing in this repo can.
 * See logQuoteContext in routes/webhooks.ts.
 *
 * Mocked - no DATABASE_URL, no API key.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockGetLastNMessages = vi.fn();

vi.mock('../src/services/claude.js', () => ({
  CLAUDE_MODEL: 'claude-test-model',
  getClient: () => ({ messages: { create: mockCreate } }),
  isDevMode: vi.fn(() => false),
  isFullCatalogEnabled: vi.fn(() => false),
  agentQuery: vi.fn(),
  logUsageLine: vi.fn(),
}));
vi.mock('../src/services/ragQuery.js', () => ({
  getFullCatalogBlock: vi.fn(async () => ''),
  buildCatalogContext: vi.fn(async () => ''),
}));
vi.mock('../src/repositories/appSettings.js', () => ({
  getDefaultPromptSections: vi.fn(async () => [{ name: 'Identitas', content: 'CS Legacy' }]),
}));
vi.mock('../src/repositories/products.js', () => ({ listBrands: vi.fn(async () => []) }));
vi.mock('../src/repositories/conversations.js', () => ({
  getLastNMessages: mockGetLastNMessages,
  getConversationSummary: vi.fn(async () => null),
  updateConversationSummary: vi.fn(),
  countConversationMessages: vi.fn(async () => 0),
  getMessagesForSummary: vi.fn(async () => []),
}));
vi.mock('../src/services/replyChecks.js', () => ({
  verifyReplyTieredPrices: vi.fn(() => ({ ok: true, reason: '' })),
  verifyReplyTone: vi.fn(() => ({ ok: true, reason: '' })),
  verifyReplyNotCarried: vi.fn(() => ({ ok: true, reason: '' })),
  verifyReplyPhotoClaim: vi.fn(() => ({ ok: true, reason: '' })),
  saysNotCarried: vi.fn(() => false),
  verifyReplyMeta: vi.fn(() => ({ ok: true, reason: '' })),
  verifyReplyCatalogClaim: vi.fn(() => ({ ok: true, reason: '' })),
  verifyReplyOpener: vi.fn(() => ({ ok: true, reason: '' })),
  verifyReplyFirstGreeting: vi.fn(() => ({ ok: true, reason: '' })),
  verifyReplyNameRepeat: vi.fn(() => ({ ok: true, reason: '' })),
  verifyReplyNotCarriedCloses: vi.fn(() => ({ ok: true, reason: '' })),
  nameGivenIn: vi.fn(() => null),
  ASKS_NAME_RE: /dengan\s+siapa/i,
}));

const { buildContextAndCallAI } = await import('../src/services/aiLayer.js');

const OLD_QUOTE =
  'Baik, Kak Dilla! Order 3 karton knob handle (150 Lsn = 1.800 pcs) kami catat. Boleh tahu nama tokonya?';

/** The final user turn as it is actually sent to Claude. */
function lastUserContent(): string {
  const sent = mockCreate.mock.calls[0]![0].messages as { role: string; content: unknown }[];
  const last = sent[sent.length - 1]!;
  return typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLastNMessages.mockResolvedValue([]);
  mockCreate.mockResolvedValue({
    stop_reason: 'tool_use',
    usage: {},
    content: [{
      type: 'tool_use', name: 'respond_to_customer', id: 'tu1',
      input: { message: 'Siap kak!', confidence: 'high', fit_basis: [] },
    }],
  });
});

describe('quoted reply', () => {
  it('tells the model which message the customer answered', async () => {
    await buildContextAndCallAI('conv-1', 'Tb. Jaya karya di genteng banyuwangi', null, [], null, OLD_QUOTE);

    const content = lastUserContent();
    expect(content).toContain('pelanggan membalas pesan ini');
    expect(content).toContain(OLD_QUOTE);
    // The customer's own words must still be there, and after the marker - the quote is
    // context for the reply, not a replacement for it.
    expect(content).toContain('Tb. Jaya karya di genteng banyuwangi');
    expect(content.indexOf(OLD_QUOTE)).toBeLessThan(content.indexOf('Tb. Jaya karya'));
  });

  // The reason this works at all for a days-old reply: the quoted text is injected into the
  // live turn, not looked up in the replayed history. findMessageByWaMessageId matches on
  // wa_message_id with no time or window filter, so how long ago it was sent is irrelevant.
  it('carries a quote that has aged out of the 20-message context window', async () => {
    // 30 turns of unrelated chatter since; only the last 20 are replayed as history.
    mockGetLastNMessages.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        body: `pesan lain ${i}`,
        senderName: null,
      }))
    );

    await buildContextAndCallAI('conv-1', 'jadi berapa totalnya kak?', null, [], null, OLD_QUOTE);

    const sent = mockCreate.mock.calls[0]![0].messages as { content: unknown }[];
    // The old message is nowhere in the replayed history...
    expect(JSON.stringify(sent.slice(0, -1))).not.toContain('1.800 pcs');
    // ...but the model still gets it, because the quote rides on the live turn.
    expect(lastUserContent()).toContain('1.800 pcs');
  });

  it('says nothing about a quote when the customer did not reply to anything', async () => {
    await buildContextAndCallAI('conv-1', 'halo ada gembok?');

    expect(lastUserContent()).not.toContain('membalas pesan ini');
  });
});
