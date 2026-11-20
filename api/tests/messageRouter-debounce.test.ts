/**
 * QA Gate: Typing Debounce — AI Spam Fix
 * SHA: 6b52651
 *
 * Covers AC-1 through AC-6 for the per-conversation text debounce feature
 * in src/services/messageRouter.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BOX_GRAMASI, SUPREME } from './price-fixtures.js';
import { itemKey } from '../src/domain/orderProfile.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockGetFirstPhoneNumber = vi.fn();
const mockFindPhoneNumberByProviderId = vi.fn();
const mockGetAiEnabledDefault = vi.fn();
const mockGetPoFormUrls = vi.fn();
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
type HistoryRow = { role: string; body: string; status?: string; metadata?: Record<string, unknown> | null };
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
  getPoFormUrls: mockGetPoFormUrls,
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
const mockUpsertContactProfile = vi.fn();
vi.mock('../src/repositories/contactProfiles.js', () => ({
  getContactProfile: mockGetContactProfile,
  upsertContactProfile: mockUpsertContactProfile,
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
// The catalog the PO form's gramasi check reads (and the reference photos' owners). Empty by default:
// no product with gramasi, so every turn sends the form as it did before the check.
const mockGetCatalogProducts = vi.fn(async (): Promise<unknown[]> => []);
vi.mock('../src/services/ragQuery.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/ragQuery.js')>()),
  getCatalogProducts: mockGetCatalogProducts,
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
}));
// The comparison with catalog photos talks to the DB and the model; tests/photo-match.test.ts covers
// it. Here it resolves at once to "nothing to compare", which is a catalog with no photos yet.
// A confirmed match by default: since 2026-11-11 any other verdict hands the photo to the team before
// the AI runs (photoUnsureReason), and most photo tests here are about batching and timing.
const SAME_VERDICT = { certainty: 'same', product: { name: 'BOX NASI KRAFT 20X20 CETAK 1 WARNA', brand: 'Imperial Indopack', imageUrl: '/uploads/images/box-nasi.jpg' }, compared: ['BOX NASI KRAFT 20X20 CETAK 1 WARNA'], reason: 'identik' };
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
    mockGetPoFormUrls.mockResolvedValue({ cetak: 'https://forms.gle/REPLACE-ME', plano: 'https://forms.gle/REPLACE-ME' });
    mockUpsertContact.mockResolvedValue(BASE_CONTACT);
    mockUpsertConversation.mockResolvedValue({ ...BASE_CONVERSATION });
    mockResetConversationToActive.mockResolvedValue(null);
    mockUpdateConversationStatus.mockResolvedValue(null);
    mockGetLastNMessages.mockResolvedValue([]);
    // Complete profile by default → pickProfileGapQuestion returns null, so the still-checking
    // ack is the bare line. The thin-profile case gets its own test below.
    // all six order details known, so no gap question rides on the acks
    mockGetContactProfile.mockResolvedValue({ customerType: null, profile: { name: 'Budi', business_name: 'RM Siang', items: [{ product: 'box nasi', size: '10x10x5', qty: 2500, qty_unit: 'pcs', has_design: true }] } });
    mockInsertMessageIfNew.mockResolvedValue({ id: 'msg-uuid', conversationId: 'conv-uuid-1' });
    mockClaimSyncedInbound.mockResolvedValue(null);
    mockSyncContactChat.mockResolvedValue(0);
    mockInsertMessage.mockResolvedValue({ id: 'msg-reply-uuid' });
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION });
    mockFindMessageByWaMessageId.mockResolvedValue(null);
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE });
    mockSendTextMessage.mockResolvedValue('wa-sent-id');
    mockSendImageMessage.mockResolvedValue('wa-img-id');
    mockSendDocumentMessage.mockResolvedValue('wa-doc-id');
    mockListBrands.mockResolvedValue([]);
    mockGetCatalogProducts.mockResolvedValue([]);
    mockUpsertContactProfile.mockResolvedValue(undefined);
    mockEscalateConversation.mockResolvedValue(undefined);
    mockDetectHumanRequest.mockReturnValue(false);
    mockClassifyIntent.mockResolvedValue({ intent: 'product_inquiry', language: 'id', keywords: ['produk'] });
    mockPickCannedGreeting.mockReturnValue('Halo! Ada yang bisa kami bantu?');
    mockSaveConversationInsights.mockResolvedValue(undefined);
    mockExtractCatalogKeywords.mockResolvedValue({});
    mockVisionExtractToKeywords.mockReturnValue([]);
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

    await routeInboundBaileysMessage({ ...makeTextPayload('wamid-LEAD-AT', 'ada box nasi?'), timestamp: sentAt.getTime() / 1000 });

    expect(mockRecordLeadFromMessage).toHaveBeenCalledWith('ada box nasi?', 'contact-uuid-1', sentAt);
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

    const QUOTED_BODY =
      'Halo Kak Kevin! Box nasi kami ada 2 pilihan bahan:\n1. BOX NASI KRAFT 20X20 — Rp 1.800/pcs';
    mockFindMessageByWaMessageId.mockResolvedValue({
      id: 'dc-msg', conversationId: 'conv-uuid-1', role: 'assistant', body: QUOTED_BODY,
    });

    // Customer quote-replies to the door-closer price message with a short comment.
    await routeInboundBaileysMessage(makeTextPayload('wamid-Q01', 'lmyn ya hrgnya kak', 'wamid-doorcloser'));
    await vi.runAllTimersAsync();

    // Looked up by the quoted wamid...
    expect(mockFindMessageByWaMessageId).toHaveBeenCalledWith('wamid-doorcloser');
    // ...and the resolved body is threaded into buildContextAndCallAI's quotedMessageBody arg (6th).
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    expect(mockBuildContextAndCallAI.mock.calls[0][5]).toBe(QUOTED_BODY);
  });

  it('no quoted context → quotedMessageBody arg is null (regression)', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-Q02', 'halo ada box nasi?'));
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

    await routeInboundBaileysMessage(makeTextPayload('wamid-E2', 'ada box kue?'));
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

  // "Saya Tono" must not be answered with "untuk jualan apa?" a moment after the customer typed
  // "Untuk nasi padang sih kak" - the draft was written before that message existed.
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
      await routeInboundBaileysMessage(makeTextPayload('wamid-SUP1', 'Saya Tono'));
      await vi.advanceTimersByTimeAsync(1200);
      await routeInboundBaileysMessage(makeTextPayload('wamid-SUP2', 'Untuk nasi padang sih kak'));
      await vi.advanceTimersByTimeAsync(1200);
      resolveTurn1!(turn1);
      await vi.advanceTimersByTimeAsync(2000);
      delete process.env.TYPING_DEBOUNCE_MS;
    }

    it('drops the stale draft and answers both batches in one reply', async () => {
      await textDuringTurn({ ...BASE_AI_RESPONSE, message: 'Halo Kak Tono! Untuk jualan apa kak?' });

      expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(2);
      expect(mockBuildContextAndCallAI.mock.calls[1]![1]).toBe('Saya Tono\nUntuk nasi padang sih kak');
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

      await routeInboundBaileysMessage(makeTextPayload('wamid-RACE1', 'ada box kue 20x20?'));
      await vi.advanceTimersByTimeAsync(1200);
      expect(rows.get('wamid-RACE2')).toBe('chakra_sync');
      await routeInboundBaileysMessage(makeTextPayload('wamid-RACE2', 'yang kraft ya kak'));
      await vi.advanceTimersByTimeAsync(1200);
      resolveTurn1({ ...BASE_AI_RESPONSE, message: 'draft basi' });
      await vi.advanceTimersByTimeAsync(2000);
      delete process.env.TYPING_DEBOUNCE_MS;

      expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(2);
      expect(mockBuildContextAndCallAI.mock.calls[1]![1]).toBe('ada box kue 20x20?\nyang kraft ya kak');
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

  // An answer typed while the photo was being answered must not be followed by the photo's reply
  // asking the same thing again. The photo's draft is dropped; the text turn answers the photo and the text.
  it('drops a photo draft the customer has already moved past, and answers both in one reply', async () => {
    process.env.TYPING_DEBOUNCE_MS = '1000';
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockMatchCustomerPhoto.mockResolvedValueOnce({
      certainty: 'same',
      product: { name: 'BOX KUE IVORY 20X20 CETAK FULL COLOR', brand: 'Imperial Indopack', imageUrl: '/s.jpg' },
      compared: ['BOX KUE IVORY 20X20 CETAK FULL COLOR'],
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

    resolveImage({ ...BASE_AI_RESPONSE, message: 'Boleh tahu, untuk jualan apa kak?' });
    await vi.advanceTimersByTimeAsync(2000);
    await imagePromise;

    expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual(['jawaban gabungan']);
    expect(mockBuildContextAndCallAI.mock.calls[1][1]).toContain(
      '[Pelanggan mengirim foto: produk kami BOX KUE IVORY 20X20 CETAK FULL COLOR (foto sama)] mau tanya product ini ada ga ya?'
    );
    expect(mockBuildContextAndCallAI.mock.calls[1][1]).toContain('sendiri');

    delete process.env.TYPING_DEBOUNCE_MS;
  });

  // The bot must not answer without staff's phone reply from a minute earlier. Each reply pulls the chat first - and a hanging Chakra costs at most 5 s, never the reply.
  it('pulls staff replies into the chat before answering, without waiting on a hanging sync', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const order: string[] = [];
    mockSyncContactChat.mockImplementationOnce(async () => { order.push('sync'); return 2; });
    mockBuildContextAndCallAI.mockImplementationOnce(async () => { order.push('ai'); return { ...BASE_AI_RESPONSE }; });

    await routeInboundBaileysMessage(makeTextPayload('wamid-SY1', 'untuk katering mbak'));
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

  // A customer can send five marketplace screenshots at once as one request ("foto rekomendasi
  // seperti di atas"). Each photo used to be its own turn: one reply about one photo, another about
  // a different photo 18 minutes later. Photos sent together now get one turn.
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
    const verdictFor = (name: string) => ({ certainty: 'same', product: { name, brand: 'Imperial Indopack', imageUrl: '/x.jpg' }, compared: [name], reason: 'x' });
    mockMatchCustomerPhoto.mockResolvedValueOnce(verdictFor('LUNCH BOX KRAFT')).mockResolvedValueOnce(verdictFor('PAPER BAG KRAFT TALI'));

    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-NOTE1'), timestamp: 100 });
    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-NOTE2'), timestamp: 101 });
    await vi.runAllTimersAsync();

    const note = (mockBuildContextAndCallAI.mock.calls[0][6] as { photoNote: string }).photoNote;
    expect(note).toMatch(/FOTO 1:[^]*LUNCH BOX KRAFT[^]*FOTO 2:[^]*PAPER BAG KRAFT TALI/);
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

    await routeInboundBaileysMessage(makeTextPayload('wamid-NM01', 'ada box kue?'));
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
      profileUpdate: { business_type: 'katering' },
    });

    await routeInboundBaileysMessage(makeTextPayload('wamid-INS1', 'box ukuran 50x50 ada?'));
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
      profileUpdate: { business_type: 'katering' },
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
      message: 'Itu box nasi kraft 20x20 kak, harganya Rp 1.800/pcs.',
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
    const [first] = await acksFor([...old, userRow('ada box kue?'), handoffRow()], 1);
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
    // For a printer an uncaptioned file is a design: "Desain masuk: Pelanggan mengirim logo atau file".
    expect(mockEscalateConversation.mock.calls[0][6]).toBe('desain_masuk');
  });

  // Plan 2 Task 10: the conversation panel lists the files the customer sent, so a document is kept
  // on disk like a photo, under its own (sanitised) name.
  describe('saving an inbound document', () => {
    const docPayload = (wamid: string, filename: string | null, text: string | null = null) => ({
      ...makeTextPayload(wamid, ''),
      type: 'document' as const,
      text: text as never,
      media: { base64: Buffer.from('%PDF-1.4 contoh').toString('base64'), mimeType: 'application/pdf', filename },
    });
    const storedMeta = () => mockInsertMessageIfNew.mock.calls[0][0].metadata as Record<string, unknown>;

    it('writes it to uploads/inbound/<ts>_<wamid>_<name> and points mediaUrl at it', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

      await routeInboundBaileysMessage(docPayload('wamid.DOC-3', 'Logo Contoh (final).pdf'));
      await vi.runAllTimersAsync();

      const [path, bytes] = mockWriteFile.mock.calls[0];
      expect(path).toMatch(/\/uploads\/inbound\/\d+_wamid_DOC_3_Logo_Contoh__final_\.pdf$/);
      expect(Buffer.from(bytes).toString()).toBe('%PDF-1.4 contoh');
      expect(storedMeta()).toMatchObject({ attachmentType: 'document', filename: 'Logo Contoh (final).pdf' });
      expect(storedMeta().mediaUrl).toMatch(/^\/uploads\/inbound\/\d+_wamid_DOC_3_Logo_Contoh__final_\.pdf$/);
      // Still the C1 hand-off: an uncaptioned file is a design for the team.
      expect(mockEscalateConversation.mock.calls[0][6]).toBe('desain_masuk');
    });

    it('keeps only the basename, at most 80 characters, with its extension', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

      await routeInboundBaileysMessage(docPayload('wamid-DOC4', `../../etc/${'desain-'.repeat(20)}akhir.pdf`, 'ini desainnya kak'));
      await vi.runAllTimersAsync();

      const name = String(storedMeta().mediaUrl).replace(/^\/uploads\/inbound\/\d+_wamid_DOC4_/, '');
      expect(name).toHaveLength(80);
      expect(name).toMatch(/^desain-desain-.*\.pdf$/);
      expect(String(mockWriteFile.mock.calls[0][0])).not.toContain('..');
    });

    it('a file that cannot be written is logged; the row keeps its filename and the hand-off still happens', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockWriteFile.mockRejectedValueOnce(new Error('ENOSPC'));

      await routeInboundBaileysMessage(docPayload('wamid-DOC5', 'logo-contoh.pdf'));
      await vi.runAllTimersAsync();

      expect(storedMeta()).toMatchObject({ attachmentType: 'document', filename: 'logo-contoh.pdf' });
      expect(storedMeta()).not.toHaveProperty('mediaUrl');
      expect(warn.mock.calls.some((c) => String(c[0]).includes('inbound document'))).toBe(true);
      expect(mockEscalateConversation.mock.calls[0][6]).toBe('desain_masuk');
      warn.mockRestore();
    });

    it('a document whose download failed keeps the name WhatsApp sent', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

      await routeInboundBaileysMessage({ ...docPayload('wamid-DOC6', null), media: null as never, filename: 'logo-contoh.pdf' });
      await vi.runAllTimersAsync();

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(storedMeta()).toMatchObject({ attachmentType: 'document', filename: 'logo-contoh.pdf' });
      expect(storedMeta()).not.toHaveProperty('mediaUrl');
      expect(mockEscalateConversation.mock.calls[0][1]).toContain('logo-contoh.pdf');
    });
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

  it('answers an unreadable, uncaptioned photo in the bot\'s voice', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_IMAGE_UNREADABLE_REPLY } = await import('../src/domain/constants.js');

    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-IMG0'), media: null as never });
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls[0][2]).toBe(CANNED_IMAGE_UNREADABLE_REPLY);
    expect(CANNED_IMAGE_UNREADABLE_REPLY).not.toMatch(/\bkami\b|\bAnda\b/);
  });

  it('still answers ordinary text through the AI', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    await routeInboundBaileysMessage(makeTextPayload('wamid-VN2', 'ada box kue kak?'));
    await vi.runAllTimersAsync();
    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
  });

  // ─── Final review M1/M2: this turn's facts are saved before anything reads them ───
  describe('saving the turn\'s facts', () => {
    const QTY_ITEM = { product: 'kertas nasi', size: '30x30', qty: 10, qty_unit: 'rim' };
    // The profile store: what saveConversationInsights wrote is what the next read sees.
    function profileStore() {
      let stored: unknown = { customerType: null, profile: { items: [{ product: 'kertas nasi', size: '30x30' }] } };
      mockGetContactProfile.mockImplementation(async () => stored);
      mockSaveConversationInsights.mockImplementation(async () => { stored = { customerType: null, profile: { items: [QTY_ITEM] } }; });
    }
    const handOffNote = () => mockNotifyStaff.mock.calls.map((c) => c[0] as { title: string; body: string }).find((n) => n.title === 'Eskalasi baru');

    it.each([['text', false], ['photo', true]] as const)('the %s path: the team hand-off lists the quantity given in this very message', async (_path, photo) => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      profileStore();
      mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'Siap kak, 10 rim ya 🙏', sendPoForm: true, profileUpdate: { items: [QTY_ITEM] } });

      await routeInboundBaileysMessage(photo ? makeImagePayload('wamid-M1p', 'oke saya ambil yang ini') : makeTextPayload('wamid-M1t', 'oke kak saya ambil yang itu'));
      await vi.runAllTimersAsync();

      expect(handOffNote()!.body).toContain('Barang: kertas nasi, 30x30, 10 rim');
      expect(mockSaveConversationInsights).toHaveBeenCalledTimes(1);
    });

    function slowSave(ms: number) {
      const state = { done: false };
      mockSaveConversationInsights.mockImplementation(() => new Promise<void>((res) => setTimeout(() => { state.done = true; res(); }, ms)));
      return state;
    }

    it.each([['a reply', { ...BASE_AI_RESPONSE }], ['no reply', { message: '', confidence: 'high', noReply: true }]] as const)(
      'the next queued turn starts only after the save, after %s', async (_label, first) => {
        const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
        const save = slowSave(20_000);
        const sawSaved: boolean[] = [];
        mockBuildContextAndCallAI
          .mockImplementationOnce(async () => { sawSaved.push(save.done); return first; })
          .mockImplementation(async () => { sawSaved.push(save.done); return { ...BASE_AI_RESPONSE }; });

        await routeInboundBaileysMessage(makeTextPayload('wamid-M2a', 'mau kertas nasi 30x30'));
        await vi.advanceTimersByTimeAsync(9000); // turn 1 runs and is saving
        await routeInboundBaileysMessage(makeTextPayload('wamid-M2b', '10 rim'));
        await vi.runAllTimersAsync();

        expect(sawSaved).toEqual([false, true]);
      });
  });

  // ─── Final review M3: the price-list resolver and the reply send fail safe ───
  describe('when the price list or the reply cannot go', () => {
    it('answers the turn when the price list cannot be resolved, before or after the reply', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
      mockGetContactProfile.mockResolvedValue(null);
      mockListBrands.mockRejectedValue(new Error('db down'));
      mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, catalogUrl: 'x' });

      await routeInboundBaileysMessage(makeTextPayload('wamid-M3a', 'minta pricelist kertas supreme'));
      await vi.runAllTimersAsync();

      expect(mockBuildContextAndCallAI.mock.calls[0]![6].catalogNote).toMatch(/belum ada file yang dikirim/);
      expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual(['AI reply']);
      expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({ body: 'AI reply', status: 'sent' }));
      expect(mockSendDocumentMessage).not.toHaveBeenCalled();
      expect(warn.mock.calls.some((c) => String(c[0]).includes('price list'))).toBe(true);
      warn.mockRestore();
    });

    it.each([['text', false], ['photo', true]] as const)('tells staff when the %s reply itself cannot be sent', async (_path, photo) => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      mockSendTextMessage.mockRejectedValue(new Error('chakra 400'));

      await routeInboundBaileysMessage(photo ? makeImagePayload('wamid-M3p') : makeTextPayload('wamid-M3t', 'ada box nasi?'));
      await vi.runAllTimersAsync();

      expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({ body: 'AI reply', status: 'saved' }));
      expect(mockNotifyStaff).toHaveBeenCalledWith(expect.objectContaining({ title: 'Balasan bot gagal terkirim', path: '/conversations/conv-uuid-1' }));
    });

    // chakraClient returns '' for an HTTP 200 without a message id: the customer got the reply.
    it.each([['text', false], ['photo', true]] as const)('does not tell staff the %s reply failed when it was sent without a message id', async (_path, photo) => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      mockSendTextMessage.mockResolvedValue('');

      await routeInboundBaileysMessage(photo ? makeImagePayload('wamid-M3q') : makeTextPayload('wamid-M3u', 'ada box nasi?'));
      await vi.runAllTimersAsync();

      expect(mockSendTextMessage).toHaveBeenCalled();
      expect(mockNotifyStaff).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Balasan bot gagal terkirim' }));
    });
  });

  // ─── Final review M4: supersede no longer stops after a price list went out ───
  it('drops a stale draft after a price list went out, and the re-run sends no second list', async () => {
    process.env.TYPING_DEBOUNCE_MS = '1000';
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    mockListBrands.mockResolvedValue([{ id: 'b2', name: 'Kertas Supreme', catalogFileUrl: 'https://cdn.example/daftar-harga-supreme.pdf' }]);
    let resolveTurn1: (v: unknown) => void = () => { };
    mockBuildContextAndCallAI
      .mockReturnValueOnce(new Promise((res) => { resolveTurn1 = res; }))
      .mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'jawaban lengkap' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-M4a', 'minta pricelist kertas supreme'));
    await vi.advanceTimersByTimeAsync(1200);
    await routeInboundBaileysMessage(makeTextPayload('wamid-M4b', 'untuk nasi padang'));
    await vi.advanceTimersByTimeAsync(1200);
    resolveTurn1({ ...BASE_AI_RESPONSE, message: 'draft basi' });
    await vi.advanceTimersByTimeAsync(3000);
    delete process.env.TYPING_DEBOUNCE_MS;

    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(2);
    expect(mockBuildContextAndCallAI.mock.calls[1]![1]).toBe('minta pricelist kertas supreme\nuntuk nasi padang');
    expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual(['jawaban lengkap']);
    expect(mockSendDocumentMessage).toHaveBeenCalledTimes(1);
    // The re-run is told what already went out, so its reply and the attachment agree.
    expect(mockBuildContextAndCallAI.mock.calls[1]![6].catalogNote).toMatch(/^KATALOG: file terkirim\./);
  });

  // ─── The price list: a price question, by brand (spec 7.3) ────────────────

  const IMPERIAL_PDF = 'https://cdn.example/daftar-harga-imperial.pdf';
  const SUPREME_PDF = 'https://cdn.example/daftar-harga-supreme.pdf';
  const withBrandFiles = () => mockListBrands.mockResolvedValue([
    { id: 'b1', name: 'Imperial Indopack', catalogFileUrl: IMPERIAL_PDF },
    { id: 'b2', name: 'Kertas Supreme', catalogFileUrl: SUPREME_PDF },
  ]);
  const catalogNote = () => mockBuildContextAndCallAI.mock.calls.at(-1)![6]?.catalogNote as string | null;

  // Review focus 4: the ad's own text from a customer the system has never seen. Final review M6: a price
  // question (not a request for the list itself) is decided after the reply, with this turn's facts, so
  // the list follows the reply - and the model is told it will, unless it prices the item.
  it('sends the Kertas Supreme price list for the bare ad text, after the reply, and tells the model', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    withBrandFiles();

    await routeInboundBaileysMessage(makeTextPayload('wamid-PL1', 'berapa harga kertas supreme?'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).toHaveBeenCalledTimes(1);
    expect(mockSendDocumentMessage.mock.calls[0][2]).toBe(SUPREME_PDF);
    expect(mockSendDocumentMessage.mock.calls[0][3]).toBe('Daftar Harga Kertas Supreme.pdf');
    expect(mockSendDocumentMessage.mock.invocationCallOrder[0]).toBeGreaterThan(mockSendTextMessage.mock.invocationCallOrder[0]);
    expect(catalogNote()).toMatch(/^KATALOG: daftar harga Kertas Supreme dikirim sistem sesudah balasan ini/);
    expect(catalogNote()).not.toContain('file terkirim');
    // Stored under its wamid, like every file the bot sends.
    expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({
      waMessageId: 'wa-doc-id',
      metadata: expect.objectContaining({ attachmentType: 'document', mediaUrl: SUPREME_PDF }),
    }));
  });

  it('sends both price lists when both brands are known', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue({ customerType: null, profile: { brands: ['kertas_supreme', 'imperial_indopack'] } });
    withBrandFiles();

    await routeInboundBaileysMessage(makeTextPayload('wamid-PL2', 'minta pricelist nya kak'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage.mock.calls.map((c) => c[2])).toEqual([SUPREME_PDF, IMPERIAL_PDF]);
  });

  // Final review M6: a fully specified first message used to get the whole list - the profile was still
  // empty when the keyword path ran. This turn's facts decide now: a quote, not the list.
  it('sends no price list when this very turn priced the item', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    withBrandFiles();
    mockBuildContextAndCallAI.mockResolvedValue({
      ...BASE_AI_RESPONSE,
      message: 'Untuk Kertas Supreme 64 gsm 30 x 30 cm, 10 rim: Rp 165.000/rim, total Rp 1.650.000 kak.',
      toolFigures: [165000, 1650000, 160000], priceToolRan: true,
      profileUpdate: { brands: ['kertas_supreme'], items: [{ product: 'Kertas Supreme 64 gsm', size: '30x30', qty: 10, qty_unit: 'rim' }] },
    });

    await routeInboundBaileysMessage(makeTextPayload('wamid-PLQ', 'berapa harga kertas supreme 30x30 10 rim'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendDocumentMessage).not.toHaveBeenCalled();
  });

  it('sends no price list when the tool quoted this turn, even with no facts saved', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    withBrandFiles();
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '10 rim: Rp 165.000/rim kak.', toolFigures: [165000, 1650000], priceToolRan: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-PLQ2', 'berapa harga kertas supreme 30x30 10 rim'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).not.toHaveBeenCalled(); // the tool's quote is the price
  });

  it('sends it after all when the reply says the list is coming', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    withBrandFiles();
    mockBuildContextAndCallAI.mockResolvedValue({
      ...BASE_AI_RESPONSE,
      message: '10 rim: Rp 165.000/rim kak. Daftar harga lengkapnya saya kirimkan juga ya.',
      toolFigures: [165000, 1650000], priceToolRan: true,
      profileUpdate: { items: [{ product: 'Kertas Supreme 64 gsm', size: '30x30', qty: 10, qty_unit: 'rim' }] },
    });

    await routeInboundBaileysMessage(makeTextPayload('wamid-PLQ3', 'berapa harga kertas supreme 30x30 10 rim'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage.mock.calls.map((c) => c[2])).toEqual([SUPREME_PDF]);
  });

  it('sends nothing while the brand is unknown, and tells the model to ask what they pack', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    withBrandFiles();

    await routeInboundBaileysMessage(makeTextPayload('wamid-PL3', 'berapa harganya kak?'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).not.toHaveBeenCalled();
    expect(catalogNote()).toContain('Merek belum jelas: tanyakan dulu barang apa yang mau dikemas');
  });

  it('sends no price list once the item, size and quantity are known', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue({
      customerType: null,
      profile: { brands: ['kertas_supreme'], items: [{ product: 'Kertas Supreme 64 gsm', size: '30x30', qty: 10, qty_unit: 'rim' }] },
    });
    withBrandFiles();

    await routeInboundBaileysMessage(makeTextPayload('wamid-PL4', 'jadi berapa harganya kak?'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).not.toHaveBeenCalled();
    expect(catalogNote()).toContain('hitung_harga');
  });

  // Review fix R1: asked for by name, the list goes even once the item is priced.
  it.each(['kirim pricelist dong', 'pricelist box 20x20 berapa ya'])('sends the price list for "%s" even with a priced item', async (text) => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue({
      customerType: null,
      profile: { brands: ['imperial_indopack'], items: [{ product: 'Box Ivory', size: '20x20x7', qty: 10, qty_unit: 'rim' }] },
    });
    withBrandFiles();

    await routeInboundBaileysMessage(makeTextPayload('wamid-PLX', text));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage.mock.calls.map((c) => c[2])).toEqual([IMPERIAL_PDF]);
    expect(catalogNote()).toMatch(/^KATALOG: file terkirim\./);
  });

  // Review fix m1: a courier's "berapa ongkirnya" is not a price question - no file, no note.
  it('sends no price list on a non-sales turn', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    withBrandFiles();

    await routeInboundBaileysMessage(makeTextPayload('wamid-PLC', 'dari jne kak, mau ambil paket box. berapa ongkirnya?'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).not.toHaveBeenCalled();
    expect(mockListBrands).not.toHaveBeenCalled();
    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
  });

  // Review fix m2: the keyword path ran with no brand known; the model learned it in this turn.
  it('the AI-flagged path still sends a brand the keyword path could not know yet', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    withBrandFiles();
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, catalogUrl: 'x', profileUpdate: { brands: ['kertas_supreme'] } });

    await routeInboundBaileysMessage(makeTextPayload('wamid-PLM', 'berapa harganya kak? buat bungkus nasi padang'));
    await vi.runAllTimersAsync();

    expect(catalogNote()).toContain('Merek belum jelas');
    expect(mockSendDocumentMessage.mock.calls.map((c) => c[2])).toEqual([SUPREME_PDF]);
  });

  it('sends the brand price list when the AI flags a request the keywords missed', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    withBrandFiles();
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, catalogUrl: 'https://model-invented.example/x.pdf' });

    // The answer to "barang apa yang mau dikemas?": no price word, but it names what they pack.
    await routeInboundBaileysMessage(makeTextPayload('wamid-PL5', 'buat box nasi kak'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).toHaveBeenCalledTimes(1);
    // Always the real file, never the model-provided URL (closed catalog).
    expect(mockSendDocumentMessage.mock.calls[0][2]).toBe(IMPERIAL_PDF);
  });

  it('the AI-flagged path counts the brand recorded in this very turn', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    withBrandFiles();
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, catalogUrl: 'x', profileUpdate: { brands: ['kertas_supreme'] } });

    await routeInboundBaileysMessage(makeTextPayload('wamid-PL6', 'untuk nasi padang kak'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage.mock.calls.map((c) => c[2])).toEqual([SUPREME_PDF]);
  });

  it('image path: AI-flagged price list via caption sends the real file too', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    withBrandFiles();
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, catalogUrl: 'https://model-invented.example/x.pdf' });

    await routeInboundBaileysMessage(makeImagePayload('wamid-PL7', 'minta price list kertas supreme'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage).toHaveBeenCalledTimes(1);
    expect(mockSendDocumentMessage.mock.calls[0][2]).toBe(SUPREME_PDF);
    expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({ body: 'AI reply' }));
  });

  it('image path: a caption asking for the price list by name gets it even with a priced item', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue({
      customerType: null,
      profile: { brands: ['kertas_supreme'], items: [{ product: 'Kertas Supreme 64 gsm', size: '30x30', qty: 10 }] },
    });
    withBrandFiles();
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, catalogUrl: 'x' });

    await routeInboundBaileysMessage(makeImagePayload('wamid-PL7b', 'minta pricelist nya kak'));
    await vi.runAllTimersAsync();

    expect(mockSendDocumentMessage.mock.calls.map((c) => c[2])).toEqual([SUPREME_PDF]);
  });

  it('keyword-triggered price list is not duplicated by the AI catalogUrl flag', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    withBrandFiles();
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, catalogUrl: '/uploads/catalogs/x.pdf' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-PL8', 'berapa harga kertas supreme?'));
    await vi.runAllTimersAsync();
    expect(mockSendDocumentMessage).toHaveBeenCalledTimes(1);

    // A request for the list by name re-sends it before the reply - and the model's flag after it does not add a third.
    await routeInboundBaileysMessage(makeTextPayload('wamid-PL8b', 'kirim pricelist kertas supreme lagi dong'));
    await vi.runAllTimersAsync();
    expect(mockSendDocumentMessage).toHaveBeenCalledTimes(2);
  });

  it('sends a brand\'s price list once per conversation, and again after /new', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    withBrandFiles();
    const T = Math.floor(Date.now() / 1000);

    await routeInboundBaileysMessage({ ...makeTextPayload('wamid-PL9a', 'berapa harga kertas supreme?'), timestamp: T - 60 });
    await vi.runAllTimersAsync();
    await routeInboundBaileysMessage({ ...makeTextPayload('wamid-PL9b', 'kertas supreme harganya berapa ya?'), timestamp: T - 30 });
    await vi.runAllTimersAsync();
    expect(mockSendDocumentMessage).toHaveBeenCalledTimes(1);
    expect(catalogNote()).toContain('sudah dikirim sebelumnya');

    await routeInboundBaileysMessage({ ...makeTextPayload('wamid-PL9c', '/new'), timestamp: T });
    await routeInboundBaileysMessage({ ...makeTextPayload('wamid-PL9d', 'berapa harga kertas supreme?'), timestamp: T + 1 });
    await vi.runAllTimersAsync();
    expect(mockSendDocumentMessage).toHaveBeenCalledTimes(2);
  });

  // ─── Reference photos and the PO form, after the reply (spec 7.2, 7.3) ──────

  // The default profile (beforeEach) has a design, so a real cetak link is what goes out.
  const PO_URL = 'https://forms.gle/imperial-po';
  const PLANO_URL = 'https://forms.gle/imperial-po-plano';
  const PO_URLS = { cetak: PO_URL, plano: PLANO_URL };
  const sentTexts = () => mockSendTextMessage.mock.calls.map((c) => c[2]);
  const imageRows = () => mockInsertMessage.mock.calls.map((c) => c[0]).filter((r) => r.metadata?.attachmentType === 'image');

  // Final review M9: "oke kak" agreeing to the quote has nothing to answer, but the PO form still goes -
  // on its own, with no empty reply before it and no hand-off.
  it.each([['text', false], ['photo', true]] as const)('sends the PO form alone on a %s turn with no reply text', async (_path, photo) => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { poFormMessage } = await import('../src/domain/constants.js');
    mockGetPoFormUrls.mockResolvedValue(PO_URLS);
    mockBuildContextAndCallAI.mockResolvedValue({ message: '', confidence: 'high', sendPoForm: true });

    await routeInboundBaileysMessage(photo ? makeImagePayload('wamid-PO0p', 'oke kak') : makeTextPayload('wamid-PO0', 'oke kak'));
    await vi.runAllTimersAsync();

    expect(sentTexts()).toEqual([poFormMessage(PO_URL)]);
    expect(mockEscalateConversation).not.toHaveBeenCalled();
    expect(mockInsertMessage.mock.calls.map((c) => c[0]).filter((r) => r.role === 'assistant').map((r) => r.body)).toEqual([poFormMessage(PO_URL)]);
    expect(mockNotifyStaff).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Balasan bot gagal terkirim' }));
  });

  it('sends the PO form link from settings after the reply when sendPoForm', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { poFormMessage } = await import('../src/domain/constants.js');
    mockGetPoFormUrls.mockResolvedValue(PO_URLS);
    mockSendTextMessage.mockResolvedValueOnce('wa-reply').mockResolvedValueOnce('wa-po');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'Siap kak, 10 rim ya 🙏', sendPoForm: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-PO1', 'oke kak saya ambil 10 rim'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
    expect(mockSendTextMessage.mock.calls[1][2]).toBe(poFormMessage(PO_URL));
    expect(sentTexts()).toEqual(['Siap kak, 10 rim ya 🙏', `Untuk pemesanannya, silakan isi form PO berikut ya kak 🙏\n${PO_URL}`]);
    // Each send is its own row, in send order, under its own wamid.
    const rows = mockInsertMessage.mock.calls.map((c) => c[0]).filter((r) => r.role === 'assistant');
    expect(rows.map((r) => [r.body, r.waMessageId])).toEqual([['Siap kak, 10 rim ya 🙏', 'wa-reply'], [poFormMessage(PO_URL), 'wa-po']]);
    expect(rows[1].metadata).toMatchObject({ source: 'po_form' });
  });

  const PRICE_CALL = {
    input: { product: 'Kertas Supreme 64 gsm cetak 1 warna', size: '30 x 30 cm', qty: 12, unit: 'rim' },
    outcome: 'quote', productId: 'p-ks1', productName: 'Kertas Supreme 64 gsm cetak 1 warna', variantName: '30 x 30 cm', quote: null,
  };

  it.each([['text', false], ['photo', true]] as const)('stores the %s turn price calls on the reply row', async (_path, photo) => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, priceCalls: [PRICE_CALL] });

    await routeInboundBaileysMessage(photo ? makeImagePayload('wamid-PC1p', 'berapa kak?') : makeTextPayload('wamid-PC1', 'berapa 12 rim kak?'));
    await vi.runAllTimersAsync();

    const reply = mockInsertMessage.mock.calls.map((c) => c[0]).find((r) => r.role === 'assistant' && r.body === 'AI reply');
    expect(reply.metadata.priceCalls).toHaveLength(1);
    expect(reply.metadata.priceCalls[0]).toMatchObject({ outcome: 'quote', productName: 'Kertas Supreme 64 gsm cetak 1 warna' });
  });

  it('puts no priceCalls on a reply row when the tool was not called', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    await routeInboundBaileysMessage(makeTextPayload('wamid-PC2', 'halo kak'));
    await vi.runAllTimersAsync();
    const reply = mockInsertMessage.mock.calls.map((c) => c[0]).find((r) => r.role === 'assistant' && r.body === 'AI reply');
    expect(reply.metadata?.priceCalls).toBeUndefined();
  });

  // ─── Hand-off category: why the team has the chat (Plan 2 Task 3) ───────────
  const categoryOf = () => mockEscalateConversation.mock.calls[0]?.[6];
  const lowTurn = (extra: Record<string, unknown> = {}) =>
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: 'Low confidence', ...extra });

  it.each([
    ['above_top_tier', 'pesanan_besar'],
    ['not_in_catalog', 'harga_custom'],
  ] as const)('a low-confidence text turn with a %s price call is stored as %s', async (outcome, want) => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    lowTurn({ priceCalls: [PRICE_CALL, { ...PRICE_CALL, outcome }] });

    await routeInboundBaileysMessage(makeTextPayload('wamid-HC1', 'box ivory 22x22x7 5000 pcs berapa?'));
    await vi.runAllTimersAsync();

    expect(categoryOf()).toBe(want);
  });

  it('a request for a person outranks the price outcome', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockDetectHumanRequest.mockReturnValue(true);
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, priceCalls: [{ ...PRICE_CALL, outcome: 'not_in_catalog' }] });

    await routeInboundBaileysMessage(makeTextPayload('wamid-HC2', 'mau bicara dengan admin aja'));
    await vi.runAllTimersAsync();

    expect(categoryOf()).toBe('minta_orang');
  });

  it('a complaint is stored as komplain', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    lowTurn();

    await routeInboundBaileysMessage(makeTextPayload('wamid-HC3', 'box yang kemarin datang penyok semua kak'));
    await vi.runAllTimersAsync();

    expect(categoryOf()).toBe('komplain');
  });

  it.each([
    ['a non-sales topic', 'sudah transfer ya kak, tolong dicek', {}],
    ['the model saying so', 'kami pabrik plastik kak', { escalationReason: 'BUKAN PEMBELI: pabrik plastik menawarkan produknya' }],
  ] as const)('not a buyer by %s is stored as bukan_pembeli', async (_by, text, extra) => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    lowTurn(extra);

    await routeInboundBaileysMessage(makeTextPayload('wamid-HC4', text));
    await vi.runAllTimersAsync();

    expect(categoryOf()).toBe('bukan_pembeli');
  });

  it('a hand-off from a batch that held a captioned document is a design received', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    lowTurn();

    await routeInboundBaileysMessage({
      ...makeTextPayload('wamid-HC5', 'ini file cetaknya kak'),
      type: 'document' as const,
      media: { base64: 'JVBER', mimeType: 'application/pdf', filename: 'cetak.pdf' },
    });
    await vi.runAllTimersAsync();

    expect(categoryOf()).toBe('desain_masuk');
  });

  it('a plain text hand-off with no signal goes by its reason, else lainnya', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    lowTurn();

    await routeInboundBaileysMessage(makeTextPayload('wamid-HC6', 'bisa kirim ke luar pulau?'));
    await vi.runAllTimersAsync();

    expect(categoryOf()).toBe('lainnya');
  });

  it('a photo the bot could not match is a design received', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockMatchCustomerPhoto.mockResolvedValueOnce({ certainty: 'none', product: null, compared: ['BOX NASI'], reason: 'beda' });

    await routeInboundBaileysMessage(makeImagePayload('wamid-HC7', 'ada yang seperti ini?'));
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(categoryOf()).toBe('desain_masuk');
  });

  it('a photo turn still puts a complaint first', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    lowTurn();

    await routeInboundBaileysMessage(makeImagePayload('wamid-HC8', 'boxnya datang penyok kak'));
    await vi.runAllTimersAsync();

    expect(categoryOf()).toBe('komplain');
  });

  it('the still-checking refresh stores this turn\'s category with its reason', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated', escalationReason: 'Low confidence' });
    lowTurn({ escalationReason: '150 rim box ivory', priceCalls: [{ ...PRICE_CALL, outcome: 'above_top_tier' }] });

    await routeInboundBaileysMessage(makeTextPayload('wamid-HC9', 'kalau 150 rim berapa kak?'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).not.toHaveBeenCalled();
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated', '150 rim box ivory', undefined, 'pesanan_besar');
  });

  it('tags the PO form row as po_form', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetPoFormUrls.mockResolvedValue(PO_URLS);
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, sendPoForm: true });
    await routeInboundBaileysMessage(makeTextPayload('wamid-PC3', 'oke kak'));
    await vi.runAllTimersAsync();
    const po = mockInsertMessage.mock.calls.map((c) => c[0]).find((r) => r.body?.includes(PO_URL));
    expect(po.metadata.source).toBe('po_form');
  });

  it('tags a sent reference photo with its source', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockSendImageMessage.mockResolvedValue('wa-img');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, imageUrls: ['/uploads/images/x.jpg'] });
    await routeInboundBaileysMessage(makeTextPayload('wamid-PC4', 'ada contoh kak?'));
    await vi.runAllTimersAsync();
    expect(imageRows()[0].metadata).toMatchObject({ source: 'reference_photo', mediaUrl: '/uploads/images/x.jpg' });
  });

  it('tags a sent price list with its source and brand', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetContactProfile.mockResolvedValue(null);
    mockListBrands.mockResolvedValue([{ id: 'b2', name: 'Kertas Supreme', catalogFileUrl: 'https://cdn.example/daftar-harga-supreme.pdf' }]);
    mockSendDocumentMessage.mockResolvedValue('wa-doc');
    await routeInboundBaileysMessage(makeTextPayload('wamid-PC5', 'minta pricelist kertas supreme'));
    await vi.runAllTimersAsync();
    const doc = mockInsertMessage.mock.calls.map((c) => c[0]).find((r) => r.metadata?.attachmentType === 'document');
    expect(doc.metadata).toMatchObject({ source: 'price_list', brand: 'Kertas Supreme' });
  });

  it('sends no PO form without the flag', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-PO2', 'oke kak'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockGetPoFormUrls).not.toHaveBeenCalled();
  });

  it('sends no PO form on a hand-off', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: 'x', sendPoForm: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-PO3', 'oke saya ambil'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockGetPoFormUrls).not.toHaveBeenCalled();
  });

  // Review fix R2: the placeholder link never reaches a customer; the team sends the form.
  it('sends the team line instead of the placeholder PO link, and hands the chat to the team', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_PO_FORM_FROM_TEAM, PO_FORM_PLACEHOLDER_URL } = await import('../src/domain/constants.js');
    mockGetPoFormUrls.mockResolvedValue({ cetak: PO_FORM_PLACEHOLDER_URL, plano: PO_FORM_PLACEHOLDER_URL });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, sendPoForm: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-PO5', 'oke kak saya ambil 10 rim'));
    await vi.runAllTimersAsync();

    expect(CANNED_PO_FORM_FROM_TEAM).toBe('Untuk form PO-nya, tim kami kirimkan sebentar lagi ya kak 🙏');
    expect(sentTexts()).toEqual(['AI reply', CANNED_PO_FORM_FROM_TEAM]);
    expect(sentTexts().join(' ')).not.toContain('REPLACE-ME');
    // Its reason tells staff what to do; it is no sales category of its own (Plan 2 Task 3).
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.stringContaining('Form PO belum diatur di Pengaturan'), undefined, 'lainnya');
    expect(mockNotifyStaff).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('Form PO belum diatur di Pengaturan') }));
    expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({ body: CANNED_PO_FORM_FROM_TEAM, metadata: expect.objectContaining({ source: 'po_form' }) }));
    // A reply, not a hand-off message: the customer is not sent the canned escalation.
    expect(mockEscalateConversation).not.toHaveBeenCalled();
  });

  it('the placeholder written another way (case, trailing slash) is not sent either', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_PO_FORM_FROM_TEAM } = await import('../src/domain/constants.js');
    mockGetPoFormUrls.mockResolvedValue({ cetak: 'HTTPS://FORMS.GLE/REPLACE-ME/', plano: 'https://forms.gle/replace-me' });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, sendPoForm: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-PO5v', 'oke kak saya ambil 10 rim'));
    await vi.runAllTimersAsync();

    expect(sentTexts()).toEqual(['AI reply', CANNED_PO_FORM_FROM_TEAM]);
    expect(sentTexts().join(' ').toLowerCase()).not.toContain('replace-me');
  });

  it('the placeholder-PO hand-off tells staff the order details too', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { PO_FORM_PLACEHOLDER_URL } = await import('../src/domain/constants.js');
    mockGetPoFormUrls.mockResolvedValue({ cetak: PO_FORM_PLACEHOLDER_URL, plano: PO_FORM_PLACEHOLDER_URL });
    mockGetContactProfile.mockResolvedValue({ customerType: null, profile: { name: 'Budi', items: [{ product: 'Box Nasi', size: '10x10x5' }] } });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, sendPoForm: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-PO5b', 'oke kak saya ambil 10 rim'));
    await vi.runAllTimersAsync();

    const body = (mockNotifyStaff.mock.calls[0]![0] as { body: string }).body;
    expect(body).toContain('Form PO belum diatur di Pengaturan');
    expect(body).toContain('Nama: Budi');
    expect(body).toContain('Barang: Box Nasi, 10x10x5');
  });

  it('photo path: the placeholder PO link is not sent either, and the team takes it', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_PO_FORM_FROM_TEAM, PO_FORM_PLACEHOLDER_URL } = await import('../src/domain/constants.js');
    mockGetPoFormUrls.mockResolvedValue({ cetak: PO_FORM_PLACEHOLDER_URL, plano: PO_FORM_PLACEHOLDER_URL });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, sendPoForm: true });

    await routeInboundBaileysMessage(makeImagePayload('wamid-PO6', 'yang ini kak, saya ambil'));
    await vi.runAllTimersAsync();

    expect(sentTexts()).toEqual(['AI reply', CANNED_PO_FORM_FROM_TEAM]);
    // Its reason tells staff what to do; it is no sales category of its own (Plan 2 Task 3).
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.stringContaining('Form PO belum diatur di Pengaturan'), undefined, 'lainnya');
    expect(mockNotifyStaff).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('Form PO belum diatur di Pengaturan') }));
  });

  it('a PO link that cannot be read is handled the same way: the reply is kept, the team sends the form', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_PO_FORM_FROM_TEAM } = await import('../src/domain/constants.js');
    mockGetPoFormUrls.mockRejectedValue(new Error('db down'));
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, sendPoForm: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-PO4', 'oke saya ambil'));
    await vi.runAllTimersAsync();

    expect(sentTexts()).toEqual(['AI reply', CANNED_PO_FORM_FROM_TEAM]);
    expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({ body: 'AI reply', waMessageId: 'wa-sent-id' }));
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.stringContaining('Form PO'), undefined, 'lainnya');
    expect(mockSaveConversationInsights).toHaveBeenCalledTimes(1);
  });

  it('a real PO link does not hand the chat to the team', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetPoFormUrls.mockResolvedValue(PO_URLS);
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, sendPoForm: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-PO7', 'oke saya ambil'));
    await vi.runAllTimersAsync();

    expect(mockUpdateConversationStatus).not.toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.anything());
  });

  // Task 20b: two forms - cetak with a design, plano without (client rule, 2026-11-19). Code picks them
  // from the order facts saved this turn, never the model.
  describe('which PO form goes out', () => {
    const poTurn = (profileUpdate?: Record<string, unknown>) =>
      mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, sendPoForm: true, ...(profileUpdate && { profileUpdate }) });
    const profile = (facts: Record<string, unknown>) => mockGetContactProfile.mockResolvedValue({ customerType: null, profile: { name: 'Budi', ...facts } });

    it.each([['text', false], ['photo', true]] as const)('%s path: has a design -> the cetak form only', async (_path, photo) => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormMessage } = await import('../src/domain/constants.js');
      mockGetPoFormUrls.mockResolvedValue(PO_URLS);
      profile({ items: [{ product: 'Box Nasi', size: '10x10x5', has_design: true }] });
      poTurn();

      await routeInboundBaileysMessage(photo ? makeImagePayload('wamid-PF1p', 'saya ambil kak') : makeTextPayload('wamid-PF1', 'saya ambil kak'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormMessage(PO_URL)]);
      expect(sentTexts().join(' ')).not.toContain(PLANO_URL);
      expect(mockUpdateConversationStatus).not.toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.anything(), undefined, expect.anything());
    });

    it.each([['text', false], ['photo', true]] as const)('%s path: no design -> the plano form only', async (_path, photo) => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormMessage } = await import('../src/domain/constants.js');
      mockGetPoFormUrls.mockResolvedValue(PO_URLS);
      profile({ has_design: false, items: [{ product: 'Kertas Supreme 64 gsm', size: '30x30', has_design: false }] });
      poTurn();

      await routeInboundBaileysMessage(photo ? makeImagePayload('wamid-PF2p', 'oke kak') : makeTextPayload('wamid-PF2', 'oke kak'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormMessage(PLANO_URL)]);
      const po = mockInsertMessage.mock.calls.map((c) => c[0]).find((r) => r.body === poFormMessage(PLANO_URL));
      expect(po.metadata).toMatchObject({ source: 'po_form' });
    });

    it.each([['text', false], ['photo', true]] as const)('%s path: design unknown -> both forms, labelled, in one message', async (_path, photo) => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormsMessage } = await import('../src/domain/constants.js');
      mockGetPoFormUrls.mockResolvedValue(PO_URLS);
      profile({ items: [{ product: 'Box Nasi', size: '10x10x5' }] });
      poTurn();

      await routeInboundBaileysMessage(photo ? makeImagePayload('wamid-PF3p', 'oke kak') : makeTextPayload('wamid-PF3', 'oke kak'));
      await vi.runAllTimersAsync();

      const both = poFormsMessage(['cetak', 'plano'], PO_URLS);
      expect(sentTexts()).toEqual(['AI reply', both]);
      expect(both).toContain(`Form order cetak (bila sudah ada desain/logo):\n${PO_URL}`);
      expect(both).toContain(`Form order plano (bila belum ada desain):\n${PLANO_URL}`);
      expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({ body: both, metadata: expect.objectContaining({ source: 'po_form' }) }));
    });

    it('items that disagree on the design -> both forms', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormsMessage } = await import('../src/domain/constants.js');
      mockGetPoFormUrls.mockResolvedValue(PO_URLS);
      profile({ items: [{ product: 'Box Nasi', has_design: true }, { product: 'Kertas Supreme', has_design: false }] });
      poTurn();

      await routeInboundBaileysMessage(makeTextPayload('wamid-PF4', 'ambil dua-duanya kak'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormsMessage(['cetak', 'plano'], PO_URLS)]);
    });

    it("this turn's own design fact counts, even before the saved profile shows it", async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormMessage } = await import('../src/domain/constants.js');
      mockGetPoFormUrls.mockResolvedValue(PO_URLS);
      profile({ items: [{ product: 'Box Nasi', size: '10x10x5' }] });
      poTurn({ items: [{ product: 'Box Nasi', size: '10x10x5', has_design: false }] });

      await routeInboundBaileysMessage(makeTextPayload('wamid-PF5', 'belum ada desain, saya ambil kak'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormMessage(PLANO_URL)]);
    });

    it('the saved profile cannot be read: the design is unknown -> both forms, labelled, even if this turn says one', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormsMessage } = await import('../src/domain/constants.js');
      mockGetPoFormUrls.mockResolvedValue(PO_URLS);
      mockGetContactProfile.mockRejectedValue(new Error('profile read failed'));
      // This turn alone says "has a design" - but an earlier item the profile holds may not have one.
      poTurn({ items: [{ product: 'Box Nasi', size: '10x10x5', has_design: true }] });

      await routeInboundBaileysMessage(makeTextPayload('wamid-PF8', 'logonya sudah ada, saya ambil kak'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormsMessage(['cetak', 'plano'], PO_URLS)]);
      expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({ body: poFormsMessage(['cetak', 'plano'], PO_URLS), metadata: expect.objectContaining({ source: 'po_form' }) }));
    });

    it('a chosen form still on the placeholder: the team line and a hand-off (lainnya), no link at all', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { CANNED_PO_FORM_FROM_TEAM, PO_FORM_PLACEHOLDER_URL } = await import('../src/domain/constants.js');
      mockGetPoFormUrls.mockResolvedValue({ cetak: PO_URL, plano: PO_FORM_PLACEHOLDER_URL });
      profile({ items: [{ product: 'Box Nasi', size: '10x10x5' }] }); // unknown -> both, and plano is not set
      poTurn();

      await routeInboundBaileysMessage(makeTextPayload('wamid-PF6', 'oke kak saya ambil'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', CANNED_PO_FORM_FROM_TEAM]);
      expect(sentTexts().join(' ')).not.toContain(PO_URL);
      expect(sentTexts().join(' ').toLowerCase()).not.toContain('replace-me');
      expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.stringContaining('Form PO belum diatur di Pengaturan'), undefined, 'lainnya');
      const reason = String(mockUpdateConversationStatus.mock.calls.find((c) => c[1] === 'escalated')![2]);
      expect(reason).toContain('plano');
      expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({ body: CANNED_PO_FORM_FROM_TEAM, metadata: expect.objectContaining({ source: 'po_form' }) }));
      expect(mockEscalateConversation).not.toHaveBeenCalled();
    });

    it('the form not chosen may still be the placeholder: the chosen one goes', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormMessage, PO_FORM_PLACEHOLDER_URL } = await import('../src/domain/constants.js');
      mockGetPoFormUrls.mockResolvedValue({ cetak: PO_URL, plano: PO_FORM_PLACEHOLDER_URL });
      profile({ has_design: true });
      poTurn();

      await routeInboundBaileysMessage(makeTextPayload('wamid-PF7', 'oke kak saya ambil'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormMessage(PO_URL)]);
      expect(mockUpdateConversationStatus).not.toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.anything(), undefined, expect.anything());
    });
  });

  // Spec 5.6: the PO form waits for a gramasi. A net under the prompt rule (ask first, set send_po_form
  // on the turn the customer picks): a send_po_form turn whose item's size two gramasi offer, with none
  // chosen, asks which instead - the next turn's rules send the form once one is recorded.
  describe('the PO form waits for a gramasi', () => {
    // 'Box Makan Ivory (CONTOH)': 20x20x7 in 270 and 300 gsm, 25x25x7 in 300 gsm only.
    const BOX = { ...BOX_GRAMASI, variants: [...BOX_GRAMASI.variants!, { ...BOX_GRAMASI.variants![0]!, id: 'v-ii2-25-300', name: '25x25x7' }] };
    // BOX plus 22x22x7 in 250 and 310 gsm: a second size with its own two gramasi.
    const BOX_TWO_SIZES = { ...BOX, variants: [...BOX.variants, { ...BOX.variants[0]!, id: 'v-ii2-22-250', name: '22x22x7', gsm: '250 gsm' }, { ...BOX.variants[0]!, id: 'v-ii2-22-310', name: '22x22x7', gsm: '310 gsm' }] };
    const BOX_20 = itemKey({ product: 'Box Makan Ivory', size: '20x20x7' });
    const poTurn = (profileUpdate?: Record<string, unknown>) =>
      mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, sendPoForm: true, ...(profileUpdate && { profileUpdate }) });
    const profile = (item: Record<string, unknown>) => mockGetContactProfile.mockResolvedValue({
      customerType: null, profile: { name: 'Contoh', items: [{ product: 'Box Makan Ivory', qty: 10, qty_unit: 'rim', has_design: true, ...item }] },
    });
    const payload = (photo: boolean, id: string) => (photo ? makeImagePayload(`${id}p`, 'oke kak saya ambil') : makeTextPayload(id, 'oke kak saya ambil'));
    const rowFor = (body: string) => mockInsertMessage.mock.calls.map((c) => c[0]).find((r) => r.body === body);
    const handedToTeam = () => mockUpdateConversationStatus.mock.calls.some((c) => c[1] === 'escalated');
    const paths = [['text', false], ['photo', true]] as const;

    beforeEach(() => {
      mockGetPoFormUrls.mockResolvedValue(PO_URLS);
      mockGetCatalogProducts.mockResolvedValue([BOX]);
      poTurn();
    });

    it.each(paths)('holds the PO form and asks which gramasi when two gramasi offer the size (%s path)', async (_path, photo) => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { gramasiBeforePoLine } = await import('../src/domain/constants.js');
      profile({ size: '20x20x7' });

      await routeInboundBaileysMessage(payload(photo, 'wamid-GR1'));
      await vi.runAllTimersAsync();

      const question = gramasiBeforePoLine(['270 gsm', '300 gsm']);
      expect(sentTexts()).toEqual(['AI reply', question]);
      expect(sentTexts().join(' ')).not.toContain(PO_URL);
      expect(rowFor(question).metadata).toMatchObject({ source: 'gramasi_question' });
      // A question for the customer, not a job for the team.
      expect(handedToTeam()).toBe(false);
    });

    it('holds the team\'s PO promise too: a form waiting on the gramasi hands nothing to the team', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { gramasiBeforePoLine, CANNED_PO_FORM_FROM_TEAM, PO_FORM_PLACEHOLDER_URL } = await import('../src/domain/constants.js');
      mockGetPoFormUrls.mockResolvedValue({ cetak: PO_FORM_PLACEHOLDER_URL, plano: PO_FORM_PLACEHOLDER_URL });
      profile({ size: '20x20x7' });

      await routeInboundBaileysMessage(payload(false, 'wamid-GR2'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', gramasiBeforePoLine(['270 gsm', '300 gsm'])]);
      expect(sentTexts()).not.toContain(CANNED_PO_FORM_FROM_TEAM);
      expect(handedToTeam()).toBe(false);
      expect(mockEscalateConversation).not.toHaveBeenCalled();
    });

    // Once per order: a second send_po_form turn that still finds no gramasi (the pick was not recorded,
    // or an item the customer moved on from) sends the form - the net never holds it twice.
    it('asks once: the question already went and no form after it -> the form goes', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { gramasiBeforePoLine, poFormMessage } = await import('../src/domain/constants.js');
      const question = gramasiBeforePoLine(['270 gsm', '300 gsm']);
      mockGetLastNMessages.mockResolvedValue([
        { role: 'assistant', body: 'AI reply' },
        { role: 'assistant', body: question, status: 'sent', metadata: { source: 'gramasi_question', itemKey: BOX_20 } },
        { role: 'user', body: 'oke kak' },
      ]);
      profile({ size: '20x20x7' });

      await routeInboundBaileysMessage(payload(false, 'wamid-GR9'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormMessage(PO_URL)]);
    });

    it('a PO form after the last question starts a new order: it asks again', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { gramasiBeforePoLine, poFormMessage } = await import('../src/domain/constants.js');
      const question = gramasiBeforePoLine(['270 gsm', '300 gsm']);
      mockGetLastNMessages.mockResolvedValue([
        { role: 'assistant', body: question, status: 'sent', metadata: { source: 'gramasi_question', itemKey: BOX_20 } },
        { role: 'assistant', body: poFormMessage(PO_URL), status: 'sent', metadata: { source: 'po_form' } },
        { role: 'user', body: 'tambah satu lagi kak' },
      ]);
      profile({ size: '20x20x7' });

      await routeInboundBaileysMessage(payload(false, 'wamid-GR10'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', question]);
    });

    // Final review I1: the question row says which item it asked about, and "asked" is per item.
    it('the question row names the item it asked about', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { gramasiBeforePoLine } = await import('../src/domain/constants.js');
      profile({ size: '20x20x7' });

      await routeInboundBaileysMessage(payload(false, 'wamid-GR11'));
      await vi.runAllTimersAsync();

      expect(rowFor(gramasiBeforePoLine(['270 gsm', '300 gsm'])).metadata).toEqual({ source: 'gramasi_question', itemKey: BOX_20 });
    });

    it('a question that never reached the customer (saved, not sent) is not "asked": it asks again', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { gramasiBeforePoLine } = await import('../src/domain/constants.js');
      const question = gramasiBeforePoLine(['270 gsm', '300 gsm']);
      mockGetLastNMessages.mockResolvedValue([
        { role: 'assistant', body: question, status: 'saved', metadata: { source: 'gramasi_question', itemKey: BOX_20 } },
        { role: 'user', body: 'oke kak' },
      ]);
      profile({ size: '20x20x7' });

      await routeInboundBaileysMessage(payload(false, 'wamid-GR12'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', question]);
    });

    // Two multi-gramasi items: asking about the first does not count for the second.
    it('a question asked about one item still asks about another item this turn orders', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { gramasiBeforePoLine } = await import('../src/domain/constants.js');
      mockGetCatalogProducts.mockResolvedValue([BOX_TWO_SIZES]);
      mockGetLastNMessages.mockResolvedValue([
        { role: 'assistant', body: gramasiBeforePoLine(['270 gsm', '300 gsm']), status: 'sent', metadata: { source: 'gramasi_question', itemKey: BOX_20 } },
        { role: 'user', body: 'yang 22x22 aja kak, ambil' },
      ]);
      mockGetContactProfile.mockResolvedValue({ customerType: null, profile: { name: 'Contoh', items: [
        { product: 'Box Makan Ivory', size: '20x20x7', qty: 10, qty_unit: 'rim', has_design: true },
        { product: 'Box Makan Ivory', size: '22x22x7', qty: 10, qty_unit: 'rim', has_design: true },
      ] } });
      poTurn({ items: [{ product: 'Box Makan Ivory', size: '22x22x7', qty: 10, qty_unit: 'rim' }] });

      await routeInboundBaileysMessage(makeTextPayload('wamid-GR13', 'yang 22x22 aja kak, ambil'));
      await vi.runAllTimersAsync();

      const question = gramasiBeforePoLine(['250 gsm', '310 gsm']);
      expect(sentTexts()).toEqual(['AI reply', question]);
      expect(rowFor(question).metadata).toEqual({ source: 'gramasi_question', itemKey: 'box makan ivory|22x22x7' });
    });

    // The final review's case: a box asked about earlier (two gramasi) must not hold the paper the
    // customer agrees to now - only this turn's items are checked when the turn sends items.
    it("checks only this turn's items: an earlier multi-gramasi box does not hold the paper form", async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormMessage } = await import('../src/domain/constants.js');
      mockGetCatalogProducts.mockResolvedValue([BOX, SUPREME]);
      mockGetContactProfile.mockResolvedValue({ customerType: null, profile: { name: 'Contoh', items: [
        { product: 'Box Makan Ivory', size: '20x20x7', qty: 5, qty_unit: 'rim', has_design: true },
        { product: 'Kertas Supreme 64 gsm cetak 1 warna', size: '30 x 30 cm', has_design: true },
      ] } });
      poTurn({ items: [{ product: 'Kertas Supreme 64 gsm cetak 1 warna', size: '30 x 30 cm', qty: 10, qty_unit: 'rim' }] });

      await routeInboundBaileysMessage(makeTextPayload('wamid-GR14', 'oke yang kertas supreme aja, ambil'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormMessage(PO_URL)]);
    });

    it.each(paths)('sends the form when the item has a chosen gramasi (%s path)', async (_path, photo) => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormMessage } = await import('../src/domain/constants.js');
      profile({ size: '20x20x7', gsm: '300' }); // "300" is 300 gsm

      await routeInboundBaileysMessage(payload(photo, 'wamid-GR3'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormMessage(PO_URL)]);
      expect(mockUpsertContactProfile).not.toHaveBeenCalled();
    });

    // The QA case "yang 300 aja, saya ambil": the pick and the agreement in one turn.
    it("this turn's own pick counts, before the saved profile shows it", async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormMessage } = await import('../src/domain/constants.js');
      profile({ size: '20x20x7' });
      poTurn({ items: [{ product: 'Box Makan Ivory', size: '20x20x7', gsm: '300 gsm' }] });

      await routeInboundBaileysMessage(makeTextPayload('wamid-GR4', 'yang 300 aja kak, saya ambil'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormMessage(PO_URL)]);
    });

    it.each(paths)('fills the only gramasi into the profile and sends the form (%s path)', async (_path, photo) => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormMessage } = await import('../src/domain/constants.js');
      profile({ size: '25x25x7' });

      await routeInboundBaileysMessage(payload(photo, 'wamid-GR5'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormMessage(PO_URL)]);
      // The saved item, matched by product and size, takes the gramasi - before the form is made.
      expect(mockUpsertContactProfile).toHaveBeenCalledTimes(1);
      expect(mockUpsertContactProfile).toHaveBeenCalledWith('contact-uuid-1', { profilePatch: { items: [{ product: 'Box Makan Ivory', size: '25x25x7', gsm: '300 gsm' }] } });
      expect(mockUpsertContactProfile.mock.invocationCallOrder[0]!).toBeLessThan(mockGetPoFormUrls.mock.invocationCallOrder[0]!);
    });

    it('an item that already has its only gramasi is not written again', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormMessage } = await import('../src/domain/constants.js');
      profile({ size: '25x25x7', gsm: '300 gsm' });

      await routeInboundBaileysMessage(payload(false, 'wamid-GR6'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormMessage(PO_URL)]);
      expect(mockUpsertContactProfile).not.toHaveBeenCalled();
    });

    it('a fill that cannot be saved still sends the form', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormMessage } = await import('../src/domain/constants.js');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
      mockUpsertContactProfile.mockRejectedValue(new Error('db down'));
      profile({ size: '25x25x7' });

      await routeInboundBaileysMessage(payload(false, 'wamid-GR7'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormMessage(PO_URL)]);
      expect(warn.mock.calls.some((c) => String(c[0]).includes('gramasi'))).toBe(true);
      warn.mockRestore();
    });

    it.each(paths)('an unreadable catalog still sends the form (%s path)', async (_path, photo) => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormMessage } = await import('../src/domain/constants.js');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
      mockGetCatalogProducts.mockRejectedValue(new Error('db down'));
      profile({ size: '20x20x7' });

      await routeInboundBaileysMessage(payload(photo, 'wamid-GR8'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormMessage(PO_URL)]);
      expect(warn.mock.calls.some((c) => String(c[0]).includes('gramasi'))).toBe(true);
      warn.mockRestore();
    });
  });

  it('sends each reference image in order and records each', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const photos = ['/uploads/reference/1.jpg', '/uploads/reference/2.jpg', '/uploads/reference/3.jpg'];
    mockSendImageMessage.mockResolvedValueOnce('wa-img-1').mockResolvedValueOnce('wa-img-2').mockResolvedValueOnce('wa-img-3');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, imageUrls: photos });

    await routeInboundBaileysMessage(makeTextPayload('wamid-IMG1', 'belum ada desain kak'));
    await vi.runAllTimersAsync();

    expect(mockSendImageMessage.mock.calls.map((c) => c[2])).toEqual(photos);
    // After the text.
    expect(mockSendTextMessage.mock.invocationCallOrder[0]).toBeLessThan(mockSendImageMessage.mock.invocationCallOrder[0]);
    expect(imageRows().map((r) => [r.metadata.mediaUrl, r.waMessageId])).toEqual([
      ['/uploads/reference/1.jpg', 'wa-img-1'], ['/uploads/reference/2.jpg', 'wa-img-2'], ['/uploads/reference/3.jpg', 'wa-img-3'],
    ]);
    // The reply's row comes first, so the thread reads in send order.
    const bodies = mockInsertMessage.mock.calls.map((c) => c[0].body);
    expect(bodies.indexOf('AI reply')).toBeLessThan(bodies.indexOf('[Foto]'));
  });

  it('a photo that fails to send does not stop the others', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockSendImageMessage.mockResolvedValueOnce('wa-img-1').mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce('wa-img-3');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, imageUrls: ['/r/1.jpg', '/r/2.jpg', '/r/3.jpg'] });

    await routeInboundBaileysMessage(makeTextPayload('wamid-IMG2', 'contohnya ada kak?'));
    await vi.runAllTimersAsync();

    expect(mockSendImageMessage).toHaveBeenCalledTimes(3);
    expect(imageRows().map((r) => r.metadata.mediaUrl)).toEqual(['/r/1.jpg', '/r/3.jpg']);
  });

  it('sends the text, then the photos, then the PO form', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetPoFormUrls.mockResolvedValue(PO_URLS);
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, imageUrls: ['/r/1.jpg', '/r/2.jpg'], sendPoForm: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-IMG3', 'oke ambil yang ini'));
    await vi.runAllTimersAsync();

    const [reply, po] = mockSendTextMessage.mock.invocationCallOrder;
    const [img1, img2] = mockSendImageMessage.mock.invocationCallOrder;
    expect(reply).toBeLessThan(img1!);
    expect(img1).toBeLessThan(img2!);
    expect(img2).toBeLessThan(po!);
  });

  it('photo path: sends the reference photos and the PO form after the reply too', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { poFormMessage } = await import('../src/domain/constants.js');
    mockGetPoFormUrls.mockResolvedValue(PO_URLS);
    mockSendImageMessage.mockResolvedValueOnce('wa-img-1').mockResolvedValueOnce('wa-img-2');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, imageUrls: ['/r/1.jpg', '/r/2.jpg'], sendPoForm: true });

    await routeInboundBaileysMessage(makeImagePayload('wamid-IMG4', 'yang seperti ini kak, saya ambil'));
    await vi.runAllTimersAsync();

    expect(sentTexts()).toEqual(['AI reply', poFormMessage(PO_URL)]);
    expect(mockSendImageMessage.mock.calls.map((c) => c[2])).toEqual(['/r/1.jpg', '/r/2.jpg']);
    expect(mockSendTextMessage.mock.invocationCallOrder[0]).toBeLessThan(mockSendImageMessage.mock.invocationCallOrder[0]);
    expect(mockSendImageMessage.mock.invocationCallOrder[1]).toBeLessThan(mockSendTextMessage.mock.invocationCallOrder[1]);
    expect(imageRows().map((r) => [r.metadata.mediaUrl, r.waMessageId])).toEqual([['/r/1.jpg', 'wa-img-1'], ['/r/2.jpg', 'wa-img-2']]);
    expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({ body: poFormMessage(PO_URL), metadata: expect.objectContaining({ source: 'po_form' }) }));
  });

  // Review fix (Task 10 I1): no design and no reference photos - the team sends examples, and is told to.
  it('examplesForTeam: the reply goes out, then the fixed examples line, and the team takes the chat', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_DESIGN_EXAMPLES_FROM_TEAM } = await import('../src/domain/constants.js');
    mockGetContactProfile.mockResolvedValue({ customerType: null, profile: { name: 'Budi', items: [{ product: 'Kertas Supreme 64 gsm', size: '30x30', has_design: false }] } });
    mockSendTextMessage.mockResolvedValueOnce('wa-reply').mockResolvedValueOnce('wa-ex');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'Siap kak, belum ada desain ya.', examplesForTeam: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-EX1', 'belum ada desain kak'));
    await vi.runAllTimersAsync();

    expect(CANNED_DESIGN_EXAMPLES_FROM_TEAM).toBe('Untuk contoh desainnya, tim kami kirimkan sebentar lagi ya kak 🙏');
    expect(sentTexts()).toEqual(['Siap kak, belum ada desain ya.', CANNED_DESIGN_EXAMPLES_FROM_TEAM]);
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.stringContaining('Contoh desain diminta'), undefined, 'desain_masuk');
    const body = (mockNotifyStaff.mock.calls[0]![0] as { body: string }).body;
    expect(body).toContain('Contoh desain diminta');
    expect(body).toContain('Nama: Budi');
    const rows = mockInsertMessage.mock.calls.map((c) => c[0]).filter((r) => r.role === 'assistant');
    expect(rows.map((r) => [r.body, r.waMessageId])).toEqual([['Siap kak, belum ada desain ya.', 'wa-reply'], [CANNED_DESIGN_EXAMPLES_FROM_TEAM, 'wa-ex']]);
    expect(rows[1].metadata).toMatchObject({ source: 'design_examples' });
    // A reply, not a hand-off message: the customer is not sent the canned escalation.
    expect(mockEscalateConversation).not.toHaveBeenCalled();
  });

  it('no examples line, and no hand-off, without the flag', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_DESIGN_EXAMPLES_FROM_TEAM } = await import('../src/domain/constants.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-EX2', 'belum ada desain kak'));
    await vi.runAllTimersAsync();

    expect(sentTexts()).not.toContain(CANNED_DESIGN_EXAMPLES_FROM_TEAM);
    expect(mockUpdateConversationStatus).not.toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.anything());
  });

  it('photo path: the examples line follows the reply and any photos, and the team takes the chat', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_DESIGN_EXAMPLES_FROM_TEAM } = await import('../src/domain/constants.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, imageUrls: ['/r/1.jpg'], examplesForTeam: true });

    await routeInboundBaileysMessage(makeImagePayload('wamid-EX3', 'box seperti ini kak, belum ada desain'));
    await vi.runAllTimersAsync();

    expect(sentTexts()).toEqual(['AI reply', CANNED_DESIGN_EXAMPLES_FROM_TEAM]);
    expect(mockSendImageMessage.mock.invocationCallOrder[0]).toBeLessThan(mockSendTextMessage.mock.invocationCallOrder[1]!);
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.stringContaining('Contoh desain diminta'), undefined, 'desain_masuk');
    expect(mockNotifyStaff).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('Contoh desain diminta') }));
    expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({ body: CANNED_DESIGN_EXAMPLES_FROM_TEAM, metadata: expect.objectContaining({ source: 'design_examples' }) }));
    expect(mockEscalateConversation).not.toHaveBeenCalled();
  });

  // Task 13 carry + fix round 1: the team's promise is made once per hand-off - suppressed only while
  // the chat is still escalated and no staff message came after the earlier line.
  describe('the examples line and the PO-placeholder line, once per hand-off', () => {
    const EXAMPLES_REASON = 'Contoh desain diminta';
    const PO_REASON = 'Form PO belum diatur di Pengaturan';
    const lineOf = async (line: 'examples' | 'po') => {
      const { CANNED_DESIGN_EXAMPLES_FROM_TEAM, CANNED_PO_FORM_FROM_TEAM } = await import('../src/domain/constants.js');
      return line === 'examples' ? CANNED_DESIGN_EXAMPLES_FROM_TEAM : CANNED_PO_FORM_FROM_TEAM;
    };
    const botSaid = async (line: 'examples' | 'po', opts: { staffAfter?: boolean } = {}) => {
      const body = await lineOf(line);
      mockGetLastNMessages.mockResolvedValue([
        { role: 'user', body: 'belum ada desain kak' },
        { role: 'assistant', body: 'Siap kak.' },
        { role: 'assistant', body, metadata: { source: line === 'examples' ? 'design_examples' : 'po_form' } },
        ...(opts.staffAfter ? [{ role: 'assistant', body: 'Sudah kami kirim ya kak', senderName: 'Tim CS' }] : []),
        { role: 'user', body: 'oke kak' },
      ] as HistoryRow[]);
      return body;
    };
    const escalated = () => {
      mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
      mockUpsertConversation.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    };
    const handedOffFor = (reason: string) =>
      mockUpdateConversationStatus.mock.calls.some((c) => c[1] === 'escalated' && String(c[2]).includes(reason));
    const staffToldOf = (reason: string) =>
      mockNotifyStaff.mock.calls.some((c) => String((c[0] as { body: string }).body).includes(reason));
    const examplesTurn = () => mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, examplesForTeam: true });
    const poTurn = async () => {
      const { PO_FORM_PLACEHOLDER_URL } = await import('../src/domain/constants.js');
      mockGetPoFormUrls.mockResolvedValue({ cetak: PO_FORM_PLACEHOLDER_URL, plano: PO_FORM_PLACEHOLDER_URL });
      mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, sendPoForm: true });
    };

    // ── already sent, still escalated, no staff reply since → suppressed ──
    it('text path: an examples line still pending is not sent again, and the team is not told again', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      escalated();
      await botSaid('examples');
      examplesTurn();

      await routeInboundBaileysMessage(makeTextPayload('wamid-EX4', 'contohnya mana kak'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply']);
      expect(handedOffFor(EXAMPLES_REASON)).toBe(false);
      expect(staffToldOf(EXAMPLES_REASON)).toBe(false);
    });

    it('photo path: an examples line still pending is not sent again, and the team is not told again', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      escalated();
      await botSaid('examples');
      examplesTurn();

      await routeInboundBaileysMessage(makeImagePayload('wamid-EX5', 'box seperti ini kak, belum ada desain'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply']);
      expect(handedOffFor(EXAMPLES_REASON)).toBe(false);
      expect(staffToldOf(EXAMPLES_REASON)).toBe(false);
    });

    it('text path: a PO-placeholder line still pending is not sent again, and the team is not told again', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      escalated();
      await botSaid('po');
      await poTurn();

      await routeInboundBaileysMessage(makeTextPayload('wamid-PO8', 'oke kak jadi ambil 10 rim'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply']);
      expect(handedOffFor(PO_REASON)).toBe(false);
      expect(staffToldOf(PO_REASON)).toBe(false);
      expect(mockInsertMessage).not.toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ source: 'po_form' }) }));
    });

    it('photo path: a PO-placeholder line still pending is not sent again, and the team is not told again', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      escalated();
      await botSaid('po');
      await poTurn();

      await routeInboundBaileysMessage(makeImagePayload('wamid-PO9', 'yang ini kak, saya ambil'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply']);
      expect(handedOffFor(PO_REASON)).toBe(false);
      expect(staffToldOf(PO_REASON)).toBe(false);
    });

    // ── already sent, but the chat was set back to active → a new job: line and hand-off ──
    it('text path: chat set back to active, a new agreement gets the PO line and a hand-off again', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const line = await botSaid('po');
      await poTurn();

      await routeInboundBaileysMessage(makeTextPayload('wamid-PO11', 'oke kak, pesanan kedua 5 rim ya'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', line]);
      expect(handedOffFor(PO_REASON)).toBe(true);
      expect(staffToldOf(PO_REASON)).toBe(true);
    });

    it('photo path: chat set back to active, a new examples request gets the line and a hand-off again', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const line = await botSaid('examples');
      examplesTurn();

      await routeInboundBaileysMessage(makeImagePayload('wamid-EX8', 'kalau box yang ini, contoh desainnya ada?'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', line]);
      expect(handedOffFor(EXAMPLES_REASON)).toBe(true);
      expect(staffToldOf(EXAMPLES_REASON)).toBe(true);
    });

    // ── already sent, still escalated, but staff replied after it → a new job too ──
    it('text path: staff answered after the examples line - a new request gets the line and a hand-off', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      escalated();
      const line = await botSaid('examples', { staffAfter: true });
      examplesTurn();

      await routeInboundBaileysMessage(makeTextPayload('wamid-EX9', 'untuk box kue, contoh desainnya juga ada?'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', line]);
      expect(handedOffFor(EXAMPLES_REASON)).toBe(true);
      expect(staffToldOf(EXAMPLES_REASON)).toBe(true);
    });

    it('photo path: staff answered after the PO line - a new agreement gets the line and a hand-off', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      escalated();
      const line = await botSaid('po', { staffAfter: true });
      await poTurn();

      await routeInboundBaileysMessage(makeImagePayload('wamid-PO12', 'yang ini juga kak, saya ambil'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', line]);
      expect(handedOffFor(PO_REASON)).toBe(true);
      expect(staffToldOf(PO_REASON)).toBe(true);
    });

    it('a line said only by the customer, or the other fixed line, does not count', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { CANNED_DESIGN_EXAMPLES_FROM_TEAM } = await import('../src/domain/constants.js');
      escalated();
      await botSaid('po');
      mockGetLastNMessages.mockResolvedValue([
        ...(await mockGetLastNMessages()),
        { role: 'user', body: CANNED_DESIGN_EXAMPLES_FROM_TEAM },
      ] as HistoryRow[]);
      examplesTurn();

      await routeInboundBaileysMessage(makeTextPayload('wamid-EX6', 'belum ada desain kak'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', CANNED_DESIGN_EXAMPLES_FROM_TEAM]);
      expect(handedOffFor(EXAMPLES_REASON)).toBe(true);
    });

    it('a real PO link is not held back by the placeholder line sent earlier', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormMessage } = await import('../src/domain/constants.js');
      escalated();
      await botSaid('po');
      mockGetPoFormUrls.mockResolvedValue(PO_URLS);
      mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, sendPoForm: true });

      await routeInboundBaileysMessage(makeTextPayload('wamid-PO10', 'oke kak saya ambil'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply', poFormMessage(PO_URL)]);
    });
  });

  // Task 13 carry: a low-confidence turn hands off, and the examples request rides on the hand-off reason.
  it('a hand-off turn that also asked for examples tells the team in the hand-off reason', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_DESIGN_EXAMPLES_FROM_TEAM } = await import('../src/domain/constants.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: 'Ukuran custom', examplesForTeam: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-EX7', 'belum ada desain, ukurannya 50x50 kak'));
    await vi.runAllTimersAsync();

    expect(sentTexts()).not.toContain(CANNED_DESIGN_EXAMPLES_FROM_TEAM);
    expect(mockEscalateConversation).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^Ukuran custom; Contoh desain diminta/), expect.anything(), expect.anything(), expect.anything(), undefined, 'harga_custom');
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
    // Escalation notifies a human; it must not change what the customer is told. Holding any
    // Rp-bearing reply while escalated is blunt enough to eat prices for unrelated products - a
    // single bad figure would silence every price in the conversation for hours, across a
    // different product, while the customer asks "kok lama ya". The price check guards the
    // figures; escalation is not a conversation-wide gag.
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_STILL_CHECKING_REPLY } = await import('../src/domain/constants.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    const reply = 'RM Padang Jaya sudah saya catat 😊 Harganya Rp 185.000/rim, minimal 5 rim.';
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: reply, confidence: 'high' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-HOLD1', 'rm padang jaya kak nama usahanya'));
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
      ...BASE_AI_RESPONSE, message: 'Ini Rp 1.800/pcs ya kak.', confidence: 'high',
    });

    await routeInboundBaileysMessage(makeImagePayload('wamid-HOLD2', 'ini fotonya, harganya berapa?'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][2]).toBe('Ini Rp 1.800/pcs ya kak.');
  });

  it('already-escalated + NEW reason → escalation_reason is refreshed, not left stale', async () => {
    // The banner used to show whatever first escalated the conversation: live, a price objection
    // sat on a conversation that had moved on to another product 18 days later, so the team had
    // nothing actionable to pick up.
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockBuildContextAndCallAI.mockResolvedValue({
      ...BASE_AI_RESPONSE, confidence: 'low', escalationReason: 'Box 50x50 - ukuran tidak ada di katalog',
    });

    await routeInboundBaileysMessage(makeTextPayload('wamid-STALE1', 'yg biasanya aja, yg oval'));
    await vi.runAllTimersAsync();

    expect(mockUpdateConversationStatus).toHaveBeenCalledWith(
      'conv-uuid-1', 'escalated', 'Box 50x50 - ukuran tidak ada di katalog', undefined, 'harga_custom'
    );
    expect(mockEscalateConversation).not.toHaveBeenCalled();
  });

  it('still-checking ack carries a profile-gap question when the profile is thin', async () => {
    // Five identical dead lines in a row is what the customer actually got. When the AI has
    // nothing to say, at least collect what the team will need — same question the first
    // hand-off asks.
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_STILL_CHECKING_REPLY, ESCALATION_ASK_PRODUCT } = await import('../src/domain/constants.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockGetContactProfile.mockResolvedValue({ customerType: null, profile: {} });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, confidence: 'low' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-GAP1', 'kok lama ya'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][2]).toBe(`${CANNED_STILL_CHECKING_REPLY} ${ESCALATION_ASK_PRODUCT}`);
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

  // A gap question asked four times after the customer answered it - the answer never reached the
  // profile, and the ack asked on. Once is enough; the next rung (or nothing) comes after.
  it('never repeats a gap question the conversation already asked', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_STILL_CHECKING_REPLY, ESCALATION_ASK_PRODUCT, ESCALATION_ASK_SIZE } =
      await import('../src/domain/constants.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockGetContactProfile.mockResolvedValue({ customerType: null, profile: {} });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, confidence: 'low' });
    mockGetLastNMessages.mockResolvedValue([
      { role: 'assistant', body: `Kita coba cek dengan tim dulu ya kak 🙏 ${ESCALATION_ASK_PRODUCT}` },
      { role: 'user', body: 'box nasi' },
    ]);

    await routeInboundBaileysMessage(makeTextPayload('wamid-GAP3', 'kok lama ya'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls[0][2]).toBe(`${CANNED_STILL_CHECKING_REPLY} ${ESCALATION_ASK_SIZE}`);
  });

  // A complaint ("box yang saya pesan bulan lalu banyak yang rusak") must not get "kira-kira kebutuhannya berapa
  // banyak ya kak?" appended to the hand-off.
  it('a complaint hand-off opens with an apology and asks no sales question', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_COMPLAINT_REPLY } = await import('../src/domain/constants.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: 'Komplain box rusak' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-CMP1', 'box yang saya pesan bulan lalu banyak yang rusak, gimana ini?'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);
    expect(mockEscalateConversation.mock.calls[0][5]).toBe(CANNED_COMPLAINT_REPLY);
  });

  // "grab / mau ambil pesanan" must not get a sales question. This number is also the marketplace
  // sender number; couriers go to the team as they are.
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
    const reason = 'Penawaran menjadi supplier/kerja sama produk plastik - bukan pembelian kemasan.';
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
      { role: 'assistant', body: 'Baik Bu Sari, ada yang bisa saya bantu?', createdAt: new Date() },
    ]);

    await routeInboundBaileysMessage(makeTextPayload('wamid-SUP3', 'Terkait dengan kebutuhan plastik kami bisa menghubungi kemana ya kak?'));
    await vi.runAllTimersAsync();
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockEscalateConversation.mock.calls[0][1]).toContain('Penawaran kerja sama / supplier');
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);
    expect(mockEscalateConversation.mock.calls[0][5]).toBe(CANNED_NON_SALES_REPLY);
  });

  // A job seeker must get no sales question - on the hand-off, or on any ack while waiting.
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
    mockGetLastNMessages.mockResolvedValue([{ role: 'user', body: 'boxnya banyak yang rusak kak' }]);

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
  // big order, a discount): "butuh 2000 box nasi" is exactly what they need to see.
  it('still notifies staff when the bot answers inside an escalated chat', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'Box nasi 20x20 Rp 1.800/pcs kak.', confidence: 'high' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-ESC3', 'butuh 2000 box nasi'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls[0][2]).toBe('Box nasi 20x20 Rp 1.800/pcs kak.');
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1);
    expect((mockNotifyStaff.mock.calls[0]![0] as { body: string }).body).toContain('butuh 2000 box nasi');
  });

  it('does not notify staff for an ordinary answered turn outside an escalation', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');

    await routeInboundBaileysMessage(makeTextPayload('wamid-ESC4', 'ada box nasi 20x20?'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockNotifyStaff).not.toHaveBeenCalled();
  });

  // ─── AI on/off gate: global default + per-contact override ────────────────

  it('AI off globally, contact has no override → message recorded, no AI, no reply', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetAiEnabledDefault.mockResolvedValue(false);

    await routeInboundBaileysMessage(makeTextPayload('wamid-OFF1', 'Halo ada box kue 20x20?'));
    await vi.runAllTimersAsync();

    expect(mockInsertMessageIfNew).toHaveBeenCalledTimes(1); // still recorded for CRM
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('AI off globally, contact pinned on → AI runs and replies', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetAiEnabledDefault.mockResolvedValue(false);
    mockUpsertContact.mockResolvedValue({ ...BASE_CONTACT, aiEnabled: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-ON1', 'Halo ada box kue 20x20?'));
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('AI on globally, contact pinned off → message recorded, no AI, no reply', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockGetAiEnabledDefault.mockResolvedValue(true);
    mockUpsertContact.mockResolvedValue({ ...BASE_CONTACT, aiEnabled: false });

    await routeInboundBaileysMessage(makeTextPayload('wamid-OFF2', 'Halo ada box kue 20x20?'));
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

    await routeInboundBaileysMessage(makeTextPayload('wamid-F01', 'ada box kue?'));

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

    await routeInboundBaileysMessage(makeTextPayload('wamid-ERR1', 'ada box kue 20x20?'));
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
      product: { name: 'BOX KUE KRAFT JENDELA', brand: 'Imperial Indopack', imageUrl: '/uploads/images/box-kue.jpg' },
      compared: ['BOX KUE KRAFT JENDELA', 'BOX KUE IVORY 20X20'],
      reason: 'bentuk kotak, leher panjang',
    });

    await routeInboundBaileysMessage(makeImagePayload('wamid-PM1'));
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    const call = mockEscalateConversation.mock.calls[0]!;
    expect(call[1]).toBe(`${PHOTO_UNSURE_REASON} (mirip BOX KUE KRAFT JENDELA, belum pasti)`);
    expect(call[5]).toBe(CANNED_PHOTO_CHECK_REPLY);
  });

  // Final review C1: at go-live no product has a photo, so every photo went to the team and the logo
  // path (spec 7.7) never ran - "ini logonya, mau cetak kertas nasi 30x30 10 rim" got the photo-check
  // hand-off plus "kemasannya untuk produk apa?". With nothing to compare, the model reads the photo.
  it('answers the photo itself while the catalog has no product photos, and keeps the design fact', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { NO_CATALOG_PHOTOS } = await vi.importActual<typeof import('../src/services/photoMatch.js')>('../src/services/photoMatch.js');
    mockMatchCustomerPhoto.mockResolvedValueOnce(NO_CATALOG_PHOTOS);
    const answer = {
      ...BASE_AI_RESPONSE,
      message: 'Terima kasih logonya kak, nanti saya teruskan ke tim bersama pesanannya 😊',
      profileUpdate: { items: [{ product: 'kertas nasi', size: '30x30', qty: 10, qty_unit: 'rim', has_design: true }] },
    };
    mockBuildContextAndCallAI.mockResolvedValue(answer);

    await routeInboundBaileysMessage(makeImagePayload('wamid-NOPH1', 'ini logonya, mau cetak kertas nasi 30x30 10 rim'));
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);
    expect(mockBuildContextAndCallAI.mock.calls[0]![6]).toEqual({ photoNote: null }); // nothing was compared
    expect(mockEscalateConversation).not.toHaveBeenCalled();
    expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual([answer.message]);
    expect(mockSaveConversationInsights).toHaveBeenCalledWith('conv-uuid-1', 'contact-uuid-1', expect.objectContaining({
      profileUpdate: { items: [expect.objectContaining({ has_design: true })] },
    }));
  });

  it('hands a photo whose comparison failed or timed out (no verdict), or did not match, to the team', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockMatchCustomerPhoto
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ certainty: 'none', product: null, compared: ['PAPER BAG PUTIH'], reason: 'beda' });

    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-PM2'), timestamp: 100 });
    await routeInboundBaileysMessage({ ...makeImagePayload('wamid-PM2b'), timestamp: 101 });
    await vi.runAllTimersAsync();

    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
    expect(mockEscalateConversation.mock.calls[0]![1]).toMatch(/foto 1: tidak ada hasil perbandingan foto; foto 2: tidak sama/);
  });

  // Only this turn sees the image; what it found is kept on the message for later turns.
  it('keeps what the photo was on the message, for later turns', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockMatchCustomerPhoto.mockResolvedValueOnce({
      certainty: 'same',
      product: { name: 'KERTAS SUPREME 64 GSM CETAK 1 WARNA', brand: 'Kertas Supreme', imageUrl: '/uploads/images/g.jpg' },
      compared: ['KERTAS SUPREME 64 GSM CETAK 1 WARNA'],
      reason: 'identik',
    });

    await routeInboundBaileysMessage(makeImagePayload('wamid-PM3'));
    await vi.runAllTimersAsync();

    expect(mockMergeMessageMetadata).toHaveBeenCalledWith('msg-uuid', { photoContext: 'produk kami KERTAS SUPREME 64 GSM CETAK 1 WARNA (foto sama)' });
  });


  // ─── A size the catalog does not have goes to the team (client 2026-11-11) ────
  it('adds the team line and escalates when a size question got no size', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_SIZE_FOR_TEAM } = await import('../src/domain/constants.js');
    const answer = 'Untuk Box Kue Ivory: Harga Rp 1.800/pcs, cetak full color.';
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: answer });

    await routeInboundBaileysMessage(makeTextPayload('wamid-SZ1', 'pilihan ukurannya ada berapa bu ?'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual([`${answer}\n\n${CANNED_SIZE_FOR_TEAM}`]);
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.stringContaining('ukuran'), undefined, 'lainnya');
  });

  it('leaves a reply that gives the size alone', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'Ada 2 pilihan kak: besar 25 cm dan tanggung 20 cm.' });

    await routeInboundBaileysMessage(makeTextPayload('wamid-SZ2', 'pilihan ukurannya ada berapa bu ?'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual(['Ada 2 pilihan kak: besar 25 cm dan tanggung 20 cm.']);
    expect(mockUpdateConversationStatus).not.toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.anything());
  });

  // ─── A total over many items goes to the team (owner, 2026-10-27) ────────────
  it('sends the per-item answer, says the team will calculate the total, and tells the team', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_TOTAL_FOR_TEAM } = await import('../src/domain/constants.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'Box nasi 20x20: Rp 1.800/pcs', totalForTeam: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-TOT1', 'jadi total berapa'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls.map((c) => c[2])).toEqual([`Box nasi 20x20: Rp 1.800/pcs\n\n${CANNED_TOTAL_FOR_TEAM}`]);
    expect(mockEscalateConversation).not.toHaveBeenCalled();
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.stringContaining('total'), undefined, 'lainnya');
    expect(mockNotifyStaff).toHaveBeenCalled();
  });

  it('does the same on a photo turn', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    const { CANNED_TOTAL_FOR_TEAM } = await import('../src/domain/constants.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'FOTO 1: box kue ivory Rp 2.100/pcs', totalForTeam: true });

    await routeInboundBaileysMessage(makeImagePayload('wamid-TOT2'));
    await vi.runAllTimersAsync();

    expect(mockSendTextMessage.mock.calls[0]![2]).toContain(CANNED_TOTAL_FOR_TEAM);
    // A photo turn's hand-off is a design received unless a stronger signal fired (Plan 2 Task 3).
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated', expect.stringContaining('total'), undefined, 'desain_masuk');
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

      await routeInboundBaileysMessage(makeTextPayload('wamid-NOC5', 'ada box?'));
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
    // Client 2026-10-26: a tax question goes to the team as it is - no sales question on the
    // hand-off.
    expect(mockEscalateConversation.mock.calls[0][3]).toBe(false);
  });

  // The faktur question can be only inside a screenshot of the customer's marketplace chat with us.
  // The model read it and handed off, but nothing in the caption said "pajak", so the hand-off asked
  // a sales question.
  it('hands off a tax question read from a chat screenshot, with no sales question', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockExtractCatalogKeywords.mockResolvedValue({ chat_text: ['pembelian di imperial apakah bisa dapat faktur pajak kak?'] });
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

    await routeInboundBaileysMessage(makeTextPayload('wamid-PPN3', 'ada box besar yang murah?'));
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

      await routeInboundBaileysMessage({ ...makeTextPayload('wamid-FLY1', 'kertas supreme 30x30 berapa?'), timestamp: T - 20 });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockBuildContextAndCallAI).toHaveBeenCalledTimes(1);

      await routeInboundBaileysMessage({ ...makeTextPayload('wamid-FLY2', '/new'), timestamp: T });
      resolveAI({ ...BASE_AI_RESPONSE, message: 'Kertas Supreme 30x30 Rp 185.000/rim kak.' });
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

  // ─── QA 2026-11-19: agreement and hand-off failure modes ─────────────────────
  describe('agreement after a price staff named (A3)', () => {
    const QUOTE = { role: 'assistant', body: 'Untuk 2.500 pcs harganya Rp 1.234/pcs, totalnya Rp 3.085.000 ya kak', senderName: null };
    const STAFF = { role: 'assistant', body: 'buletin ke 3 juta', senderName: 'Tim CS' };

    it('sends the fixed line instead of the reply or the form, and hands the deal to the team', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { CANNED_STAFF_PRICE_AGREED } = await import('../src/domain/constants.js');
      mockGetPoFormUrls.mockResolvedValue(PO_URLS);
      mockGetLastNMessages.mockResolvedValue([QUOTE, { role: 'user', body: 'bisa nego?' }, STAFF] as HistoryRow[]);
      mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'Siap kak, totalnya Rp 5.000.000 ya', sendPoForm: true });

      await routeInboundBaileysMessage(makeTextPayload('wamid-SP1', 'ya oke lah'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual([CANNED_STAFF_PRICE_AGREED]);
      expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-uuid-1', 'escalated',
        expect.stringContaining('Pelanggan setuju harga dari tim ("buletin ke 3 juta") - mohon kirimkan form PO'), undefined, 'lainnya');
      expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({ body: CANNED_STAFF_PRICE_AGREED, metadata: expect.objectContaining({ source: 'po_form' }) }));
      expect(mockSaveConversationInsights).toHaveBeenCalled();
      expect(mockEscalateConversation).not.toHaveBeenCalled();
    });

    it('also when the model handed the agreement off itself', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { CANNED_STAFF_PRICE_AGREED } = await import('../src/domain/constants.js');
      mockGetLastNMessages.mockResolvedValue([QUOTE, STAFF] as HistoryRow[]);
      mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: 'harga dari tim', sendPoForm: true });

      await routeInboundBaileysMessage(makeTextPayload('wamid-SP2', 'oke deal'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual([CANNED_STAFF_PRICE_AGREED]);
      expect(mockEscalateConversation).not.toHaveBeenCalled();
    });

    it('says the line once: a second "oke" before the team answers only gets an ack', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { CANNED_STAFF_PRICE_AGREED } = await import('../src/domain/constants.js');
      mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'escalated' });
      mockGetLastNMessages.mockResolvedValue([QUOTE, STAFF, { role: 'user', body: 'oke' },
        { role: 'assistant', body: CANNED_STAFF_PRICE_AGREED, senderName: null }] as HistoryRow[]);
      mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, sendPoForm: true });

      await routeInboundBaileysMessage(makeTextPayload('wamid-SP3', 'oke kak jadi ya'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toHaveLength(1);
      expect(sentTexts()[0]).not.toBe(CANNED_STAFF_PRICE_AGREED);
      expect(mockUpdateConversationStatus).not.toHaveBeenCalled();
      expect(mockNotifyStaff).toHaveBeenCalledWith(expect.objectContaining({ title: 'Pelanggan menunggu balasan' }));
    });

    it('a bot quote after the staff price is an ordinary agreement again', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      const { poFormMessage } = await import('../src/domain/constants.js');
      mockGetPoFormUrls.mockResolvedValue(PO_URLS);
      mockGetLastNMessages.mockResolvedValue([STAFF, { role: 'user', body: 'kalau 5000 pcs?' },
        { role: 'assistant', body: 'Untuk 5.000 pcs Rp 1.100/pcs ya kak', senderName: null }] as HistoryRow[]);
      mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: 'Siap kak 🙏', sendPoForm: true });

      await routeInboundBaileysMessage(makeTextPayload('wamid-SP4', 'oke ambil 5000'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['Siap kak 🙏', poFormMessage(PO_URL)]);
    });
  });

  describe('staff take the chat over while the reply is being written (B1)', () => {
    const takeOverDuringCall = (response: Record<string, unknown>) =>
      mockBuildContextAndCallAI.mockImplementation(async () => {
        mockFindConversationById.mockResolvedValue({ ...BASE_CONVERSATION, status: 'needs_human', assignedAgent: 'staff-1' });
        return response;
      });

    it('sends nothing and writes no status, but keeps the facts', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      takeOverDuringCall({ ...BASE_AI_RESPONSE, message: 'Siap kak 🙏', sendPoForm: true });

      await routeInboundBaileysMessage(makeTextPayload('wamid-B1a', 'oke kak'));
      await vi.runAllTimersAsync();

      expect(mockSendTextMessage).not.toHaveBeenCalled();
      expect(mockUpdateConversationStatus).not.toHaveBeenCalled();
      expect(mockSaveConversationInsights).toHaveBeenCalled();
    });

    it('a low-confidence turn does not escalate over the staff hold', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      takeOverDuringCall({ ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: 'x' });

      await routeInboundBaileysMessage(makeTextPayload('wamid-B1b', 'bisa nego?'));
      await vi.runAllTimersAsync();

      expect(mockEscalateConversation).not.toHaveBeenCalled();
      expect(mockUpdateConversationStatus).not.toHaveBeenCalled();
      expect(mockSendTextMessage).not.toHaveBeenCalled();
    });

    it('a failed re-read still replies', async () => {
      const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
      mockBuildContextAndCallAI.mockImplementation(async () => {
        mockFindConversationById.mockRejectedValue(new Error('db down'));
        return { ...BASE_AI_RESPONSE };
      });

      await routeInboundBaileysMessage(makeTextPayload('wamid-B1c', 'halo kak'));
      await vi.runAllTimersAsync();

      expect(sentTexts()).toEqual(['AI reply']);
    });
  });

  it('a hand-off on the agreement turn tells the team a sale is waiting (A4)', async () => {
    const { routeInboundBaileysMessage } = await import('../src/services/messageRouter.js');
    mockBuildContextAndCallAI.mockResolvedValue({ ...BASE_AI_RESPONSE, message: '', confidence: 'low', escalationReason: 'Desain sudah ada tidak didukung data', sendPoForm: true });

    await routeInboundBaileysMessage(makeTextPayload('wamid-A4', 'oke saya ambil'));
    await vi.runAllTimersAsync();

    expect(mockEscalateConversation).toHaveBeenCalledTimes(1);
    expect(mockEscalateConversation.mock.calls[0]![1]).toBe('Pelanggan setuju membeli - mohon kirimkan form PO (balasan bot ditahan: Desain sudah ada tidak didukung data)');
  });
});
