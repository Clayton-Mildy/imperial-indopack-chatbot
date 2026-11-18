/**
 * human-agent-context.test.ts
 * A message a human colleague typed must never reach the model as something the BOT said.
 *
 * chakraSync imports every outbound message as role 'assistant' - a reply the bot generated and
 * a reply a staff member typed in ChakraHQ's inbox are the same shape, and senderName was the
 * only thing telling them apart. Nothing in the AI path read it. Live, a staff member forwarded
 * an unrelated returns note ("...di retur karena minta @ 1dos") into an active sales thread; on
 * the customer's next message the model read that note as its own previous turn and lost the
 * conversation entirely.
 *
 * Two places had to learn the difference, and both are covered here: the context builder (and
 * the summarizer that shares its helper) and the lastAssistant anchor that seeds the RAG query.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockGetLastNMessages = vi.fn();
const mockBuildCatalogContext = vi.fn(async () => '');

vi.mock('../src/services/claude.js', () => ({
  CLAUDE_MODEL: 'claude-test-model',
  getClient: () => ({ messages: { create: mockCreate } }),
  isDevMode: vi.fn(() => false),
  // Legacy RAG path: it is the one that feeds ragQuery to buildCatalogContext, which makes the
  // lastAssistant anchor observable. Full catalog takes no query at all.
  isFullCatalogEnabled: vi.fn(() => false),
  agentQuery: vi.fn(),
  logUsageLine: vi.fn(),
}));
vi.mock('../src/services/ragQuery.js', () => ({
  getFullCatalogBlock: vi.fn(async () => ''),
  buildCatalogContext: mockBuildCatalogContext,
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

const { buildContext, buildContextAndCallAI } = await import('../src/services/aiLayer.js');

// The message that actually caused the incident.
const STRAY = 'kunci pintu wide yang alicante gun blaclk di retur karena minta @ 1dos';

function row(role: string, body: string, senderName: string | null = null) {
  return { role, body, senderName };
}

describe('buildContext', () => {
  it('labels a human-authored assistant turn instead of replaying it as the bot\'s own', () => {
    const built = buildContext(
      [row('user', 'halo'), row('assistant', STRAY, 'Agen ChakraHQ'), row('user', 'toko saya Jaya Karya')],
      null
    );
    expect(built[1]).toEqual({ role: 'assistant', body: `[Rekan tim CS menulis: ${STRAY}]` });
  });

  it('leaves the bot\'s own turns and every customer turn untouched', () => {
    const built = buildContext([row('user', 'halo'), row('assistant', 'Halo kak, ada yang bisa dibantu?')], null);
    expect(built).toEqual([
      { role: 'user', body: 'halo' },
      { role: 'assistant', body: 'Halo kak, ada yang bisa dibantu?' },
    ]);
  });

  // Prefix, never drop: the customer already saw that reply, so removing it would have the bot
  // repeat or contradict an answer that has already been given.
  it('keeps the human message in context rather than dropping it', () => {
    const built = buildContext([row('assistant', STRAY, 'Agen ChakraHQ')], null);
    expect(built).toHaveLength(1);
    expect(built[0]!.body).toContain(STRAY);
  });

  // 2026-10-09: "foto yang itu ada ga ya?" -> "saya tidak bisa lihat foto" - a photo was replayed
  // as its bare caption, and what its turn found was gone.
  it('replays a customer photo as a photo, with what its turn found', () => {
    const img = (body: string, photoContext?: string) =>
      ({ role: 'user', body, senderName: null, metadata: { attachmentType: 'image', ...(photoContext && { photoContext }) } });
    const built = buildContext([
      img('yang kaya gini ada ga?', 'produk kami HANDLE KECIL + BODY GUANGZHOU (foto sama)'),
      img('[Pelanggan mengirim foto — analisis gambar terlampir]', 'isi foto: engsel, pintu'),
      img('[Pelanggan mengirim foto — analisis gambar terlampir]'),
    ], null);
    expect(built.map((m) => m.body)).toEqual([
      '[Pelanggan mengirim foto: produk kami HANDLE KECIL + BODY GUANGZHOU (foto sama)] yang kaya gini ada ga?',
      '[Pelanggan mengirim foto: isi foto: engsel, pintu]',
      '[Pelanggan mengirim foto]',
    ]);
  });
});

describe('lastAssistant anchor', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockBuildCatalogContext.mockClear();
    mockCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      usage: {},
      content: [{
        type: 'tool_use', name: 'respond_to_customer', id: 'tu1',
        input: { message: 'Baik kak!', confidence: 'high', fit_basis: [] },
      }],
    });
  });

  // A short message carries no product terms of its own, so the RAG query is seeded from the
  // last thing "we" said. Anchoring that on a colleague's stray message drags the whole turn
  // onto the wrong topic - the same bug as above, one layer down, where a label would not help.
  it('skips a human-authored message when seeding the RAG query for a short reply', async () => {
    mockGetLastNMessages.mockResolvedValue([
      row('assistant', 'Mau cari handle pintu yang seperti apa kak?'),
      row('assistant', STRAY, 'Agen ChakraHQ'),
    ]);
    await buildContextAndCallAI('conv-1', 'mau');
    const ragQuery = mockBuildCatalogContext.mock.calls[0]![0] as unknown as string;
    expect(ragQuery).toContain('handle pintu');
    expect(ragQuery).not.toContain('retur');
  });

  // Live 2026-10-14: SATURNUS earlier in the chat, then an ALEXANDER photo whose verdict sat only in
  // the system prompt - the reply followed the earlier photo's note in the history.
  it('puts the photo verdict on the photo\'s own turn', async () => {
    mockGetLastNMessages.mockResolvedValue([]);
    const note = 'PERBANDINGAN FOTO: foto pelanggan SAMA dengan foto produk kami HANDLE BESAR + BODY KUNCI VINTAGE ALEXANDER.';
    await buildContextAndCallAI('conv-1', 'kalau ini apa ya?', undefined, [], { base64: 'QUJD', mimeType: 'image/jpeg' }, null, { photoNote: note });
    const sent = mockCreate.mock.calls[0]![0].messages as { role: string; content: unknown }[];
    expect(JSON.stringify(sent[sent.length - 1]!.content)).toContain('foto produk kami HANDLE BESAR + BODY KUNCI VINTAGE ALEXANDER');
  });

  // Photos sent together reach the model in one turn, each lettered so its verdict can name it.
  it('sends several photos in one turn, numbered', async () => {
    mockGetLastNMessages.mockResolvedValue([]);
    const img = { base64: 'QUJD', mimeType: 'image/jpeg' };
    await buildContextAndCallAI('conv-1', '[Pelanggan mengirim foto — analisis gambar terlampir]', undefined, [], [img, img, img], null, { photoNote: 'FOTO 1: x' });
    const sent = mockCreate.mock.calls[0]![0].messages as { role: string; content: { type: string; text?: string }[] }[];
    const last = sent[sent.length - 1]!.content;
    expect(last.filter((c) => c.type === 'image')).toHaveLength(3);
    expect(last.filter((c) => c.text && /^FOTO \d:$/.test(c.text)).map((c) => c.text)).toEqual(['FOTO 1:', 'FOTO 2:', 'FOTO 3:']);
    expect(JSON.stringify(last)).toContain('3 foto');
  });

  it('still anchors on the bot\'s own last message when there is no human turn', async () => {
    mockGetLastNMessages.mockResolvedValue([row('assistant', 'Mau cari handle pintu yang seperti apa kak?')]);
    await buildContextAndCallAI('conv-1', 'mau');
    expect(mockBuildCatalogContext.mock.calls[0]![0]).toContain('handle pintu');
  });
});
