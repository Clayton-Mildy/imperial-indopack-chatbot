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
const mockNotifyStaff = vi.fn();
vi.mock('../src/services/staffNotify.js', () => ({ notifyStaff: mockNotifyStaff }));

const { detectComplaint, detectCourierMessage, detectNonSalesTopic, detectHumanRequest, detectPpnQuestion, escalateConversation, isNonSalesHandoff, isNonSalesReason, mentionsQuantity, pickProfileGapQuestion } = await import('../src/services/escalationHandler.js');
const { ASK_BUYER_TYPE_REPLY, CANNED_COMPLAINT_REPLY, CANNED_ESCALATION_REPLY, ESCALATION_ASK_CUSTOMER_TYPE, ESCALATION_ASK_QUANTITY, ESCALATION_ASK_STORE_NAME } = await import('../src/domain/constants.js');

const CONVERSATION = { id: 'conv-1', contactId: 'contact-1', phoneNumberId: 'pn-1' } as Parameters<typeof escalateConversation>[0];

function profileWith(customerType: 'reseller' | 'end_user' | 'project' | null, facts: Record<string, unknown> = {}) {
  return { id: 'prof-1', contactId: 'contact-1', customerType, profile: facts, followUpStatus: 'none', followUpNotes: null, updatedAt: new Date() };
}

describe('detectHumanRequest', () => {
  it('does NOT escalate a reseller/distributor inquiry ("jadi agen")', () => {
    // The incident: a "become a reseller" question false-triggered the bare 'agen ' keyword.
    expect(
      detectHumanRequest('Halo legacy, syarat jadi agen gmn ya, apa masih bisa masuk harganya jika dijual online')
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

  it('reads the connector through a typo (UAT Run 3 E-01)', () => {
    expect(detectHumanRequest('bisa bicara dengn admin?')).toBe(true);
    expect(detectHumanRequest('mau ngobrol ama orang aja')).toBe(true);
    expect(detectHumanRequest('bicara dg cs dong')).toBe(true);
  });
});

describe('size questions (client 2026-11-11)', () => {
  it('reads a question about our sizes, not a product name or the customer\'s own size', async () => {
    const { detectSizeQuestion } = await import('../src/services/escalationHandler.js');
    for (const q of ['pilihan panjangnya ada berapa bu ?', 'ukurannya berapa cm?', 'berapa panjang handlenya', 'panjang berapa kak', 'Ada ukuran apa aja?']) {
      expect(detectSizeQuestion(q), q).toBe(true);
    }
    for (const q of ['gembok panjang ada?', 'ukurannya 90 cm', 'ukuran pintu saya 90cm, cocok?', 'mohon bantu infokan harganya']) {
      expect(detectSizeQuestion(q), q).toBe(false);
    }
  });

  it('counts a size as answered only when the reply has a measurement', async () => {
    const { unansweredSizeQuestion } = await import('../src/services/escalationHandler.js');
    expect(unansweredSizeQuestion('pilihan panjangnya ada berapa bu ?', 'Harga Rp 294.000/Set, warna BNSN')).toBe(true);
    expect(unansweredSizeQuestion('panjangnya berapa?', 'Besar 25 cm, tanggung 20 cm')).toBe(false);
    expect(unansweredSizeQuestion('ukurannya berapa?', 'Plat tebal 1,5mm')).toBe(false);
    expect(unansweredSizeQuestion('ukuran apa aja?', 'GERGAJI UK 16" Rp 90.000')).toBe(false);
    expect(unansweredSizeQuestion('harganya berapa?', 'Rp 294.000/Set')).toBe(false);
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
    expect(detectPpnQuestion('mau tanya harga handle besar')).toBe(false);
    expect(detectPpnQuestion('ada gembok ukuran 50mm?')).toBe(false);
  });
});

describe('pickProfileGapQuestion', () => {
  it('asks buyer type first when nothing is known', () => {
    expect(pickProfileGapQuestion(null)).toBe(ESCALATION_ASK_CUSTOMER_TYPE);
    expect(pickProfileGapQuestion(profileWith(null, { quantity: 12 }))).toBe(ESCALATION_ASK_CUSTOMER_TYPE);
  });

  it('offers all three buyer types, since each is priced differently', () => {
    expect(ESCALATION_ASK_CUSTOMER_TYPE).toContain('dipakai sendiri');
    expect(ESCALATION_ASK_CUSTOMER_TYPE).toContain('proyek');
    expect(ESCALATION_ASK_CUSTOMER_TYPE).toContain('dijual lagi');
  });

  it('asks quantity once buyer type is known', () => {
    expect(pickProfileGapQuestion(profileWith('end_user'))).toBe(ESCALATION_ASK_QUANTITY);
    expect(pickProfileGapQuestion(profileWith('project'))).toBe(ESCALATION_ASK_QUANTITY);
  });

  // The live failure this rung exists for: a reseller's 3-carton order sat escalated for two
  // days with buyer type and quantity already on file, so the ack asked nothing at all - while
  // the price gate in Kebijakan Harga was blocked on the one fact nobody was asking for.
  it('asks a reseller for the store name BEFORE quantity', () => {
    expect(pickProfileGapQuestion(profileWith('reseller'))).toBe(ESCALATION_ASK_STORE_NAME);
    expect(pickProfileGapQuestion(profileWith('reseller', { quantity: 1800 }))).toBe(ESCALATION_ASK_STORE_NAME);
  });

  it('moves on to quantity once the reseller has named their store', () => {
    expect(pickProfileGapQuestion(profileWith('reseller', { business_name: 'Tb. Jaya Karya' }))).toBe(ESCALATION_ASK_QUANTITY);
  });

  // Only resellers hit the store-name gate - an end user is never asked for a shop.
  it('never asks an end user or project buyer for a store name', () => {
    expect(pickProfileGapQuestion(profileWith('end_user'))).not.toBe(ESCALATION_ASK_STORE_NAME);
    expect(pickProfileGapQuestion(profileWith('project'))).not.toBe(ESCALATION_ASK_STORE_NAME);
  });

  it('asks nothing when the basics are covered (either quantity field counts)', () => {
    expect(pickProfileGapQuestion(profileWith('end_user', { quantity: 12 }))).toBeNull();
    expect(pickProfileGapQuestion(profileWith('reseller', { business_name: 'Tb. Jaya Karya', estimated_volume: '50/bulan' }))).toBeNull();
  });
});

describe('escalateConversation', () => {
  beforeEach(() => {
    mockSendText.mockClear();
    mockInsertMessage.mockClear();
    mockNotifyStaff.mockClear();
    mockGetContactProfile.mockReset();
    mockGetContactProfile.mockResolvedValue(null);
  });

  // The reply used to be whatever the failing turn wrote. Asked to explain why it could not
  // help, the model narrated the catalog it had just read ("katalog kami khusus
  // didokumentasikan untuk pintu kayu") - five of six live replays leaked internal vocabulary.
  // The customer now always gets fixed template text; the technical reason goes to the team.
  it('sends only fixed template text, never the model prose that caused the escalation', async () => {
    await escalateConversation(
      CONVERSATION,
      'Fungsi produk menyebut pintu kayu, foto menunjukkan pintu kaca - perlu dicek tim.',
      '628123'
    );

    expect(mockSendText).toHaveBeenCalledTimes(1);
    const sent = mockSendText.mock.calls[0][2] as unknown as string;
    expect(sent).toBe(`${CANNED_ESCALATION_REPLY} ${ESCALATION_ASK_CUSTOMER_TYPE}`);
    expect(sent.toLowerCase()).not.toContain('katalog');
    expect(sent.toLowerCase()).not.toContain('kayu');
    // Tone rule: maksimal satu emoji per balasan — templates must not stack a second one.
    expect((sent.match(/\p{Extended_Pictographic}/gu) ?? []).length).toBeLessThanOrEqual(1);
  });

  // UAT Run 2 E-08: "Kita coba cek ... kira-kira kebutuhannya berapa banyak?" right after "10 buah".
  it('does not ask for a quantity the customer typed in the message that escalated', async () => {
    mockGetContactProfile.mockResolvedValue(profileWith('end_user'));
    mockGetLastNMessages.mockResolvedValueOnce([
      { role: 'user', body: 'halo, saya Budi, dipakai sendiri buat rumah' },
      { role: 'assistant', body: 'Salam kenal, Pak Budi 😊 Lagi cari apa nih?' },
      { role: 'user', body: 'mau gembok master key 10 buah satu kunci' },
    ]);
    await escalateConversation(CONVERSATION, 'master key > 2 pcs', '628123');
    expect(mockSendText.mock.calls[0][2]).toBe(CANNED_ESCALATION_REPLY);
  });

  it('skips the sales question when the customer explicitly asked for a human', async () => {
    await escalateConversation(CONVERSATION, 'customer asked for a human', '628123', false);
    expect(mockSendText.mock.calls[0][2]).toBe(CANNED_ESCALATION_REPLY);
    expect(mockGetContactProfile).not.toHaveBeenCalled();
  });

  // SOP: escalation hands off, it does not end the conversation - while the team checks,
  // ask for the one profile fact we still lack, in this order: buyer type, then quantity.
  it('appends the quantity question when buyer type is already known', async () => {
    mockGetContactProfile.mockResolvedValue(profileWith('end_user'));
    await escalateConversation(CONVERSATION, 'reason', '628123');
    expect(mockSendText.mock.calls[0][2]).toBe(`${CANNED_ESCALATION_REPLY} ${ESCALATION_ASK_QUANTITY}`);
  });

  it('sends the bare hand-off line when the profile basics are covered', async () => {
    mockGetContactProfile.mockResolvedValue(profileWith('reseller', { business_name: 'Tb. Jaya Karya', estimated_volume: '50/bulan' }));
    await escalateConversation(CONVERSATION, 'reason', '628123');
    expect(mockSendText.mock.calls[0][2]).toBe(CANNED_ESCALATION_REPLY);
  });

  it('persists the sent reply as an assistant message so the next AI turn has the context', async () => {
    await escalateConversation(CONVERSATION, 'reason', '628123');
    expect(mockInsertMessage).toHaveBeenCalledTimes(1);
    expect(mockInsertMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1',
      role: 'assistant',
      body: `${CANNED_ESCALATION_REPLY} ${ESCALATION_ASK_CUSTOMER_TYPE}`,
      waMessageId: 'wamid-1',
      status: 'sent',
    }));
  });

  it('a profile lookup failure degrades to the buyer-type question, not a crash', async () => {
    mockGetContactProfile.mockRejectedValue(new Error('db down'));
    await escalateConversation(CONVERSATION, 'reason', '628123');
    expect(mockSendText.mock.calls[0][2]).toBe(`${CANNED_ESCALATION_REPLY} ${ESCALATION_ASK_CUSTOMER_TYPE}`);
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

describe('pickProfileGapQuestion — each question at most once (UAT F-06)', () => {
  it('moves on to the next rung once the buyer type was asked, answered or not', () => {
    const asked = [bot(`Kita coba cek dengan tim dulu ya kak 🙏 ${ESCALATION_ASK_CUSTOMER_TYPE}`)];
    expect(pickProfileGapQuestion(null, asked)).toBe(ESCALATION_ASK_QUANTITY);
    expect(pickProfileGapQuestion(null, [...asked, bot(`Siap kak ${ESCALATION_ASK_QUANTITY}`)])).toBeNull();
  });

  it('does not count the customer quoting a question as the bot having asked it', () => {
    expect(pickProfileGapQuestion(null, [customer(ESCALATION_ASK_CUSTOMER_TYPE)])).toBe(ESCALATION_ASK_CUSTOMER_TYPE);
  });

  // verifyFit's fallback asks the same question in other words; a hand-off right after it must
  // not ask it a second time.
  it('treats the buyer-type fallback reply as the question already asked', () => {
    expect(pickProfileGapQuestion(null, [bot(ASK_BUYER_TYPE_REPLY)])).toBe(ESCALATION_ASK_QUANTITY);
  });

  // Live 2026-10-06: the model asked it twice in its own words, the customer answered "Untuk proyek
  // sih kak" and "Proyek", the turn escalated with no type saved - and the hand-off asked a third time.
  it('treats the model asking the buyer type in its own words as the question already asked', () => {
    const history = [
      bot('Iya kak, ada! 😊 Boleh tahu nama kakak? Terus ini untuk dipakai sendiri, untuk proyek, atau dijual lagi ya?'),
      customer('Saya yan'),
      customer('Untuk proyek sih kak'),
      bot('Halo Kak Yan! 😊 Terus ini untuk dipakai sendiri, untuk proyek, atau dijual lagi ya?'),
      customer('Proyek'),
    ];
    expect(pickProfileGapQuestion(null, history)).toBe(ESCALATION_ASK_QUANTITY);
  });

  it('counts any spelling of a quantity key the model writes', () => {
    expect(pickProfileGapQuestion(profileWith('end_user', { estimated_quantity: 10 }))).toBeNull();
    expect(pickProfileGapQuestion(profileWith('end_user', { jumlah_unit: '3 set' }))).toBeNull();
  });
});

// UAT Run 2 F-06: the profile never stored what the customer had typed, so the hand-off asked for
// the store name four minutes after "Toko Bangunan Maju Jaya", and "berapa banyak?" right after
// "20 set newton", "3 karton" and "mau gembok master key 10 buah".
describe('pickProfileGapQuestion — facts the customer already typed', () => {
  it.each([
    'saya mau ambil 20 set newton buat rumah kos, harganya?',
    'saya mau ambil 3 karton engsel aomori 2,5 inch',
    'mau gembok master key 10 buah satu kunci',
    'ada beberapa sih, 2 pintu depan dan belakang, dan 2 pintu kamar',
    '20',
    '1 aja, jadi harganya brp ya?',
    '100 kak',
  ])('reads a quantity in: %s', (m) => expect(mentionsQuantity(m)).toBe(true));

  it.each([
    'gembok kuningan blossom 30mm ready?',
    'engsel tipis aomori 2,5 inch berapa?',
    '60mm, bukaan dari 2 sisi, punya 3 anak kunci',
    'kunci bulat blossom 587 itu bahannya apa?',
    'budget 150rb aja',
    '081234567890',
  ])('does not read a size, a price, a model number or a phone as a quantity: %s', (m) => expect(mentionsQuantity(m)).toBe(false));

  // Live 2026-10-07: a number with no unit, read from its context.
  it.each([
    'kebutuhan kurang lebih 300 an per ukuran',
    'butuh 300an',
    'sekitar 300 per ukuran',
    'kebutuhannya kurang lebih 50',
    'total 120 kak',
  ])('reads a quantity with no unit in: %s', (m) => expect(mentionsQuantity(m)).toBe(true));

  // Live 2026-10-08 (Kak Rei): every hand-off asked "berapa banyak?" after "10 koli".
  it.each([
    'untuk awal biasa campur 10 koli leher panjang dan leher pendek',
    'ambil 3 colly dulu kak',
    '5 coli aja',
  ])('reads koli/colly as a quantity: %s', (m) => expect(mentionsQuantity(m)).toBe(true));

  it('does not ask the quantity after "campur 10 koli" (Kak Rei, 2026-10-08)', () => {
    const recent = [
      customer('untuk awal biasa campur 10 koli leher panjang dan leher pendek'),
      bot('Kita coba cek dengan tim dulu ya kak 🙏'),
    ];
    expect(pickProfileGapQuestion(profileWith('reseller', { business_name: 'Toko Rei Jaya' }), recent)).toBeNull();
  });

  it.each([
    'saya Ryan kak, mau tanya perihal harga handle pintu\nberikut untuk list nya :\nHandle pintu panel uk 25\nHandle pintu moulded uk 20',
    'dikirim aja kak untuk list harga sesuai ukuran handle yang saya butuhkan',
    'butuh sekitar 30mm',
    'butuh 3" aja',
    'budget sekitar 150rb',
    'butuh 2,5 inch',
  ])('still does not read a size, a price or a sentence with no number as a quantity: %s', (m) => expect(mentionsQuantity(m)).toBe(false));

  // The exact 2026-10-07 thread: project buyer, quantity typed but never saved by the live turn.
  it('does not ask the quantity after "kebutuhan kurang lebih 300 an per ukuran" (live 2026-10-07)', () => {
    const recent = [
      customer('selamat sore'),
      bot('Selamat sore kak! 😊 Saya Rina dari Legacy. Sebelumnya, dengan siapa saya terhubung ya?'),
      customer('saya Ryan kak, mau tanya perihal harga handle pintu\nberikut untuk list nya :\nHandle pintu panel uk 25\nHandle pintu moulded uk 20'),
      bot('Salam kenal, Kak Ryan! 😊 Sebelum saya kasih harganya, boleh tahu dulu rencananya untuk dipakai sendiri, untuk proyek, atau dijual kembali ya?'),
      customer('untuk proyek'),
      customer('kebutuhan kurang lebih 300 an per ukuran'),
      customer('dikirim aja kak untuk list harga sesuai ukuran handle yang saya butuhkan'),
    ];
    expect(pickProfileGapQuestion(profileWith('project'), recent)).toBeNull();
  });

  it('skips the quantity question when the customer already gave one', () => {
    expect(pickProfileGapQuestion(profileWith('end_user'), [customer('mau gembok master key 10 buah satu kunci')])).toBeNull();
  });

  it('counts a store name the customer gave in answer to the question for it (C-05)', () => {
    const recent = [
      bot('Halo Pak Rudi! Sebelum saya kasih harga, boleh saya tahu dulu: - Nama toko atau usaha Pak Rudi? - Lokasi usahanya di mana?'),
      customer('Toko Bangunan Maju Jaya, Sidoarjo, Jl. Raya Waru 12'),
      bot('Baik Pak Rudi, ini harganya ...'),
      customer('saya mau ambil 3 karton engsel aomori 2,5 inch'),
      customer('bisa diskon 25% ga kalau ambil banyak?'),
    ];
    expect(pickProfileGapQuestion(profileWith('reseller'), recent)).toBeNull();
  });

  it('asks nothing on a later hand-off in a complaint thread (UAT Run 3 E-06)', () => {
    const recent = [
      customer('engsel yang saya beli bulan lalu sudah berkarat, gimana ini?'),
      bot('Waduh, mohon maaf ya kak atas kendalanya 🙏 Kita cek dengan tim dulu ya.'),
      customer('engsel 3inch newton'),
    ];
    expect(pickProfileGapQuestion(null, recent)).toBeNull();
  });

  it('does not take "punya toko bangunan di Surabaya" for a store name', () => {
    const recent = [customer('halo saya Dewi, punya toko bangunan di Surabaya, mau jadi reseller')];
    expect(pickProfileGapQuestion(profileWith('reseller'), recent)).toBe(ESCALATION_ASK_STORE_NAME);
  });
});

describe('isNonSalesHandoff', () => {
  it.each([
    'permisi apa masih ada lowongan driver pengiriman?', // UAT Run 2 G-07
    'saya mau kirim lamaran kerja',
    'engsel yang saya beli bulan lalu sudah berkarat, gimana ini?',
  ])('no sales question after: %s', (m) => expect(isNonSalesHandoff(m)).toBe(true));

  it.each([
    'harganya sudah termasuk ppn belum?', // a hand-off mid-sale keeps its question
    'mau cari gembok buat loker kantor', // loker = locker
    'saya cari supplier engsel buat toko saya', // a reseller lead
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
  ])('courier: %s', (m) => expect(detectCourierMessage(m)).toBe(true));
  it.each([
    'saya ambil 10 ya kak',
    'mau order handle besar',
    'bisa kirim pakai jne?',
    'ongkir pakai jnt berapa',
    'grabber tool ada?',
    'impact driver ada?',
    'saya mau ambil barangnya besok di toko bisa?',
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
    ['kami dari PT ABC supplier engsel, mau tawarkan kerja sama', 'Penawaran kerja sama / supplier'],
    ['grab\nmau ambil pesanan', 'Kurir / pengambilan pesanan'],
  ])('%s -> %s', (m, topic) => expect(detectNonSalesTopic(m)).toBe(topic));
  it.each([
    'gembok buat loker ada?', 'gembok untuk loker gudang ada?', 'saya dari CV Maju Jaya mau order engsel', 'cari supplier engsel untuk toko saya',
    'mau jadi reseller, bisa kerja sama?', 'bisa beli di shopee ga kak?', 'kalau order hari ini kapan dikirim?',
    'bisa transfer ke rekening mana kak?', 'saya kerja di proyek, butuh engsel', 'karyawan saya mau ambil barang besok di toko',
    // code review 2026-10-13
    'saya lihat dari shopee kak, handle ini ada?', 'shopee nya apa kak?', 'grab bar stainless ada kak?', 'jne bisa kak kirimnya?',
    'saya cari kerja sama untuk jadi reseller', 'di shopee kemarin harganya lebih murah kak',
  ])('a buyer: %s', (m) => expect(detectNonSalesTopic(m)).toBeNull());
});

// Live 2026-10-31: a plastics factory offering us packaging, over four messages, matched nothing. The
// model handed it off itself, and the hand-off still asked "kira-kira kebutuhannya berapa banyak?".
describe('detectNonSalesTopic - a supplier across messages', () => {
  const SUPPLIER = 'Penawaran kerja sama / supplier';
  const intro = 'Pagi kak\nSalam kenal saya Windy\nDari PT. Pelita Mekar Semesta';
  const factory = 'Siap Salam kenal Kak Rina\nKami dari pabrik plastik kantongan, shrink, stretch film';

  it('reads the live chat as a supplier once it says what it wants', () => {
    expect(detectNonSalesTopic(intro)).toBeNull(); // a greeting - the bot asks what she needs
    expect(detectNonSalesTopic(factory, intro)).toBeNull(); // what it makes, no offer yet
    expect(detectNonSalesTopic('Kami ingin coba menjajaki kebutuhan palstik untuk outer produk di  Legacy Inti Pratama', `${intro}\n${factory}`)).toBe(SUPPLIER);
    expect(detectNonSalesTopic('Terkait dengan kebutuhan plastik kami bisa menghubungi kemana ya kak? 😊🙏', `${intro}\n${factory}`)).toBe(SUPPLIER);
  });

  it.each([
    'kami ingin menjajaki kebutuhan kemasan di perusahaan bapak',
    'mau menawarkan produk kami kak, kardus box custom',
    'boleh minta kontak bagian purchasing?',
    'bisa hubungi tim pengadaan kemana ya?',
    'kami ingin jadi supplier legacy',
  ])('an offer on its own: %s', (m) => expect(detectNonSalesTopic(m)).toBe(SUPPLIER));

  it.each([
    ['kami dari pabrik furniture, butuh engsel untuk produk kami', ''],
    ['kami dari pabrik garmen, minta penawaran harga engsel 200 pcs', ''],
    ['bisa menawarkan harga grosir kak?', 'kami pabrik lemari'],
    ['ada handle pintu yang ready?', 'kami dari pabrik plastik kantongan'], // a factory buying from us
    ['kebutuhan engsel kami bisa menghubungi kemana?', ''], // no supplier introduction anywhere
    ['saya cari supplier engsel, bisa menawarkan harga reseller?', ''],
    ['saya mau tawarkan ke pelanggan saya dulu ya kak', 'halo saya Budi'],
  ])('a buyer: %s', (m, earlier) => expect(detectNonSalesTopic(m, earlier)).toBeNull());

  it('reads only the supplier introduction from earlier messages, never the other topics', () => {
    expect(detectNonSalesTopic('ada engsel 4 inch?', 'kak saya sudah transfer, tolong dicek ya')).toBeNull();
  });
});

describe('isNonSalesReason - the model\'s own hand-off reason', () => {
  it.each([
    'Penawaran menjadi supplier/kerja sama produk plastik - keluar dari scope hardware.', // live 2026-10-31
    'BUKAN PEMBELI: pabrik plastik menawarkan kemasan',
    'Penawaran kerja sama / supplier - bukan pertanyaan produk',
    'Pabrik menawarkan produk kemasan ke Legacy',
    'Customer menanyakan lowongan kerja driver',
  ])('not a buyer: %s', (r) => expect(isNonSalesReason(r)).toBe(true));
  it.each([
    'Customer mencari supplier engsel untuk tokonya (reseller)',
    'Minta harga proyek 200 unit',
    'Customer menanyakan PPN',
    null,
  ])('a buyer: %s', (r) => expect(isNonSalesReason(r)).toBe(false));
});

describe('detectComplaint', () => {
  it.each([
    'engsel yang saya beli bulan lalu sudah berkarat, gimana ini?',
    'baru seminggu handlenya patah',
    'kuncinya macet kak, nggak berfungsi',
    'saya mau klaim garansi',
  ])('reads after-sales trouble: %s', (m) => expect(detectComplaint(m)).toBe(true));

  it.each([
    'yang anti karat ada kak?',          // a sales question about a product property
    'garansinya berapa lama?',           // pre-sale question
    'ada engsel 3 inch?',
  ])('leaves a sales question alone: %s', (m) => expect(detectComplaint(m)).toBe(false));
});

describe('escalateConversation — complaint wording', () => {
  beforeEach(() => {
    mockSendText.mockClear();
    mockGetContactProfile.mockReset();
    mockGetContactProfile.mockResolvedValue(null);
  });

  it('sends the apology lead alone when told not to ask', async () => {
    await escalateConversation(CONVERSATION, 'Komplain engsel berkarat', '628123', false, null, CANNED_COMPLAINT_REPLY);
    expect(mockSendText.mock.calls[0][2]).toBe(CANNED_COMPLAINT_REPLY);
    expect((CANNED_COMPLAINT_REPLY.match(/\p{Extended_Pictographic}/gu) ?? []).length).toBe(1);
  });
});
