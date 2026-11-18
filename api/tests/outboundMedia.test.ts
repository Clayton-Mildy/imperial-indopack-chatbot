/**
 * The bot's own photos and PDFs are stored when sent, under their wamid. That is what lets
 * chakraSync label every other outbound file "Tim CS", and what lets the dashboard show them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cfg: Record<string, string> = { PUBLIC_BASE_URL: 'https://bot.example.com/' };
vi.mock('../src/config.js', () => ({ getConfig: () => cfg }));
const mockInsertMessage = vi.fn();
vi.mock('../src/repositories/conversations.js', () => ({ insertMessage: mockInsertMessage }));

const { recordOutboundMedia, storedMediaUrl } = await import('../src/services/outboundMedia.js');

describe('storedMediaUrl', () => {
  it('keeps our own files relative, folding the tunnel address back to the path', () => {
    expect(storedMediaUrl('/uploads/products/a.jpg')).toBe('/uploads/products/a.jpg');
    expect(storedMediaUrl('https://bot.example.com/uploads/products/a.jpg')).toBe('/uploads/products/a.jpg');
    expect(storedMediaUrl('https://cdn.chakrahq.com/katalog.pdf')).toBe('https://cdn.chakrahq.com/katalog.pdf');
  });
});

describe('recordOutboundMedia', () => {
  beforeEach(() => { mockInsertMessage.mockReset(); });

  it('stores the file under its wamid, unlabelled, with the same body the sync would give it', async () => {
    mockInsertMessage.mockResolvedValue({});
    await recordOutboundMedia({ conversationId: 'c1', kind: 'image', link: '/uploads/p/x.jpg', wamid: 'wamid.X', source: 'bot_media' });
    await recordOutboundMedia({ conversationId: 'c1', kind: 'document', link: 'https://cdn.chakrahq.com/k.pdf', filename: 'KATALOG.pdf', wamid: '', source: 'bot_media' });
    expect(mockInsertMessage.mock.calls[0]![0]).toMatchObject({
      role: 'assistant', body: '[Foto]', waMessageId: 'wamid.X', senderName: null,
      metadata: { attachmentType: 'image', mediaUrl: '/uploads/p/x.jpg', source: 'bot_media' },
    });
    // No wamid from the provider: stored without one (chakraSync's twin check then skips its copy).
    expect(mockInsertMessage.mock.calls[1]![0]).toMatchObject({
      body: 'KATALOG.pdf', waMessageId: undefined,
      metadata: { attachmentType: 'document', mediaUrl: 'https://cdn.chakrahq.com/k.pdf', filename: 'KATALOG.pdf' },
    });
  });

  it('never throws - the file is already with the customer', async () => {
    mockInsertMessage.mockImplementation(async () => { throw new Error('db down'); });
    await expect(
      recordOutboundMedia({ conversationId: 'c1', kind: 'image', link: '/uploads/x.jpg', wamid: 'w', source: 'bot_media' })
    ).resolves.toBeUndefined();
  });
});
