/**
 * staff-notify.test.ts
 * notifyStaff is the only thing in this system that reaches a person.
 *
 * Before it existed, escalateConversation's "notification" was a canned line sent to the
 * CUSTOMER's own number, and the escalations queue was polled by an open browser tab - so a
 * hand-off raised at night reached a human whenever someone next opened the dashboard. That
 * makes two properties load-bearing: it must be inert (not broken) when unconfigured, so a
 * deploy that sets no keys behaves exactly as before; and it must clean up dead subscriptions,
 * because a push endpoint that 410s stays dead forever and would be retried on every escalation.
 *
 * Mocked - no DATABASE_URL, no network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendNotification = vi.fn();
const mockSetVapidDetails = vi.fn();
const mockListSubs = vi.fn();
const mockDeleteSub = vi.fn(async () => undefined);
const mockSendText = vi.fn(async () => 'wamid-1');

let cfg: Record<string, string> = {};

vi.mock('web-push', () => ({
  default: { setVapidDetails: mockSetVapidDetails, sendNotification: mockSendNotification },
}));
vi.mock('../src/config.js', () => ({ getConfig: () => cfg }));
vi.mock('../src/repositories/pushSubscriptions.js', () => ({
  listPushSubscriptions: mockListSubs,
  deletePushSubscription: mockDeleteSub,
}));
vi.mock('../src/repositories/phoneNumbers.js', () => ({
  getFirstPhoneNumber: vi.fn(async () => ({ id: 'pn-1', phoneNumberId: 'wa-1' })),
}));
vi.mock('../src/services/whatsappSender.js', () => ({ sendTextMessage: mockSendText }));

const { notifyStaff, resetVapidCache } = await import('../src/services/staffNotify.js');

const SUB = { id: 's1', staffId: 'staff-1', endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' };

function configured(extra: Record<string, string> = {}) {
  return {
    VAPID_PUBLIC_KEY: 'pub',
    VAPID_PRIVATE_KEY: 'priv',
    VAPID_SUBJECT: 'mailto:a@b.c',
    PUBLIC_BASE_URL: 'https://dashboard.example.co.id',
    ESCALATION_NOTIFY_WA: '',
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetVapidCache();
  cfg = configured();
  mockListSubs.mockResolvedValue([SUB]);
  mockSendNotification.mockResolvedValue(undefined);
});

describe('notifyStaff', () => {
  it('pushes to every subscription with a tappable dashboard link', async () => {
    notifyStaff({ title: 'Eskalasi baru', body: 'Low confidence', path: '/conversations/c1' });

    await vi.waitFor(() => expect(mockSendNotification).toHaveBeenCalledTimes(1));
    const [subscription, payload] = mockSendNotification.mock.calls[0]!;
    expect(subscription).toEqual({ endpoint: SUB.endpoint, keys: { p256dh: 'p', auth: 'a' } });
    // The dashboard is proxied under /app on this same origin, so PUBLIC_BASE_URL is the whole
    // address - there is no second hostname to keep in sync.
    expect(JSON.parse(payload as string).url).toBe(
      'https://dashboard.example.co.id/app/conversations/c1'
    );
  });

  it('deletes a subscription the push service reports as gone (410)', async () => {
    mockSendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));

    notifyStaff({ title: 't', body: 'b' });

    await vi.waitFor(() => expect(mockDeleteSub).toHaveBeenCalledWith(SUB.endpoint));
  });

  it('keeps the subscription on a transient failure (500)', async () => {
    mockSendNotification.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));

    notifyStaff({ title: 't', body: 'b' });

    await vi.waitFor(() => expect(mockSendNotification).toHaveBeenCalled());
    expect(mockDeleteSub).not.toHaveBeenCalled();
  });

  // The whole point of the env gates: an install that configures neither channel must keep
  // working exactly as it does today, not throw on every escalation.
  it('is inert when no VAPID keys are configured', async () => {
    cfg = configured({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' });
    resetVapidCache();

    notifyStaff({ title: 't', body: 'b' });

    await vi.waitFor(() => expect(mockSetVapidDetails).not.toHaveBeenCalled());
    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(mockSendText).not.toHaveBeenCalled();
  });

  // Covers the phones push cannot reach: iOS before 16.4, and any browser where nobody pressed
  // "enable notifications". Independent of push, so one being off never disables the other.
  it('also pings WhatsApp when a staff number is set', async () => {
    cfg = configured({ ESCALATION_NOTIFY_WA: '628999' });

    notifyStaff({ title: 'Eskalasi baru', body: 'Low confidence', path: '/conversations/c1' });

    await vi.waitFor(() => expect(mockSendText).toHaveBeenCalledTimes(1));
    const [phoneNumberId, to, text] = mockSendText.mock.calls[0]!;
    expect(phoneNumberId).toBe('wa-1');
    expect(to).toBe('628999');
    expect(text).toContain('Low confidence');
    expect(text).toContain('/app/conversations/c1');
  });

  it('still pushes when the WhatsApp ping throws', async () => {
    cfg = configured({ ESCALATION_NOTIFY_WA: '628999' });
    mockSendText.mockRejectedValueOnce(new Error('WhatsApp 500'));

    notifyStaff({ title: 't', body: 'b' });

    await vi.waitFor(() => expect(mockSendNotification).toHaveBeenCalledTimes(1));
  });
});
