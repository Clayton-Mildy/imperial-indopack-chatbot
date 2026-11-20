import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendText = vi.fn(async () => 'wamid-1');
const mockInsertMessage = vi.fn(async () => ({ id: 'msg-1' }));
const mockGetContactProfile = vi.fn(async (): Promise<unknown> => null);
vi.mock('../src/services/whatsappSender.js', () => ({ sendTextMessage: mockSendText }));
const mockGetLastNMessages = vi.fn(async (): Promise<{ role: string; body: string }[]> => []);
vi.mock('../src/repositories/conversations.js', () => ({
  updateConversationStatus: vi.fn(async () => undefined),
  insertMessage: mockInsertMessage,
  getLastNMessages: mockGetLastNMessages,
}));
vi.mock('../src/repositories/phoneNumbers.js', () => ({
  findPhoneNumberById: vi.fn(async () => ({ id: 'pn-1', phoneNumberId: 'wa-1' })),
}));
vi.mock('../src/repositories/contactProfiles.js', () => ({ getContactProfile: mockGetContactProfile }));
const mockGetBotSettings = vi.fn(async () => ({ fallbackMinPcs: 2500 }));
vi.mock('../src/repositories/appSettings.js', () => ({ getBotSettings: mockGetBotSettings }));
const mockNotifyStaff = vi.fn();
vi.mock('../src/services/staffNotify.js', () => ({ notifyStaff: mockNotifyStaff }));

const { detectComplaint, detectCourierMessage, detectNonSalesTopic, detectHumanRequest, detectPpnQuestion, escalateConversation, isNonSalesHandoff, isNonSalesReason, mentionsDesign, mentionsQuantity, pickProfileGapQuestion } = await import('../src/services/escalationHandler.js');
const { mergeOrderFacts } = await import('../src/domain/orderProfile.js');
const { CANNED_COMPLAINT_REPLY, CANNED_ESCALATION_REPLY, ESCALATION_ASK_BUSINESS_NAME, ESCALATION_ASK_DESIGN, ESCALATION_ASK_NAME, ESCALATION_ASK_PRODUCT, ESCALATION_ASK_QUANTITY, ESCALATION_ASK_SIZE, escalationAskQuantity } = await import('../src/domain/constants.js');

const CONVERSATION = { id: 'conv-1', contactId: 'contact-1', phoneNumberId: 'pn-1' } as Parameters<typeof escalateConversation>[0];

function profileWith(facts: Record<string, unknown> = {}) {
  return { id: 'prof-1', contactId: 'contact-1', customerType: null, profile: facts, followUpStatus: 'none', followUpNotes: null, updatedAt: new Date() };
}

describe('detectHumanRequest', () => {
  it('does NOT escalate an agent/distributor inquiry ("jadi agen")', () => {
    // A "become an agent" question must not trip a bare 'agen' keyword.
    expect(
      detectHumanRequest('Halo admin, syarat jadi agen kertas supreme gmn ya, apa masih bisa masuk harganya jika dijual online')
    ).toBe(false);
    expect(detectHumanRequest('cara daftar jadi agen resmi')).toBe(false);
  });

  it('still escalates a genuine "talk to a human" request', () => {
    expect(detectHumanRequest('mau bicara dengan CS dong')).toBe(true);
    expect(detectHumanRequest('sambungkan dengan sales')).toBe(true);
    expect(detectHumanRequest('bisa bicara dengan manusia?')).toBe(true);
    expect(detectHumanRequest('can I talk to agent please')).toBe(true);
    // Escalation trigger #8's own example phrasing must trip the deterministic router too.
    expect(detectHumanRequest('ada admin?')).toBe(true);
  });

  it('reads the connector through a typo', () => {
    expect(detectHumanRequest('bisa bicara dengn admin?')).toBe(true);
    expect(detectHumanRequest('mau ngobrol ama orang aja')).toBe(true);
    expect(detectHumanRequest('bicara dg cs dong')).toBe(true);
  });
});

describe('size questions (client 2026-11-11)', () => {
  it('reads a question about our sizes, not a product name or the customer\'s own size', async () => {
    const { detectSizeQuestion } = await import('../src/services/escalationHandler.js');
    for (const q of ['pilihan ukurannya ada berapa bu ?', 'ukurannya berapa cm?', 'berapa lebar kertasnya', 'panjang berapa kak', 'Ada ukuran apa aja?']) {
      expect(detectSizeQuestion(q), q).toBe(true);
    }
    for (const q of ['box panjang ada?', 'ukurannya 30x30', 'ukuran nasi box saya 20cm, cocok?', 'mohon bantu infokan harganya']) {
      expect(detectSizeQuestion(q), q).toBe(false);
    }
  });

  it('counts a size as answered only when the reply has a measurement', async () => {
    const { unansweredSizeQuestion } = await import('../src/services/escalationHandler.js');
    expect(unansweredSizeQuestion('pilihan ukurannya ada berapa bu ?', 'Harga Rp 185.000/rim, minimal 5 rim')).toBe(true);
    expect(unansweredSizeQuestion('panjangnya berapa?', 'Besar 25 cm, kecil 20 cm')).toBe(false);
    expect(unansweredSizeQuestion('ukurannya berapa?', 'Tebal kertasnya 64 gsm, lebar 30 cm')).toBe(false);
    expect(unansweredSizeQuestion('harganya berapa?', 'Rp 185.000/rim')).toBe(false);
  });

  // Task 13: the catalog writes sizes as p x l (x t), often with no unit - a reply listing them answered.
  it('counts the catalog\'s p x l sizes as a measurement, with or without a unit', async () => {
    const { unansweredSizeQuestion } = await import('../src/services/escalationHandler.js');
    expect(unansweredSizeQuestion('ukuran apa aja?', 'Yang ada 30 x 30 dan 35 x 35 kak')).toBe(false);
    expect(unansweredSizeQuestion('ukuran box nya berapa?', 'Box ivory ukuran 20x20x7,5 kak')).toBe(false);
    expect(unansweredSizeQuestion('ukuran apa aja?', 'Ada 2 pilihan warna cetak kak')).toBe(true);
  });

  // Task 13 review m5: "1 x 500 lembar" is a quantity, not a size.
  it('does not take a quantity written "N x M lembar/rim/pcs" for a size', async () => {
    const { unansweredSizeQuestion } = await import('../src/services/escalationHandler.js');
    for (const reply of ['Isinya 1 x 500 lembar kak', 'Bisa 2 x 5 rim ya kak', 'Paketnya 4 x 250 pcs kak']) {
      expect(unansweredSizeQuestion('ukurannya berapa?', reply), reply).toBe(true);
    }
    expect(unansweredSizeQuestion('ukurannya berapa?', 'Ukurannya 30 x 30 cm, isi 1 x 500 lembar')).toBe(false);
  });
});

describe('detectPpnQuestion', () => {
  it('catches the tax question in the wordings customers actually use', () => {
    expect(detectPpnQuestion('harga itu sudah termasuk ppn belum ya?')).toBe(true);
    expect(detectPpnQuestion('Harganya exclude PPN kan?')).toBe(true);
    expect(detectPpnQuestion('bisa minta faktur pajak?')).toBe(true);
    expect(detectPpnQuestion('does that include VAT?')).toBe(true);
    expect(detectPpnQuestion('is the price inclusive of tax')).toBe(true);
  });

  // Client 2026-10-26: a faktur question is the team's call even without the word "pajak" - retail
  // orders (under 1 karton) need the team to decide whether a faktur can be issued at all.
  it('catches a faktur or NPWP question that never says "pajak"', () => {
    expect(detectPpnQuestion('bisa pakai faktur kak?')).toBe(true);
    expect(detectPpnQuestion('fakturnya bisa atas nama PT?')).toBe(true);
    expect(detectPpnQuestion('bisa e-faktur?')).toBe(true);
    expect(detectPpnQuestion('perlu NPWP saya?')).toBe(true);
  });

  it('does not fire on words that merely contain the keywords', () => {
    // A plain substring 'tax' matches "taxi"; that is why the gate is word-bounded.
    expect(detectPpnQuestion('bisa kirim pakai taxi online?')).toBe(false);
    expect(detectPpnQuestion('mau tanya harga box nasi')).toBe(false);
    expect(detectPpnQuestion('ada kertas ukuran 30x30?')).toBe(false);
  });
});

const P = (facts: Record<string, unknown> = {}) => profileWith(facts);
const ALL_GAP_QUESTIONS = [ESCALATION_ASK_PRODUCT, ESCALATION_ASK_SIZE, ESCALATION_ASK_QUANTITY, ESCALATION_ASK_DESIGN, ESCALATION_ASK_BUSINESS_NAME, ESCALATION_ASK_NAME];

describe('pickProfileGapQuestion', () => {
  it('asks the product first on an empty profile', () => {
    expect(pickProfileGapQuestion(null, [])).toBe(ESCALATION_ASK_PRODUCT);
    expect(pickProfileGapQuestion(P(), [])).toBe(ESCALATION_ASK_PRODUCT);
  });

  it('a business type counts as knowing the product', () => {
    expect(pickProfileGapQuestion(P({ business_type: 'katering' }), [])).toBe(ESCALATION_ASK_SIZE);
  });

  it('asks size once the product is known', () => {
    expect(pickProfileGapQuestion(P({ items: [{ product: 'box' }] }), [])).toBe(ESCALATION_ASK_SIZE);
  });

  // The question states the fallback minimum (Plan 2 Task 4); the setting overrides it.
  it('states the fallback minimum in the quantity question', () => {
    expect(ESCALATION_ASK_QUANTITY).toBe('Sambil menunggu, kira-kira mau pesan berapa banyak kak? (minimal 2.500 pcs / 5 rim)');
  });

  it('asks quantity with the configured minimum', () =>
    expect(pickProfileGapQuestion(P({ items: [{ product: 'box', size: '20x20x7' }] }), [], 1000)).toBe(escalationAskQuantity(1000)));

  it('escalateConversation passes the configured minimum', async () => {
    mockGetBotSettings.mockResolvedValueOnce({ fallbackMinPcs: 1200 });
    mockGetContactProfile.mockResolvedValueOnce(P({ items: [{ product: 'box', size: '20x20x7' }] }));
    mockSendText.mockClear();
    await escalateConversation({ id: 'c1', phoneNumberId: 'pn-1' } as never, 'harga custom', '6281200007001', true);
    expect(mockSendText.mock.calls[0][2]).toContain('minimal 1.200 pcs');
  });

  it('walks size, qty, design, business, name', () => {
    const item = { product: 'box' };
    expect(pickProfileGapQuestion(P({ items: [item] }), [])).toBe(ESCALATION_ASK_SIZE);
    expect(pickProfileGapQuestion(P({ items: [{ ...item, size: '10x10x5' }] }), [])).toBe(ESCALATION_ASK_QUANTITY);
    expect(pickProfileGapQuestion(P({ items: [{ ...item, size: '10x10x5', qty: 2500, qty_unit: 'pcs' }] }), [])).toBe(ESCALATION_ASK_DESIGN);
    const withDesign = { ...item, size: '10x10x5', qty: 2500, qty_unit: 'pcs', has_design: false };
    expect(pickProfileGapQuestion(P({ items: [withDesign] }), [])).toBe(ESCALATION_ASK_BUSINESS_NAME);
    expect(pickProfileGapQuestion(P({ items: [withDesign], business_name: 'RM Siang' }), [])).toBe(ESCALATION_ASK_NAME);
    expect(pickProfileGapQuestion(P({ items: [withDesign], business_name: 'RM Siang', name: 'Budi' }), [])).toBeNull();
  });

  it('an item counts for each field it has, even across items', () => {
    const facts = { items: [{ product: 'box', size: '10x10x5' }, { product: 'cup', qty: 3, qty_unit: 'rim', has_design: true }] };
    expect(pickProfileGapQuestion(P({ ...facts, business_name: 'X' }), [])).toBe(ESCALATION_ASK_NAME);
  });

  it('has_design false is an answer, not a gap', () => {
    const facts = { items: [{ product: 'box', size: '1x1', qty: 1, has_design: false }], business_name: 'X', name: 'Y' };
    expect(pickProfileGapQuestion(P(facts), [])).toBeNull();
  });

  it('a stored item that holds nothing usable counts for nothing', () => {
    expect(pickProfileGapQuestion(P({ items: [{ product: '  ', size: 5 }, 'junk'] }), [])).toBe(ESCALATION_ASK_PRODUCT);
  });

  it('never asks a question already sent in recent', () => {
    expect(pickProfileGapQuestion(null, [bot(`Siap kak ${ESCALATION_ASK_PRODUCT}`)])).toBe(ESCALATION_ASK_SIZE);
    expect(pickProfileGapQuestion(null, ALL_GAP_QUESTIONS.map((q) => bot(q)))).toBeNull();
  });

  it('stays quiet after a non-sales handoff', () => {
    expect(pickProfileGapQuestion(null, [customer('masih ada lowongan driver?')])).toBeNull();
    expect(pickProfileGapQuestion(null, [customer('box nasi yang saya terima rusak semua')])).toBeNull();
  });

  it('never asks the buyer type', () => {
    expect(JSON.stringify(ALL_GAP_QUESTIONS)).not.toMatch(/dijual lagi|dipakai sendiri|proyek/);
  });
});

describe('escalateConversation', () => {
  beforeEach(() => {
    mockSendText.mockClear();
    mockInsertMessage.mockClear();
    mockNotifyStaff.mockClear();
    mockGetContactProfile.mockReset();
    mockGetContactProfile.mockResolvedValue(null);
    mockGetLastNMessages.mockClear();
  });

  // The reply used to be whatever the failing turn wrote. Asked to explain why it could not
  // help, the model narrated the catalog it had just read ("katalog kami khusus untuk box
  // makanan kering") - internal vocabulary sent to a customer. The customer now always gets fixed
  // template text; the technical reason goes to the team.
  it('sends only fixed template text, never the model prose that caused the escalation', async () => {
    await escalateConversation(
      CONVERSATION,
      'Kegunaan produk menyebut makanan kering, foto menunjukkan kue basah - perlu dicek tim.',
      '628123'
    );

    expect(mockSendText).toHaveBeenCalledTimes(1);
    const sent = mockSendText.mock.calls[0][2] as unknown as string;
    expect(sent).toBe(`${CANNED_ESCALATION_REPLY} ${ESCALATION_ASK_PRODUCT}`);
    expect(sent.toLowerCase()).not.toContain('katalog');
    expect(sent.toLowerCase()).not.toContain('kering');
    // Tone rule: maksimal satu emoji per balasan — templates must not stack a second one.
    expect((sent.match(/\p{Extended_Pictographic}/gu) ?? []).length).toBeLessThanOrEqual(1);
  });

  // "Kita coba cek ... kira-kira mau pesan berapa banyak?" must not follow "10 buah".
  it('does not ask for a quantity the customer typed in the message that escalated', async () => {
    mockGetContactProfile.mockResolvedValue(P({ items: [{ product: 'box', size: '10x10' }] }));
    mockGetLastNMessages.mockResolvedValueOnce([
      { role: 'user', body: 'halo, saya Budi' },
      { role: 'assistant', body: 'Salam kenal, Pak Budi 😊 Lagi cari apa nih?' },
      { role: 'user', body: 'mau box 10 buah' },
    ]);
    await escalateConversation(CONVERSATION, 'reason', '628123');
    expect(mockSendText.mock.calls[0][2]).toBe(`${CANNED_ESCALATION_REPLY} ${ESCALATION_ASK_DESIGN}`);
  });

  it('skips the sales question when the customer explicitly asked for a human', async () => {
    await escalateConversation(CONVERSATION, 'customer asked for a human', '628123', false);
    expect(mockSendText.mock.calls[0][2]).toBe(CANNED_ESCALATION_REPLY);
    expect(mockGetLastNMessages).not.toHaveBeenCalled();
  });

  // SOP: escalation hands off, it does not end the conversation - while the team checks,
  // ask for the first order detail we still lack.
  it('appends the quantity question when product and size are already known', async () => {
    mockGetContactProfile.mockResolvedValue(P({ items: [{ product: 'box', size: '10x10x5' }] }));
    await escalateConversation(CONVERSATION, 'reason', '628123');
    expect(mockSendText.mock.calls[0][2]).toBe(`${CANNED_ESCALATION_REPLY} ${ESCALATION_ASK_QUANTITY}`);
  });

  it('sends the bare hand-off line when all six details are known', async () => {
    mockGetContactProfile.mockResolvedValue(P({ name: 'Budi', business_name: 'RM Siang', items: [{ product: 'box', size: '1x1', qty: 5, has_design: true }] }));
    await escalateConversation(CONVERSATION, 'reason', '628123');
    expect(mockSendText.mock.calls[0][2]).toBe(CANNED_ESCALATION_REPLY);
  });

  it('persists the sent reply as an assistant message so the next AI turn has the context', async () => {
    await escalateConversation(CONVERSATION, 'reason', '628123');
    expect(mockInsertMessage).toHaveBeenCalledTimes(1);
    expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1',
      role: 'assistant',
      body: `${CANNED_ESCALATION_REPLY} ${ESCALATION_ASK_PRODUCT}`,
      waMessageId: 'wamid-1',
      status: 'sent',
    }));
  });

  it('a profile lookup failure degrades to the product question, not a crash', async () => {
    mockGetContactProfile.mockRejectedValue(new Error('db down'));
    await escalateConversation(CONVERSATION, 'reason', '628123');
    expect(mockSendText.mock.calls[0][2]).toBe(`${CANNED_ESCALATION_REPLY} ${ESCALATION_ASK_PRODUCT}`);
  });

  it('a caller-supplied phone number skips the DB lookup and is used for the send', async () => {
    const { findPhoneNumberById } = await import('../src/repositories/phoneNumbers.js');
    vi.mocked(findPhoneNumberById).mockClear(); // earlier tests in this file used the lookup path
    const known = { id: 'pn-known', phoneNumberId: 'wa-known' } as never;

    await escalateConversation(CONVERSATION, 'reason', '628123', true, known);

    expect(vi.mocked(findPhoneNumberById)).not.toHaveBeenCalled();
    expect(mockSendText.mock.calls[0][0]).toBe('wa-known');
  });
});

// The third argument of escalateConversation is the CUSTOMER's WhatsApp id: for as long as this
// function has existed, "escalation" messaged the person who was already waiting and nobody
// else. The only staff-facing surface was an escalations queue polled by an open browser tab,
// so a hand-off raised at night reached a human whenever someone next opened the dashboard.
describe('escalateConversation staff notification', () => {
  beforeEach(() => {
    mockSendText.mockClear();
    mockNotifyStaff.mockClear();
    mockGetContactProfile.mockReset();
    mockGetContactProfile.mockResolvedValue(null);
  });

  it('notifies a human, carrying the reason the customer never sees', async () => {
    await escalateConversation(CONVERSATION, 'Permintaan diskon di luar tiga tingkat', '628123');

    expect(mockNotifyStaff).toHaveBeenCalledTimes(1);
    const n = mockNotifyStaff.mock.calls[0][0] as { title: string; body: string; path: string };
    expect(n.body).toBe('Permintaan diskon di luar tiga tingkat');
    // Deep link, so the notification is one tap from the conversation rather than a hunt.
    expect(n.path).toBe('/conversations/conv-1');
  });

  it('the staff notification includes the order summary', async () => {
    mockGetContactProfile.mockResolvedValue(P({ name: 'Budi', business_name: 'RM Siang', items: [{ product: 'Kertas Supreme', gsm: '64', size: '30x30', qty: 5, qty_unit: 'rim', has_design: false }] }));
    await escalateConversation(CONVERSATION, 'Minta harga khusus', '628123');
    const n = mockNotifyStaff.mock.calls[0][0] as { body: string };
    expect(n.body).toContain('Minta harga khusus');
    expect(n.body).toContain('Nama: Budi');
    expect(n.body).toContain('Usaha: RM Siang');
    expect(n.body).toContain('Barang: ');
  });

  it('the summary is sent even when no gap question is asked', async () => {
    mockGetContactProfile.mockResolvedValue(P({ name: 'Budi' }));
    await escalateConversation(CONVERSATION, 'customer asked for a human', '628123', false);
    expect((mockNotifyStaff.mock.calls[0][0] as { body: string }).body).toContain('Nama: Budi');
  });

  it('notifies even when the customer-facing send fails', async () => {
    // A hand-off the customer never received is MORE urgent for the team, not less - so the
    // ping must not sit behind the send it would be reporting the failure of.
    mockSendText.mockRejectedValueOnce(new Error('WhatsApp 500'));
    await escalateConversation(CONVERSATION, 'reason', '628123');
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1);
  });

  it('still notifies when the customer asked for a human (no sales question)', async () => {
    await escalateConversation(CONVERSATION, 'customer asked for a human', '628123', false);
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1);
  });
});

const bot = (body: string) => ({ role: 'assistant', body });
const customer = (body: string) => ({ role: 'user', body });

describe('pickProfileGapQuestion — each question at most once', () => {
  it('moves on to the next rung once a question was asked, answered or not', () => {
    const asked = [bot(`Kita coba cek dengan tim dulu ya kak 🙏 ${ESCALATION_ASK_PRODUCT}`)];
    expect(pickProfileGapQuestion(null, asked)).toBe(ESCALATION_ASK_SIZE);
    expect(pickProfileGapQuestion(null, [...asked, bot(`Siap kak ${ESCALATION_ASK_SIZE}`)])).toBe(ESCALATION_ASK_QUANTITY);
  });

  it('does not count the customer quoting a question as the bot having asked it', () => {
    expect(pickProfileGapQuestion(null, [customer(ESCALATION_ASK_PRODUCT)])).toBe(ESCALATION_ASK_PRODUCT);
  });

  // The model asks the name in its own words ("Sebelumnya, dengan siapa saya terhubung?"); the hand-off
  // must not ask it a second time in the template's words.
  it('counts the model\'s own name question, in any wording, as the name asked', () => {
    const full = { items: [{ product: 'box', size: '1x1', qty: 1, has_design: true }], business_name: 'RM Siang' };
    expect(pickProfileGapQuestion(P(full), [customer('halo')])).toBe(ESCALATION_ASK_NAME);
    for (const asked of ['Halo kak 😊 Sebelumnya, dengan siapa saya terhubung?', 'Boleh tahu nama kakak siapa?', 'Siapa nama kakak?']) {
      expect(pickProfileGapQuestion(P(full), [bot(asked), customer('berapa harganya?')]), asked).toBeNull();
    }
  });

  // Review fix (Task 10 m1): the business-name question is not the name question.
  it('does not count a business-name question as the name asked', () => {
    const full = { items: [{ product: 'box', size: '1x1', qty: 1, has_design: true }], business_name: 'RM Siang' };
    for (const asked of [ESCALATION_ASK_BUSINESS_NAME, 'Boleh tahu nama usahanya kak?', 'Boleh tahu nama tokonya kak?']) {
      expect(pickProfileGapQuestion(P(full), [bot(asked), customer('RM Siang')]), asked).toBe(ESCALATION_ASK_NAME);
    }
  });

  it('still asks another detail after the model asked only the name', () => {
    const asked = [bot('Sebelumnya, dengan siapa saya terhubung?'), customer('mau tanya harga')];
    expect(pickProfileGapQuestion(null, asked)).toBe(ESCALATION_ASK_PRODUCT);
  });

  it('counts any spelling of a quantity key the model writes', () => {
    expect(pickProfileGapQuestion(P({ items: [{ product: 'box', size: '1x1' }], estimated_quantity: 10 }))).toBe(ESCALATION_ASK_DESIGN);
    expect(pickProfileGapQuestion(P({ items: [{ product: 'box', size: '1x1' }], jumlah_unit: '3 set' }))).toBe(ESCALATION_ASK_DESIGN);
  });
});

// When the profile never stored what the customer typed, the hand-off must still not ask for the
// business name right after "RM Padang Sederhana", or "berapa banyak?" right after "10 rim",
// "3 karton" or "box nasi 2500 pcs".
describe('pickProfileGapQuestion — facts the customer already typed', () => {
  it.each([
    'saya mau ambil 10 rim kertas supreme 30x30, harganya?',
    'saya mau ambil 3 karton box nasi 20x20',
    'mau box nasi 2500 pcs cetak logo',
    'kertas bungkusnya 500 lembar dulu',
    'pesan 2 pack paper bag',
    '20',
    '1 aja, jadi harganya brp ya?',
    '100 kak',
  ])('reads a quantity in: %s', (m) => expect(mentionsQuantity(m)).toBe(true));

  it.each([
    'kertas supreme 64 gsm 30x30 ready?',
    'box ivory 20x20x7,5 berapa?',
    'tebalnya 270 gsm, cetak 2 warna',
    'box kue kode 587 itu bahannya apa?',
    'budget 150rb aja',
    '081234567890',
  ])('does not read a size, a price, a model number or a phone as a quantity: %s', (m) => expect(mentionsQuantity(m)).toBe(false));

  // A number with no unit, read from its context.
  it.each([
    'kebutuhan kurang lebih 300 an per ukuran',
    'butuh 300an',
    'sekitar 300 per ukuran',
    'kebutuhannya kurang lebih 50',
    'total 120 kak',
  ])('reads a quantity with no unit in: %s', (m) => expect(mentionsQuantity(m)).toBe(true));

  // "koli"/"colly" counts cartons: a hand-off must not ask "berapa banyak?" after "10 koli".
  it.each([
    'untuk awal biasa campur 10 koli box kue dan box nasi',
    'ambil 3 colly dulu kak',
    '5 coli aja',
  ])('reads koli/colly as a quantity: %s', (m) => expect(mentionsQuantity(m)).toBe(true));

  it('does not ask the quantity after "campur 10 koli"', () => {
    const recent = [
      customer('untuk awal biasa campur 10 koli box kue dan box nasi'),
      bot('Kita coba cek dengan tim dulu ya kak 🙏'),
    ];
    expect(pickProfileGapQuestion(P({ items: [{ product: 'box', size: '1x1' }] }), recent)).toBe(ESCALATION_ASK_DESIGN);
  });

  it.each([
    'saya Andi kak, mau tanya harga box\nberikut list nya :\nBox kue uk 20\nKertas nasi uk 30',
    'dikirim aja kak untuk list harga sesuai ukuran box yang saya butuhkan',
    'butuh sekitar 30cm',
    'butuh 3" aja',
    'budget sekitar 150rb',
    'butuh 2,5 inch',
    // Task 13 review m7: never across a line break - in a list the number before a product is a size.
    'uk 20\nBox kue',
    'Box kue uk 20\nbox nasi uk 18',
  ])('still does not read a size, a price or a sentence with no number as a quantity: %s', (m) => expect(mentionsQuantity(m)).toBe(false));

  // A quantity typed with no unit and never saved by the turn that read it.
  it('does not ask the quantity after "kebutuhan kurang lebih 300 an per ukuran"', () => {
    const recent = [
      customer('selamat sore'),
      bot('Selamat sore kak! 😊 Saya Admin dari Imperial Indopack & Kertas Supreme. Ada yang bisa saya bantu?'),
      customer('saya Andi kak, mau tanya harga box\nberikut list nya :\nBox kue uk 20\nKertas nasi uk 30'),
      bot('Salam kenal, Kak Andi! 😊 Boxnya untuk kue apa saja ya kak?'),
      customer('kue kering'),
      customer('kebutuhan kurang lebih 300 an per ukuran'),
      customer('dikirim aja kak untuk list harga sesuai ukuran box yang saya butuhkan'),
    ];
    expect(pickProfileGapQuestion(P({ items: [{ product: 'box', size: '1x1' }] }), recent)).toBe(ESCALATION_ASK_DESIGN);
  });

  it('skips the quantity question when the customer already gave one', () => {
    expect(pickProfileGapQuestion(P({ items: [{ product: 'box', size: '1x1' }] }), [customer('mau box 10 buah')])).toBe(ESCALATION_ASK_DESIGN);
  });

  it('counts a business name the customer gave in answer to the question for it', () => {
    const recent = [
      bot('Halo Pak Budi! Sebelum saya kasih harga, boleh saya tahu dulu: - Nama toko atau usaha Pak Budi? - Lokasi usahanya di mana?'),
      customer('RM Padang Sederhana, Sidoarjo'),
      bot('Baik Pak Budi, ini harganya ...'),
      customer('saya mau ambil 10 rim kertas supreme 30x30'),
      customer('bisa diskon 25% ga kalau ambil banyak?'),
    ];
    const full = { items: [{ product: 'box', size: '1x1', qty: 1, has_design: true }] };
    expect(pickProfileGapQuestion(P(full), recent)).toBe(ESCALATION_ASK_NAME);
  });

  it('asks nothing on a later hand-off in a complaint thread', () => {
    const recent = [
      customer('box yang saya pesan bulan lalu banyak yang rusak, gimana ini?'),
      bot('Waduh, mohon maaf ya kak atas kendalanya 🙏 Kita cek dengan tim dulu ya.'),
      customer('box nasi 20x20'),
    ];
    expect(pickProfileGapQuestion(null, recent)).toBeNull();
  });

  it('does not take "punya toko kue di Surabaya" for a business name', () => {
    const recent = [customer('halo saya Dewi, punya toko kue di Surabaya, mau pesan box')];
    const full = { items: [{ product: 'box', size: '1x1', qty: 1, has_design: true }] };
    expect(pickProfileGapQuestion(P(full), recent)).toBe(ESCALATION_ASK_BUSINESS_NAME);
  });
});

describe('isNonSalesHandoff', () => {
  it.each([
    'permisi apa masih ada lowongan driver pengiriman?',
    'saya mau kirim lamaran kerja',
    'box yang saya pesan bulan lalu banyak yang rusak, gimana ini?',
  ])('no sales question after: %s', (m) => expect(isNonSalesHandoff(m)).toBe(true));

  it.each([
    'harganya sudah termasuk ppn belum?', // a hand-off mid-sale keeps its question
    'mau cari box buat loker kantor', // loker = locker
    'saya cari supplier kertas nasi buat warung saya', // a buyer
    'bisa diskon 25% ga kalau ambil banyak?',
  ])('still a sale: %s', (m) => expect(isNonSalesHandoff(m)).toBe(false));
});

// This number is also the marketplace sender number (owner, 2026-10-13): couriers go to the team.
describe('detectCourierMessage', () => {
  it.each([
    'grab',
    'grab\nselamat malem kak\ndari grab mau ambil barang',
    'grab\nmau ambil pesanan',
    'saya driver gojek',
    'kurir shopee mau pickup',
    'jne ada paket',
    'pick up paket a.n. Budi',
    'ini paket untuk gudang, penerimanya siapa ya?',
    'Paket untuk gudang Jatinegara, penerimanya siapa kak?',
    'Paket untuk gudang Jatinegara',
  ])('courier: %s', (m) => expect(detectCourierMessage(m)).toBe(true));
  it.each([
    'saya ambil 10 ya kak',
    'mau order box nasi',
    'bisa kirim pakai jne?',
    'ongkir pakai jnt berapa',
    'grab bisa kirim ke Bekasi kak?',
    'grabfood bisa pakai paper bag ini?',
    'saya mau ambil barangnya besok di toko bisa?',
    'kirim paket ke gudang kami di Bekasi bisa kak?',
    'ada paket untuk toko baru buka?', 'paket buat kantor ada kak?', 'paket untuk toko kue berapa?', 'mau paket untuk toko saya',
  ])('a buyer: %s', (m) => expect(detectCourierMessage(m)).toBe(false));
});

// Client, 2026-10-13: chats not about buying go straight to the team. Probed first: left to the model,
// these got invented HR channels, an unforwarded payment, and a sales question on the hand-off.
describe('detectNonSalesTopic', () => {
  it.each([
    ['kak masih buka loker gudang?', 'Lowongan kerja'], ['mau tanya kak, kalau mau kirim CV kemana ya?', 'Lowongan kerja'],
    ['saya cari kerja kak, ada posisi kosong?', 'Lowongan kerja'], ['info lowker dong kak', 'Lowongan kerja'],
    ['kak saya sudah transfer, tolong dicek ya', 'Pembayaran / status pesanan'], ['pesanan saya belum sampai kak', 'Pembayaran / status pesanan'],
    ['saya beli di shopee kemarin, kapan dikirim?', 'Pembayaran / status pesanan'], ['minta nomor resi kak', 'Pembayaran / status pesanan'],
    ['kami dari PT ABC supplier plastik, ingin tawarkan kerja sama', 'Penawaran kerja sama / supplier'],
    ['grab\nmau ambil pesanan', 'Kurir / pengambilan pesanan'],
  ])('%s -> %s', (m, topic) => expect(detectNonSalesTopic(m)).toBe(topic));
  it.each([
    'box buat loker ada?', 'box untuk loker gudang ada?', 'saya dari CV Maju Jaya mau order box', 'cari supplier kertas nasi untuk warung saya',
    'mau jadi agen, bisa kerja sama?', 'bisa beli di shopee ga kak?', 'kalau order hari ini kapan dikirim?',
    'bisa transfer ke rekening mana kak?', 'saya kerja di katering, butuh box nasi', 'karyawan saya mau ambil barang besok di toko',
    // code review 2026-10-13
    'saya lihat dari shopee kak, box ini ada?', 'shopee nya apa kak?', 'grab bisa kirim ke Bekasi kak?', 'jne bisa kak kirimnya?',
    'ada paket untuk toko baru buka?', 'paket buat kantor ada kak?', 'paket untuk toko kue berapa?',
    'saya cari kerja sama untuk jadi agen', 'di shopee kemarin harganya lebih murah kak',
  ])('a buyer: %s', (m) => expect(detectNonSalesTopic(m)).toBeNull());
});

// A plastics factory offering us packaging over several messages: each alone says little, and the
// hand-off must not ask "kira-kira mau pesan berapa banyak?".
describe('detectNonSalesTopic - a supplier across messages', () => {
  const SUPPLIER = 'Penawaran kerja sama / supplier';
  const intro = 'Pagi kak\nSalam kenal saya Sari\nDari PT. Contoh Plastik Sejahtera';
  const factory = 'Siap Salam kenal Kak Admin\nKami dari pabrik plastik kantongan, shrink, stretch film';

  it('reads the chat as a supplier once it says what it wants', () => {
    expect(detectNonSalesTopic(intro)).toBeNull(); // a greeting - the bot asks what she needs
    expect(detectNonSalesTopic(factory, intro)).toBeNull(); // what it makes, no offer yet
    expect(detectNonSalesTopic('Kami ingin coba menjajaki kebutuhan plastik untuk produk di Imperial Indopack', `${intro}\n${factory}`)).toBe(SUPPLIER);
    expect(detectNonSalesTopic('Kami ingin tahu kebutuhan plastik untuk gudang di PT Imperial Indopack', `${intro}\n${factory}`)).toBe(SUPPLIER);
    expect(detectNonSalesTopic('Terkait dengan kebutuhan plastik kami bisa menghubungi kemana ya kak? 😊🙏', `${intro}\n${factory}`)).toBe(SUPPLIER);
  });

  // Task 13 carry: the supplier patterns name Imperial Indopack and Kertas Supreme.
  it.each([
    'kami ingin menjajaki kebutuhan plastik di perusahaan bapak',
    'ingin menawarkan produk kami kak, tinta dan lem', // "mau menawarkan" now reaches the bot (fix round 2)
    'boleh tahu kontak bagian purchasing?', // "minta" is a buy verb (fix round 2)
    'bisa hubungi tim pengadaan kemana ya?',
    'kami ingin jadi supplier imperial indopack',
    'kami supplier untuk PT Imperial Indopack sejak 2020',
    'kami bisa jadi pemasok bagi Kertas Supreme',
    'pabrik kami vendor ke kertas supreme sejak lama',
    // Task 13 review: explicit offers to sell or supply TO us.
    'Kami supplier kertas kraft roll, boleh kirim penawaran ke bagian pembelian?',
    'Perkenalkan kami vendor tinta sablon, ingin menawarkan kerja sama',
    'Kami dari CV Maju, bisa supply plastik ke Imperial Indopack',
    'Kami ingin menawarkan kerja sama untuk pengiriman barang',
    'kami siap jadi supplier kalian untuk lem dan tinta',
    'izin kirim company profile kami ya kak',
  ])('an offer on its own: %s', (m) => expect(detectNonSalesTopic(m)).toBe(SUPPLIER));

  // Task 13 review: Imperial's core buyers are factories, caterers and resellers who introduce
  // themselves with a PT/CV and a trade - buy intent always wins, and "tawarkan box" asks US to offer.
  const bakery = 'Kami produsen roti dari PT Sari Roti Lezat';
  it.each([
    ['Kami dari PT Sari Roti Lezat, produsen roti, butuh box 5000 pcs', ''],
    ['Kami dari CV Berkah Catering, supplier nasi kotak, butuh box nasi 20x20', ''],
    ['bisa tawarkan box ukuran lain?', bakery],
    ['tawarin dong box yang murah', bakery],
    ['kebutuhan box kami bisa hubungi siapa?', bakery],
    ['kami supplier untuk Imperial Kitchen, butuh box dimsum', ''],
    ['kami supplier untuk Imperial Kitchen sejak 2019', ''], // m1: a bare "imperial" is not us
    ['boleh kirim penawaran harga box 2000 pcs?', bakery],
    ['Kami dari PT Sinar Kue, mau pesan kertas bungkus cetak logo', ''],
    // Accepted cost of fix round 2: "mau menawarkan" carries a buy verb, so it goes to the bot.
    ['Kami mau menawarkan kerja sama untuk pengiriman barang', ''],
    // Fix round 2: no comma between the introduction and the need.
    ['Kami pabrik roti butuh box 5000 pcs, boleh kirim penawaran?', ''],
    ['Kami produsen roti butuh box kue, bisa supply ke kami?', ''],
    ['Kami pabrik roti butuh box 5000 pcs, bisa hubungi bagian pembelian?', ''],
    ['Kami supplier nasi kotak butuh box nasi, ingin menawarkan kerja sama', ''],
    ['kami vendor catering mau pesan box, boleh kirim penawaran', ''],
  ])('a buyer with a supplier-sounding introduction: %s', (m, earlier) => expect(detectNonSalesTopic(m, earlier)).toBeNull());

  it.each([
    ['kami dari pabrik roti, butuh box kue untuk produk kami', ''],
    ['kami dari pabrik keripik, minta penawaran harga box 2000 pcs', ''],
    ['bisa menawarkan harga grosir kak?', 'kami pabrik kue'],
    ['ada box nasi yang ready?', 'kami dari pabrik plastik kantongan'], // a factory buying from us
    ['kebutuhan box kami bisa menghubungi kemana?', ''], // no supplier introduction anywhere
    ['saya cari supplier kertas nasi, bisa menawarkan harga agen?', ''],
    ['ini supplier kertas supreme ya kak?', ''], // a buyer naming the brand
    ['kebutuhan kertas untuk kertas supreme 30x30 berapa rim minimal?', ''], // no supplier introduction
    ['saya mau tawarkan ke pelanggan saya dulu ya kak', 'halo saya Budi'],
  ])('a buyer: %s', (m, earlier) => expect(detectNonSalesTopic(m, earlier)).toBeNull());

  it('reads only the supplier introduction from earlier messages, never the other topics', () => {
    expect(detectNonSalesTopic('ada box 20x20?', 'kak saya sudah transfer, tolong dicek ya')).toBeNull();
  });
});

describe('isNonSalesReason - the model\'s own hand-off reason', () => {
  it.each([
    'Penawaran menjadi supplier/kerja sama produk plastik - bukan pembelian kemasan.',
    'BUKAN PEMBELI: pabrik plastik menawarkan kemasan',
    'Penawaran kerja sama / supplier - bukan pertanyaan produk',
    'Pabrik menawarkan produk kemasan ke Imperial Indopack',
    'Customer menanyakan lowongan kerja driver',
  ])('not a buyer: %s', (r) => expect(isNonSalesReason(r)).toBe(true));
  it.each([
    'Customer mencari supplier kertas nasi untuk warungnya',
    'Minta harga proyek 200 unit',
    'Customer menanyakan PPN',
    null,
  ])('a buyer: %s', (r) => expect(isNonSalesReason(r)).toBe(false));
});

describe('detectComplaint', () => {
  it.each([
    'box yang saya pesan bulan lalu banyak yang rusak, gimana ini?',
    'baru dipakai sudah patah tutup boxnya',
    // Task 13 review m6: packaging complaints.
    'box nya penyok',
    'kertasnya sobek semua kak',
    'boxnya robek di sudut',
    'tintanya luntur kena minyak',
    'kemasannya bocor',
    'boxnya berjamur pas sampai',
    'salah cetak kak, logonya kebalik',
    'cetakannya pudar',
    'lemnya lepas semua',
    'boxnya lepas lem',
    'cetakannya cacat kak, logonya geser',
    'saya kecewa, mau retur',
  ])('reads after-sales trouble: %s', (m) => expect(detectComplaint(m)).toBe(true));

  it.each([
    'yang tahan minyak ada kak?',        // a sales question about a product property
    'garansinya berapa lama?',           // pre-sale question
    'ada box 20x20?',
  ])('leaves a sales question alone: %s', (m) => expect(detectComplaint(m)).toBe(false));
});

describe('escalateConversation — complaint wording', () => {
  beforeEach(() => {
    mockSendText.mockClear();
    mockGetContactProfile.mockReset();
    mockGetContactProfile.mockResolvedValue(null);
  });

  it('sends the apology lead alone when told not to ask', async () => {
    await escalateConversation(CONVERSATION, 'Komplain box rusak', '628123', false, null, CANNED_COMPLAINT_REPLY);
    expect(mockSendText.mock.calls[0][2]).toBe(CANNED_COMPLAINT_REPLY);
    expect((CANNED_COMPLAINT_REPLY.match(/\p{Extended_Pictographic}/gu) ?? []).length).toBe(1);
  });
});

// Final review C1: a design the customer already mentioned is not asked about again - from the
// order-level fact, a design-only item, or the customer's own words.
describe('the design rung', () => {
  const ITEM = { product: 'kertas nasi', size: '30x30', qty: 10, qty_unit: 'rim' };

  it('reads an order-level has_design', () => {
    expect(pickProfileGapQuestion(P({ items: [ITEM], has_design: true }), [])).toBe(ESCALATION_ASK_BUSINESS_NAME);
    expect(pickProfileGapQuestion(P({ items: [ITEM], has_design: false }), [])).toBe(ESCALATION_ASK_BUSINESS_NAME);
  });

  it('reads a design-only item the model sent on its own', () => {
    const facts = mergeOrderFacts(mergeOrderFacts({}, { items: [{ has_design: true }] }), { items: [ITEM] });
    expect(pickProfileGapQuestion(P(facts), [])).toBe(ESCALATION_ASK_BUSINESS_NAME);
  });

  it('does not ask after "logo saya sudah ada kak"', () =>
    expect(pickProfileGapQuestion(P({ items: [ITEM] }), [customer('logo saya sudah ada kak')])).toBe(ESCALATION_ASK_BUSINESS_NAME));

  it('does not ask after the photo caption "ini logonya, mau cetak kertas nasi 30x30 10 rim"', () =>
    expect(pickProfileGapQuestion(P({ items: [ITEM] }), [customer('ini logonya, mau cetak kertas nasi 30x30 10 rim')])).toBe(ESCALATION_ASK_BUSINESS_NAME));

  it('still asks when nothing says so', () =>
    expect(pickProfileGapQuestion(P({ items: [ITEM] }), [customer('mau cetak kertas nasi 30x30 10 rim')])).toBe(ESCALATION_ASK_DESIGN));

  it.each([
    'logo saya sudah ada kak',
    'ini logonya',
    'desainnya sudah ada',
    'sudah punya desain sendiri',
    'udah ada logo kak',
    'belum ada logo kak',
    'belum punya desain',
    'logonya belum ada',
    'pakai logo saya ya',
  ])('reads a design answer in: %s', (m) => expect(mentionsDesign(m)).toBe(true));

  it.each([
    'mau cetak kertas nasi 30x30 10 rim',
    'bisa dibantu desainnya?',
    'box nasi 20x20 berapa?',
    'logonya dicetak berapa warna?',
  ])('does not read a design answer in: %s', (m) => expect(mentionsDesign(m)).toBe(false));
});

// QA 2026-11-19 A7: the question alone, right after the PO form, is answered with the form.
describe('asksHowToOrder', () => {
  it.each(['ini ordernya gmn brrti ya?', 'ini ordernya gimana ya?', 'caranya order gimana kak', 'terus gimana kak?', 'Pemesanannya bagaimana ya kak'])(
    'is the question alone: %s', async (msg) => {
      const { asksHowToOrder } = await import('../src/services/escalationHandler.js');
      expect(asksHowToOrder(msg)).toBe(true);
    });
  it.each(['ordernya gimana, mau tambah 500 pcs', 'pesanan saya belum sampai gimana ya', 'halo kak', 'harga box 20x20 gimana kak'])(
    'is not: %s', async (msg) => {
      const { asksHowToOrder } = await import('../src/services/escalationHandler.js');
      expect(asksHowToOrder(msg)).toBe(false);
    });
});
