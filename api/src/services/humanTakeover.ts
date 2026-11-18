import { findConversationById, updateConversationStatus, insertMessage } from '../repositories/conversations.js';
import { NO_SIGNALS, classifyHandoff } from '../domain/handoff.js';

/**
 * A human answered this customer themselves, so the AI stops.
 *
 * Reuses `needs_human` rather than adding a status: messageRouter's gate already returns early
 * on it, and because status is one column this also clears `escalated` - a conversation someone
 * has picked up is no longer waiting for someone to pick it up.
 *
 * Idempotent by status check, which matters because chakraSync replays: an agent who sends five
 * messages must not produce five system notes, and a takeover must not re-fire on every sync.
 * `resolved` is left alone - that is a deliberate end state, not something to downgrade.
 */
export async function markHumanTakeover(conversationId: string, agent: string): Promise<boolean> {
  const conv = await findConversationById(conversationId);
  if (!conv || conv.status === 'needs_human' || conv.status === 'resolved') return false;

  // The bot's hand-off reason and category stay on the chat (the Perlu Tim banner keeps reading
  // them), and the queue shows who picked it up. A chat taken over before any hand-off says so, and
  // is grouped by that reason.
  const reason = conv.escalationReason ?? `Dibalas langsung oleh ${agent}`;
  await updateConversationStatus(conversationId, 'needs_human', reason, agent, conv.handoffCategory ?? classifyHandoff(NO_SIGNALS, reason));

  // Persisted so the takeover is visible in the thread itself, not only in a status badge -
  // and so the next AI turn (after someone hands it back) can see that a human stepped in.
  await insertMessage({
    conversationId,
    role: 'system_note',
    body: `${agent} membalas langsung. AI berhenti membalas percakapan ini sampai dikembalikan lewat tombol "Kembalikan ke AI".`,
  }).catch(() => { });

  console.log(`[humanTakeover] ${conversationId}: ${agent} replied directly - AI paused`);
  return true;
}
