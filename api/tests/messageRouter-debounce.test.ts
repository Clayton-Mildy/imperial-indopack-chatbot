/**
 * QA Gate: Typing Debounce — AI Spam Fix
 * SHA: 6b52651
 *
 * Covers AC-1 through AC-6 for the per-conversation text debounce feature
 * in src/services/messageRouter.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockGetFirstPhoneNumber = vi.fn();
const mockFindPhoneNumberByProviderId = vi.fn();
const mockGetAiEnabledDefault = vi.fn();
const mockUpsertContact = vi.fn();
const mockUpsertConversation = vi.fn();
const mockInsertMessageIfNew = vi.fn();
const mockClaimSyncedInbound = vi.fn();
const mockNotifyStaff = vi.fn();
vi.mock('../src/services/staffNotify.js', () => ({ notifyStaff: mockNotifyStaff }));
// Whether every Claude subscription token is refused - see "no Claude token left" below.
const mockTokensExhausted = vi.fn(() => false);
vi.mock('../src/services/claude.js', async () => ({
  ...(await vi.importActual<typeof import('../src/services/claude.js')>('../src/services/claude.js')),
  claudeTokensExhausted: mockTokensExhausted,
}));
const mockInsertMessage = vi.fn();
const mockFindConversationById = vi.fn();
const mockFindMessageByWaMessageId = vi.fn();
const mockBuildContextAndCallAI = vi.fn();
const mockSendTextMessage = vi.fn();
const mockSendImageMessage = vi.fn();
const mockSendDocumentMessage = vi.fn();
const mockListBrands = vi.fn();
const mockEscalateConversation = vi.fn();
const mockDetectHumanRequest = vi.fn();
const mockClassifyIntent = vi.fn();
const mockPickCannedGreeting = vi.fn();
const mockResetConversationToActive = vi.fn();
type HistoryRow = { role: string; body: string; metadata?: Record<string, unknown> | null };
const mockGetLastNMessages = vi.fn(async (): Promise<HistoryRow[]> => []);
const mockMergeMessageMetadata = vi.fn(async () => {});
const mockUpdateConversationStatus = vi.fn();
const mockGetContactProfile = vi.fn();
const mockSaveConversationInsights = vi.fn();
const mockRecordLeadFromMessage = vi.fn();
const mockResetConversationContext = vi.fn();
const mockDeleteContactProfile = vi.fn();
const mockResetLeadsForContact = vi.fn();
const mockExtractCatalogKeywords = vi.fn();
const mockVisionExtractToKeywords = vi.fn();
const mockOtherBrands = vi.fn((): string[] => []);
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

vi.mock('../src/repositories/phoneNumbers.js', () => ({
  getFirstPhoneNumber: mockGetFirstPhoneNumber,
  findPhoneNumberByProviderId: mockFindPhoneNumberByProviderId,
}));
vi.mock('../src/repositories/contacts.js', () => ({
  upsertContact: mockUpsertContact,
}));
vi.mock('../src/repositories/appSettings.js', () => ({
  getAiEnabledDefault: mockGetAiEnabledDefault,
}));
vi.mock('../src/repositories/conversations.js', () => ({
  upsertConversation: mockUpsertConversation,
  insertMessage: mockInsertMessage,
  insertMessageIfNew: mockInsertMessageIfNew,
  claimSyncedInbound: mockClaimSyncedInbound,
  resetConversationToActive: mockResetConversationToActive,
  findConversationById: mockFindConversationById,
  findMessageByWaMessageId: mockFindMessageByWaMessageId,
  updateConversationStatus: mockUpdateConversationStatus,
  resetConversationContext: mockResetConversationContext,
  getLastNMessages: mockGetLastNMessages,
  mergeMessageMetadata: mockMergeMessageMetadata,
}));
vi.mock('../src/repositories/contactProfiles.js', () => ({
  getContactProfile: mockGetContactProfile,
  deleteContactProfile: mockDeleteContactProfile,
}));
vi.mock('../src/repositories/leads.js', () => ({
  resetLeadsForContact: mockResetLeadsForContact,
  tagNonSalesLead: vi.fn(async () => undefined),
}));
// 628111000001 is makeTextPayload's sender, so it is the whitelisted tester here.
vi.mock('../src/config.js', () => ({ getConfig: () => ({ RESET_COMMAND_NUMBERS: '628111000001' }) }));
vi.mock('../src/services/aiLayer.js', () => ({
  buildContextAndCallAI: mockBuildContextAndCallAI,
}));
vi.mock('../src/services/whatsappSender.js', () => ({
  sendTextMessage: mockSendTextMessage,
  sendDocumentMessage: mockSendDocumentMessage,
  sendImageMessage: mockSendImageMessage,
}));
vi.mock('../src/repositories/products.js', () => ({
  listBrands: mockListBrands,
}));
// detectPpnQuestion is deliberately NOT mocked: the point of the tax gate is that a real
// customer sentence reaches escalateConversation, so the real matcher runs here.
// pickProfileGapQuestion likewise — the still-checking ack is supposed to ask for the same
// missing fact escalateConversation would, and a stub would assert nothing about that.
vi.mock('../src/services/escalationHandler.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/escalationHandler.js')>(
    '../src/services/escalationHandler.js'
  );
  return {
    escalateConversation: mockEscalateConversation,
    detectHumanRequest: mockDetectHumanRequest,
    detectPpnQuestion: actual.detectPpnQuestion,
    detectComplaint: actual.detectComplaint,
    detectNonSalesTopic: actual.detectNonSalesTopic,
    isNonSalesHandoff: actual.isNonSalesHandoff,
    isNonSalesReason: actual.isNonSalesReason,
    pickProfileGapQuestion: actual.pickProfileGapQuestion,
    unansweredSizeQuestion: actual.unansweredSizeQuestion,
    replyPromisesTeamCheck: actual.replyPromisesTeamCheck,
  };
});
vi.mock('../src/services/intentClassifier.js', () => ({
  classifyIntent: mockClassifyIntent,
  pickCannedGreeting: mockPickCannedGreeting,
}));
vi.mock('../src/services/conversationInsights.js', () => ({
  saveConversationInsights: mockSaveConversationInsights,
}));
vi.mock('../src/services/visionKeywords.js', () => ({
  extractCatalogKeywordsFromImage: mockExtractCatalogKeywords,
  visionExtractToKeywords: mockVisionExtractToKeywords,
  otherBrands: mockOtherBrands,
}));
// The comparison with catalog photos talks to the DB and the model; tests/photo-match.test.ts covers
// it. Here it resolves at once to "nothing to compare", which is a catalog with no photos yet.
// A confirmed match by default: since 2026-11-11 any other verdict hands the photo to the team before
// the AI runs (photoUnsureReason), and most photo tests here are about batching and timing.
const SAME_VERDICT = { certainty: 'same', product: { name: 'HANDLE BESAR + BODY KUNCI VINTAGE GRAHAM', brand: 'Vintage', imageUrl: '/uploads/images/graham.jpg' }, compared: ['HANDLE BESAR + BODY KUNCI VINTAGE GRAHAM'], reason: 'identik' };
const mockMatchCustomerPhoto = vi.fn(async (): Promise<unknown> => SAME_VERDICT);
vi.mock('../src/services/photoMatch.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/photoMatch.js')>('../src/services/photoMatch.js');
  return { matchCustomerPhoto: mockMatchCustomerPhoto, photoMatchNote: actual.photoMatchNote, photoTurnNote: actual.photoTurnNote, photoBatchNote: actual.photoBatchNote, photoHistoryNote: actual.photoHistoryNote, photoLine: actual.photoLine, captionOf: actual.captionOf };
});
// Lead attribution runs on every inbound message and talks to the DB. Mocked like every
// other collaborator here — this file is about the debounce, and tests/leads.test.ts covers
// the matcher against real Postgres.
vi.mock('../src/services/leadMatcher.js', () => ({
  recordLeadFromMessage: mockRecordLeadFromMessage,
}));
// Staff replies typed on the phone are pulled in before each reply (chakraSync.syncContactChat).
const mockSyncContactChat = vi.fn(async (): Promise<number> => 0);
vi.mock('../src/services/chakraSync.js', () => ({ syncContactChat: mockSyncContactChat }));
// Real fs I/O is nondeterministic under fake timers — mock the inbound-image save.
vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const BASE_PHONE = {
  id: 'phone-uuid-1',
  phoneNumberId: 'phone-number-id-1',
  promptSections: null,
};

const BASE_CONTACT = {
  id: 'contact-uuid-1',
  displayName: 'Test Customer',
  aiEnabled: null, // no override → follows the global default
};

const BASE_CONVERSATION = {
  id: 'conv-uuid-1',
  contactId: 'contact-uuid-1',
  phoneNumberId: 'phone-uuid-1',
  status: 'active',
  assignedAgent: null,
};

const BASE_AI_RESPONSE = {
  message: 'AI reply',
  confidence: 'high',
  escalationReason: null,
  imageUrl: null,
};

function makeTextPayload(waMessageId: string, text = 'Halo saya mau tanya produk', quotedWaMessageId?: string) {
  return {
    from: '628111000001',
    fromJid: '628111000001@s.whatsapp.net',
    pushName: 'Test Customer',
    type: 'text' as const,
    text,
    waMessageId,
    quotedWaMessageId,
  };
}

function makeImagePayload(waMessageId: string, caption?: string) {
  return {
    from: '628111000001',
    fromJid: '628111000001@s.whatsapp.net',
    pushName: 'Test Customer',
    type: 'image' as const,
    text: caption,
    waMessageId,
    media: { base64: 'abc123base64', mimeType: 'image/jpeg' },
  };
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('messageRouter — typing debounce (AC-1 through AC-6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Make sure the environment looks like API mode (not dev/CLI mode)
    process.env.USE_CLAUDE_CLI = 'false';
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    mockNotifyStaff.mockClear();
    mockGetFirstPhoneNumber.mockResolvedValue(BASE_PHONE);
    mockFindPhoneNumberByProviderId.mockResolvedValue(null);
    mockGetAiEnabledDefault.mockResolvedValue(true);
    mockUpsertContact.mockResolvedValue(BASE_CONTACT);
    mockUpsertConversation.mockResolvedValue({ ...BASE_CONVERSATION });
    mockResetConversationToActive.mockResolvedValue(null);
    mockUpdateConversationStatus.mockResolvedValue(null);
    mockGetLastNMessages.mockResolvedValue([]);
    // Complete profile by default → pickProfileGapQuestion returns null, so the still-checking
    // ack is the bare line. The thin-profile case gets its own test below.
    mockGetContactProfile.mockResolvedValue({ customerType: 'end_user', profile: { quantity: 5 } });
    mockInsertMessageIfNew.mockResolvedValue({ id: 'msg-uuid', conversationId: 'conv-uuid-1' });
    mockClaimSyncedInbound.mockResolvedValue(null);
    mockSyncContactChat.mockResolvedValue(0);
    mockInsertMessage.mockResolvedValue({ id: 'msg-reply-uuid' });
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION });
    mockFindMessageByWaMessageId.mockResolvedValue(null);
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE });
    mockSendTextMessage.mockResolvedValue('wa-sent-id');
    mockSendImageMessage.mockResolvedValue('wa-img-id');
    mockListBrands.mockResolvedValue([]);
    mockEscalateConversation.mockResolvedValue(undefined);
    mockDetectHumanRequest.mockReturnValue(false);
    mockClassifyIntent.mockResolvedValue({ intent: 'product_inquiry', language: 'id', keywords: ['produk'] });
    mockPickCannedGreeting.mockReturnValue('Halo! Ada yang bisa kami bantu?');
    mockSaveConversationInsights.mockResolvedValue(undefined);
    mockExtractCatalogKeywords.mockResolvedValue({});
    mockVisionExtractToKeywords.mockReturnValue([]);
    mockOtherBrands.mockReturnValue([]);
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    // Clear module cache so debounce Map is reset between tests
    vi.resetModules();
  });

  // ─── AC-1: 3 rapid texts → exactly 1 AI call ──────────────────────────────

  it('AC-1: 3 text messages within 2s → AI called exactly once', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    let msgCounter = 0;
    mockInsertMessageIfNew.mockImplementation(async () => ({ id: `msg-${++msgCounter}`, conversationId: 'conv-uuid-1' }));

    // Fire 3 messages without advancing time
    await routeInboundBaileysMessage(makeTextPayload('wamid-001', 'Halo'));
    await routeInboundBaileysMessage(makeTextPayload('wamid-002', 'Saya mau tanya'));
    await routeInboundBaileysMessage(makeTextPayload('wamid-003', 'soal produk'));

    // AI should NOT have been called yet
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();

    // Advance time past the 2s debounce and flush all pending timers/promises
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });

  // A live lead starts at its first message's stored send time, not at processing time: a later
  // first_contact_at would leave that message outside the lead's lifecycle.
  it('records the lead at the stored message time, not now', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const sentAt = new Date('2026-11-01T03:04:05.000Z');
    mockInsertMessageIfNew.mockResolvedValue({ id: 'msg-uuid', conversationId: 'conv-uuid-1', createdAt: sentAt });

    await routeInboundBaileysMessage({ ...makeTextPayload('wamid-LEAD-AT', 'ada engsel?'), timestamp: sentAt.getTime() / 1000 });

    expect(mockRecordLeadFromMessage).toHaveBeenCalledWith('ada engsel?', 'contact-uuid-1', sentAt);
  });

  // ─── AC-2: text → wait 3s → text → 2 AI calls ────────────────────────────

  it('AC-2: text, wait 3s, text → AI called exactly twice', async () => {
    // Pin the debounce window (default is 4000ms; this test advances 3000ms)
    process.env.TYPING_DEBOUNCE_MS = '2000';
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    // First message
    await routeInboundBaileysMessage(makeTextPayload('wamid-A01', 'Pertanyaan pertama'));
    // Advance 3s — past debounce window
    await vi.advanceTimersByTimeAsync(3000);

    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

    // Second message
    await routeInboundBaileysMessage(makeTextPayload('wamid-A02', 'Pertanyaan kedua'));
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(2);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);

    delete process.env.TYPING_DEBOUNCE_MS;
  });

  // ─── AC-3: image → the short photo window, not the text debounce ─────────────
  // It used to be answered at once, one turn per photo - five photos sent together were five turns
  // (live 2026-10-25). Now photos wait PHOTO_DEBOUNCE_MS (5 s) for the rest of their album.

  it('AC-3: image message is answered after the short photo window, not the text debounce', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeImagePayload('wamid-IMG-001'));
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000); // under TYPING_DEBOUNCE_MS (8 s)
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  // ─── AC-4: TYPING_DEBOUNCE_MS env var is wired ────────────────────────────

  it('AC-4: TYPING_DEBOUNCE_MS env var is read at module load and controls debounce window', async () => {
    // Set a custom debounce window before importing
    process.env.TYPING_DEBOUNCE_MS = '500';
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-B01', 'Test message'));

    // At 400ms: debounce not yet fired
    await vi.advanceTimersByTimeAsync(400);
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();

    // At 600ms: 500ms custom window has elapsed
    await vi.advanceTimersByTimeAsync(200);
    await vi.runAllTimersAsync();
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

    delete process.env.TYPING_DEBOUNCE_MS;
  });

  // ─── AC-5: all 3 messages saved to DB immediately, before AI fires ─────────

  it('AC-5: all 3 rapid inbound messages saved to DB before AI fires', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-C01', 'Msg 1'));
    await routeInboundBaileysMessage(makeTextPayload('wamid-C02', 'Msg 2'));
    await routeInboundBaileysMessage(makeTextPayload('wamid-C03', 'Msg 3'));

    // All 3 saved immediately (before timer fires)
    expect(mockInsertMessageIfNew).toHaveBeenCalledTimes(3);
    expect(mockInsertMessageIfNew).toHaveBeenCalledWith(
      expect.objectContaining({ waMessageId: 'wamid-C01' })
    );
    expect(mockInsertMessageIfNew).toHaveBeenCalledWith(
      expect.objectContaining({ waMessageId: 'wamid-C02' })
    );
    expect(mockInsertMessageIfNew).toHaveBeenCalledWith(
      expect.objectContaining({ waMessageId: 'wamid-C03' })
    );

    // AI has not fired yet
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    // AI fires once after debounce
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
  });

  // ─── AC-6: escalation during debounce window → AI does NOT respond ─────────

  it('AC-6: conversation escalated to needs_human during debounce → AI does not respond', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    // Start with active conversation
    mockUpsertConversation.mockResolvedValue({ ...BASE_CONVERSATION, status: 'active' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-D01', 'Saya butuh bantuan'));

    // Before timer fires, conversation is escalated to needs_human
    mockFindConversationById.mockResolvedValue({
      ...BASE_CONVERSATION,
      status: 'needs_human',
      assignedAgent: null,
    });

    // Fire the debounce timer
    await vi.runAllTimersAsync();

    // AI must NOT have been called
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  // ─── Quoted reply: WhatsApp reply/quote context is resolved and passed to AI ──

  it('resolves a quoted (reply-to) message and passes its body to the AI', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    const DOOR_CLOSER_BODY =
      'Halo Kak Kevin! Door Closer Vintage kami ada 2 pilihan warna:\n1. DOORCLOSER 5100 SILVER — Rp 132.500/Set';
    mockFindMessageByWaMessageId.mockResolvedValue({
      id: 'dc-msg', conversationId: 'conv-uuid-1', role: 'assistant', body: DOOR_CLOSER_BODY,
    });

    // Customer quote-replies to the door-closer price message with a short comment.
    await routeInboundBaileysMessage(makeTextPayload('wamid-Q01', 'lmyn ya hrgnya kak', 'wamid-doorcloser'));
    await vi.runAllTimersAsync();

    // Looked up by the quoted wamid...
    expect(mockFindMessageByWaMessageId).toHaveBeenCalledWith('wamid-doorcloser');
    // ...and the resolved body is threaded into buildContextAndCallAI's quotedMessageBody arg (6th).
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    expect(mockBuildContextAndCallAI.mock.calls[0][5]).toBe(DOOR_CLOSER_BODY);
  });

  it('no quoted context → quotedMessageBody arg is null (regression)', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-Q02', 'halo ada gembok?'));
    await vi.runAllTimersAsync();

    expect(mockFindMessageByWaMessageId).not.toHaveBeenCalled();
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    expect(mockBuildContextAndCallAI.mock.calls[0][5]).toBeNull();
  });

  // The quote is used for one turn and then thrown away, which is exactly why nobody could tell
  // whether ChakraHQ's pass-through forwards `context` at all. Keeping it on the row makes a
  // quote auditable after the fact; metadata is jsonb, so this costs no migration.
  // ─── Escalated: the customer is still talking ────────────────────────────────

  // escalateConversation notifies once, on the FIRST hand-off. Everything the customer says
  // while waiting used to reach nobody - and those are the messages a waiting CS most needs.
  it('notifies staff on every customer message while escalated, not just the first', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockBuildContextAndCallAI.mockResolvedValue({ message: '', confidence: 'low', escalationReason: 'r' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-E1', 'halo kok lama ya?'));
    await vi.runAllTimersAsync();

    expect(mockNotifyStaff).toHaveBeenCalledTimes(1);
    const n = mockNotifyStaff.mock.calls[0]![0] as { body: string; path: string };
    // Carries what the customer actually said, so CS can act from the notification alone.
    expect(n.body).toContain('kok lama ya');
    expect(n.path).toBe('/conversations/conv-uuid-1');
  });

  // Live 2026-10-05: with nothing to say, the model wrote its own analysis of the chat and it was sent.
  // The tool now has no_reply; the model decides, and the router just honours it.
  it('model says no_reply in an escalated chat -> nothing sent, no ack, no staff ping', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', noReply: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-NR1', 'baik kak, saya tunggu ya kak. terima kasih'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockInsertMessage).not.toHaveBeenCalled();
    expect(mockEscalateConversation).not.toHaveBeenCalled();
    expect(mockNotifyStaff).not.toHaveBeenCalled();
  });

  it('no_reply never overrides a request for a person or a tax question', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', noReply: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-NR2', 'baik kak, harga sudah termasuk ppn?'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
  });

  it('does not notify on a normal high-confidence reply', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-E2', 'ada gembok?'));
    await vi.runAllTimersAsync();

    expect(mockNotifyStaff).not.toHaveBeenCalled();
  });

  // The whole point of a takeover: a human owns this conversation, so the bot says nothing.
  it('stays silent once a human has taken the conversation over', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'needs_human' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-E3', 'halo?'));
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockNotifyStaff).not.toHaveBeenCalled();
  });

  it('persists the quoted wamid on the inbound row', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-Q03', 'ini yang mana kak?', 'wamid-quoted'));
    await vi.runAllTimersAsync();

    expect(mockInsertMessageIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ quotedWaMessageId: 'wamid-quoted' }),
      })
    );
  });

  it('leaves the quoted wamid off the row when the customer quoted nothing', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-Q04', 'halo'));
    await vi.runAllTimersAsync();

    const metadata = mockInsertMessageIfNew.mock.calls[0]![0].metadata as Record<string, unknown>;
    expect(metadata).not.toHaveProperty('quotedWaMessageId');
  });

  // ─── Inbound timestamp: one clock for both write paths ────────────────────────

  // chakraSync stamps backfilled rows with the real WhatsApp time while live rows used to get
  // now(), so the two writers ordered one history on two different clocks.
  it('stamps createdAt from the WhatsApp send time, not the DB insert time', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage({ ...makeTextPayload('wamid-TS1', 'halo'), timestamp: 1735689600 });
    await vi.runAllTimersAsync();

    expect(mockInsertMessageIfNew).toHaveBeenCalledWith(
      expect.objectContaining({ createdAt: new Date(1735689600 * 1000) })
    );
  });

  // Backdating created_at is what hid the 2026-09-22..24 stalls: a message delivered 99 minutes
  // late looked on time. A late delivery is now marked on the row (and warned in the log).
  it('marks a message that reached us minutes after it was sent', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;

    await routeInboundBaileysMessage({ ...makeTextPayload('wamid-LATE1', 'halo'), timestamp: tenMinutesAgo });
    await routeInboundBaileysMessage({ ...makeTextPayload('wamid-LATE2', 'halo'), timestamp: Math.floor(Date.now() / 1000) });
    await vi.runAllTimersAsync();

    const meta = (id: string) =>
      (mockInsertMessageIfNew.mock.calls.find((c) => c[0].waMessageId === id)![0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta('wamid-LATE1').deliveredLateMs).toBeGreaterThanOrEqual(600_000);
    expect(meta('wamid-LATE2')).not.toHaveProperty('deliveredLateMs');
  });

  // webhooks.ts falls back to 0 when Meta/Chakra send no usable timestamp; epoch 0 would sort
  // every such message to the very start of the conversation, which is worse than now().
  it('falls back to the DB default when no usable timestamp arrived', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage({ ...makeTextPayload('wamid-TS2', 'halo'), timestamp: 0 });
    await vi.runAllTimersAsync();

    expect(mockInsertMessageIfNew.mock.calls[0]![0]).not.toHaveProperty('createdAt');
  });

  // ─── Serialization: no concurrent AI turns per conversation ───────────────────

  it('defers a 2nd turn while the 1st AI call is still in flight (no concurrent turns)', async () => {
    process.env.TYPING_DEBOUNCE_MS = '1000';
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    // Turn 1's AI call hangs until we resolve it; later turns resolve immediately.
    let resolveTurn1!: (v: unknown) => void;
    const turn1 = new Promise((res) => { resolveTurn1 = res; });
    mockBuildContextAndCallAI
      .mockReturnValueOnce(turn1)
      .mockResolvedValue({ ...BASE_AI_RESPONSE });

    // Msg 1 → fire its debounce → turn 1 starts and hangs (in flight).
    await routeInboundBaileysMessage(makeTextPayload('wamid-S01', 'pesan satu'));
    await vi.advanceTimersByTimeAsync(1200);
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

    // Msg 2 arrives while turn 1 is in flight → its debounce must NOT start a 2nd AI call.
    await routeInboundBaileysMessage(makeTextPayload('wamid-S02', 'pesan dua'));
    await vi.advanceTimersByTimeAsync(1200);
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

    // Turn 1 completes → the deferred turn 2 can now run.
    resolveTurn1({ ...BASE_AI_RESPONSE });
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(2);

    delete process.env.TYPING_DEBOUNCE_MS;
  });

  // Live 2026-10-06: "Saya yan" was answered with the buyer-type question a moment after the
  // customer had typed "Untuk proyek sih kak" - the draft was written before that message existed.
  describe('a message that arrives while the reply is being written', () => {
    function hangingTurns(n: number): ((v: unknown) => void)[] {
      const resolvers: ((v: unknown) => void)[] = [];
      for (let i = 0; i < n; i++) {
        mockBuildContextAndCallAI.mockReturnValueOnce(new Promise((res) => { resolvers.push(res); }));
      }
      mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'jawaban lengkap' });
      return resolvers;
    }

    async function textDuringTurn(turn1: unknown) {
      process.env.TYPING_DEBOUNCE_MS = '1000';
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const [resolveTurn1] = hangingTurns(1);
      await routeInboundBaileysMessage(makeTextPayload('wamid-SUP1', 'Saya yan'));
      await vi.advanceTimersByTimeAsync(1200);
      await routeInboundBaileysMessage(makeTextPayload('wamid-SUP2', 'Untuk proyek sih kak'));
      await vi.advanceTimersByTimeAsync(1200);
      resolveTurn1!(turn1);
      await vi.advanceTimersByTimeAsync(2000);
      delete process.env.TYPING_DEBOUNCE_MS;
    }

    it('drops the stale draft and answers both batches in one reply', async () => {
      await textDuringTurn({ ...BASE_AI_RESPONSE, message: 'Halo Kak Yan! Untuk proyek atau dijual lagi?' });

      expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(2);
      expect(mockBuildContextAndCallAI.mock.calls[1]![1]).toBe('Saya yan\nUntuk proyek sih kak');
      expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual(['jawaban lengkap']);
      // Nothing of the dropped draft is kept: not its row, not its profile facts.
      expect(mockSaveConversationInsights).toHaveBeenCalledTimes(1);
    });

    it('drops a stale hand-off too - the next turn decides with every text in view', async () => {
      await textDuringTurn({ message: '', confidence: 'low', escalationReason: 'x' });

      expect(mockEscalateConversation).not.toHaveBeenCalled();
      expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual(['jawaban lengkap']);
    });

    it('drops a draft at most once, so someone who keeps typing still gets an answer', async () => {
      process.env.TYPING_DEBOUNCE_MS = '1000';
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const [resolveA, resolveB] = hangingTurns(2);

      await routeInboundBaileysMessage(makeTextPayload('wamid-SUP3', 'satu'));
      await vi.advanceTimersByTimeAsync(1200);
      await routeInboundBaileysMessage(makeTextPayload('wamid-SUP4', 'dua'));
      await vi.advanceTimersByTimeAsync(1200);
      resolveA!({ ...BASE_AI_RESPONSE, message: 'draft basi' }); // dropped: 'dua' is waiting
      await vi.advanceTimersByTimeAsync(2000);
      await routeInboundBaileysMessage(makeTextPayload('wamid-SUP5', 'tiga'));
      await vi.advanceTimersByTimeAsync(1200);
      resolveB!({ ...BASE_AI_RESPONSE, message: 'jawaban satu dua' }); // sent: its batch was already dropped once
      await vi.advanceTimersByTimeAsync(2000);
      delete process.env.TYPING_DEBOUNCE_MS;

      expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual(['jawaban satu dua', 'jawaban lengkap']);
    });
  });

  // Every reply first pulls its chat from Chakra (syncContactChat), seconds after the customer's
  // previous message. A message typed during that turn could be imported before its own webhook was
  // handled; the webhook then found the wamid taken, read it as a duplicate, and the bot never
  // answered it. "Already stored" is not "already handled" - only the webhook's own row is.
  describe('a message chakraSync stored before its webhook', () => {
    // Stands in for the messages table: wamid -> who wrote the row.
    let rows: Map<string, 'webhook' | 'chakra_sync'>;
    beforeEach(() => {
      rows = new Map();
      mockInsertMessageIfNew.mockImplementation(async (data: { waMessageId: string }) => {
        if (rows.has(data.waMessageId)) return null;
        rows.set(data.waMessageId, 'webhook');
        return { id: `row-${data.waMessageId}`, conversationId: 'conv-uuid-1', metadata: {} };
      });
      mockClaimSyncedInbound.mockImplementation(async (data: { waMessageId: string }) => {
        if (rows.get(data.waMessageId) !== 'chakra_sync') return null;
        rows.set(data.waMessageId, 'webhook');
        return { id: `row-${data.waMessageId}`, conversationId: 'conv-uuid-1', metadata: { syncedFirst: true } };
      });
    });

    it('answers it - folded into the turn that was running when it came', async () => {
      process.env.TYPING_DEBOUNCE_MS = '1000';
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      let resolveTurn1!: (v: unknown) => void;
      mockBuildContextAndCallAI
        .mockReturnValueOnce(new Promise((res) => { resolveTurn1 = res; }))
        .mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'jawaban lengkap' });
      // The turn's own sync finds the customer's next message already in Chakra.
      mockSyncContactChat.mockImplementationOnce(async () => {
        rows.set('wamid-RACE2', 'chakra_sync');
        return 1;
      });

      await routeInboundBaileysMessage(makeTextPayload('wamid-RACE1', 'ada handle newton?'));
      await vi.advanceTimersByTimeAsync(1200);
      expect(rows.get('wamid-RACE2')).toBe('chakra_sync');
      await routeInboundBaileysMessage(makeTextPayload('wamid-RACE2', 'yang hitam ya kak'));
      await vi.advanceTimersByTimeAsync(1200);
      resolveTurn1({ ...BASE_AI_RESPONSE, message: 'draft basi' });
      await vi.advanceTimersByTimeAsync(2000);
      delete process.env.TYPING_DEBOUNCE_MS;

      expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(2);
      expect(mockBuildContextAndCallAI.mock.calls[1]![1]).toBe('ada handle newton?\nyang hitam ya kak');
      expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual(['jawaban lengkap']);
    });

    it('answers it when no turn is running too', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      rows.set('wamid-RACE3', 'chakra_sync'); // the periodic run, ahead of a late webhook

      await routeInboundBaileysMessage(makeTextPayload('wamid-RACE3', 'masih ada stok?'));
      await vi.runAllTimersAsync();

      expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
      expect(mockBuildContextAndCallAI.mock.calls[0]![1]).toBe('masih ada stok?');
    });

    it('still drops a second delivery of a message the webhook stored itself', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

      await routeInboundBaileysMessage(makeTextPayload('wamid-DUP1', 'halo'));
      await routeInboundBaileysMessage(makeTextPayload('wamid-DUP1', 'halo'));
      await vi.runAllTimersAsync();

      expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
      expect(mockBuildContextAndCallAI.mock.calls[0]![1]).toBe('halo');
      expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Image/text serialization: images join the same in-flight gate ────────────

  it('defers an image turn while a text turn is in flight (no double greeting)', async () => {
    process.env.TYPING_DEBOUNCE_MS = '1000';
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    let resolveTurn1!: (v: unknown) => void;
    mockBuildContextAndCallAI
      .mockReturnValueOnce(new Promise((res) => { resolveTurn1 = res; }))
      .mockResolvedValue({ ...BASE_AI_RESPONSE });

    // Text turn fires and hangs (in flight).
    await routeInboundBaileysMessage(makeTextPayload('wamid-IT01', 'halo bu'));
    await vi.advanceTimersByTimeAsync(1200);
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

    // Image arrives mid-turn → must NOT start a concurrent AI call.
    await routeInboundBaileysMessage(makeImagePayload('wamid-IT02'));
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

    // Text turn completes → deferred image turn runs (after the photo window).
    resolveTurn1({ ...BASE_AI_RESPONSE });
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(2);

    delete process.env.TYPING_DEBOUNCE_MS;
  });

  it('defers a text turn while an image turn is in flight (reverse direction)', async () => {
    process.env.TYPING_DEBOUNCE_MS = '1000';
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    let resolveImage!: (v: unknown) => void;
    mockBuildContextAndCallAI
      .mockReturnValueOnce(new Promise((res) => { resolveImage = res; }))
      .mockResolvedValue({ ...BASE_AI_RESPONSE });

    // Image turn starts after the photo window and hangs.
    const imagePromise = routeInboundBaileysMessage(makeImagePayload('wamid-TI01'));
    await vi.advanceTimersByTimeAsync(5050);
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

    // Text arrives; its debounce fires mid-image-turn → deferred, not concurrent.
    await routeInboundBaileysMessage(makeTextPayload('wamid-TI02', 'itu harganya berapa?'));
    await vi.advanceTimersByTimeAsync(1200);
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

    resolveImage({ ...BASE_AI_RESPONSE });
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(2);
    await imagePromise;

    delete process.env.TYPING_DEBOUNCE_MS;
  });

  // Live 2026-10-12: "sendiri" typed while the photo was being answered, and the photo's reply asked
  // the buyer type again. The photo's draft is dropped; the text turn answers the photo and the text.
  it('drops a photo draft the customer has already moved past, and answers both in one reply', async () => {
    process.env.TYPING_DEBOUNCE_MS = '1000';
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockMatchCustomerPhoto.mockResolvedValueOnce({
      certainty: 'same',
      product: { name: 'HANDLE PISAH STAINLESS STEEL + BODY 1231 VINTAGE SATURNUS', brand: 'Vintage', imageUrl: '/s.jpg' },
      compared: ['HANDLE PISAH STAINLESS STEEL + BODY 1231 VINTAGE SATURNUS'],
      reason: 'identik',
    });
    let resolveImage!: (v: unknown) => void;
    mockBuildContextAndCallAI
      .mockReturnValueOnce(new Promise((res) => { resolveImage = res; }))
      .mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'jawaban gabungan' });

    const imagePromise = routeInboundBaileysMessage(makeImagePayload('wamid-SP01', 'mau tanya product ini ada ga ya?'));
    await vi.advanceTimersByTimeAsync(5050);
    await routeInboundBaileysMessage(makeTextPayload('wamid-SP02', 'sendiri'));
    await vi.advanceTimersByTimeAsync(1200);

    resolveImage({ ...BASE_AI_RESPONSE, message: 'Boleh tahu, dipakai sendiri, proyek, atau dijual lagi?' });
    await vi.advanceTimersByTimeAsync(2000);
    await imagePromise;

    expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual(['jawaban gabungan']);
    expect(mockBuildContextAndCallAI.mock.calls[1][1]).toContain(
      '[Pelanggan mengirim foto: produk kami HANDLE PISAH STAINLESS STEEL + BODY 1231 VINTAGE SATURNUS (foto sama)] mau tanya product ini ada ga ya?'
    );
    expect(mockBuildContextAndCallAI.mock.calls[1][1]).toContain('sendiri');

    delete process.env.TYPING_DEBOUNCE_MS;
  });

  // Live 2026-10-12: the bot answered "untuk proyek mbak" without staff's phone reply a minute
  // earlier. Each reply pulls the chat first - and a hanging Chakra costs at most 5 s, never the reply.
  it('pulls staff replies into the chat before answering, without waiting on a hanging sync', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const order: string[] = [];
    mockSyncContactChat.mockImplementationOnce(async () => { order.push('sync'); return 2; });
    mockBuildContextAndCallAI.mockImplementationOnce(async () => { order.push('ai'); return { ...BASE_AI_RESPONSE }; });

    await routeInboundBaileysMessage(makeTextPayload('wamid-SY1', 'untuk proyek mbak'));
    await vi.runAllTimersAsync();
    expect(order).toEqual(['sync', 'ai']);
    expect(mockSyncContactChat.mock.calls[0]![0]).toContain('628111000001');

    mockSyncContactChat.mockImplementationOnce(() => new Promise(() => { }));
    await routeInboundBaileysMessage(makeTextPayload('wamid-SY2', 'masih ada?'));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(2);
  });

  // review 2026-10-13: a "bukti transfer" photo ran vision, the photo comparison and the AI before the hand-off.
  it('hands a non-sales photo to the team without vision, comparison or an AI call', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    await routeInboundBaileysMessage(makeImagePayload('wamid-NSP1', 'sudah transfer ya kak, ini buktinya'));
    await vi.runAllTimersAsync();
    expect(mockExtractCatalogKeywords).not.toHaveBeenCalled();
    expect(mockMatchCustomerPhoto).not.toHaveBeenCalled();
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockEscalateConversation.mock.calls[0][1]).toContain('Pembayaran / status pesanan');
  });

  // Live 2026-10-25 Kak Dikman sent five marketplace screenshots at once as one request ("foto
  // rekomendasi seperti di atas"). Each photo was its own turn: one reply about one photo at 19.15,
  // another about a different photo 18 minutes later. Photos sent together now get one turn.
  it('answers photos sent together in one turn that sees every image', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-ALB1'), timestamp: 100 });
    await vi.advanceTimersByTimeAsync(1000);
    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-ALB2'), timestamp: 101 });
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    expect(mockBuildContextAndCallAI.mock.calls[0][4]).toHaveLength(2);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps a lone photo a lone image, as before', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    await routeInboundBaileysMessage(makeImagePayload('wamid-ONE1', 'yang kaya gini ada?'));
    await vi.runAllTimersAsync();
    expect(mockBuildContextAndCallAI.mock.calls[0][1]).toBe('yang kaya gini ada?');
    expect(mockBuildContextAndCallAI.mock.calls[0][4]).toEqual({ base64: 'abc123base64', mimeType: 'image/jpeg' });
  });

  it('tells the reply which verdict belongs to which photo', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const verdictFor = (name: string) => ({ certainty: 'same', product: { name, brand: 'Vintage', imageUrl: '/x.jpg' }, compared: [name], reason: 'x' });
    mockMatchCustomerPhoto.mockResolvedValueOnce(verdictFor('GEMBOK HITAM')).mockResolvedValueOnce(verdictFor('GRENDEL STAINLESS STEEL'));

    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-NOTE1'), timestamp: 100 });
    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-NOTE2'), timestamp: 101 });
    await vi.runAllTimersAsync();

    const note = (mockBuildContextAndCallAI.mock.calls[0][6] as { photoNote: string }).photoNote;
    expect(note).toMatch(/FOTO 1:[^]*GEMBOK HITAM[^]*FOTO 2:[^]*GRENDEL STAINLESS STEEL/);
  });

  // The photos of one album can reach us further apart than the quiet window: each webhook downloads
  // its photo first. One still being answered when the next arrives is dropped and answered with it.
  it('drops a photo draft when another photo arrives during it, and answers all of them together', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    let resolveFirst!: (v: unknown) => void;
    mockBuildContextAndCallAI
      .mockReturnValueOnce(new Promise((res) => { resolveFirst = res; }))
      .mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'jawaban untuk dua foto' });

    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-2I01'), timestamp: 100 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-2I02'), timestamp: 104 });
    resolveFirst({ ...BASE_AI_RESPONSE, message: 'jawaban untuk foto pertama saja' });
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(2);
    expect(mockBuildContextAndCallAI.mock.calls[1][4]).toHaveLength(2);
    expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual(['jawaban untuk dua foto']);
  });

  it('deferred image turn re-reads status: escalated meanwhile + low confidence → no duplicate escalation', async () => {
    process.env.TYPING_DEBOUNCE_MS = '1000';
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    let resolveTurn1!: (v: unknown) => void;
    mockBuildContextAndCallAI
      .mockReturnValueOnce(new Promise((res) => { resolveTurn1 = res; }))
      .mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: 'cannot read image' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-ES01', 'pesan'));
    await vi.advanceTimersByTimeAsync(1200);

    await routeInboundBaileysMessage(makeImagePayload('wamid-ES02')); // deferred behind text turn

    // Conversation gets escalated while the image turn waits for its slot.
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });

    resolveTurn1({ ...BASE_AI_RESPONSE });
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(2);
    // Fresh status read inside the gated turn → the dedup check drops the escalation.
    expect(mockEscalateConversation).not.toHaveBeenCalled();

    delete process.env.TYPING_DEBOUNCE_MS;
  });

  it('no-media image does not cancel a pending text debounce (texts still answered)', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-NM01', 'ada gembok?'));
    // Image without downloadable media arrives inside the debounce window.
    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-NM02'), media: undefined });

    // Canned "can't open your photo" fallback sent immediately, no AI call.
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();

    // The pending text batch still gets its AI turn.
    await vi.runAllTimersAsync();
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
  });

  // ─── Escalation dedup: already-escalated → no 2nd escalation, but keep chatting ──

  // ─── Bounds on the batch: a trailing debounce alone starves under a spammer ──

  it('answers a non-stop typist once the max-wait cap is reached, not never', async () => {
    // Someone sending a line every 2s never lets a 5s quiet window elapse. Without the cap the
    // timer is re-armed forever and the customer is never answered at all.
    process.env.TYPING_DEBOUNCE_MS = '5000';
    process.env.TYPING_DEBOUNCE_MAX_WAIT_MS = '12000';
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    let n = 0;
    mockInsertMessageIfNew.mockImplementation(async () => ({ id: `msg-${++n}`, conversationId: 'conv-uuid-1' }));

    for (let i = 0; i < 10; i++) {
      await routeInboundBaileysMessage(makeTextPayload(`wamid-CAP${i}`, `baris ${i}`));
      await vi.advanceTimersByTimeAsync(2000);
    }

    // 20s of continuous typing has passed and the quiet window never elapsed.
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    // Everything typed so far went into that one turn, not one turn per message.
    const combined = mockBuildContextAndCallAI.mock.calls[0][1] as string;
    expect(combined).toContain('baris 0');
    expect(combined.split('\n').length).toBeGreaterThan(1);

    delete process.env.TYPING_DEBOUNCE_MS;
    delete process.env.TYPING_DEBOUNCE_MAX_WAIT_MS;
  });

  it('fires immediately once the batch hits TYPING_DEBOUNCE_MAX_MESSAGES', async () => {
    process.env.TYPING_DEBOUNCE_MS = '60000'; // long enough that only the size cap can fire it
    process.env.TYPING_DEBOUNCE_MAX_MESSAGES = '5';
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    let n = 0;
    mockInsertMessageIfNew.mockImplementation(async () => ({ id: `msg-${++n}`, conversationId: 'conv-uuid-1' }));

    for (let i = 0; i < 4; i++) {
      await routeInboundBaileysMessage(makeTextPayload(`wamid-SZ${i}`, `spam ${i}`));
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();

    await routeInboundBaileysMessage(makeTextPayload('wamid-SZ4', 'spam 4'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

    delete process.env.TYPING_DEBOUNCE_MS;
    delete process.env.TYPING_DEBOUNCE_MAX_MESSAGES;
  });

  it('escalating turn saves profile insights BEFORE the hand-off picks its question', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockBuildContextAndCallAI.mockResolvedValue({
      ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: 'no fit',
      profileUpdate: { customer_type: 'end_user' },
    });

    await routeInboundBaileysMessage(makeTextPayload('wamid-INS1', 'pintu kaca 800mm ada?'));
    await vi.runAllTimersAsync();

    expect(mockSaveConversationInsights).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    // Order matters: the escalation question reads the profile this call just updated.
    expect(mockSaveConversationInsights.mock.invocationCallOrder[0])
      .toBeLessThan(mockEscalateConversation.mock.invocationCallOrder[0]);
    // Low-confidence escalation stays proactive: the profile-gap question is allowed.
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(true);
  });

  it('image-path escalation also saves insights first', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockBuildContextAndCallAI.mockResolvedValue({
      ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: 'no fit',
      profileUpdate: { customer_type: 'end_user' },
    });

    await routeInboundBaileysMessage(makeImagePayload('wamid-INS2'));
    await vi.runAllTimersAsync();

    expect(mockSaveConversationInsights).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockSaveConversationInsights.mock.invocationCallOrder[0])
      .toBeLessThan(mockEscalateConversation.mock.invocationCallOrder[0]);
  });

  it('an explicit human request escalates WITHOUT the sales question (askProfileGap=false)', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockDetectHumanRequest.mockReturnValue(true);

    await routeInboundBaileysMessage(makeTextPayload('wamid-HUM1', 'bisa sambungkan ke CS manusia?'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);
  });

  it('image path: a human-request caption also suppresses the sales question (parity)', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockDetectHumanRequest.mockReturnValue(true);
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: 'human requested' });

    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-HUM2'), text: 'minta cs dong' });
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);
  });

  // The caption path computed humanRequested and used it for askProfileGap, but left it OUT of the
  // escalation condition — so asking for a human only worked when the AI ALSO failed. A photo with
  // "tolong sambungkan ke CS" and a confident AI reply kept the customer talking to the bot.
  it('image path: a human-request caption escalates even when the AI answered confidently', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockDetectHumanRequest.mockReturnValue(true);
    mockBuildContextAndCallAI.mockResolvedValue({
      ...BASE_AI_RESPONSE,
      message: 'Itu engsel Vintage 4 inci kak, harganya Rp 42.000/Set.',
      confidence: 'high',
    });

    await routeInboundBaileysMessage({
      ...makeImagePayload('wamid-HUM3'),
      text: 'ini fotonya, tolong sambungkan ke CS',
    });
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false); // no sales question tacked on
  });

  // ─── A waiting customer must not hear the same sentence forever ──────────────

  const handoffRow = (): HistoryRow => ({ role: 'assistant', body: 'Kita coba cek dengan tim dulu ya kak 🙏', metadata: { source: 'escalation' } });
  const ackRow = (body: string): HistoryRow => ({ role: 'assistant', body, metadata: { source: 'escalation_ack' } });
  const userRow = (body: string): HistoryRow => ({ role: 'user', body, metadata: null });

  // Replays `turns` chaser messages into an escalated chat, feeding each ack back into the history
  // the next turn reads - which is what the real repository returns.
  async function acksFor(history: HistoryRow[], turns: number, text = 'kok lama ya kak?'): Promise<string[]> {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockUpsertConversation.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', confidence: 'low' });
    const sent: string[] = [];
    for (let n = 0; n < turns; n++) {
      mockGetLastNMessages.mockResolvedValue([...history]);
      mockSendTextMessage.mockClear();
      await routeInboundBaileysMessage(makeTextPayload(`wamid-ACK${sent.length}-${history.length}`, text));
      await vi.runAllTimersAsync();
      const ack = mockSendTextMessage.mock.calls.at(-1)?.[2] as string;
      sent.push(ack);
      history.push(userRow(text), ackRow(ack));
    }
    return sent;
  }

  // UAT Run 2: "Baik kak, semuanya sudah saya catat ya." seven times in one chat, twice 8 s apart -
  // the old count covered every hand-off the conversation ever had, so it sat on the last line.
  it('restates the hand-off once, then only acknowledges, never the same line twice in a row', async () => {
    const { CANNED_STILL_CHECKING_REPLY, ESCALATION_FOLLOWUP_ACKS } = await import('../src/domain/constants.js');
    const sent = await acksFor([handoffRow()], 7);

    expect(sent[0]).toBe(CANNED_STILL_CHECKING_REPLY);
    expect(sent[1]).toBe(ESCALATION_FOLLOWUP_ACKS[0]);
    for (const ack of sent.slice(1)) expect(ack).not.toContain('cek dengan tim');
    for (let i = 1; i < sent.length; i++) expect(sent[i]).not.toBe(sent[i - 1]);
  });

  it('starts over for a new hand-off, whatever an older one left behind', async () => {
    const { CANNED_STILL_CHECKING_REPLY, ESCALATION_FOLLOWUP_ACKS } = await import('../src/domain/constants.js');
    const old = [handoffRow(), ackRow(ESCALATION_FOLLOWUP_ACKS[2]!), ackRow(ESCALATION_FOLLOWUP_ACKS[3]!)];
    const [first] = await acksFor([...old, userRow('ada gembok?'), handoffRow()], 1);
    expect(first).toBe(CANNED_STILL_CHECKING_REPLY);
  });

  // A long wait scrolls the hand-off row out of the 20-row window; the rotation must keep moving.
  it('keeps rotating with no hand-off row left in the window', async () => {
    const { ESCALATION_FOLLOWUP_ACKS } = await import('../src/domain/constants.js');
    const last = ESCALATION_FOLLOWUP_ACKS[ESCALATION_FOLLOWUP_ACKS.length - 1]!;
    const [next] = await acksFor([userRow('halo?'), ackRow(last)], 1);
    expect(next).toBe(ESCALATION_FOLLOWUP_ACKS[0]);
  });

  // /new floors the history the repository returns, so the rotation starts over by itself.
  it('restates the hand-off after /new emptied the history', async () => {
    const { CANNED_STILL_CHECKING_REPLY } = await import('../src/domain/constants.js');
    expect(await acksFor([], 1)).toEqual([CANNED_STILL_CHECKING_REPLY]);
  });

  // UAT Run 2 E-02: a PPN question in an escalated chat got "Baik kak, semuanya sudah saya catat ya."
  // - nothing told the customer the team would answer it.
  it('says the team is checking when the new message is one only the team can answer', async () => {
    const { CANNED_STILL_CHECKING_REPLY, ESCALATION_FOLLOWUP_ACKS } = await import('../src/domain/constants.js');
    const history = [handoffRow(), ackRow(CANNED_STILL_CHECKING_REPLY), ackRow(ESCALATION_FOLLOWUP_ACKS[0]!)];
    const [ack] = await acksFor(history, 1, 'udah termasuk PPN belum ya?');
    expect(ack!.startsWith(CANNED_STILL_CHECKING_REPLY)).toBe(true);
  });

  // ─── Unsupported media: answer honestly instead of guessing ──────────────────

  it('answers a voice note honestly and never calls the AI', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_UNSUPPORTED_MEDIA_REPLY } = await import('../src/domain/constants.js');

    await routeInboundBaileysMessage({ ...makeTextPayload('wamid-VN1', ''), type: 'audio' as never });
    await vi.runAllTimersAsync();

    // The placeholder body used to reach the model, which then answered a question nobody asked.
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][2]).toBe(CANNED_UNSUPPORTED_MEDIA_REPLY);
  });

  // UAT F-12: a location, a sticker and a contact card were each told their "pesan suara/video"
  // could not be opened.
  it('does not call a sticker or location a voice note', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_UNSUPPORTED_OTHER_REPLY } = await import('../src/domain/constants.js');

    await routeInboundBaileysMessage({ ...makeTextPayload('wamid-STK1', ''), type: 'other' as never });
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockSendTextMessage.mock.calls[0][2]).toBe(CANNED_UNSUPPORTED_OTHER_REPLY);
    expect(CANNED_UNSUPPORTED_OTHER_REPLY).not.toMatch(/suara|video/);
  });

  // Live 2026-10-06: two such events a second apart drew "pesan ini belum bisa aku buka" twice.
  it('says the cannot-open line once per burst, but still names a voice note after a sticker', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_UNSUPPORTED_MEDIA_REPLY, CANNED_UNSUPPORTED_OTHER_REPLY } = await import('../src/domain/constants.js');

    await Promise.all([
      routeInboundBaileysMessage({ ...makeTextPayload('wamid-STK2', ''), type: 'other' as never }),
      routeInboundBaileysMessage({ ...makeTextPayload('wamid-STK3', ''), type: 'other' as never }),
    ]);
    await routeInboundBaileysMessage({ ...makeTextPayload('wamid-VN2', ''), type: 'audio' as never });
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual([CANNED_UNSUPPORTED_OTHER_REPLY, CANNED_UNSUPPORTED_MEDIA_REPLY]);
  });

  // UAT F-22: an uncaptioned invoice PDF reached the model as a placeholder and got an answer to
  // an older question, then "silakan tanya produk saja".
  it('hands an uncaptioned document to the team without running the model', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage({
      ...makeTextPayload('wamid-DOC1', ''),
      type: 'document' as const,
      text: null as never,
      media: { base64: 'JVBER', mimeType: 'application/pdf', filename: 'Invoice-INV-2026-0613.pdf' },
    });
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0][1]).toContain('Invoice-INV-2026-0613.pdf');
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false); // no sales question
  });

  it('still lets a captioned document reach the model', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage({
      ...makeTextPayload('wamid-DOC2', 'ini daftar barang yang saya butuhkan kak'),
      type: 'document' as const,
      media: { base64: 'JVBER', mimeType: 'application/pdf', filename: 'daftar.pdf' },
    });
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).not.toHaveBeenCalled();
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
  });

  it('answers an unreadable, uncaptioned photo in Rina\'s voice', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_IMAGE_UNREADABLE_REPLY } = await import('../src/domain/constants.js');

    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-IMG0'), media: null as never });
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls[0][2]).toBe(CANNED_IMAGE_UNREADABLE_REPLY);
    expect(CANNED_IMAGE_UNREADABLE_REPLY).not.toMatch(/\bkami\b|\bAnda\b/);
  });

  it('still answers ordinary text through the AI', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    await routeInboundBaileysMessage(makeTextPayload('wamid-VN2', 'ada engsel kak?'));
    await vi.runAllTimersAsync();
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
  });

  // ─── AI-flagged catalog request: the keyword list is not the only trigger ─────

  // The brand price lists print PRICELIST figures, so who may receive one is a gate, not a
  // preference. A CONFIRMED reseller (store name + city, client 2026-10-16) with two brands on file
  // is the "allowed" fixture.
  const asReseller = () => {
    mockGetContactProfile.mockResolvedValue({ customerType: 'reseller', profile: { business_name: 'Toko Jaya', city: 'Sidoarjo' } });
    mockListBrands.mockResolvedValue([
      { id: 'b1', name: 'Vintage', catalogFileUrl: 'https://cdn.example/vintage.pdf' },
      { id: 'b2', name: 'Blossom', catalogFileUrl: 'https://cdn.example/blossom.pdf' },
    ]);
  };

  it('sends the brand price list when the AI flags a request the keyword list missed', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    asReseller();
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, catalogUrl: 'https://model-invented.example/x.pdf' });

    // No CATALOG_NOUNS hit in this phrasing, but it does name a brand.
    await routeInboundBaileysMessage(makeTextPayload('wamid-CAT1', 'boleh minta file lengkap produk vintage kak?'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).toHaveBeenCalledTimes(1);
    // Always the real file, never the model-provided URL (closed catalog).
    expect(mockSendDocumentMessage.mock.calls[0][2]).toBe('https://cdn.example/vintage.pdf');
  });

  it('image path: AI-flagged catalog request via caption sends the real PDF too', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    asReseller();
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, catalogUrl: 'https://model-invented.example/x.pdf' });

    await routeInboundBaileysMessage(makeImagePayload('wamid-CAT3', 'minta katalog vintage'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).toHaveBeenCalledTimes(1);
    expect(mockSendDocumentMessage.mock.calls[0][2]).toBe('https://cdn.example/vintage.pdf');
  });

  it('keyword-triggered catalog send is not duplicated by the AI catalogUrl flag', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    asReseller();
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, catalogUrl: '/uploads/catalogs/vintage.pdf' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-CAT2', 'minta katalog vintage dong'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).toHaveBeenCalledTimes(1);
  });

  it('sends every brand price list when the customer asks for all of them', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    asReseller();

    await routeInboundBaileysMessage(makeTextPayload('wamid-CAT4', 'boleh minta katalog semua merek?'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).toHaveBeenCalledTimes(2);
  });

  it('sends no price list to an end user - the file carries reseller pricing', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue({ customerType: 'end_user', profile: {} });
    mockListBrands.mockResolvedValue([
      { id: 'b1', name: 'Vintage', catalogFileUrl: 'https://cdn.example/vintage.pdf' },
    ]);

    await routeInboundBaileysMessage(makeTextPayload('wamid-CAT5', 'minta katalog vintage dong'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).not.toHaveBeenCalled();
    // ...and the model is told so, or it cheerfully says "sudah dikirim" over no attachment.
    const note = mockBuildContextAndCallAI.mock.calls.at(-1)![6]?.catalogNote;
    expect(note).toContain('JANGAN katakan katalog sudah dikirim');
    // Owner's call 2026-09-24: point end users at the store, and give the model no reason to
    // repeat - "Katalog price list kami khusus untuk reseller dan proyek" was the old leak (F-15).
    expect(note).toContain('https://shopee.co.id/vintage_indo');
    expect(note).not.toMatch(/pengguna akhir|khusus untuk reseller/);
  });

  it('sends nothing until the buyer type is known, and says why', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue({ customerType: null, profile: {} });
    mockListBrands.mockResolvedValue([
      { id: 'b1', name: 'Vintage', catalogFileUrl: 'https://cdn.example/vintage.pdf' },
    ]);

    await routeInboundBaileysMessage(makeTextPayload('wamid-CAT6', 'minta katalog vintage dong'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).not.toHaveBeenCalled();
    expect(mockBuildContextAndCallAI.mock.calls.at(-1)![6]?.catalogNote).toMatch(/tipe pembeli belum diketahui/i);
  });

  // "dijual lagi" alone is not confirmed: the chat withholds pricelist until the store is known, and
  // so does the file (client, 2026-10-16).
  it('sends no price list to a reseller whose store details are not known yet, and asks for them', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue({ customerType: 'reseller', profile: {} });
    mockListBrands.mockResolvedValue([{ id: 'b1', name: 'Vintage', catalogFileUrl: 'https://cdn.example/vintage.pdf' }]);

    await routeInboundBaileysMessage(makeTextPayload('wamid-CAT8', 'minta price list vintage dong'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).not.toHaveBeenCalled();
    expect(mockBuildContextAndCallAI.mock.calls.at(-1)![6]?.catalogNote).toContain('Daftar harga per merek BELUM dikirim');
  });

  // Live 2026-10-16: the team reported the AI never sent the catalog - end users got no file at all.
  it('sends the company catalogue (no prices) to an end user once it is configured', async () => {
    process.env.CATALOG_FILE_URL = 'https://cdn.example/katalog-2026.pdf';
    try {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      mockGetContactProfile.mockResolvedValue({ customerType: 'end_user', profile: {} });
      mockListBrands.mockResolvedValue([{ id: 'b1', name: 'Vintage', catalogFileUrl: 'https://cdn.example/vintage.pdf' }]);

      await routeInboundBaileysMessage(makeTextPayload('wamid-CAT9', 'minta katalog vintage dong'));
      await vi.runAllTimersAsync();

      expect(mockSendDocumentMessage).toHaveBeenCalledTimes(1);
      expect(mockSendDocumentMessage.mock.calls[0][2]).toBe('https://cdn.example/katalog-2026.pdf');
      expect(mockSendDocumentMessage.mock.calls[0][3]).toBe('Katalog Legacy.pdf');
      expect(mockBuildContextAndCallAI.mock.calls.at(-1)![6]?.catalogNote).toContain('tanpa harga');
    } finally {
      delete process.env.CATALOG_FILE_URL;
    }
  });

  it('asks which brand instead of guessing when none is named', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    asReseller();

    await routeInboundBaileysMessage(makeTextPayload('wamid-CAT7', 'minta katalog dong'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).not.toHaveBeenCalled();
    expect(mockBuildContextAndCallAI.mock.calls.at(-1)![6]?.catalogNote).toContain('merek belum disebut');
  });

  // Live 2026-09-21: two numbers were configured and getFirstPhoneNumber() picked the older
  // one, so every reply was sent AS a number the Chakra plugin does not own. Chakra answered
  // 400, the send threw, and each send site swallows that into a console.warn - so inbound kept
  // working perfectly while WhatsApp went completely silent. Nothing in the system said why.
  describe('replies are sent AS the number the message arrived on', () => {
    const DEMO_PHONE = { id: 'phone-uuid-2', phoneNumberId: '1198363780034673', promptSections: null };

    it('resolves the sender from the inbound metadata, not the first configured row', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      mockFindPhoneNumberByProviderId.mockResolvedValue(DEMO_PHONE);

      await routeInboundBaileysMessage({
        ...makeTextPayload('wamid-PN1', 'halo'),
        toPhoneNumberId: '1198363780034673',
      });
      await vi.runAllTimersAsync();

      expect(mockFindPhoneNumberByProviderId).toHaveBeenCalledWith('1198363780034673');
      expect(mockSendTextMessage.mock.calls[0][0]).toBe('1198363780034673');
      expect(mockSendTextMessage.mock.calls[0][0]).not.toBe(BASE_PHONE.phoneNumberId);
    });

    it('falls back to the first number when the payload carries none (Baileys shape)', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

      await routeInboundBaileysMessage(makeTextPayload('wamid-PN2', 'halo'));
      await vi.runAllTimersAsync();

      expect(mockFindPhoneNumberByProviderId).not.toHaveBeenCalled();
      expect(mockSendTextMessage.mock.calls[0][0]).toBe(BASE_PHONE.phoneNumberId);
    });

    it('falls back when the inbound number is not configured, instead of dropping the message', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      mockFindPhoneNumberByProviderId.mockResolvedValue(null);

      await routeInboundBaileysMessage({
        ...makeTextPayload('wamid-PN3', 'halo'),
        toPhoneNumberId: 'not-configured',
      });
      await vi.runAllTimersAsync();

      expect(mockSendTextMessage.mock.calls[0][0]).toBe(BASE_PHONE.phoneNumberId);
    });
  });

  it('a price question is not a request for the price list file', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    asReseller();

    // "daftar harga" is in CATALOG_NOUNS, and as a bare substring this used to fire a send.
    await routeInboundBaileysMessage(makeTextPayload('wamid-CAT8', 'berapa daftar harga handle newton untuk pintu kayu ya?'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).not.toHaveBeenCalled();
  });

  it('already-escalated + low confidence → still-checking ack, no second escalation, never silence', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_STILL_CHECKING_REPLY } = await import('../src/domain/constants.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, confidence: 'low', escalationReason: 'over budget' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-ESC1', 'budget gk sampai 100rb'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).not.toHaveBeenCalled();
    // The live bug: this used to be a silent drop — three customer messages, one reply.
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][2]).toBe(CANNED_STILL_CHECKING_REPLY);
    expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant', body: CANNED_STILL_CHECKING_REPLY,
    }));
  });

  it('escalated + high-confidence reply WITH a price → still sent; escalation does not gag the AI', async () => {
    // Escalation notifies a human; it must not change what the customer is told. This used to
    // hold any Rp-bearing reply while escalated, after a bengkel motor restated its shop name
    // an hour post-escalation and got the reseller pricelist (2026-08-20). That hold was blunt
    // enough to eat prices for unrelated products - live, a single bad figure on a padlock
    // silenced every price in the conversation for twenty hours, across a different product,
    // while the customer asked "kok lama ya". Removed deliberately. The tier leak it was
    // guarding belongs to a customerType-aware price check (see CLAUDE.md), not to a
    // conversation-wide gag.
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_STILL_CHECKING_REPLY } = await import('../src/domain/constants.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    const reply = 'Bengkel Jaya Motor sudah terdaftar 😊 Harganya Rp 116.000/Set, minimum 3 set.';
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: reply, confidence: 'high' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-HOLD1', 'bengkel jaya motor kak nama tokonya'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][2]).toBe(reply);
    expect(mockSendTextMessage.mock.calls[0][2]).not.toBe(CANNED_STILL_CHECKING_REPLY);
    expect(mockEscalateConversation).not.toHaveBeenCalled();
  });

  it('escalated + image-caption price reply → also sent, image path is not gagged either', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockBuildContextAndCallAI.mockResolvedValue({
      ...BASE_AI_RESPONSE, message: 'Ini Rp 42.000/Set ya kak.', confidence: 'high',
    });

    await routeInboundBaileysMessage(makeImagePayload('wamid-HOLD2', 'ini fotonya, harganya berapa?'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][2]).toBe('Ini Rp 42.000/Set ya kak.');
  });

  it('already-escalated + NEW reason → escalation_reason is refreshed, not left stale', async () => {
    // The banner used to show whatever first escalated the conversation: live, an objection
    // about a padlock sat on a conversation that had moved on to cement trowels 18 days later,
    // so the team had nothing actionable to pick up.
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockBuildContextAndCallAI.mockResolvedValue({
      ...BASE_AI_RESPONSE, confidence: 'low', escalationReason: 'Cetok oval - ukuran tidak ada di katalog',
    });

    await routeInboundBaileysMessage(makeTextPayload('wamid-STALE1', 'yg biasanya aja, yg oval'));
    await vi.runAllTimersAsync();

    expect(mockUpdateConversationStatus).toHaveBeenCalledWith(
      'conv-uuid-1', 'escalated', 'Cetok oval - ukuran tidak ada di katalog'
    );
    expect(mockEscalateConversation).not.toHaveBeenCalled();
  });

  it('still-checking ack carries a profile-gap question when the profile is thin', async () => {
    // Five identical dead lines in a row is what the customer actually got. When the AI has
    // nothing to say, at least collect what the team will need — same question the first
    // hand-off asks.
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_STILL_CHECKING_REPLY, ESCALATION_ASK_CUSTOMER_TYPE } = await import('../src/domain/constants.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockGetContactProfile.mockResolvedValue({ customerType: null, profile: {} });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, confidence: 'low' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-GAP1', 'kok lama ya'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][2]).toBe(`${CANNED_STILL_CHECKING_REPLY} ${ESCALATION_ASK_CUSTOMER_TYPE}`);
  });

  it('but NOT when the customer asked for a human — same rule escalateConversation follows', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_STILL_CHECKING_REPLY } = await import('../src/domain/constants.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockGetContactProfile.mockResolvedValue({ customerType: null, profile: {} });
    mockDetectHumanRequest.mockReturnValue(true);
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, confidence: 'low' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-GAP2', 'mau bicara dengan orang aja'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls[0][2]).toBe(CANNED_STILL_CHECKING_REPLY);
  });

  // UAT F-06: the buyer type was asked four times after "sendiri" - the answer never reached the
  // profile, and the ack asked on. Once is enough; the next rung (or nothing) comes after.
  it('never repeats a gap question the conversation already asked', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_STILL_CHECKING_REPLY, ESCALATION_ASK_CUSTOMER_TYPE, ESCALATION_ASK_QUANTITY } =
      await import('../src/domain/constants.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockGetContactProfile.mockResolvedValue({ customerType: null, profile: {} });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, confidence: 'low' });
    mockGetLastNMessages.mockResolvedValue([
      { role: 'assistant', body: `Kita coba cek dengan tim dulu ya kak 🙏 ${ESCALATION_ASK_CUSTOMER_TYPE}` },
      { role: 'user', body: 'sendiri' },
    ]);

    await routeInboundBaileysMessage(makeTextPayload('wamid-GAP3', 'kok lama ya'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls[0][2]).toBe(`${CANNED_STILL_CHECKING_REPLY} ${ESCALATION_ASK_QUANTITY}`);
  });

  // UAT E-05: "engsel yang saya beli bulan lalu sudah berkarat" got "kira-kira kebutuhannya berapa
  // banyak ya kak?" appended to the hand-off.
  it('a complaint hand-off opens with an apology and asks no sales question', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_COMPLAINT_REPLY } = await import('../src/domain/constants.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: 'Komplain karat' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-CMP1', 'engsel yang saya beli bulan lalu sudah berkarat, gimana ini?'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);
    expect(mockEscalateConversation.mock.calls[0][5]).toBe(CANNED_COMPLAINT_REPLY);
  });

  // Live 2026-10-12: "grab / mau ambil pesanan" was asked "dipakai sendiri, untuk proyek, atau dijual
  // lagi?". This number is also the marketplace sender number; couriers go to the team as they are.
  it('hands a courier to the team without an AI call or a sales question', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_NON_SALES_REPLY } = await import('../src/domain/constants.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-KUR1', 'grab'));
    await routeInboundBaileysMessage(makeTextPayload('wamid-KUR2', 'mau ambil pesanan'));
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);
    expect(mockEscalateConversation.mock.calls[0][5]).toBe(CANNED_NON_SALES_REPLY);
  });

  // Probe 2026-10-13: "sudah transfer, tolong dicek" got "saya teruskan ke tim" with nobody told, and a
  // job seeker got an invented HR channel. Both now go to the team as they are.
  it.each([
    ['kak saya sudah transfer, tolong dicek ya', 'Pembayaran / status pesanan'],
    ['mau tanya kak, kalau mau kirim CV kemana ya?', 'Lowongan kerja'],
  ])('hands "%s" to the team without an AI call or a sales question', async (text, topic) => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    await routeInboundBaileysMessage(makeTextPayload(`wamid-NS-${topic.length}`, text));
    await vi.runAllTimersAsync();
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockEscalateConversation.mock.calls[0][1]).toContain(topic);
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);
  });

  // Live 2026-10-31: a plastics factory offering us packaging. Its words matched no pattern, the model
  // handed it off itself ("Penawaran menjadi supplier/kerja sama produk plastik"), and the hand-off still
  // asked "kira-kira kebutuhannya berapa banyak ya kak?" - then every ack after it could too.
  it('asks a supplier the model handed off no sales question, on the hand-off or the acks after it', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_NON_SALES_REPLY, CANNED_STILL_CHECKING_REPLY } = await import('../src/domain/constants.js');
    const reason = 'Penawaran menjadi supplier/kerja sama produk plastik - keluar dari scope hardware.';
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: reason });

    await routeInboundBaileysMessage(makeTextPayload('wamid-SUP1', 'Kami dari pabrik plastik kantongan, shrink, stretch film'));
    await vi.runAllTimersAsync();
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1); // the model saw it, not the patterns
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);
    expect(mockEscalateConversation.mock.calls[0][5]).toBe(CANNED_NON_SALES_REPLY);

    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated', escalationReason: reason });
    mockGetContactProfile.mockResolvedValue({ customerType: null, profile: {} });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', confidence: 'low' });
    await routeInboundBaileysMessage(makeTextPayload('wamid-SUP2', 'halo kak?'));
    await vi.runAllTimersAsync();
    expect(mockSendTextMessage.mock.calls.at(-1)?.[2]).toBe(CANNED_STILL_CHECKING_REPLY);
  });

  it('hands a supplier to the team when its introduction and its offer come in different messages', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_NON_SALES_REPLY } = await import('../src/domain/constants.js');
    mockGetLastNMessages.mockResolvedValue([
      { role: 'user', body: 'Kami dari pabrik plastik kantongan, shrink, stretch film', createdAt: new Date() },
      { role: 'assistant', body: 'Baik Bu Windy, ada yang bisa saya bantu?', createdAt: new Date() },
    ]);

    await routeInboundBaileysMessage(makeTextPayload('wamid-SUP3', 'Terkait dengan kebutuhan plastik kami bisa menghubungi kemana ya kak?'));
    await vi.runAllTimersAsync();
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockEscalateConversation.mock.calls[0][1]).toContain('Penawaran kerja sama / supplier');
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);
    expect(mockEscalateConversation.mock.calls[0][5]).toBe(CANNED_NON_SALES_REPLY);
  });

  // UAT Run 2 G-07: a job seeker was asked whether it was "untuk dipakai sendiri, proyek, atau
  // dijual lagi" - on the hand-off, and again on every ack while waiting.
  it('asks a job seeker no sales question, on the hand-off or the acks after it', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_STILL_CHECKING_REPLY } = await import('../src/domain/constants.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: 'Lowongan kerja' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-JOB1', 'permisi apa masih ada lowongan driver pengiriman?'));
    await vi.runAllTimersAsync();
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);

    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockGetContactProfile.mockResolvedValue({ customerType: null, profile: {} });
    mockGetLastNMessages.mockResolvedValue([{ role: 'user', body: 'permisi apa masih ada lowongan driver pengiriman?' }]);
    await routeInboundBaileysMessage(makeTextPayload('wamid-JOB2', 'halo?'));
    await vi.runAllTimersAsync();
    expect(mockSendTextMessage.mock.calls.at(-1)?.[2]).toBe(CANNED_STILL_CHECKING_REPLY);
  });

  // UAT E-06: while the complaint waits, "halo? / jadi gimana" carry no complaint words themselves.
  it('keeps the follow-up acks of a complaint free of sales questions', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_STILL_CHECKING_REPLY } = await import('../src/domain/constants.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockGetContactProfile.mockResolvedValue({ customerType: null, profile: {} });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, confidence: 'low' });
    mockGetLastNMessages.mockResolvedValue([{ role: 'user', body: 'engselnya sudah berkarat kak' }]);

    await routeInboundBaileysMessage(makeTextPayload('wamid-CMP2', 'jadi gimana kak'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls[0][2]).toBe(CANNED_STILL_CHECKING_REPLY);
  });

  it('keeps chatting when escalated: a normal high-confidence reply is still sent', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'Baik kak, sama-sama!', confidence: 'high' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-ESC2', 'oke makasih kak'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });

  // The bot answering an escalated chat must not hide it from the team working the hand-off (a
  // RAB, a discount): "butuh 50 engsel" is exactly what they need to see.
  it('still notifies staff when the bot answers inside an escalated chat', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'Engsel 4" Rp 59.000/Set kak.', confidence: 'high' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-ESC3', 'butuh 50 engsel'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls[0][2]).toBe('Engsel 4" Rp 59.000/Set kak.');
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1);
    expect((mockNotifyStaff.mock.calls[0]![0] as { body: string }).body).toContain('butuh 50 engsel');
  });

  it('does not notify staff for an ordinary answered turn outside an escalation', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-ESC4', 'ada engsel 4 inch?'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockNotifyStaff).not.toHaveBeenCalled();
  });

  // ─── AI on/off gate: global default + per-contact override ────────────────

  it('AI off globally, contact has no override → message recorded, no AI, no reply', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetAiEnabledDefault.mockResolvedValue(false);

    await routeInboundBaileysMessage(makeTextPayload('wamid-OFF1', 'Halo ada handle newton?'));
    await vi.runAllTimersAsync();

    expect(mockInsertMessageIfNew).toHaveBeenCalledTimes(1); // still recorded for CRM
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('AI off globally, contact pinned on → AI runs and replies', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetAiEnabledDefault.mockResolvedValue(false);
    mockUpsertContact.mockResolvedValue({ ...BASE_CONTACT, aiEnabled: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-ON1', 'Halo ada handle newton?'));
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('AI on globally, contact pinned off → message recorded, no AI, no reply', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetAiEnabledDefault.mockResolvedValue(true);
    mockUpsertContact.mockResolvedValue({ ...BASE_CONTACT, aiEnabled: false });

    await routeInboundBaileysMessage(makeTextPayload('wamid-OFF2', 'Halo ada handle newton?'));
    await vi.runAllTimersAsync();

    expect(mockInsertMessageIfNew).toHaveBeenCalledTimes(1);
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('AI off for the contact also blocks the image path', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockUpsertContact.mockResolvedValue({ ...BASE_CONTACT, aiEnabled: false });

    await routeInboundBaileysMessage(makeImagePayload('wamid-OFF-IMG'));
    await vi.runAllTimersAsync();

    expect(mockInsertMessageIfNew).toHaveBeenCalledTimes(1);
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  // ─── First-message debounce window (TYPING_DEBOUNCE_FIRST_MS) ───────────────

  it('a lone first message fires after TYPING_DEBOUNCE_FIRST_MS, not the full window', async () => {
    process.env.TYPING_DEBOUNCE_MS = '8000';
    process.env.TYPING_DEBOUNCE_FIRST_MS = '2000';
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-F01', 'ada gembok?'));

    await vi.advanceTimersByTimeAsync(1900);
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    await vi.runAllTimersAsync();
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

    delete process.env.TYPING_DEBOUNCE_MS;
    delete process.env.TYPING_DEBOUNCE_FIRST_MS;
  });

  it('a 2nd message inside the first window re-arms to the FULL window and merges', async () => {
    process.env.TYPING_DEBOUNCE_MS = '8000';
    process.env.TYPING_DEBOUNCE_FIRST_MS = '2000';
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    let n = 0;
    mockInsertMessageIfNew.mockImplementation(async () => ({ id: `msg-${++n}`, conversationId: 'conv-uuid-1' }));

    await routeInboundBaileysMessage(makeTextPayload('wamid-F02', 'baris satu'));
    await vi.advanceTimersByTimeAsync(1000); // still inside the short first window
    await routeInboundBaileysMessage(makeTextPayload('wamid-F03', 'baris dua'));

    // 2nd message re-armed the FULL 8s window — well past the short window, still quiet.
    await vi.advanceTimersByTimeAsync(4000);
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    const combined = mockBuildContextAndCallAI.mock.calls[0][1] as string;
    expect(combined).toContain('baris satu');
    expect(combined).toContain('baris dua');

    delete process.env.TYPING_DEBOUNCE_MS;
    delete process.env.TYPING_DEBOUNCE_FIRST_MS;
  });

  it('TYPING_DEBOUNCE_FIRST_MS never exceeds the full window (min-bound)', async () => {
    process.env.TYPING_DEBOUNCE_MS = '1000';
    process.env.TYPING_DEBOUNCE_FIRST_MS = '4000'; // misconfigured higher than the window
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-F04', 'halo'));
    await vi.advanceTimersByTimeAsync(1100);
    await vi.runAllTimersAsync();
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

    delete process.env.TYPING_DEBOUNCE_MS;
    delete process.env.TYPING_DEBOUNCE_FIRST_MS;
  });

  // ─── AI failure is never silent: it rides the escalation flow ────────────────

  it('a thrown AI call escalates (with the pre-resolved phone number), never silence', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockBuildContextAndCallAI.mockRejectedValue(new Error('Request timed out'));

    await routeInboundBaileysMessage(makeTextPayload('wamid-ERR1', 'ada handle newton?'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0][1]).toContain('AI call failed');
    // 5th arg: the phone number resolved at enqueue time — no re-query inside escalation.
    expect(mockEscalateConversation.mock.calls[0][4]).toEqual(BASE_PHONE);
  });

  it('a thrown AI call on an already-escalated conversation sends the still-checking ack', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_STILL_CHECKING_REPLY } = await import('../src/domain/constants.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockBuildContextAndCallAI.mockRejectedValue(new Error('overloaded'));

    await routeInboundBaileysMessage(makeTextPayload('wamid-ERR2', 'jadi gimana kak?'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][2]).toBe(CANNED_STILL_CHECKING_REPLY);
  });

  it('image path: a thrown AI call escalates too', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockBuildContextAndCallAI.mockRejectedValue(new Error('boom'));

    await routeInboundBaileysMessage(makeImagePayload('wamid-ERR3'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0][1]).toContain('AI call failed');
  });

  // ─── Vision extraction must not block the AI call ────────────────────────────

  it('image turn starts the AI call while vision extraction is still running', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    // Vision call never resolves — the AI call must start anyway.
    mockExtractCatalogKeywords.mockReturnValue(new Promise(() => { }));

    await routeInboundBaileysMessage(makeImagePayload('wamid-VIS1'));
    await vi.advanceTimersByTimeAsync(5000);

    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    // The keywords ride along as a promise for aiLayer to await at the right point.
    expect(mockBuildContextAndCallAI.mock.calls[0][3]).toBeInstanceOf(Promise);
  });

  // Client 2026-11-11: "klu tidak bisa menangkap itu gambar apa, lempar ke human; klu AI yakin dan sesuai
  // punya kita, bru tawarkan". Only a confirmed match reaches the reply model; a "mirip" goes to the team.
  it('hands a photo that only looks similar to the team, offering nothing', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_PHOTO_CHECK_REPLY, PHOTO_UNSURE_REASON } = await import('../src/domain/constants.js');
    mockMatchCustomerPhoto.mockResolvedValueOnce({
      certainty: 'similar',
      product: { name: 'GEMBOK KOTAK CHROME PANJANG', brand: 'Blossom', imageUrl: '/uploads/images/kotak.jpg' },
      compared: ['GEMBOK KOTAK CHROME PANJANG', 'GEMBOK BULAT PUTIH'],
      reason: 'bentuk kotak, leher panjang',
    });

    await routeInboundBaileysMessage(makeImagePayload('wamid-PM1'));
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    const call = mockEscalateConversation.mock.calls[0]!;
    expect(call[1]).toBe(`${PHOTO_UNSURE_REASON} (mirip GEMBOK KOTAK CHROME PANJANG, belum pasti)`);
    expect(call[5]).toBe(CANNED_PHOTO_CHECK_REPLY);
  });

  it('hands a photo with nothing to compare against, or no match, to the team too', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockMatchCustomerPhoto
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ certainty: 'none', product: null, compared: ['GEMBOK BESI JACKET'], reason: 'beda' });

    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-PM2'), timestamp: 100 });
    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-PM2b'), timestamp: 101 });
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockEscalateConversation.mock.calls[0]![1]).toMatch(/foto 1: tidak ada hasil perbandingan foto; foto 2: tidak sama/);
  });

  // Live 2026-10-22: a SOLID padlock pack became "gembok 60mm solid yang kokoh". The brand printed on
  // the photo reaches the reply as a brand we do not carry, and stays on the message for later turns.
  it('tells the reply a brand printed on the photo is not ours', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockOtherBrands.mockReturnValue(['SOLID']);
    mockVisionExtractToKeywords.mockReturnValue(['gembok']);
    // As in production: the comparison waits for the vision step before it answers.
    mockMatchCustomerPhoto.mockImplementationOnce(async (...args: unknown[]) => {
      await args[1];
      return { certainty: 'same', product: { name: 'GEMBOK BESI JACKET', brand: 'Blossom', imageUrl: '/j.jpg' }, compared: ['GEMBOK BESI JACKET'], reason: 'identik' };
    });

    await routeInboundBaileysMessage(makeImagePayload('wamid-BR1'));
    await vi.runAllTimersAsync();

    const turn = mockBuildContextAndCallAI.mock.calls[0][6] as { photoNote?: string };
    expect(turn.photoNote).toMatch(/PERBANDINGAN FOTO/);
    expect(turn.photoNote).toMatch(/MEREK DI FOTO: .*merek SOLID - itu NAMA MEREK lain, bukan merek kami/);
    expect(mockMergeMessageMetadata).toHaveBeenCalledWith('msg-uuid', {
      photoContext: 'merek SOLID (bukan merek kami); produk kami GEMBOK BESI JACKET (foto sama)',
    });
  });

  // Only this turn sees the image; what it found is kept on the message for later turns.
  it('keeps what the photo was on the message, for later turns', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockMatchCustomerPhoto.mockResolvedValueOnce({
      certainty: 'same',
      product: { name: 'HANDLE KECIL + BODY GUANGZHOU', brand: 'Aomori Slim', imageUrl: '/uploads/images/g.jpg' },
      compared: ['HANDLE KECIL + BODY GUANGZHOU'],
      reason: 'identik',
    });

    await routeInboundBaileysMessage(makeImagePayload('wamid-PM3'));
    await vi.runAllTimersAsync();

    expect(mockMergeMessageMetadata).toHaveBeenCalledWith('msg-uuid', { photoContext: 'produk kami HANDLE KECIL + BODY GUANGZHOU (foto sama)' });
  });


  // ─── A size the catalog does not have goes to the team (client 2026-11-11) ────
  it('adds the team line and escalates when a size question got no size', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_SIZE_FOR_TEAM } = await import('../src/domain/constants.js');
    const answer = 'Untuk Handle Besar + Body Kunci Vintage Graham: Harga Rp 294.000/Set, warna BNSN, SNGP.';
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: answer });

    await routeInboundBaileysMessage(makeTextPayload('wamid-SZ1', 'pilihan panjangnya ada berapa bu ?'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual([`${answer}\n\n${CANNED_SIZE_FOR_TEAM}`]);
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.stringContaining('ukuran'));
  });

  it('leaves a reply that gives the size alone', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'Ada 2 pilihan kak: besar 25 cm dan tanggung 20 cm.' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-SZ2', 'pilihan panjangnya ada berapa bu ?'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual(['Ada 2 pilihan kak: besar 25 cm dan tanggung 20 cm.']);
    expect(mockUpdateConversationStatus).not.toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.anything());
  });

  // ─── A total over many items goes to the team (owner, 2026-10-27) ────────────
  it('sends the per-item answer, says the team will calculate the total, and tells the team', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_TOTAL_FOR_TEAM } = await import('../src/domain/constants.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'Engsel 4": Rp 42.000/Set', totalForTeam: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-TOT1', 'jadi total berapa'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual([`Engsel 4": Rp 42.000/Set\n\n${CANNED_TOTAL_FOR_TEAM}`]);
    expect(mockEscalateConversation).not.toHaveBeenCalled();
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.stringContaining('total'));
    expect(mockNotifyStaff).toHaveBeenCalled();
  });

  it('does the same on a photo turn', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_TOTAL_FOR_TEAM } = await import('../src/domain/constants.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'FOTO 1: grendel tanam Rp 112.500/Set', totalForTeam: true });

    await routeInboundBaileysMessage(makeImagePayload('wamid-TOT2'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls[0]![2]).toContain(CANNED_TOTAL_FOR_TEAM);
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.stringContaining('total'));
  });

  // ─── PPN / tax questions hand off, whatever the model thought ────────────────
  // Whether a price includes PPN is a commercial commitment. The model answering it
  // confidently is exactly the failure this gate exists for, so confidence is 'high'
  // in both tests below and the hand-off still has to happen.

  // ─── No Claude token left (owner, 2026-11-03) ────────────────────────────────
  // From 2026-11-02 every token was spent or revoked, and every message got "Kita coba cek dengan
  // tim dulu ya kak" plus a sales question. With no token left the bot now says nothing at all.
  describe('no Claude token left', () => {
    const outOfClaude = () => {
      mockTokensExhausted.mockReturnValue(true);
      mockBuildContextAndCallAI.mockRejectedValue(new Error('Claude Code returned an error result: Failed to authenticate. API Error: 401 OAuth access token has been revoked.'));
    };
    afterEach(() => mockTokensExhausted.mockReturnValue(false));

    it('sends nothing and hands nothing off, but tells staff once', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      outOfClaude();

      await routeInboundBaileysMessage(makeTextPayload('wamid-NOC1', 'Halo'));
      await vi.runAllTimersAsync();
      await routeInboundBaileysMessage(makeTextPayload('wamid-NOC2', 'budi'));
      await vi.runAllTimersAsync();

      expect(mockSendTextMessage).not.toHaveBeenCalled();
      expect(mockEscalateConversation).not.toHaveBeenCalled();
      expect(mockUpdateConversationStatus).not.toHaveBeenCalled();
      expect(mockNotifyStaff).toHaveBeenCalledTimes(1);
      expect(mockNotifyStaff.mock.calls[0]![0].title).toMatch(/AI tidak aktif/);
    });

    it('sends no still-checking ack in a chat already handed off', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
      outOfClaude();

      await routeInboundBaileysMessage(makeTextPayload('wamid-NOC3', 'masih ada?'));
      await vi.runAllTimersAsync();

      expect(mockSendTextMessage).not.toHaveBeenCalled();
      expect(mockInsertMessage).not.toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' }));
    });

    it('stays silent on a photo turn too', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      outOfClaude();

      await routeInboundBaileysMessage(makeImagePayload('wamid-NOC4', 'ada yang kaya gini?'));
      await vi.runAllTimersAsync();

      expect(mockSendTextMessage).not.toHaveBeenCalled();
      expect(mockEscalateConversation).not.toHaveBeenCalled();
    });

    it('still hands off when the AI fails for any other reason', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      mockBuildContextAndCallAI.mockRejectedValue(new Error('overloaded'));

      await routeInboundBaileysMessage(makeTextPayload('wamid-NOC5', 'ada handle?'));
      await vi.runAllTimersAsync();

      expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
      expect(mockEscalateConversation.mock.calls[0][1]).toContain('AI call failed');
    });
  });

  it('escalates a PPN question even when the AI returned confidence "high"', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-PPN1', 'harganya sudah termasuk ppn belum ya kak?'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0][1]).toContain('PPN');
    // The model's own answer must not be sent alongside the hand-off.
    expect(mockSendTextMessage).not.toHaveBeenCalled();
    // Client 2026-10-26: a tax question goes to the team as it is - no "dipakai sendiri, untuk
    // proyek, atau dijual lagi?" on the hand-off.
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);
  });

  // Live 2026-10-26 (PT Sinergi Multi Teknindo): the faktur question was only inside a screenshot of
  // the customer's marketplace chat with us. The model read it and handed off, but nothing in the
  // caption said "pajak", so the hand-off asked "dipakai sendiri, untuk proyek, atau dijual lagi?".
  it('hands off a tax question read from a chat screenshot, with no sales question', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockExtractCatalogKeywords.mockResolvedValue({ chat_text: ['pembelian legacy apakah bisa dapat faktur pajak kak?'] });
    // Confident: the screenshot itself has staff saying "bisa pakai faktur", which the model could repeat.
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'Bisa kak, pakai faktur.' });

    await routeInboundBaileysMessage(makeImagePayload('wamid-PPN4'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0][1]).toContain('PPN');
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  // The vision step can fail; the model's own hand-off reason still says what the hand-off is about.
  it('asks no sales question when the model hands off over tax it read from the photo', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockBuildContextAndCallAI.mockResolvedValue({ message: '', confidence: 'low', escalationReason: 'Customer menanyakan faktur pajak untuk pembelian 1pcs' });

    await routeInboundBaileysMessage(makeImagePayload('wamid-PPN5'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);
  });

  it('escalates a PPN question asked in an image caption', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeImagePayload('wamid-PPN2', 'ini harganya include pajak?'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0][1]).toContain('PPN');
  });

  it('leaves an ordinary product question alone', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-PPN3', 'ada handle besar yang murah?'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });

  // ─── /new ────────────────────────────────────────────────────────────────
  //
  // The gate's own logic is unit-tested in context-reset.test.ts; what matters here is where
  // it sits. Below the AI gate it would still reset, but the model would also answer "/new" -
  // and below the lead hook it would leave a lead behind for a command that is not a sales
  // message. Both are invisible except by asserting the short-circuit.
  describe('/new', () => {
    // UAT Run 2 12:03: the setup line sent one second after /new fell under a floor stamped at
    // processing time, because every inbound row is backdated to its WhatsApp send time.
    it('floors at the /new message\'s own send time, and writes its note there', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const T = Math.floor(Date.now() / 1000) - 5;

      await routeInboundBaileysMessage({ ...makeTextPayload('wamid-NEWT', '/new'), timestamp: T });
      await vi.runAllTimersAsync();

      const floor = mockResetConversationContext.mock.calls[0]![1] as Date;
      expect(floor.getTime()).toBe(T * 1000);
      expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'system_note', createdAt: floor }));
    });

    // UAT Run 2 11:34:59: "/halo", still in the debounce when /new arrived, was answered after it.
    it('never answers a text sent before /new that was still waiting in the debounce', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const T = Math.floor(Date.now() / 1000);

      await routeInboundBaileysMessage({ ...makeTextPayload('wamid-PRE1', '/halo'), timestamp: T - 2 });
      await routeInboundBaileysMessage({ ...makeTextPayload('wamid-PRE2', '/new'), timestamp: T });
      await vi.runAllTimersAsync();

      expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
      expect(mockSendTextMessage).toHaveBeenCalledTimes(1); // the reset confirmation only
    });

    it('never answers a photo sent before /new that was still waiting to be answered', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const T = Math.floor(Date.now() / 1000);

      await routeInboundBaileysMessage({ ...makeImagePayload('wamid-PREP1'), timestamp: T - 2 });
      await routeInboundBaileysMessage({ ...makeTextPayload('wamid-PREP2', '/new'), timestamp: T });
      await vi.runAllTimersAsync();

      expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    });

    it('keeps a text typed after /new even when it was delivered first', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const T = Math.floor(Date.now() / 1000);

      await routeInboundBaileysMessage({ ...makeTextPayload('wamid-POST1', 'halo, saya Budi'), timestamp: T + 1 });
      await routeInboundBaileysMessage({ ...makeTextPayload('wamid-POST2', '/new'), timestamp: T });
      await vi.runAllTimersAsync();

      expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
      expect(mockBuildContextAndCallAI.mock.calls[0]![1]).toBe('halo, saya Budi');
    });

    it('drops the reply of a turn that was in flight when /new arrived - and its profile facts', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const T = Math.floor(Date.now() / 1000);
      let resolveAI!: (r: unknown) => void;
      mockBuildContextAndCallAI.mockImplementation(() => new Promise((r) => { resolveAI = r; }));

      await routeInboundBaileysMessage({ ...makeTextPayload('wamid-FLY1', 'engsel tipis aomori 2,5 inch berapa?'), timestamp: T - 20 });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

      await routeInboundBaileysMessage({ ...makeTextPayload('wamid-FLY2', '/new'), timestamp: T });
      resolveAI({ ...BASE_AI_RESPONSE, message: 'Engsel tipis 2½" Rp 8.000/Pcs kak.', customerType: 'end_user' });
      await vi.runAllTimersAsync();

      expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual(['Konteks direset. Percakapan berikutnya dimulai dari nol.']);
      expect(mockSaveConversationInsights).not.toHaveBeenCalled();
    });

    it('resets and answers nothing else - no AI turn, no lead', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

      await routeInboundBaileysMessage(makeTextPayload('wamid-NEW1', '/new'));
      await vi.runAllTimersAsync();

      expect(mockResetConversationContext).toHaveBeenCalledWith('conv-uuid-1', expect.any(Date));
      expect(mockDeleteContactProfile).toHaveBeenCalledTimes(1);
      expect(mockResetLeadsForContact).toHaveBeenCalledTimes(1);
      expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
      expect(mockRecordLeadFromMessage).not.toHaveBeenCalled();
      // Only the confirmation - the model never got a turn.
      expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    });

    it('is an ordinary message from a number that is not whitelisted', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

      await routeInboundBaileysMessage({ ...makeTextPayload('wamid-NEW2', '/new'), from: '628999000999' });
      await vi.runAllTimersAsync();

      expect(mockResetConversationContext).not.toHaveBeenCalled();
      expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    });
  });
});
