import { updateConversationStatus, insertMessage, getLastNMessages } from '../repositories/conversations.js';
import { getContactProfile } from '../repositories/contactProfiles.js';
import { getBotSettings } from '../repositories/appSettings.js';
import { FALLBACK_MIN_PCS } from '../domain/pricing.js';
import { sendTextMessage } from './whatsappSender.js';
import {
  CANNED_ESCALATION_REPLY,
  ESCALATION_ASK_BUSINESS_NAME,
  ESCALATION_ASK_DESIGN,
  ESCALATION_ASK_NAME,
  ESCALATION_ASK_PRODUCT,
  escalationAskQuantity,
  ESCALATION_ASK_SIZE,
  MAX_CONTEXT_MESSAGES,
} from '../domain/constants.js';
import type { ContactProfile, Conversation, PhoneNumber } from '../domain/types.js';
import { findPhoneNumberById } from '../repositories/phoneNumbers.js';
import { notifyStaff } from './staffNotify.js';
import { mergeOrderFacts, orderDetailsSummary, type OrderItem } from '../domain/orderProfile.js';
import { ASKS_NAME_RE } from './replyChecks.js';
import { HANDOFF_LABEL, NO_SIGNALS, classifyHandoff, type HandoffCategory } from '../domain/handoff.js';

/**
 * The one customer fact the team will need next, as a fixed question — or null when the
 * profile already has the basics. Templates only, never model prose: this rides on the
 * escalation reply, which is fixed text for a reason (see CANNED_ESCALATION_REPLY).
 */
// The ladder is the six order details staff need, first missing one first: product (or business
// type), size, quantity, design, business name, name. Read from the merged facts - an item counts for
// each field it has.
//
// `recent`: the conversation's recent rows, oldest first. Each question is asked at most once in
// that window, whether or not the answer got saved - live (UAT F-06) the quantity was asked five
// times after "3 box", because the answer never reached the profile. Asking again is nagging; the
// next rung, or nothing, is better. And a quantity or store name the customer already TYPED counts
// as known even if the model never saved it.
export function pickProfileGapQuestion(profile: ContactProfile | null, recent: RecentRow[] = [], minPcs: number = FALLBACK_MIN_PCS): string | null {
  // A complaint or job hand-off stays free of sales questions for as long as the customer waits on
  // it - on the acks after it AND on a later hand-off in the same thread (UAT Run 3 E-06). One place,
  // so both hand-off paths ask the same.
  if (recent.some((m) => m.role === 'user' && isNonSalesHandoff(m.body))) return null;
  // The model asks the name in its own words ("dengan siapa saya terhubung?"): that counts too.
  const asked = (body: string, question: string) =>
    body.includes(question) || (question === ESCALATION_ASK_NAME && ASKS_NAME_RE.test(body));
  const fresh = (question: string) => !recent.some((m) => m.role === 'assistant' && asked(m.body, question));
  const facts = mergeOrderFacts({}, profile?.profile ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(facts.items) ? facts.items : []) as OrderItem[];
  const text = (v: unknown) => typeof v === 'string' && v.trim() !== '';

  const askQuantity = escalationAskQuantity(minPcs);
  const ladder: Array<[boolean, string]> = [
    [items.some((i) => i.product) || text(facts.business_type), ESCALATION_ASK_PRODUCT],
    [items.some((i) => i.size), ESCALATION_ASK_SIZE],
    [items.some((i) => i.qty !== undefined) || !hasNoFact(facts, QUANTITY_KEYS)
      || recent.some((m) => m.role === 'user' && mentionsQuantity(m.body)), askQuantity],
    [items.some((i) => i.has_design !== undefined) || typeof facts.has_design === 'boolean'
      || recent.some((m) => m.role === 'user' && mentionsDesign(m.body)), ESCALATION_ASK_DESIGN],
    [text(facts.business_name) || answeredStoreName(recent), ESCALATION_ASK_BUSINESS_NAME],
    [text(facts.name), ESCALATION_ASK_NAME],
  ];
  for (const [known, question] of ladder) {
    if (!known && fresh(question)) return question;
  }
  return null;
}

// The configured fallback minimum; the shipped value when the setting cannot be read, so a
// settings hiccup never stops the hand-off message.
async function minPcsSetting(): Promise<number> {
  try { return (await getBotSettings()).fallbackMinPcs; } catch { return FALLBACK_MIN_PCS; }
}

type RecentRow = { role: string; body: string };

// ponytail: the two scans below are heuristics, not parsing. A miss costs one question, asked once
// (the `fresh` rule above); a false hit skips one. Widen the unit list if live chats show misses.

// "10 rim", "2500 pcs", "500 lembar", "3 karton", "10 box", or a bare number answering "berapa banyak?"
// ("20", "1 aja", "100 kak"). Not a size ("30x30", "30mm"), a price ("150rb") or a phone number.
// "koli"/"colly" is how some buyers count cartons ("campur 10 koli"); a missed unit means the hand-off
// asks "berapa banyak?" again right after the customer said it. Never across a line break: in a list
// ("uk 20" then "Box kue" on the next line) the number is a size, not 20 boxes.
const QUANTITY_RE =
  /\b\d{1,4}[ \t]*(?:rim|lembar|lbr|pcs|pc|biji|buah|unit|set|pasang|lusin|lsn|karton|ctn|dus|box|pack|koli|colly|coli|roll)\b|^[ \t]*\d{1,4}[ \t]*(?:aja|saja|dulu|kak|ka|pak|bu|ya|deh|dong)?[ \t]*(?:[,.!?]|$)/im;

// A number with no unit, read as a quantity only from its context: "300 an" / "300an" (about 300),
// a need word right before it ("kebutuhan kurang lebih 300", "butuh sekitar 50"), or a per-item
// split after it ("300 per ukuran"). A buyer who wrote "kebutuhan kurang lebih 300 an per ukuran" has
// answered, even when the model said "sudah saya catat" without saving it - the hand-off must not ask
// "berapa banyak?" a minute later. A bare number still is not a quantity - "uk 25" is a size and "587"
// a model code - and a size, price or decimal right after the number never is.
const QUANTITY_CONTEXT_RE = new RegExp(
  [
    String.raw`\b\d{1,5}\s*-?\s*an\b`,
    String.raw`\b(?:kebutuhan(?:nya)?|butuh(?:nya)?|perlu|kurang\s+lebih|kurleb|sekitar|kira[\s-]*kira|kisaran|total(?:nya)?|jumlah(?:nya)?)\s+(?:(?:kurang\s+lebih|kurleb|sekitar|kira[\s-]*kira|kisaran|ada|ya|kak|cuma|hanya)\s+)*\d{1,5}\b(?![.,]\d)(?!\s*(?:(?:mm|cm|m|meter|inch|in|inci|rb|ribu|k|jt|juta)\b|["”%]))`,
    String.raw`\b\d{1,5}\s*(?:per|\/)\s*(?:ukuran|item|tipe|type|model|jenis|warna|size|varian)\b`,
  ].join('|'),
  'i'
);

export function mentionsQuantity(text: string): boolean {
  return QUANTITY_RE.test(text) || QUANTITY_CONTEXT_RE.test(text);
}

// The customer saying whether there is a design, either way: "logo saya sudah ada kak", "ini logonya"
// (a photo caption), "belum punya desain", "pakai logo saya". Same job as mentionsQuantity - the design
// question is not asked right after the customer answered it, saved or not. Not a question about
// design work ("bisa dibantu desainnya?", "logonya dicetak berapa warna?"): no have-word next to it.
const DESIGN_WORD = String.raw`(?:logo|desain|design|artwork)(?:nya)?`;
const DESIGN_ANSWER_RE = new RegExp([
  String.raw`\b${DESIGN_WORD}(?:\s+(?:saya|aku|kami|sendiri|kak|ka))*\s+(?:sudah|udah|sdh|udh|ada|punya|siap|belum|blm|tidak|gak|ga|nggak|ngga)\b`,
  String.raw`\b(?:sudah|udah|sdh|udh|belum|blm|punya|pakai|pake|tidak|gak|nggak|ngga)\s+(?:ada\s+|punya\s+)?${DESIGN_WORD}\b`,
  String.raw`\bini\s+${DESIGN_WORD}\b`,
].join('|'), 'i');

export function mentionsDesign(text: string): boolean {
  return DESIGN_ANSWER_RE.test(text);
}

// The model asks for the business in its own words ("Nama toko atau usahanya apa kak?"), so a pattern
// on the customer's text alone ("toko ...") would read "toko kue di Surabaya" as a name, and
// "ud"/"cv" are chat slang. The customer's reply to that question is the answer.
const ASKS_STORE_NAME_RE = /nama\s+(?:toko|usaha)|tokonya\s+apa/i;

function answeredStoreName(recent: RecentRow[]): boolean {
  return recent.some((m, i) => m.role === 'user' && i > 0
    && recent[i - 1]!.role === 'assistant' && ASKS_STORE_NAME_RE.test(recent[i - 1]!.body));
}

// Older profiles hold the quantity as a top-level fact under whatever key the model picked, so an exact
// key check misses spellings and the ack asks "kira-kira mau pesan berapa banyak?" minutes AFTER the
// customer answered it. Matching is a substring of the normalized key, so quantity / estimated_volume /
// order_qty / estimated_quantity / jumlah_unit all count as "we already know".
const QUANTITY_KEYS = ['quantity', 'qty', 'jumlah', 'volume'];

function hasNoFact(facts: Record<string, unknown>, keys: string[]): boolean {
  for (const [k, v] of Object.entries(facts)) {
    if (v == null || v === '') continue;
    const key = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (keys.some((wanted) => key.includes(wanted))) return false;
  }
  return true;
}


/**
 * Hands the conversation to a human and tells the customer so, in fixed words.
 *
 * It used to send the model's own message when there was one. That message is written by the
 * turn that just failed - asked to say why it could not help, the model explains itself with
 * the catalog internals it was reading, or makes a reason up. The technical reason belongs in
 * `reason`, which only the team reads. The customer gets CANNED_ESCALATION_REPLY — plus, so
 * the hand-off never dead-ends the sale, one fixed question for a profile fact we still lack.
 *
 * `askProfileGap: false` when the customer explicitly asked for a human, is complaining, or asked
 * about tax: tacking a sales question onto that hand-off reads as the bot ignoring the request and
 * continuing to sell. `lead` replaces the canned line itself (CANNED_COMPLAINT_REPLY).
 * `category`: why the team has it (domain/handoff.ts) - the caller's, from its signals, or else read
 * off the reason text.
 */
export async function escalateConversation(
  conversation: Conversation,
  reason: string,
  customerWaId: string,
  askProfileGap = true,
  knownPhoneNumber?: PhoneNumber | null,
  lead: string = CANNED_ESCALATION_REPLY,
  category?: HandoffCategory
): Promise<void> {
  const handoffCategory = category ?? classifyHandoff(NO_SIGNALS, reason);
  // Status write, phone-number lookup (skipped when the caller already has it) and the
  // profile/history reads are independent — run them together; this all sits before the
  // hand-off message the customer is waiting on.
  // The profile is read even without a gap question: staff get the order details in their note.
  const [, phoneNumber, profile, recent] = await Promise.all([
    updateConversationStatus(conversation.id, 'escalated', reason, undefined, handoffCategory),
    knownPhoneNumber ? Promise.resolve(knownPhoneNumber) : findPhoneNumberById(conversation.phoneNumberId),
    getContactProfile(conversation.contactId).catch(() => null),
    askProfileGap ? getLastNMessages(conversation.id, MAX_CONTEXT_MESSAGES).catch(() => []) : Promise.resolve([]),
  ]);
  if (!phoneNumber) return;

  // The hand-off is only half of an escalation; this is the half that reaches a person. Fired
  // here rather than in messageRouter so both the text and image paths get it for free, and
  // before the customer send so a failed send still raises the alarm.
  const summary = orderDetailsSummary(mergeOrderFacts({}, profile?.profile ?? {}));
  notifyStaff({
    title: `Perlu tim: ${HANDOFF_LABEL[handoffCategory]}`,
    body: summary ? `${reason}\n${summary}` : reason,
    path: `/conversations/${conversation.id}`,
  });

  const question = askProfileGap ? pickProfileGapQuestion(profile, recent, await minPcsSetting()) : null;
  const reply = question ? `${lead} ${question}` : lead;

  let sentId: string | null = null;
  try { sentId = await sendTextMessage(phoneNumber.phoneNumberId, customerWaId, reply); } catch { /* recorded below as 'saved' */ }

  // Persist what the customer actually saw: without this row the next AI turn has no idea the
  // question above was asked, and the customer's answer ("30x30") arrives without context.
  await insertMessage({
    conversationId: conversation.id,
    role: 'assistant',
    body: reply,
    waMessageId: sentId || undefined,
    status: sentId ? 'sent' : 'saved',
    metadata: { source: 'escalation' } as Record<string, unknown>,
  }).catch(() => { });
}

// After-sales trouble. Only shapes the WORDING of a hand-off the model already chose - an apology,
// no sales question - and never escalates on its own: "box yang kemarin rusak, mau pesan lagi" is a
// sale. A complaint about an earlier order must not get "kira-kira mau pesan berapa banyak?" appended
// to the hand-off.
// No bare "garansi": "garansinya berapa lama?" is a sales question.
// ponytail: keyword list, not intent - an escalated replacement enquiry gets the apology too.
const COMPLAINT_RE =
  /\b(?:komplain|complain|keluhan|klaim\s+garansi|retur|refund|kecewa|cacat|rusak|patah|macet|penyok|sobek|robek|luntur|bocor|berjamur|salah\s+cetak|cetakan(?:nya)?\s+pudar|lem(?:nya)?\s+lepas|lepas\s+lem|(?:tidak|nggak|ngga|gak|ga)\s+berfungsi)\b/i;

export function detectComplaint(message: string): boolean {
  return COMPLAINT_RE.test(message);
}

// A job seeker is not a sale: "masih ada lowongan driver?" must not get a sales question. Not a bare
// "loker" - that is also a locker ("box buat loker") - and not "supplier": "cari supplier kertas nasi"
// is a buyer. "loker" only in a job sense ("loker gudang", "info loker", "masih ada loker"), and CV
// only as in "kirim CV" - "CV Maju Jaya" is a company, usually a buyer.
const JOB_ENQUIRY_RE = new RegExp([
  String.raw`\b(?:lowongan|lowker|lamaran|melamar|rekrut\w*|vacancy|hiring|magang)\b`,
  // "box buat loker kantor" is for a locker - so never right after buat/untuk.
  String.raw`(?<!(?:buat|untuk)\s)\bloker\s+(?:gudang|sales|admin|driver|kerja|staf+|karyawan|kurir|helper|operator)\b`,
  String.raw`\b(?:info|buka|masih\s+(?:ada|buka))\s+loker\b`,
  // not "cari kerja sama" - a partnership or a buyer who resells (review 2026-10-13)
  String.raw`\b(?:cari|mencari|nyari|butuh)\s+(?:kerja(?!\s*sama)|kerjaan|pekerjaan)\b`,
  String.raw`\b(?:butuh|cari|terima|menerima|buka)\s+karyawan\b`,
  String.raw`\bkirim\s+(?:cv|lamaran)\b`, String.raw`\bposisi\s+kosong\b`, String.raw`\bdaftar\s+(?:jadi\s+)?karyawan\b`,
].join('|'), 'i');

// Marketplaces the team also sells on - shared by the order-follow-up and courier patterns.
const MARKETPLACES = String.raw`shopee|tokopedia|tokped|lazada|tiktok(?:\s*shop)?|blibli|bukalapak`;

// A payment or an order already placed - the team's to check, never the bot's: probed 2026-10-13,
// "sudah transfer, tolong dicek" got "saya teruskan ke tim" at confidence high (nobody was told), and
// "beli di shopee kemarin, kapan dikirim?" was sent to the Shopee app although the team ships those
// orders from this very number.
const ORDER_FOLLOWUP_RE = new RegExp([
  String.raw`\b(?:sudah|udah|sdh|udh)\s+(?:transfer|tf|bayar|dibayar|lunas)\b`,
  String.raw`\bbukti\s+(?:transfer|tf|bayar|pembayaran)\b`, String.raw`\bkonfirmasi\s+(?:pembayaran|transfer)\b`,
  String.raw`\b(?:nomor|no\.?|cek)\s+resi\b`, String.raw`\bstatus\s+pesanan\b`,
  String.raw`\bpesanan\s+(?:saya\s+)?(?:belum|blm|kok\s+belum)\s+(?:sampai|datang|dikirim|diterima)\b`,
  // an order already placed on a marketplace - not "bisa beli di shopee?" or "di shopee kemarin lebih murah"
  String.raw`\b(?:beli|order|pesan|checkout)\s+di\s+(?:${MARKETPLACES})\s+(?:kemarin|tadi|barusan|minggu\s+lalu)\b`,
  String.raw`\b(?:sudah|udah|sdh|udh)\s+(?:beli|order|pesan|checkout)\b[^\n]{0,20}\b(?:${MARKETPLACES})\b`,
  String.raw`\b(?:${MARKETPLACES})\b[^\n]{0,40}\b(?:kapan\s+dikirim|belum\s+(?:dikirim|sampai|datang)|resi)\b`,
].join('|'), 'i');

// Our own names as a supplier writes them: the company or either brand ("PT Imperial Indopack",
// "Kertas Supreme"). Never a bare "imperial": "Imperial Kitchen" is a buyer's restaurant.
const OUR_NAME = String.raw`(?:pt\.?\s*imperial(?:\s*indopack)?|imperial\s*indopack|kertas\s*supreme)`;

// Someone selling TO us: an explicit offer to sell or supply. Not a bare "supplier" ("cari supplier
// kertas nasi" is a buyer), not a PT/CV introduction ("Kami dari PT Sari Roti, produsen roti" buys
// boxes), and not "bisa tawarkan box ...?" - that is a buyer asking US to offer.
const PARTNERSHIP_OFFER_RE = new RegExp([
  String.raw`\b(?:menawarkan|tawarkan|tawarin|penawaran)\s+kerja\s*sama\b`,
  String.raw`\b(?:kami|saya)\s+(?:ingin\s+|mau\s+|akan\s+)?menawarkan\b`,
  String.raw`\b(?:ingin|mau)\s+menawarkan\b`,
  String.raw`\b(?:menawarkan|tawarkan|tawarin)\s+(?:produk|jasa|barang|layanan)\s+(?:kami|kita)\b`,
  String.raw`\b(?:kontak|hubungi|menghubungi)\s+(?:bagian|tim|divisi)?\s*(?:purchasing|pembelian|procurement|pengadaan)\b`,
  String.raw`\b(?:bagian|tim|divisi)\s+(?:purchasing|procurement|pengadaan)\b`,
  // A plastics factory: "Kami ingin coba menjajaki kebutuhan plastik untuk produk di perusahaan
  // bapak". Exploring OUR needs is seller's language; a buyer has needs of their own.
  String.raw`\bmenjajaki\s+kebutuhan\b`,
  String.raw`\bkami\s+(?:bisa\s+|siap\s+)?(?:supply|suplai|memasok|menyuplai)\b`,
  String.raw`\b(?:bisa|siap)\s+(?:supply|suplai|memasok|menyuplai)\b`,
  String.raw`\b(?:jadi|menjadi)\s+(?:supplier|pemasok|vendor)\b`,
  String.raw`\b(?:supplier|pemasok|vendor)\s+(?:untuk|bagi|ke)\s+(?:kalian|anda|${OUR_NAME})\b`,
  String.raw`\b(?:boleh|bisa|izin|ijin)\s+(?:kami\s+)?(?:kirim|mengirim|mengirimkan|ajukan|mengajukan)\s+(?:penawaran|company\s*profile|compro)\b`,
  String.raw`\b(?:company\s*profile|compro)\s+kami\b`,
].join('|'), 'i');

// A factory or supplier introducing itself ("Kami dari pabrik plastik kantongan, shrink, stretch film").
// Not enough alone - a bakery buying boxes for its cakes says the same ("kami pabrik roti") - so it
// counts only with a question about our needs, and the two may come in different messages: the
// factory says what it makes in one and asks "Terkait kebutuhan plastik kami bisa menghubungi kemana
// ya kak?" three minutes later.
const SUPPLIER_SELF_ID_RE =
  /\b(?:kami|saya)\s+(?:dari\s+|adalah\s+)?(?:(?:pt|cv)\.?\s+[^,.?!\n]{1,40}?\s+(?:yang\s+)?)?(?:pabrik|produsen|manufaktur|supplier|pemasok|vendor)\b/i;
const SUPPLIER_OFFER_RE = new RegExp([
  String.raw`\bkebutuhan\s+\w+(?:\s+\w+)?\s+(?:kami\s+)?(?:bisa|boleh)\s+(?:menghubungi|hubungi|kontak)\b`,
  String.raw`\bkebutuhan\b[^,.?!\n]{0,40}\b(?:di|untuk|bagi)\s+${OUR_NAME}\b`,
].join('|'), 'i');

// Buy intent overrides every supplier signal (client ruling, Task 13 review): a message that asks for,
// prices or names what we sell is a buyer's, whoever wrote it. A buy VERB anywhere in the message is
// enough ("Kami pabrik roti butuh box 5000 pcs, boleh kirim penawaran?" - no comma before the need).
// A buy NOUN counts once what a supplier says about its own goods is cut ("supplier kertas kraft
// roll", "vendor tinta sablon", "bisa supply plastik ke ..."): the cut takes the noun phrase after the
// supplier word and stops at punctuation or a buy verb. Cost accepted: a supplier who writes "mau
// menawarkan" reaches the bot, whose prompt hands it off as BUKAN PEMBELI.
const BUY_VERBS = String.raw`butuh|perlu|pesan|order|beli|mau|cari|minta`;
const BUY_VERB_RE = new RegExp(String.raw`\b(?:${BUY_VERBS})(?:nya)?\b`, 'i');
const BUY_NOUN_RE = /\b(?:box|dus|kertas|cetak|sablon|kemasan)(?:nya)?\b/i;
const SELLER_GOODS_RE = new RegExp(
  String.raw`\b(?:supplier|pemasok|vendor|distributor|pabrik|produsen|manufaktur|supply|suplai|memasok|menyuplai)\b(?:(?!\b(?:${BUY_VERBS})\b)[^,.?!\n]){0,40}`,
  'gi'
);

function wantsToBuy(message: string): boolean {
  return BUY_VERB_RE.test(message) || BUY_NOUN_RE.test(message.replace(SELLER_GOODS_RE, ' '));
}

/**
 * A hand-off that is not a sale in progress - after-sales trouble or a job enquiry - gets no
 * profile-gap question, on the first hand-off or any ack after it: a sales question tacked on reads
 * as not listening. PPN is not one of these: the tax turn's own hand-off asks nothing (messageRouter),
 * but a later hand-off in the same chat is still a sale in progress.
 */
// A courier or marketplace pickup, not a buyer: this number is also the sender number on the team's
// marketplace listings, so drivers write to it ("grab / mau ambil pesanan"), and must not get a sales
// question. Owner's call 2026-10-13: straight to the team, no sales question. Narrow on purpose - a buyer says "saya ambil 10" or "mau order", and
// "bisa kirim pakai jne?" is a shipping question mid-sale, so a courier name only counts when it
// opens a line ("grab", "jne ada paket") or follows dari/driver/kurir/abang.
// Not a bare "shopee": "saya lihat dari shopee", "shopee nya apa?" are buyers (review 2026-10-13). And a
// courier name at the start of a line counts only ALONE ("grab") or with courier words ("jne ada paket") -
// "jne bisa kirimnya?" and "grab bisa kirim ke Bekasi?" are shipping questions.
const COURIERS = String.raw`grab(?:\s*express)?|gojek|go-?send|maxim|lalamove|deliveree|borzo|paxel|shopee\s*express|spx|j\s*&\s*t|jnt|jne|si\s*cepat|anteraja|ninja\s*x?press|lion\s*parcel|id\s*express`;
const COURIER_SELF_ID_RE = new RegExp([
  String.raw`(?:^|\n)\s*(?:saya\s+)?(?:${COURIERS})\s*[.!]*\s*(?:$|\n)`,
  String.raw`\b(?:${COURIERS})\b[^\n]{0,30}\b(?:paket|pesanan|orderan|ambil|jemput|pick\s*-?\s*up)\b`,
  String.raw`\b(?:dari|driver|abang|bang|mas)\s+(?:${COURIERS})\b`,
  String.raw`\bpaket\s+(?:untuk|buat)\s+(?:gudang|kantor|pabrik|toko)\b|\bpenerima(?:nya)?\s+(?:paket\s+)?siapa\b`,
  String.raw`\b(?:saya|ini)\s+kurir\b|\bkurir\s+(?:${COURIERS}|${MARKETPLACES})\b`,
].join('|'), 'i');
const PICKUP_RE = /\b(?:ambil|jemput|pick\s*-?\s*up)\s+(?:pesanan|paket|orderan|barang\s+pesanan)\b/i;

export function detectCourierMessage(message: string): boolean {
  return COURIER_SELF_ID_RE.test(message) || PICKUP_RE.test(message);
}

/**
 * Chats that are not about buying, which go to the team as they are - no AI call, no sales question
 * (client, 2026-10-13: "chat selain tentang orderan barang ... langsung arahkan ke tim"). Left to the
 * model, a probe of ten such first messages produced invented HR channels ("kirim CV ke tim HR lewat
 * website"), a payment confirmation acknowledged but never handed off, and a hand-off with a sales
 * question tacked on. The label is the hand-off reason staff read.
 *
 * `earlier` is the customer's own recent messages before this batch. Only the supplier introduction
 * is read from it, never the other topics: a customer who once wrote "sudah transfer" and now asks
 * about a new product must reach the bot.
 */
export function detectNonSalesTopic(message: string, earlier = ''): string | null {
  if (detectCourierMessage(message)) return 'Kurir / pengambilan pesanan';
  if (JOB_ENQUIRY_RE.test(message)) return 'Lowongan kerja';
  if (ORDER_FOLLOWUP_RE.test(message)) return 'Pembayaran / status pesanan';
  if (wantsToBuy(message)) return null;
  if (PARTNERSHIP_OFFER_RE.test(message)) return 'Penawaran kerja sama / supplier';
  if (SUPPLIER_OFFER_RE.test(message) && SUPPLIER_SELF_ID_RE.test(`${earlier}\n${message}`)) return 'Penawaran kerja sama / supplier';
  return null;
}

export function isNonSalesHandoff(message: string): boolean {
  return detectComplaint(message) || detectNonSalesTopic(message) !== null;
}

/**
 * A hand-off reason - the model's own, or the one stored on the conversation - saying the customer is
 * not a buyer. Live 2026-10-31 a plastics factory offering us packaging was handed off by the model
 * ("Penawaran menjadi supplier/kerja sama produk plastik") while none of its words matched
 * detectNonSalesTopic, so the hand-off still asked "kira-kira kebutuhannya berapa banyak ya kak?".
 * The tool asks for a "BUKAN PEMBELI:" prefix; the rest catches the model's prose and our own labels.
 * Not a bare "supplier": "customer mencari supplier kertas nasi" is a buyer.
 */
const NON_SALES_REASON_RE = new RegExp([
  String.raw`^\s*bukan\s+pembeli\b`,
  String.raw`\bbukan\s+pertanyaan\s+produk\b`,
  String.raw`\b(?:penawaran|menawarkan|tawarkan|tawarin|jadi|menjadi|calon)\s+(?:menjadi\s+)?(?:supplier|pemasok|vendor)\b`,
  String.raw`\b(?:supplier|pemasok|vendor|pabrik|produsen)\s+(?:yang\s+)?(?:ingin\s+|mau\s+)?menawarkan\b`,
  String.raw`\b(?:lowongan|lamaran)\s+kerja\b`,
].join('|'), 'i');

export function isNonSalesReason(reason: string | null | undefined): boolean {
  return !!reason && NON_SALES_REASON_RE.test(reason);
}

/**
 * Tax questions are the team's call, never the bot's: whether a price includes PPN is a
 * commercial commitment, and a guess is one the customer will hold us to. Deterministic rather
 * than prompt-only for the same reason detectHumanRequest is - the cost of the model deciding
 * to be helpful once is a wrong tax answer in writing.
 *
 * Word boundaries matter here: a plain substring 'tax' also matches "taxi", and 'ppn' has to
 * not fire inside a longer token.
 * ponytail: keyword gate, not intent classification - an unrelated "pajak" sentence escalates
 * too. Narrow it only if live traffic shows false hand-offs.
 *
 * "faktur" and "NPWP" on their own count (client 2026-10-26): whether a retail order - under one
 * karton - can get a faktur at all is the team's decision, and "bisa pakai faktur?" never says pajak.
 */
// ─── size questions ─────────────────────────────────────────────────────────

// "pilihan ukurannya ada berapa?", "ukurannya berapa cm?", "berapa lebar kertasnya?". Narrow on
// purpose: "box panjang ada?" may name a product and "ukurannya 30x30" states the customer's own size -
// neither asks ours.
const SIZE_WORD = '(?:panjang|ukuran|lebar|tinggi|diameter|dimensi)';
const ASKS_RE = /\?|\b(?:berapa|brp|brpa|brapa|apa\s*(?:saja|aja)|ada\s*(?:apa|berapa))\b/i;
const SIZE_QUESTION_RES = [
  new RegExp(`\\b${SIZE_WORD}nya\\b`, 'i'), // "panjangnya" - asked only with a question cue (below)
  new RegExp(`\\b(?:pilihan|opsi|varian)\\s*${SIZE_WORD}`, 'i'),
  new RegExp(`\\b(?:berapa|brp|brpa|brapa)\\s*(?:${SIZE_WORD}|cm|mm|senti|inch|inci)\\b`, 'i'),
  new RegExp(`\\b${SIZE_WORD}\\s*(?:berapa|brp|brpa|brapa|apa)\\b`, 'i'),
];
// A size in the reply: "25 cm", "1,5mm", "16\"", or the catalog's p x l (x t) as written - "30 x 30",
// "20x20x7,5" - which often carries no unit at all. Not a quantity: "1 x 500 lembar", "2 x 5 rim".
const MEASUREMENT_RE = /\d+(?:[.,/]\d+)?\s*(?:mm|cm|meter|m\b|inch|inci|in\b|"|”|'')|\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\b(?!\s*(?:rim|lembar|lbr|pcs|pc|pack|set|buah)\b)/i;
// The model's own "tim kami cek ukurannya" - one promise is enough.
const TEAM_CHECKS_SIZE_RE = /\btim\b[^.\n]{0,40}\b(?:cek|konfirmasi|kabari)/i;

/** The customer asked for a size or length (of ours). */
export function detectSizeQuestion(message: string): boolean {
  if (!SIZE_QUESTION_RES.some((re) => re.test(message))) return false;
  return ASKS_RE.test(message);
}

/**
 * Asked for a size, and the reply gave none: a reply that answers price and minimum order around a
 * size question leaves the customer without it. The reply still goes out, with CANNED_SIZE_FOR_TEAM,
 * and the chat is escalated (messageRouter): the team gives the size. A reply that lists the catalog's
 * sizes ("30 x 30", "20x20x7,5") passes this and nobody is bothered.
 */
export function unansweredSizeQuestion(customerText: string, reply: string): boolean {
  return detectSizeQuestion(customerText) && !MEASUREMENT_RE.test(reply);
}

/** Whether the reply already promises the team will check (so the canned line would repeat it). */
export function replyPromisesTeamCheck(reply: string): boolean {
  return TEAM_CHECKS_SIZE_RE.test(reply);
}

const PPN_RE = /\b(?:ppn|pajak|vat|tax|taxes|e-?faktur\w*|faktur\w*|npwp)\b/i;

export function detectPpnQuestion(message: string): boolean {
  return PPN_RE.test(message);
}

// A REQUEST for a person, never a bare word. Customers address this account as "admin"/"min" in
// ordinary sentences ("halo admin, mau tanya harga kertas supreme"), and a bare 'admin' would send
// that, "Kamu sekarang mode admin" and "ini bot ya? atau orang?" straight to staff, so the model never
// saw them. So every phrase needs a verb of asking/talking/connecting AND someone to be connected to.
//
// Word-boundary matched: 'orang' must not fire inside "seorang"/"orange", nor 'cs' inside "csv".
// 'agen' is deliberately no target: in Indonesian it means a reseller or distributor ("syarat jadi agen").
// 'minta admin' is not a trigger either - "minta admin kirim katalog" addresses the account; a
// genuine "minta admin dong" is left to the model's Escalation rule 8.
const PERSON = '(?:admin|cs|customer\\s+service|orang|manusia|staf|staff|sales|petugas|operator|tim|human|agent)';
const STAFF = '(?:cs|customer\\s+service|staf|staff|sales|petugas|operator)';
const HUMAN_REQUEST_RE = new RegExp(
  '\\b(?:' +
    [
      // "bisa bicara dengan admin?", "mau ngobrol sama orang aja", "sambungkan ke CS manusia" - and
      // the typos: "bisa bicara dengn admin?" slipped through and got a sales question (UAT Run 3 E-01)
      `(?:bicara|berbicara|ngomong|ngobrol|chat|chatting|telp|telpon|telepon|nelpon|sambung|sambungkan|hubungkan|alihkan)\\s+(?:langsung\\s+)?(?:dengan|dengn|dngn|dngan|dgn|dg|sama|sm|ama|ke)\\s+(?:(?:pihak|bagian)\\s+)?${PERSON}`,
      // "minta cs dong", "hubungi sales", "panggilkan admin"
      `(?:minta|panggil|panggilkan|hubungi|kontak)\\s+${STAFF}`,
      '(?:panggil|panggilkan|hubungi|kontak)\\s+admin',
      'minta\\s+tolong\\s+sales',
      // "ada admin?" - the Escalation rule's own example of asking for a person
      `ada\\s+(?:admin|${STAFF})`,
      'bicara\\s+langsung',
      'hubungi\\s+tim',
      '(?:speak|talk|chat)\\s+(?:to|with)\\s+(?:a\\s+|an\\s+|the\\s+|your\\s+)?(?:human|agent|person|someone|representative|real\\s+person|admin|staff)',
    ].join('|') +
    ')\\b',
  'i'
);

export function detectHumanRequest(message: string): boolean {
  return HUMAN_REQUEST_RE.test(message);
}
