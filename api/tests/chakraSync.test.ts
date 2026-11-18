/**
 * chakraSync backfills conversation history from ChakraHQ.
 *
 * The two properties that matter to a customer:
 *   - it never sends anything or runs the AI (it only writes to the DB), and
 *   - re-running it is free, because dedup rides on the existing UNIQUE index on
 *     messages.wa_message_id and Chakra's `externalId` is that same wamid.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cfg: Record<string, string> = {
  CHAKRA_BASE_URL: 'https://api.chakrahq.com',
  CHAKRA_PLUGIN_ID: 'plug-123',
  CHAKRA_API_VERSION: 'v22.0',
  CHAKRA_ACCESS_TOKEN: 'tok-abc',
  WHATSAPP_TRANSPORT: 'chakra',
};
vi.mock('../src/config.js', () => ({ getConfig: () => cfg }));

const mockUpsertContact = vi.fn();
const mockUpsertConversation = vi.fn();
const mockInsertMessageIfNew = vi.fn();
const mockBackdateConversation = vi.fn();
const mockHasUnlinkedAssistantTwin = vi.fn();
const mockMarkHumanTakeover = vi.fn(async () => true);
vi.mock('../src/services/humanTakeover.js', () => ({ markHumanTakeover: mockMarkHumanTakeover }));
const mockFindPhoneNumberByProviderId = vi.fn();
const mockGetFirstPhoneNumber = vi.fn();
const mockGetChakraSyncState = vi.fn();
const mockSetChakraSyncState = vi.fn();
const mockSendTextMessage = vi.fn();
const mockBuildContextAndCallAI = vi.fn();
const mockWriteFile = vi.fn();
const mockRecordLeadFromMessage = vi.fn();

vi.mock('../src/repositories/contacts.js', () => ({ upsertContact: mockUpsertContact }));
vi.mock('../src/repositories/conversations.js', () => ({
  upsertConversation: mockUpsertConversation,
  insertMessageIfNew: mockInsertMessageIfNew,
  backdateConversation: mockBackdateConversation,
  hasUnlinkedAssistantTwin: mockHasUnlinkedAssistantTwin,
  existingWaMessageIds: async (ids: string[]) => new Set(ids.filter((id) => inserted.some((m) => m['waMessageId'] === id))),
}));
vi.mock('../src/repositories/phoneNumbers.js', () => ({
  findPhoneNumberByProviderId: mockFindPhoneNumberByProviderId,
  getFirstPhoneNumber: mockGetFirstPhoneNumber,
}));
vi.mock('../src/repositories/appSettings.js', () => ({
  getChakraSyncState: mockGetChakraSyncState,
  setChakraSyncState: mockSetChakraSyncState,
}));
// chakraSync must not reach either of these. Mocking them turns "it doesn't" into an
// assertion instead of an assumption — a future send added here fails the last test.
vi.mock('../src/services/whatsappSender.js', () => ({
  sendTextMessage: mockSendTextMessage,
  sendDocumentMessage: vi.fn(),
  sendImageMessage: vi.fn(),
}));
vi.mock('../src/services/aiLayer.js', () => ({ buildContextAndCallAI: mockBuildContextAndCallAI }));
vi.mock('fs/promises', () => ({ writeFile: mockWriteFile, mkdir: vi.fn() }));
// The backfill importer attributes leads too, same as the webhook path. Mocked like every
// other collaborator here; tests/leads.test.ts covers the matcher against real Postgres.
vi.mock('../src/services/leadMatcher.js', () => ({
  recordLeadFromMessage: mockRecordLeadFromMessage,
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ─── Fixtures ───────────────────────────────────────────────────────────────

const CHAT = {
  id: 'chat-1',
  provider: 'WHATSAPP',
  providerHandle: '628999000111',
  providerHandleId: 'PN-META-1',
  primaryContact: { name: 'Budi' },
  // Chakra returns the handle with a "+"; contacts.wa_id holds bare digits.
  primaryContactHandle: { value: '+62812 3456 7890' },
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_300_000,
};

// Newest-first, which is what the early-exit path expects to find.
const MESSAGES = [
  {
    id: 'c3',
    externalId: 'wamid.C',
    direction: 'OUTBOUND',
    dataType: 'text',
    text: 'Terima kasih!',
    deliveryStatus: 'DELIVERED',
    user: 'agent-uuid-1', // human agent typed this in Chakra's inbox
    timestamp: 1_700_000_300_000,
  },
  {
    id: 'c2',
    externalId: 'wamid.B',
    direction: 'OUTBOUND',
    dataType: 'text',
    body: { text: { body: 'Halo, ada yang bisa dibantu?' } },
    timestamp: 1_700_000_200_000,
  },
  {
    id: 'c1',
    externalId: 'wamid.A',
    direction: 'INBOUND',
    dataType: 'text',
    text: 'halo',
    timestamp: 1_700_000_100_000,
  },
];

// A chat long enough to paginate: page 1 is the newest 500 (which the live webhook has
// already stored), page 2 holds the older history that only a backfill can reach.
const MESSAGE_PAGE_SIZE = 500;
const OLD_PAGE_1 = Array.from({ length: MESSAGE_PAGE_SIZE }, (_, i) => ({
  id: `p1-${i}`,
  externalId: `wamid.KNOWN${i}`,
  direction: 'INBOUND',
  dataType: 'text',
  text: `pesan ${i}`,
  timestamp: 1_700_000_000_000 - i * 1000,
}));
const OLD_PAGE_2 = [
  {
    id: 'p2-0',
    externalId: 'wamid.ANCIENT',
    direction: 'INBOUND',
    dataType: 'text',
    text: 'pesan paling lama',
    timestamp: 1_690_000_000_000,
  },
];

let messageFixture: unknown[] = MESSAGES;
let messageFixturePage2: unknown[] = [];
let mediaOk = true;
let inserted: Record<string, unknown>[] = [];

function jsonRes(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function routeFetch(url: string, opts: { body?: string }) {
  const page = opts.body ? (JSON.parse(opts.body) as { page?: number }).page ?? 1 : 1;

  if (url.endsWith('/v1/ext/chat')) {
    return jsonRes({ _data: page === 1 ? [CHAT] : [] });
  }
  if (url.endsWith('/v1/ext/chat/chat-1/message')) {
    if (page === 1) return jsonRes({ _data: messageFixture });
    if (page === 2) return jsonRes({ _data: messageFixturePage2 });
    return jsonRes({ _data: [] });
  }
  if (url.includes('/media/')) {
    if (!mediaOk) return { ok: false, status: 404, text: async () => 'expired' };
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  }
  throw new Error(`unexpected fetch: ${url}`);
}

async function importSync() {
  return import('../src/services/chakraSync.js');
}

describe('chakraSync.runChakraSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageFixture = MESSAGES;
    messageFixturePage2 = [];
    mediaOk = true;
    inserted = [];

    fetchMock.mockImplementation((url: string, opts: { body?: string }) => routeFetch(url, opts ?? {}));

    mockGetChakraSyncState.mockResolvedValue({ watermarkMs: 0, lastRunAt: null, lastResult: null });
    mockSetChakraSyncState.mockResolvedValue(undefined);
    mockFindPhoneNumberByProviderId.mockResolvedValue({ id: 'phone-uuid', phoneNumberId: 'PN-META-1' });
    mockGetFirstPhoneNumber.mockResolvedValue({ id: 'phone-uuid', phoneNumberId: 'PN-META-1' });
    mockUpsertContact.mockResolvedValue({ id: 'contact-uuid', waId: '6281234567890' });
    mockUpsertConversation.mockResolvedValue({ id: 'conv-uuid' });
    mockBackdateConversation.mockResolvedValue(undefined);
    mockHasUnlinkedAssistantTwin.mockResolvedValue(false);
    mockWriteFile.mockResolvedValue(undefined);
    delete cfg['ESCALATION_NOTIFY_WA'];

    // Stands in for the UNIQUE index on wa_message_id + ON CONFLICT DO NOTHING.
    mockInsertMessageIfNew.mockImplementation(async (data: Record<string, unknown>) => {
      if (inserted.some((m) => m['waMessageId'] === data['waMessageId'])) return null;
      inserted.push(data);
      return { id: `m${inserted.length}`, ...data };
    });
  });

  it('maps direction to role, and labels every outbound text it did not already have as a person\'s', async () => {
    const { runChakraSync } = await importSync();
    const result = await runChakraSync();

    expect(result).toMatchObject({ chats: 1, messages: 3, errors: 0, mediaFailed: 0 });

    const byId = Object.fromEntries(inserted.map((m) => [m['waMessageId'], m]));
    expect(byId['wamid.A']).toMatchObject({ role: 'user', body: 'halo' });
    // body.text.body is the fallback when the flat `text` field is absent
    expect(byId['wamid.B']).toMatchObject({ role: 'assistant', body: 'Halo, ada yang bisa dibantu?' });

    // Every text the bot sends is already stored under its wamid, so an outbound text arriving
    // here was typed by a person. Chakra's `user` was meant to say so but is never set in
    // production - wamid.B is the shape a reply from the WhatsApp Business phone actually has.
    expect(byId['wamid.B']!['senderName']).toBe('Tim CS');
    expect(byId['wamid.C']!['senderName']).toBe('Agen ChakraHQ');
    expect(byId['wamid.A']!['senderName']).toBeNull();
  });

  // Live 2026-10-08: staff told Ika "kami tidak menyediakan" from the phone; it was stored as
  // "AI", and the model read it back as its own words.
  describe('who wrote an outbound message', () => {
    const outbound = (over: Record<string, unknown>) => ({
      id: 'o1', externalId: 'wamid.O1', direction: 'OUTBOUND', dataType: 'text',
      text: 'mohon maaf utk barang tersebut kami tidak menyediakan yaa', timestamp: 1_700_000_400_000, ...over,
    });

    // The bot stores every file it sends under its wamid (outboundMedia.ts), so like a text, a file
    // the sync still finds new was sent off the phone. Live: an invoice photo to pak Ferry read "AI".
    it('labels a photo or document sent off the phone as a person\'s', async () => {
      messageFixture = [
        outbound({ id: 'o1', externalId: 'wamid.O1', dataType: 'image', text: null, body: { image: { id: 'MEDIA-1', caption: 'Izin menginfokan tagihan' } } }),
        outbound({ id: 'o2', externalId: 'wamid.O2', dataType: 'document', text: null, body: { document: { id: 'MEDIA-2', filename: 'VIP-12.pdf' } } }),
      ];
      const { runChakraSync } = await importSync();
      await runChakraSync();
      expect(inserted.map((m) => m['senderName'])).toEqual(['Tim CS', 'Tim CS']);
      expect(inserted[0]!['body']).toBe('Izin menginfokan tagihan');
    });

    it('leaves a file sent by link unlabeled and shows it from that link, without a download', async () => {
      cfg['PUBLIC_BASE_URL'] = 'https://bot.example.com';
      messageFixture = [
        outbound({ id: 'o1', externalId: 'wamid.O1', dataType: 'image', text: null, body: { image: { link: 'https://bot.example.com/uploads/products/saturnus.jpg', caption: '' } } }),
        outbound({ id: 'o2', externalId: 'wamid.O2', dataType: 'document', text: null, body: { document: { link: 'https://cdn.chakrahq.com/katalog.pdf', filename: 'KATALOG LEGACY 2026.pdf' } } }),
      ];
      const { runChakraSync } = await importSync();
      await runChakraSync();
      expect(inserted.map((m) => m['senderName'])).toEqual([null, null]);
      const meta = inserted.map((m) => m['metadata'] as Record<string, unknown>);
      expect(meta[0]).toMatchObject({ attachmentType: 'image', mediaUrl: '/uploads/products/saturnus.jpg' });
      expect(meta[1]).toMatchObject({ attachmentType: 'document', mediaUrl: 'https://cdn.chakrahq.com/katalog.pdf' });
      expect(meta[0]).not.toHaveProperty('sentByLink');
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/media/'))).toBe(false);
      delete cfg['PUBLIC_BASE_URL'];
    });

    it('skips a bot file that was stored without its wamid instead of showing it twice', async () => {
      messageFixture = [outbound({ dataType: 'image', text: null, body: { image: { id: 'MEDIA-1' } } })];
      mockHasUnlinkedAssistantTwin.mockResolvedValue(true);
      const { runChakraSync } = await importSync();
      await runChakraSync();
      expect(inserted).toEqual([]);
    });

    it('skips a bot reply that was stored without its wamid instead of showing it twice', async () => {
      messageFixture = [outbound({})];
      mockHasUnlinkedAssistantTwin.mockResolvedValue(true);
      const { runChakraSync } = await importSync();
      await runChakraSync();
      expect(inserted).toEqual([]);
    });

    it('holds back an outbound message too new to tell from a bot reply still being stored', async () => {
      messageFixture = [outbound({ timestamp: Date.now() - 30_000 })];
      const { runChakraSync } = await importSync();
      await runChakraSync();
      expect(inserted).toEqual([]);

      messageFixture = [outbound({ timestamp: Date.now() - 3 * 60_000 })];
      await runChakraSync();
      expect(inserted[0]!['senderName']).toBe('Tim CS');
    });

    it('leaves the bot\'s escalation pings to the staff number unlabeled', async () => {
      cfg['ESCALATION_NOTIFY_WA'] = '+62 812-3456-7890';
      messageFixture = [outbound({ text: 'Pelanggan menunggu balasan' })];
      const { runChakraSync } = await importSync();
      await runChakraSync();
      expect(inserted[0]!['senderName']).toBeNull();
    });

    it('labels only - a phone reply never pauses the AI', async () => {
      messageFixture = [outbound({})];
      const { runChakraSync } = await importSync();
      await runChakraSync();
      expect(inserted[0]!['senderName']).toBe('Tim CS');
      expect(mockMarkHumanTakeover).not.toHaveBeenCalled();
    });
  });

  // Live 2026-10-12: staff wrote from the phone at 13:13, the customer answered at 13:14, and the bot
  // replied without staff's message - the periodic run holds outbound back 2 minutes, then waits a tick.
  describe('syncContactChat - one chat, right before the bot replies', () => {
    beforeEach(() => { vi.resetModules(); }); // the chat-id cache lives in the module
    const staff = (ageMs: number) => ({
      id: 's1', externalId: 'wamid.S1', direction: 'OUTBOUND', dataType: 'text',
      text: 'Klu yg persis kami belum adaa pak', timestamp: Date.now() - ageMs,
    });

    it('imports a staff reply typed seconds before the customer wrote, labelled as staff', async () => {
      messageFixture = [staff(40_000)];
      const { syncContactChat } = await importSync();
      expect(await syncContactChat('6281234567890')).toBe(1);
      expect(inserted[0]).toMatchObject({ role: 'assistant', senderName: 'Tim CS', body: 'Klu yg persis kami belum adaa pak' });
    });

    it('still holds back a text sent in the last 10 s - a send whose row is about to be stored', async () => {
      messageFixture = [staff(3_000)];
      const { syncContactChat } = await importSync();
      expect(await syncContactChat('6281234567890')).toBe(0);
    });

    // Inbound is the webhook's to store: stored here first, a message typed during the turn was read
    // as a duplicate by its own webhook and never answered.
    it('leaves a customer message from the last 2 minutes to its webhook', async () => {
      const customer = (ageMs: number) => ({
        id: 'u1', externalId: 'wamid.U1', direction: 'INBOUND', dataType: 'text', text: 'yang hitam ya kak', timestamp: Date.now() - ageMs,
      });
      messageFixture = [customer(20_000)];
      const { syncContactChat, runChakraSync } = await importSync();
      expect(await syncContactChat('6281234567890')).toBe(0);

      // A message whose webhook never came is still imported, once it is old enough...
      messageFixture = [customer(3 * 60_000)];
      expect(await syncContactChat('6281234567890')).toBe(1);

      // ...and the periodic run holds nothing inbound back.
      inserted = [];
      messageFixture = [customer(20_000)];
      await runChakraSync();
      expect(inserted[0]).toMatchObject({ role: 'user', body: 'yang hitam ya kak' });
    });

    it('finds the chat once per customer, and does nothing for a customer it cannot find', async () => {
      messageFixture = [staff(40_000)];
      const { syncContactChat } = await importSync();
      await syncContactChat('+62 812-3456-7890');
      await syncContactChat('6281234567890');
      expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/v1/ext/chat'))).toHaveLength(1);
      expect(await syncContactChat('628000000000')).toBe(0);
    });

    // review 2026-10-13: importMessage downloads media before the insert dedups, so every reply re-fetched
    // every catalog PDF and product photo in the chat.
    it('never re-downloads the media of a message it already has', async () => {
      const photo = { id: 'p1', externalId: 'wamid.P1', direction: 'OUTBOUND', dataType: 'image', body: { image: { id: 'media-1' } }, timestamp: Date.now() - 60_000 };
      messageFixture = [photo];
      const { syncContactChat } = await importSync();
      await syncContactChat('6281234567890');
      const downloads = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/media/')).length;
      const first = downloads();
      await syncContactChat('6281234567890');
      expect(downloads()).toBe(first);
    });

    it('remembers a customer it could not find, instead of listing chats on every reply', async () => {
      const { syncContactChat } = await importSync();
      await syncContactChat('628000000000');
      await syncContactChat('628000000000');
      expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/v1/ext/chat'))).toHaveLength(1);
    });

    it('does nothing off the Chakra transport', async () => {
      cfg['WHATSAPP_TRANSPORT'] = 'meta';
      try {
        const { syncContactChat } = await importSync();
        expect(await syncContactChat('6281234567890')).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        cfg['WHATSAPP_TRANSPORT'] = 'chakra';
      }
    });
  });

  it('stamps createdAt from Chakra timestamps, not import time', async () => {
    const { runChakraSync } = await importSync();
    await runChakraSync();

    const first = inserted.find((m) => m['waMessageId'] === 'wamid.A');
    expect((first!['createdAt'] as Date).getTime()).toBe(1_700_000_100_000);

    // The conversation's start is pulled back to its oldest message. updated_at is
    // deliberately left alone — writing it would stamp an imported chat with the import
    // time and float months-old history to the top of the inbox.
    expect(mockBackdateConversation).toHaveBeenCalledWith('conv-uuid', new Date(1_700_000_100_000));
  });

  it('strips the "+" and spaces off the Chakra handle so contacts match the webhook', async () => {
    const { runChakraSync } = await importSync();
    await runChakraSync();

    expect(mockUpsertContact).toHaveBeenCalledWith('6281234567890', 'Budi', new Date(1_700_000_000_000));
    // Imported contacts must not pin ai_enabled — they follow the global switch.
    expect(mockUpsertContact.mock.calls[0]).toHaveLength(3);
  });

  it('inserts nothing on a second run over the same history', async () => {
    const { runChakraSync } = await importSync();
    await runChakraSync();
    expect(inserted).toHaveLength(3);

    mockGetChakraSyncState.mockResolvedValue({
      watermarkMs: 1_700_000_300_000,
      lastRunAt: 'x',
      lastResult: null,
    });
    const second = await runChakraSync();

    expect(second.messages).toBe(0);
    expect(inserted).toHaveLength(3);
  });

  it('downloads image attachments and points metadata.mediaUrl at the saved file', async () => {
    messageFixture = [
      {
        id: 'c4',
        externalId: 'wamid.IMG',
        direction: 'INBOUND',
        dataType: 'image',
        body: { image: { id: 'media-99', mime_type: 'image/jpeg', caption: 'ada stok ini?' } },
        timestamp: 1_700_000_400_000,
      },
    ];

    const { runChakraSync } = await importSync();
    const result = await runChakraSync();

    expect(result.mediaFailed).toBe(0);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(inserted[0]).toMatchObject({ body: 'ada stok ini?' });
    expect(inserted[0]!['metadata']).toMatchObject({
      source: 'chakra_sync',
      attachmentType: 'image',
      mediaUrl: '/uploads/inbound/1700000400000_wamid_IMG.jpg',
    });
  });

  it('keeps the message when the media id has expired', async () => {
    mediaOk = false;
    messageFixture = [
      {
        id: 'c5',
        externalId: 'wamid.OLD',
        direction: 'INBOUND',
        dataType: 'image',
        body: { image: { id: 'media-expired', caption: 'foto lama' } },
        timestamp: 1_600_000_000_000,
      },
    ];

    const { runChakraSync } = await importSync();
    const result = await runChakraSync();

    expect(result.mediaFailed).toBe(1);
    expect(result.messages).toBe(1); // the message survives, only the file is missing
    expect(inserted[0]).toMatchObject({ body: 'foto lama' });
    expect(inserted[0]!['metadata']).not.toHaveProperty('mediaUrl');
  });

  it('still syncs when Chakra returns oldest-first instead of newest-first', async () => {
    // The cutoff and "page inserted nothing" shortcuts are only sound on descending pages.
    // If Chakra's undocumented order turns out to be ascending, this is the run that would
    // otherwise stop at the oldest chat and quietly sync nothing at all.
    messageFixture = [...MESSAGES].reverse();
    mockGetChakraSyncState.mockResolvedValue({
      watermarkMs: 1_700_000_300_000,
      lastRunAt: 'x',
      lastResult: null,
    });

    const { runChakraSync } = await importSync();
    const result = await runChakraSync();

    expect(result.messages).toBe(3);
    expect(inserted.map((m) => m['waMessageId']).sort()).toEqual(['wamid.A', 'wamid.B', 'wamid.C']);
  });

  it('on the first run, reaches old history behind a page the webhook already stored', async () => {
    // The exact case the backfill exists for: a chat that predates the webhook. Its newest
    // 500 messages are already in our DB, so a "this page was all known, stop" shortcut would
    // return 0 and silently leave everything older unimported.
    messageFixture = OLD_PAGE_1;
    messageFixturePage2 = OLD_PAGE_2;
    inserted = OLD_PAGE_1.map((m) => ({ waMessageId: m.externalId }));

    const { runChakraSync } = await importSync();
    const result = await runChakraSync(); // watermarkMs = 0 → first run

    expect(result.messages).toBe(1);
    expect(inserted.some((m) => m['waMessageId'] === 'wamid.ANCIENT')).toBe(true);
  });

  it('on a later run, stops at the first page that inserted nothing', async () => {
    messageFixture = OLD_PAGE_1;
    messageFixturePage2 = OLD_PAGE_2;
    inserted = OLD_PAGE_1.map((m) => ({ waMessageId: m.externalId }));
    mockGetChakraSyncState.mockResolvedValue({
      watermarkMs: 1_700_000_300_000,
      lastRunAt: 'x',
      lastResult: null,
    });

    const { runChakraSync } = await importSync();
    const result = await runChakraSync();

    expect(result.messages).toBe(0);
    expect(inserted.some((m) => m['waMessageId'] === 'wamid.ANCIENT')).toBe(false);
  });

  it('never sends a message or calls the AI', async () => {
    const { runChakraSync } = await importSync();
    await runChakraSync();

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockBuildContextAndCallAI).not.toHaveBeenCalled();
  });
});
