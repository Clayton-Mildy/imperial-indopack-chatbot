/**
 * escalation-nudge.test.ts
 * An escalation nobody picks up is invisible: `escalated` is sticky (only a human clicking
 * "Kembalikan ke AI" clears it) and the bot answers every further message with the same
 * holding line. Live, that produced five byte-identical acks over twenty hours while the
 * customer asked "kok lama ya". The first hand-off notification covers the hand-off; this
 * covers everyone forgetting about it afterwards.
 *
 * Mocked - no DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListStale = vi.fn();
const mockNotifyStaff = vi.fn();

vi.mock('../src/repositories/conversations.js', () => ({ listStaleEscalations: mockListStale }));
vi.mock('../src/services/staffNotify.js', () => ({ notifyStaff: mockNotifyStaff }));

const { nudgeStaleEscalations, resetNudgeState } = await import('../src/services/escalationNudge.js');

const THIRTY_MIN = 30 * 60_000;

function stale(id: string, minutesAgo: number, reason: string | null = 'Low confidence') {
  return { id, escalationReason: reason, escalatedAt: new Date(Date.now() - minutesAgo * 60_000) };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetNudgeState();
});

describe('nudgeStaleEscalations', () => {
  it('nudges an escalation that has been waiting, with how long and a deep link', async () => {
    mockListStale.mockResolvedValue([stale('conv-1', 45)]);

    await nudgeStaleEscalations(THIRTY_MIN);

    expect(mockNotifyStaff).toHaveBeenCalledTimes(1);
    const n = mockNotifyStaff.mock.calls[0]![0] as { title: string; body: string; path: string };
    expect(n.title).toContain('45 menit');
    expect(n.body).toBe('Low confidence');
    expect(n.path).toBe('/conversations/conv-1');
  });

  // The nudge runs on a timer, so without this every sweep re-pings every open escalation -
  // which is how a reminder turns into noise staff learn to ignore.
  it('nudges each conversation once, not on every sweep', async () => {
    mockListStale.mockResolvedValue([stale('conv-1', 45)]);

    await nudgeStaleEscalations(THIRTY_MIN);
    await nudgeStaleEscalations(THIRTY_MIN);
    await nudgeStaleEscalations(THIRTY_MIN);

    expect(mockNotifyStaff).toHaveBeenCalledTimes(1);
  });

  // Leaving the stale set means someone answered, resolved, or returned it to the AI. If the
  // same conversation escalates again later that is genuinely new, and must ping again.
  it('nudges again after the conversation was handled and re-escalated', async () => {
    mockListStale.mockResolvedValue([stale('conv-1', 45)]);
    await nudgeStaleEscalations(THIRTY_MIN);

    mockListStale.mockResolvedValue([]); // handled
    await nudgeStaleEscalations(THIRTY_MIN);

    mockListStale.mockResolvedValue([stale('conv-1', 40)]); // escalated again, still unanswered
    await nudgeStaleEscalations(THIRTY_MIN);

    expect(mockNotifyStaff).toHaveBeenCalledTimes(2);
  });

  it('says nothing when no escalation is old enough', async () => {
    mockListStale.mockResolvedValue([]);

    await nudgeStaleEscalations(THIRTY_MIN);

    expect(mockNotifyStaff).not.toHaveBeenCalled();
  });

  // A conversation escalated by the model with no reason recorded is exactly the one nobody
  // can triage from the queue, so it must still produce a readable notification.
  it('falls back to a readable body when no escalation reason was recorded', async () => {
    mockListStale.mockResolvedValue([stale('conv-1', 90, null)]);

    await nudgeStaleEscalations(THIRTY_MIN);

    const n = mockNotifyStaff.mock.calls[0]![0] as { title: string; body: string };
    expect(n.body).toBe('Belum ditangani');
    expect(n.title).toContain('1 jam');
  });
});
