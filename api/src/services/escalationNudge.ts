import { listStaleEscalations } from '../repositories/conversations.js';
import { notifyStaff } from './staffNotify.js';

/**
 * Nudge staff about escalations nobody has picked up.
 *
 * `escalated` is sticky - only a human clicking "Kembalikan ke AI" clears it - and the bot
 * answers every further message with the same holding line. Live, that produced five
 * byte-identical acks over twenty hours while the customer asked "kok lama ya", because the
 * hand-off had never reached a person in the first place. The first notification covers the
 * hand-off; this covers everyone forgetting about it afterwards.
 */

// ponytail: in-memory, so a restart can re-nudge each open escalation once. That is the right
// trade - a duplicate ping costs nothing, a missed one is the bug this exists to fix. Persist
// to messages.metadata if restarts ever get frequent enough for staff to notice.
const nudged = new Set<string>();

function waitedFor(since: Date): string {
  const minutes = Math.round((Date.now() - since.getTime()) / 60_000);
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} jam` : `${Math.floor(hours / 24)} hari`;
}

export async function nudgeStaleEscalations(afterMs: number): Promise<void> {
  const stale = await listStaleEscalations(new Date(Date.now() - afterMs));

  // Anything no longer in the stale set has been answered, resolved or returned to the AI -
  // drop it so a later re-escalation of the same conversation nudges again instead of being
  // silently swallowed by a stale id.
  const open = new Set(stale.map((c) => c.id));
  for (const id of nudged) {
    if (!open.has(id)) nudged.delete(id);
  }

  for (const conv of stale) {
    if (nudged.has(conv.id)) continue;
    nudged.add(conv.id);
    notifyStaff({
      title: `Eskalasi menunggu ${waitedFor(conv.escalatedAt)}`,
      body: conv.escalationReason ?? 'Belum ditangani',
      path: `/conversations/${conv.id}`,
    });
  }
}

export function scheduleEscalationNudge(afterMs: number, intervalMs: number): void {
  if (afterMs <= 0 || intervalMs <= 0) return;
  setInterval(() => {
    void nudgeStaleEscalations(afterMs).catch((err) =>
      console.warn('[escalationNudge] sweep failed:', err instanceof Error ? err.message : err)
    );
  }, intervalMs);
}

// Exposed for tests: the module-level set would otherwise leak between cases.
export function resetNudgeState(): void {
  nudged.clear();
}
