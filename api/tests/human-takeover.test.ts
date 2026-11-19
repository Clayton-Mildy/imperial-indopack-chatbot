/**
 * human-takeover.test.ts
 * When CS answers a customer themselves - from ChakraHQ's inbox, the WhatsApp Business app
 * behind it, or the dashboard - the bot has to stop. A second voice replying over a person
 * mid-conversation is worse than silence, and it is exactly what an escalated conversation
 * invites, because escalation notifies a human without ever pausing the AI.
 *
 * Reuses `needs_human` rather than adding a status: messageRouter's gate already returns on it,
 * and since status is one column it also clears `escalated` - a conversation someone has picked
 * up is no longer waiting to be picked up.
 *
 * Mocked - no DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindConversationById = vi.fn();
const mockUpdateConversationStatus = vi.fn(async () => null);
const mockInsertMessage = vi.fn(async () => ({ id: 'note-1' }));

vi.mock('../src/repositories/conversations.js', () => ({
  findConversationById: mockFindConversationById,
  updateConversationStatus: mockUpdateConversationStatus,
  insertMessage: mockInsertMessage,
}));

const { markHumanTakeover } = await import('../src/services/humanTakeover.js');

const CONV = { id: 'conv-1', contactId: 'contact-1', phoneNumberId: 'pn-1', status: 'active', escalationReason: null, handoffCategory: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertMessage.mockResolvedValue({ id: 'note-1' });
});

describe('markHumanTakeover', () => {
  it('pauses the AI and records who took over', async () => {
    mockFindConversationById.mockResolvedValue({ ...CONV });

    expect(await markHumanTakeover('conv-1', 'Tim CS')).toBe(true);
    // No hand-off before it: the reason says who answered, and the queue groups it by that reason.
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-1', 'needs_human', 'Dibalas langsung oleh Tim CS', 'Tim CS', 'lainnya');
    // A note in the thread, not just a badge - the takeover has to be visible where the
    // conversation is read, and the next AI turn can see a human stepped in.
    expect(mockInsertMessage.mock.calls[0]![0]).toMatchObject({ conversationId: 'conv-1', role: 'system_note' });
  });

  // The live case this exists for: escalated, waiting, and CS answers from their phone.
  it('clears an escalated conversation, because someone has now picked it up', async () => {
    mockFindConversationById.mockResolvedValue({ ...CONV, status: 'escalated' });

    expect(await markHumanTakeover('conv-1', 'Tim CS')).toBe(true);
    expect(mockUpdateConversationStatus.mock.calls[0]![1]).toBe('needs_human');
  });

  // The Perlu Tim banner keeps the bot's reason after the takeover, and the queue shows who took it.
  it('keeps the bot\'s reason and category and records the assignee', async () => {
    mockFindConversationById.mockResolvedValue({ ...CONV, status: 'escalated', escalationReason: 'Box 22x22x7 tidak ada di katalog', handoffCategory: 'harga_custom' });

    expect(await markHumanTakeover('conv-1', 'Admin Rina')).toBe(true);
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-1', 'needs_human', 'Box 22x22x7 tidak ada di katalog', 'Admin Rina', 'harga_custom');
  });

  // Escalated before categories existed: grouped by the reason it was handed off with.
  it('reads a missing category off the kept reason', async () => {
    mockFindConversationById.mockResolvedValue({ ...CONV, status: 'escalated', escalationReason: '150 rim, di atas tingkat teratas', handoffCategory: null });

    await markHumanTakeover('conv-1', 'Tim CS');
    expect(mockUpdateConversationStatus.mock.calls[0]![4]).toBe('pesanan_besar');
  });

  // chakraSync replays history, so an agent who sent five messages must not produce five
  // system notes, and a re-sync must not re-pause a conversation already handed back.
  it('is idempotent once the conversation is already taken over', async () => {
    mockFindConversationById.mockResolvedValue({ ...CONV, status: 'needs_human' });

    expect(await markHumanTakeover('conv-1', 'Tim CS')).toBe(false);
    expect(mockUpdateConversationStatus).not.toHaveBeenCalled();
    expect(mockInsertMessage).not.toHaveBeenCalled();
  });

  // `resolved` is a deliberate end state; a late-syncing agent message (chakraSync) must not reopen it.
  it('leaves a resolved conversation alone by default', async () => {
    mockFindConversationById.mockResolvedValue({ ...CONV, status: 'resolved' });

    expect(await markHumanTakeover('conv-1', 'Tim CS')).toBe(false);
    expect(mockUpdateConversationStatus).not.toHaveBeenCalled();
  });

  // A staff send from the dashboard (typed reply, quick-send) is the sender picking the chat back up:
  // left resolved, the customer's next message would reopen it to the bot over that staff member.
  it('a dashboard staff send takes a resolved conversation over: needs_human, held by the sender', async () => {
    mockFindConversationById.mockResolvedValue({ ...CONV, status: 'resolved' });

    expect(await markHumanTakeover('conv-1', 'Admin Rina', { includeResolved: true })).toBe(true);
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith('conv-1', 'needs_human', 'Dibalas langsung oleh Admin Rina', 'Admin Rina', 'lainnya');
    expect(mockInsertMessage.mock.calls[0]![0]).toMatchObject({ conversationId: 'conv-1', role: 'system_note' });
  });

  it('a dashboard staff send is still idempotent on a chat already held', async () => {
    mockFindConversationById.mockResolvedValue({ ...CONV, status: 'needs_human' });

    expect(await markHumanTakeover('conv-1', 'Admin Rina', { includeResolved: true })).toBe(false);
    expect(mockUpdateConversationStatus).not.toHaveBeenCalled();
  });

  it('does nothing for a conversation that does not exist', async () => {
    mockFindConversationById.mockResolvedValue(null);

    expect(await markHumanTakeover('missing', 'Tim CS')).toBe(false);
    expect(mockUpdateConversationStatus).not.toHaveBeenCalled();
  });

  // The status write is what actually stops the bot; a failed note must not take it down.
  it('still counts as a takeover when the system note cannot be written', async () => {
    mockFindConversationById.mockResolvedValue({ ...CONV });
    mockInsertMessage.mockRejectedValueOnce(new Error('db down'));

    expect(await markHumanTakeover('conv-1', 'Tim CS')).toBe(true);
    expect(mockUpdateConversationStatus).toHaveBeenCalled();
  });
});
