/**
 * The dashboard's Perlu Tim queue: every chat waiting on the team, grouped by why it was handed over
 * (domain/handoff.ts), oldest wait first in each group, with what the bot already collected and which
 * of the six order details (domain/orderDetails.ts) the team still has to ask for.
 */

import { HANDOFF_CATEGORIES, type HandoffCategory } from '../domain/handoff.js';
import { contactHeadline, orderDetailRows, orderItemsSummary, profileFacts, type OrderDetailKey } from '../domain/orderDetails.js';
import type { BrandSlug } from '../domain/orderProfile.js';
import { listHeldConversations } from '../repositories/conversations.js';
import { getBotSettings } from '../repositories/appSettings.js';

export interface TeamQueueItem {
  conversationId: string;
  customerName: string | null;
  businessName: string | null;
  waId: string;
  brands: BrandSlug[];
  itemsSummary: string;
  detailsFilled: number;
  missing: OrderDetailKey[];
  /** ISO time the chat started waiting: the hand-off message, else the row's updated_at. */
  waitingSince: string;
  assignedAgent: string | null;
  status: 'escalated' | 'needs_human';
}

export interface TeamQueue {
  waitingCount: number;
  oldestWaitingSince: string | null;
  /** Settings' teamReminderMinutes: the team is reminded of a chat unanswered this long. */
  reminderMinutes: number;
  /** All seven categories, in HANDOFF_CATEGORIES order, empty ones included. */
  groups: { category: HandoffCategory; items: TeamQueueItem[] }[];
}

/** `assignedTo`: only the chats that staff member holds ("Ditangani saya"). */
export async function getTeamQueue(opts: { assignedTo?: string } = {}): Promise<TeamQueue> {
  const [rows, settings] = await Promise.all([
    listHeldConversations({ assignedTo: opts.assignedTo?.trim() || undefined }),
    getBotSettings(),
  ]);

  const groups = HANDOFF_CATEGORIES.map((category) => ({ category, items: [] as TeamQueueItem[] }));
  for (const row of rows) {
    const facts = profileFacts(row.profile);
    const details = orderDetailRows(facts);
    // A held chat with no category (one held before categories existed) is still waiting: Lainnya.
    const category = row.handoffCategory && HANDOFF_CATEGORIES.includes(row.handoffCategory) ? row.handoffCategory : 'lainnya';
    groups.find((g) => g.category === category)!.items.push({
      conversationId: row.id,
      ...contactHeadline(facts, row.displayName),
      waId: row.waId,
      itemsSummary: orderItemsSummary(Array.isArray(facts.items) ? facts.items : []),
      detailsFilled: details.filter((d) => d.filled).length,
      missing: details.filter((d) => !d.filled).map((d) => d.key),
      waitingSince: row.waitingSince.toISOString(),
      assignedAgent: row.assignedAgent,
      status: row.status,
    });
  }

  return {
    waitingCount: rows.length,
    // Rows come oldest wait first.
    oldestWaitingSince: rows[0]?.waitingSince.toISOString() ?? null,
    reminderMinutes: settings.teamReminderMinutes,
    groups,
  };
}
