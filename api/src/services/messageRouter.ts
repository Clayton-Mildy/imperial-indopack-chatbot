import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { upsertContact } from '../repositories/contacts.js';
import { upsertConversation, insertMessage, insertMessageIfNew, claimSyncedInbound, resetConversationToActive, resetConversationContext, findConversationById, findMessageByWaMessageId, updateConversationStatus, getLastNMessages, mergeMessageMetadata } from '../repositories/conversations.js';
import { getContactProfile, deleteContactProfile } from '../repositories/contactProfiles.js';
import { resetLeadsForContact, tagNonSalesLead } from '../repositories/leads.js';
import { getFirstPhoneNumber, findPhoneNumberByProviderId } from '../repositories/phoneNumbers.js';
import { getAiEnabledDefault, getPoFormUrl } from '../repositories/appSettings.js';
import { CANNED_COMPLAINT_REPLY, CANNED_NON_SALES_REPLY, CANNED_TOTAL_FOR_TEAM, CANNED_SIZE_FOR_TEAM, PHOTO_UNSURE_REASON, CANNED_PHOTO_CHECK_REPLY, CANNED_IMAGE_UNREADABLE_REPLY, CANNED_STILL_CHECKING_REPLY, CANNED_UNSUPPORTED_MEDIA_REPLY, CANNED_UNSUPPORTED_OTHER_REPLY, ESCALATION_FOLLOWUP_ACKS, MAX_CONTEXT_MESSAGES, poFormMessage, PO_FORM_PLACEHOLDER_URL, CANNED_PO_FORM_FROM_TEAM, CANNED_DESIGN_EXAMPLES_FROM_TEAM } from '../domain/constants.js';
import { buildContextAndCallAI } from './aiLayer.js';
import { resolveCatalogDelivery, isPriceRequest, asksForPriceList, forgetSentPriceLists } from './catalogDelivery.js';
import { extractCatalogKeywordsFromImage, visionExtractToKeywords, type VisionExtract } from './visionKeywords.js';
import { matchCustomerPhoto, photoBatchNote, photoHistoryNote, photoLine, captionOf, type PhotoMatch } from './photoMatch.js';
import { escalateConversation, detectComplaint, detectNonSalesTopic, detectHumanRequest, detectPpnQuestion, isNonSalesHandoff, isNonSalesReason, pickProfileGapQuestion, unansweredSizeQuestion, replyPromisesTeamCheck } from './escalationHandler.js';
import { sendTextMessage, sendDocumentMessage, sendImageMessage } from './whatsappSender.js';
import { recordOutboundMedia } from './outboundMedia.js';
import { saveConversationInsights } from './conversationInsights.js';
import { recordLeadFromMessage } from './leadMatcher.js';
import { syncContactChat } from './chakraSync.js';
import type { BaileysInboundPayload } from '../domain/schemas.js';
import type { AIResponse, PhoneNumber, PromptSections } from '../domain/types.js';
import { notifyStaff } from './staffNotify.js';
import { mergeOrderFacts, orderDetailsSummary } from '../domain/orderProfile.js';
import { claudeTokensExhausted } from './claude.js';
import { getConfig } from '../config.js';

// Quiet window before a batch of texts is answered. 4s was shorter than how people actually type
// on WhatsApp - a line, a pause to think, another line - so ordinary bursts landed in separate
// windows and each earned its own reply. This is a tuning knob for real human timing, not a
// constant: raise it if customers still get several replies to one burst, lower it if a single
// message feels slow to answer. Env-settable so it can be changed without a rebuild.
const TYPING_DEBOUNCE_MS = Number(process.env.TYPING_DEBOUNCE_MS ?? 8000);

// Optional shorter window for the FIRST message of a batch: a second message arriving
// inside it re-arms to the full TYPING_DEBOUNCE_MS via nextDebounceWait(), so bursts still
// merge — only the lone-message case answers sooner. OFF by default (defaults to the full
// window): shortening it means a customer pausing between the two values gets two replies
// instead of one merged one, which changes what the AI answers. Opt in via .env.
const TYPING_DEBOUNCE_FIRST_MS = Math.min(
  Number(process.env.TYPING_DEBOUNCE_FIRST_MS ?? TYPING_DEBOUNCE_MS),
  TYPING_DEBOUNCE_MS // the first message's window must never exceed the batch window
);

// A pure trailing debounce never fires while someone keeps typing: every message re-arms the
// window, so a customer sending a line every few seconds is answered only once they stop - and
// someone spamming is answered never. These bound the batch; whichever is hit first wins.
const TYPING_DEBOUNCE_MAX_WAIT_MS = Number(process.env.TYPING_DEBOUNCE_MAX_WAIT_MS ?? 30000);
const TYPING_DEBOUNCE_MAX_MESSAGES = Number(process.env.TYPING_DEBOUNCE_MAX_MESSAGES ?? 20);

// Poll interval while another turn holds the conversation. This is a retry, not a quiet window,
// so it must not grow with TYPING_DEBOUNCE_MS - otherwise a longer window also delays every
// batch that had to queue behind a running turn.
const INFLIGHT_RETRY_MS = 1000;

// Quiet window before photos are answered. WhatsApp delivers an album as one webhook per photo, each
// after its own media download, so photos picked together arrive seconds apart. Live 2026-10-25 five
// screenshots sent as one request were five turns, answered one by one over 18 minutes. Short: the
// per-photo vision and comparison calls run during it, and a lone photo waits no longer than that.
// A photo arriving while the batch is being answered is folded in too (see runPhotoTurn).
const PHOTO_DEBOUNCE_MS = Number(process.env.PHOTO_DEBOUNCE_MS ?? 5000);

// A webhook this long after the WhatsApp send time was delivered late (host asleep or frozen,
// tunnel down, or the sender retrying) - see the delivery note in routeInboundBaileysMessage.
const LATE_DELIVERY_MS = 2 * 60_000;

// "Pesan ini belum bisa aku buka" is said once per burst of unreadable messages, not once per
// message: live 2026-10-06 two such events a second apart drew the same line twice in a row.
// Keyed by conversation AND reply, so a voice note after a sticker still gets its own line.
const UNSUPPORTED_REPLY_COOLDOWN_MS = 5 * 60_000;
const unsupportedRepliedAt = new Map<string, number>();

interface TextDebounceEntry {
  timer: ReturnType<typeof setTimeout>;
  /** When this batch opened - the anchor for TYPING_DEBOUNCE_MAX_WAIT_MS. */
  firstAt: number;
  texts: string[];
  /** Each text's WhatsApp send time (epoch seconds, 0 = unknown), parallel to `texts` - see /new. */
  sentAt: number[];
  sendReply: (text: string) => Promise<string | null>;
  escalationJid: string;
  /** Resolved once at enqueue time so escalation doesn't re-query it. */
  phoneNumber: PhoneNumber;
  conversationId: string;
  promptSections: PromptSections | null;
  quotedWaMessageId: string | null;
  sendDoc?: (path: string, filename: string) => Promise<void>;
  /** Resolves to the wamid; the caller stores the row after the reply's, so the thread keeps send order. */
  sendImage?: (url: string) => Promise<string>;
  /** Carries a batch whose draft was already thrown away once - see supersedeStaleTurn. */
  superseded?: boolean;
}

/** One customer photo, waiting with the others sent alongside it. */
interface PhotoItem {
  body: string;
  /** WhatsApp send time, epoch seconds (0 = unknown) - the photos' order, and /new's floor. */
  sentAt: number;
  quotedWaMessageId: string | null;
  imageData: { base64: string; mimeType: string };
  nonSales: string | null;
  keywords: Promise<string[]>;
  match: Promise<PhotoMatch | null>;
  /** Filled when the vision step returns, never waited for (see the arrival code). */
  seen: { chatText: string };
}

interface PhotoBatch {
  timer: ReturnType<typeof setTimeout>;
  firstAt: number;
  items: PhotoItem[];
  conversationId: string;
  contactWaId: string;
  replyJid: string;
  phoneNumber: PhoneNumber;
  /** Carries photos whose draft was already thrown away once - see runPhotoTurn. */
  superseded?: boolean;
}

const photoBatchMap = new Map<string, PhotoBatch>();

// Resolve a quoted message's wamid to its original text (null if not found/stored).
// A miss is logged rather than swallowed: it is the one signal that separates "the customer
// quoted something we never stored" from "no quote arrived at all" (see logQuoteContext in
// routes/webhooks.ts), and without it the whole quoted-reply path is invisible in prod.
async function resolveQuotedBody(quotedWaMessageId: string | null | undefined): Promise<string | null> {
  if (!quotedWaMessageId) return null;
  const quoted = await findMessageByWaMessageId(quotedWaMessageId);
  if (!quoted) {
    console.warn(`[messageRouter] quoted message ${quotedWaMessageId} not found - replying without its context`);
    return null;
  }
  return quoted.body ?? null;
}

const textDebounceMap = new Map<string, TextDebounceEntry>();

// Bumped by /new. A turn remembers the value it started under and drops its reply if it changed:
// before this, a batch buffered or in flight when the tester sent /new was answered after the
// "Konteks direset" ack, without its context (UAT Run 2: "/halo" answered after the reset).
const resetGeneration = new Map<string, number>();
const generationOf = (conversationId: string): number => resetGeneration.get(conversationId) ?? 0;

/**
 * /new forgets what came before it, including texts still waiting in the debounce. By send time,
 * not arrival: a text typed just after the /new can be delivered first, and must survive.
 */
function dropBufferedBefore(conversationId: string, floorSec: number): void {
  const photos = photoBatchMap.get(conversationId);
  if (photos) {
    photos.items = photos.items.filter((i) => i.sentAt > floorSec);
    if (photos.items.length === 0) {
      clearTimeout(photos.timer);
      photoBatchMap.delete(conversationId);
    }
  }
  const pending = textDebounceMap.get(conversationId);
  if (!pending) return;
  const keep = pending.sentAt.map((t, i) => (t > floorSec ? i : -1)).filter((i) => i >= 0);
  if (keep.length === 0) {
    clearTimeout(pending.timer);
    textDebounceMap.delete(conversationId);
    return;
  }
  pending.texts = keep.map((i) => pending.texts[i]!);
  pending.sentAt = keep.map((i) => pending.sentAt[i]!);
}

/**
 * How long to wait after the latest message before answering the batch: the quiet window, but
 * never past the cap since the batch opened, and fired at once when the batch is already large
 * enough that one more line cannot change the answer.
 */
function nextDebounceWait(entry: Pick<TextDebounceEntry, 'firstAt' | 'texts'>): number {
  if (entry.texts.length >= TYPING_DEBOUNCE_MAX_MESSAGES) return 0;
  const remainingCap = TYPING_DEBOUNCE_MAX_WAIT_MS - (Date.now() - entry.firstAt);
  return Math.max(0, Math.min(TYPING_DEBOUNCE_MS, remainingCap));
}

/**
 * The model handed off over tax. The customer's words may not say so - live 2026-10-26 the faktur
 * question was only in a screenshot - but the reason the model writes for the team does, and a tax
 * hand-off asks no sales question (client 2026-10-26: "langsung lempar ke tim tanpa pertanyaan").
 */
function taxHandoff(r: AIResponse): boolean {
  return r.confidence === 'low' && detectPpnQuestion(r.escalationReason ?? '');
}

/**
 * Not a buyer at all - a supplier, a job seeker, a courier - by the customer's words, by the model's
 * own hand-off reason, or by the reason the chat was already handed off for: no sales question on the
 * hand-off or any ack after it, and the plain hand-off line (live 2026-10-31: a plastics factory was
 * handed off by the model and still asked "kira-kira kebutuhannya berapa banyak ya kak?").
 */
function notABuyer(nonSales: string | null, r: AIResponse, conv: { status: string; escalationReason: string | null }): boolean {
  return !!nonSales
    || (r.confidence === 'low' && isNonSalesReason(r.escalationReason))
    || (conv.status === 'escalated' && isNonSalesReason(conv.escalationReason));
}

// The still-checking ack, and the ONLY thing an 'escalated' status changes about a reply. It
// fires when the AI has no answer to send at all, and exists so an already-escalated
// conversation doesn't raise a second hand-off - escalation notifies a human, it does not gag
// the bot. Carries the same profile-gap question escalateConversation asks, so a hand-off that
// spans several turns keeps collecting what the team will need instead of repeating one line
// (live: five byte-identical acks over twenty hours, while the customer asked "kok lama ya").
// askProfileGap: false for the same reason escalateConversation does it - tacking a sales
// question onto a reply to "minta CS" reads as the bot ignoring the request and selling on.
// forTeam: this turn raised something only the team can answer (PPN, asking for a person) - say
// so, rather than a bare "noted" (UAT Run 2 E-02: a PPN question got "semuanya sudah saya catat").
async function stillCheckingReply(conversationId: string, contactId: string, askProfileGap: boolean, forTeam = false): Promise<string> {
  const [profile, recent] = await Promise.all([
    askProfileGap ? getContactProfile(contactId).catch(() => null) : Promise.resolve(null),
    getLastNMessages(conversationId, MAX_CONTEXT_MESSAGES).catch(() => []),
  ]);
  const lead = forTeam ? CANNED_STILL_CHECKING_REPLY : nextAck(recent);

  if (!askProfileGap) return lead;
  // pickProfileGapQuestion also stays silent after a complaint or job enquiry anywhere in `recent`.
  const gap = pickProfileGapQuestion(profile, recent);
  return gap ? `${lead} ${gap}` : lead;
}

// The customer's own messages of the last day, for detectNonSalesTopic's `earlier`: a supplier says
// what it makes in one message and what it wants a few minutes later (live 2026-10-31). Includes the
// current batch when it is already stored, which is harmless - the batch is checked as well.
const EARLIER_WINDOW_MS = 24 * 60 * 60 * 1000;

async function earlierCustomerText(conversationId: string): Promise<string> {
  const recent = await getLastNMessages(conversationId, MAX_CONTEXT_MESSAGES).catch(() => []);
  const since = Date.now() - EARLIER_WINDOW_MS;
  // A row without a usable time counts as recent: a detector must never throw and cost the turn.
  const recentEnough = (m: { createdAt?: Date | string | null }): boolean => !m.createdAt || !(new Date(m.createdAt).getTime() < since);
  return recent.filter((m) => m.role === 'user' && recentEnough(m)).map((m) => m.body).join('\n');
}

const ACK_SOURCES = new Set(['escalation', 'escalation_ack']);

/**
 * The line after the last ack sent, so two acks in a row never read the same. Right after the
 * hand-off (or with no hand-off row in view) it restates the hand-off once - a customer who writes
 * again immediately may not have registered it - and after that it only acknowledges.
 *
 * Read off the newest hand-off/ack row rather than counted. The old count covered every such row
 * the conversation ever had, across /new, so from the first follow-up on the ack was pinned on
 * the list's last line (UAT Run 2: "Baik kak, semuanya sudah saya catat ya." seven times in a row,
 * twice 8 s apart); and a count taken inside the 20-row window stops moving once the hand-off row
 * scrolls out of it.
 */
function nextAck(recent: { body: string; metadata?: Record<string, unknown> | null }[]): string {
  const last = [...recent].reverse().find((m) => ACK_SOURCES.has(String(m.metadata?.source)));
  if (!last || last.metadata?.source === 'escalation') return CANNED_STILL_CHECKING_REPLY;
  const i = ESCALATION_FOLLOWUP_ACKS.findIndex((ack) => last.body.startsWith(ack));
  return ESCALATION_FOLLOWUP_ACKS[(i + 1) % ESCALATION_FOLLOWUP_ACKS.length]!;
}

// The model may still have written its own version of the line; one is enough.
const TEAM_CALCULATES_RE = /\btim\b[^.\n]{0,40}\bhitung/i;

/**
 * What the reply leaves to the team: a total over several items (the model's totalForTeam), a size
 * the customer asked for that the reply does not give (unansweredSizeQuestion - the catalog has no size
 * for most products), and design examples for a product with no reference photos (examplesForTeam).
 * Each is a fixed line (under the reply, or after it for the examples) and a reason on the hand-off.
 */
interface TeamFollowUp {
  total: boolean;
  size: boolean;
  /** The PO form the team sends by hand (poFormToSend's reason), or null. */
  poForm?: string | null;
  /** The team sends design examples: CANNED_DESIGN_EXAMPLES_FROM_TEAM follows the reply and its photos. */
  examples?: boolean;
}

function teamFollowUp(r: AIResponse, customerText: string, po?: { teamReason: string | null } | null): TeamFollowUp {
  return {
    total: Boolean(r.totalForTeam), size: unansweredSizeQuestion(customerText, r.message),
    poForm: po?.teamReason ?? null, examples: Boolean(r.examplesForTeam),
  };
}

/**
 * The team's promise of design examples, and of the PO form while its link is not set, is not made
 * twice for one hand-off: while the chat is still escalated and no staff message came after the same
 * fixed line, the team has been told and the customer has read it, so this turn neither repeats the
 * line nor hands off again for it. Once the team has answered (a staff message after the line) or set
 * the chat back to active, a new agreement or a new examples request is a new job: the line goes out
 * and the chat is handed off again. Read only when one of those lines is due, so most turns cost no
 * extra query.
 */
async function onceOnlyFollowUp(
  conv: { id: string; status: string }, r: AIResponse, customerText: string
): Promise<{ followUp: TeamFollowUp; poForm: PoFormLine | null }> {
  let poForm = r.sendPoForm ? await poFormToSend() : null;
  const due = [
    r.examplesForTeam ? CANNED_DESIGN_EXAMPLES_FROM_TEAM : null,
    poForm?.teamReason ? poForm.body : null,
  ].filter((line): line is string => line !== null);
  const sent = due.length > 0 && conv.status === 'escalated' ? await linesStillPending(conv.id, due) : new Set<string>();
  if (poForm && sent.has(poForm.body)) poForm = null;
  const followUp = teamFollowUp(r, customerText, poForm);
  if (sent.has(CANNED_DESIGN_EXAMPLES_FROM_TEAM)) followUp.examples = false;
  return { followUp, poForm };
}

/**
 * Which of `lines` a recent bot message already is with no staff message after it - the promise the
 * team has not answered yet. A failed read sends them: a repeat beats a lost promise.
 */
async function linesStillPending(conversationId: string, lines: string[]): Promise<Set<string>> {
  const recent = await getLastNMessages(conversationId, MAX_CONTEXT_MESSAGES).catch(() => []);
  const pending = new Set<string>();
  // Oldest first: a staff reply clears every promise before it.
  for (const m of recent) {
    if (m.role !== 'assistant') continue;
    if (m.senderName) pending.clear();
    else if (lines.includes(m.body.trim())) pending.add(m.body.trim());
  }
  return pending;
}

const DESIGN_EXAMPLES_REASON = 'Contoh desain diminta - pelanggan belum punya desain dan produknya belum punya foto contoh, mohon kirimkan contoh desain';

/**
 * A hand-off turn sends no examples line - the team now has the chat - but a design-examples request
 * made on it still reaches them: without this the flag was dropped with the rest of the reply.
 */
function withExamplesAsked(reason: string, r: AIResponse): string {
  return r.examplesForTeam ? `${reason}; ${DESIGN_EXAMPLES_REASON}` : reason;
}

/** Anything in the follow-up the team has to act on. */
const needsTeam = (f: TeamFollowUp): boolean => f.total || f.size || Boolean(f.poForm) || Boolean(f.examples);

/** The reply as sent: the model's answer, plus the team's promise for each thing it left to them. */
function replyText(r: AIResponse, f: TeamFollowUp = { total: Boolean(r.totalForTeam), size: false }): string {
  const lines = [r.message];
  if (f.total && !TEAM_CALCULATES_RE.test(r.message)) lines.push(CANNED_TOTAL_FOR_TEAM);
  if (f.size && !replyPromisesTeamCheck(r.message)) lines.push(CANNED_SIZE_FOR_TEAM);
  return lines.join('\n\n');
}

/**
 * A total over several items is the team's to calculate (owner, 2026-10-27), and so is a size the
 * catalog does not have (client 2026-11-11), and so is the PO form while its link is not set. The reply
 * that answered the rest also hands the chat to them - the canned line is a promise, and an escalation
 * is what makes someone keep it (it is also what the nudge reminds them of).
 */
async function handToTeam(conv: { id: string; status: string; contactId: string }, text: string, f: TeamFollowUp): Promise<void> {
  const reason = [
    f.total ? 'Pelanggan minta total harga - harga per item sudah dikirim, total keseluruhan mohon dihitung tim' : '',
    f.size ? 'Pelanggan menanyakan ukuran/panjang yang tidak ada di data katalog - mohon diinfokan tim' : '',
    f.poForm ?? '',
    f.examples ? DESIGN_EXAMPLES_REASON : '',
  ].filter(Boolean).join('; ');
  await updateConversationStatus(conv.id, 'escalated', reason)
    .catch((err) => console.warn('[messageRouter] team hand-off status failed:', err instanceof Error ? err.message : err));
  // Same six order details escalateConversation gives staff.
  const profile = await getContactProfile(conv.contactId).catch(() => null);
  const summary = orderDetailsSummary(mergeOrderFacts({}, profile?.profile ?? {}));
  notifyStaff({
    title: conv.status === 'escalated' ? 'Pelanggan menunggu balasan' : 'Eskalasi baru',
    body: `${reason}: ${text.slice(0, 120)}${summary ? `\n${summary}` : ''}`,
    path: `/conversations/${conv.id}`,
  });
}

// No Claude subscription token can answer: owner, 2026-11-03, "when there's no token left the bot should
// die". From 2026-11-02 every token was spent or revoked, and every message got "Kita coba cek dengan tim
// dulu ya kak" plus a sales question - a hand-off nobody decided on, for every chat until the tokens came
// back. Now that turn sends nothing, saves no reply and changes no status; staff get one push per chat per
// half hour, so someone answers by hand. Any other AI failure still hands off as before.
const NO_CLAUDE_ALERT_MS = 30 * 60_000;
const noClaudeAlertedAt = new Map<string, number>();

function silentWithoutClaude(conversationId: string, text: string): boolean {
  if (!claudeTokensExhausted()) return false;
  console.warn(`[messageRouter] no Claude token can answer - staying silent for ${conversationId}`);
  const last = noClaudeAlertedAt.get(conversationId);
  if (last === undefined || Date.now() - last >= NO_CLAUDE_ALERT_MS) {
    noClaudeAlertedAt.set(conversationId, Date.now());
    notifyStaff({
      title: 'AI tidak aktif - mohon balas manual',
      body: `Semua token Claude habis atau ditolak. Pesan pelanggan: ${text.slice(0, 140)}`,
      path: `/conversations/${conversationId}`,
    });
  }
  return true;
}

// Escalation notifies; it does not gag the bot, so an escalated chat still gets real answers. The
// team working the hand-off (a RAB, a discount) still has to see what the customer keeps saying -
// which used to reach them only because every such turn used to end in an ack.
function notifyEscalatedTurnAnswered(conversationId: string, text: string): void {
  notifyStaff({
    title: 'Pesan baru - percakapan dieskalasi',
    body: text.slice(0, 180),
    path: `/conversations/${conversationId}`,
  });
}

/**
 * The customer wrote again while this turn's reply was being written, so the draft answers a
 * conversation that has moved on: a reply asking "untuk jualan apa kak?" a moment after the customer
 * had typed "untuk nasi padang kak" reads as not listening. Nothing has been sent
 * yet, so drop the draft and fold this batch into the waiting one: the next turn answers everything
 * at once (its texts, not just the new ones, so detectHumanRequest and the PPN gate still see them).
 *
 * At most once per batch - otherwise someone who keeps typing never gets an answer. Not after
 * catalog files went out: the re-run would detect the same request and send them again.
 * ponytail: costs a second AI call each time it fires; watch the usage log if bursts are common.
 */
function supersedeStaleTurn(entry: TextDebounceEntry, filesSent: boolean): boolean {
  if (entry.superseded || filesSent) return false;
  const pending = textDebounceMap.get(entry.conversationId);
  if (!pending) return false;
  pending.texts = [...entry.texts, ...pending.texts];
  pending.sentAt = [...entry.sentAt, ...pending.sentAt];
  pending.quotedWaMessageId ??= entry.quotedWaMessageId;
  pending.superseded = true;
  console.log(`[messageRouter] customer wrote again during the turn for ${entry.conversationId} - dropping the draft, answering both batches together`);
  return true;
}

// Staff type replies on the WhatsApp phone, and those reach us only through Chakra's sync - so each
// reply first pulls this one chat (chakraSync.syncContactChat), or the bot answers over a teammate it
// cannot see (live 2026-10-12). Capped: a slow Chakra must cost the reply nothing but that context.
const STAFF_SYNC_TIMEOUT_MS = 5_000;

async function catchUpStaffReplies(waId: string, conversationId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const added = await Promise.race([
    syncContactChat(waId).catch((err) => {
      console.warn('[messageRouter] staff sync failed:', err instanceof Error ? err.message : err);
      return 0;
    }),
    new Promise<number>((resolve) => { timer = setTimeout(() => resolve(-1), STAFF_SYNC_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
  if (added > 0) console.log(`[messageRouter] ${added} message(s) from staff synced into ${conversationId} before replying`);
  if (added === -1) console.warn(`[messageRouter] staff sync for ${conversationId} took over ${STAFF_SYNC_TIMEOUT_MS / 1000}s - replying without waiting`);
}

// Conversations with an AI turn currently in flight. AI latency (~30s) far exceeds the
// debounce window, so without this two messages a few seconds apart would spawn concurrent
// turns that neither see each other's reply — the source of duplicate/contradicting replies.
const inFlightConversations = new Set<string>();

async function fireTextDebounce(conversationId: string): Promise<void> {
  const entry = textDebounceMap.get(conversationId);
  if (!entry) return;

  // Serialize per conversation: if a turn is already running, defer this batch (keep
  // accumulating in entry.texts) so the next turn sees the latest reply/status.
  if (inFlightConversations.has(conversationId)) {
    entry.timer = setTimeout(() => { fireTextDebounce(conversationId).catch((err) => console.error('[messageRouter] debounce fire error:', err)); }, INFLIGHT_RETRY_MS);
    return;
  }

  textDebounceMap.delete(conversationId);
  // Same synchronous step that takes the batch: a /new landing during any await below must count.
  const generation = generationOf(conversationId);
  inFlightConversations.add(conversationId);
  try {
    // Before the status check: an inbox reply marks a takeover, and the bot must see it first.
    await catchUpStaffReplies(entry.escalationJid, conversationId);
    const conv = await findConversationById(conversationId);
    if (!conv) return;
    const humanStatuses = ['needs_human', 'resolved'];
    if (humanStatuses.includes(conv.status) || conv.assignedAgent !== null) return;

    const combinedText = entry.texts.join('\n');
    // Not about buying (courier, job seeker, payment/order follow-up, supplier) - to the team as it is,
    // no AI call, no sales question, and no price list: a courier's "berapa ongkirnya" is not a price
    // question. See detectNonSalesTopic.
    const nonSales = detectNonSalesTopic(combinedText, await earlierCustomerText(conversationId));

    // The brand price lists are keyword-triggered and independent of the AI: a price question, or a
    // request for the list itself (which also resends one already sent, and goes even for a priced
    // item). The sends are fire-and-forget - resolving them BEFORE the call is what lets the reply
    // and the attachments agree, via `catalogNote`. Which brand's file, if any, is catalogDelivery's rule.

    let catalogNote: string | null = null;
    let filesSent = false;
    const fileAsked = detectCatalogRequest(combinedText) || asksForPriceList(combinedText);
    if (!nonSales && (fileAsked || isPriceRequest(combinedText))) {
      const delivery = await resolveCatalogDelivery(conv.contactId, combinedText, { explicit: fileAsked });
      catalogNote = delivery.note;
      filesSent = delivery.files.length > 0;
      for (const f of delivery.files) {
        void Promise.resolve(entry.sendDoc?.(f.url, f.filename)).catch((err) =>
          console.warn('[messageRouter] Failed to send catalog:', err instanceof Error ? err.message : err)
        );
      }
    }

    const quotedBody = await resolveQuotedBody(entry.quotedWaMessageId);

    // A thrown AI call (timeout, API error) used to be logged-and-silent — the one outcome
    // a customer can't tell apart from being ignored. Fold it into the low-confidence flow
    // below, which already knows how to escalate or ack per conversation status.
    let aiResponse: AIResponse;
    try {
      aiResponse = nonSales
        ? { message: '', confidence: 'low', escalationReason: `${nonSales} - bukan pertanyaan produk` }
        : await buildContextAndCallAI(
          conversationId, combinedText, entry.promptSections, [], null, quotedBody,
          { catalogNote }
        );
    } catch (err) {
      if (silentWithoutClaude(conversationId, combinedText)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[messageRouter] AI call failed → escalating:', msg);
      aiResponse = { message: '', confidence: 'low', escalationReason: `AI call failed: ${msg}` };
    }
    // Nothing of this turn may land after a /new: no reply, no hand-off, no profile facts.
    if (generationOf(conversationId) !== generation) {
      console.log(`[messageRouter] /new during the turn for ${conversationId} - dropping its reply`);
      return;
    }
    // Before anything is sent, saved or escalated: the next turn decides all of that afresh.
    if (supersedeStaleTurn(entry, filesSent)) return;

    // The model judged this a bare acknowledgement ("baik kak", "terima kasih") with nothing to add.
    // Its own call, via the tool's no_reply - not a keyword list here. Nothing is sent and the team is
    // not pinged, but this turn's profile facts still count. Unless a human request or a tax question
    // is in the same message, which hand off whatever the model decided.
    if (aiResponse.noReply && !detectHumanRequest(combinedText) && !detectPpnQuestion(combinedText)) {
      console.log(`[messageRouter] model chose no reply for ${conversationId} (acknowledgement only)`);
      saveConversationInsights(conversationId, conv.contactId, aiResponse).catch(() => { });
      return;
    }

    const humanRequested = detectHumanRequest(combinedText);
    // A tax question hands off even when the model was confident it could answer — see
    // detectPpnQuestion.
    const ppnAsked = detectPpnQuestion(combinedText);
    // A complaint never escalates by itself (the model decides that), it only drops the sales
    // question from the hand-off and opens with an apology - see detectComplaint.
    const complaint = detectComplaint(combinedText);
    // No sales question for someone who asked for a person, a complaint, a job seeker, or a tax
    // question - the model's own hand-off reason included (taxHandoff).
    const notBuyer = notABuyer(nonSales, aiResponse, conv);
    const askGap = !humanRequested && !isNonSalesHandoff(combinedText) && !notBuyer && !ppnAsked && !taxHandoff(aiResponse);
    if (aiResponse.confidence === 'low' || humanRequested || ppnAsked || !aiResponse.message) {
      // Save this turn's profile facts BEFORE escalating: the hand-off question reads the
      // profile and must not re-ask something the customer said in this very message.
      await saveConversationInsights(conversationId, conv.contactId, aiResponse).catch(() => { });
      if (nonSales) void tagNonSalesLead(conv.contactId, nonSales).catch((err) => console.error('[leads] tag non-sales failed:', err));
      const reason = withExamplesAsked(aiResponse.escalationReason
        ?? (ppnAsked ? 'Pertanyaan PPN/pajak — kebijakan pajak hanya dari tim' : 'Low confidence'), aiResponse);
      // Already handed to the team — no second escalation, but never dead silence either:
      // the customer asked something new and a human CS would at least acknowledge it.
      if (conv.status === 'escalated') {
        console.warn(`[messageRouter] escalated conversation ${conversationId}: low-confidence turn → still-checking ack`);
        // Keep the banner on THIS turn's reason. Without it the team reads whatever first
        // escalated the conversation - live, a price objection sat on the banner of a
        // conversation that had moved on to another product eighteen days earlier.
        await updateConversationStatus(conversationId, 'escalated', reason)
          .catch((err) => console.warn('[messageRouter] escalated-status refresh failed:', err instanceof Error ? err.message : err));
        // The hand-off notification only fires once, on the first escalation - but the
        // customer keeps talking, and those messages are the ones a waiting CS most needs to
        // see. Without this the team learns nothing until someone opens the dashboard.
        notifyStaff({
          title: 'Pelanggan menunggu balasan',
          body: combinedText.slice(0, 180),
          path: `/conversations/${conversationId}`,
        });
        const ack = await stillCheckingReply(conv.id, conv.contactId, askGap, humanRequested || ppnAsked);
        let ackId: string | null = null;
        try { ackId = await entry.sendReply(ack); } catch { /* recorded below as 'saved' */ }
        await insertMessage({ conversationId, role: 'assistant', body: ack, waMessageId: ackId || undefined, status: ackId ? 'sent' : 'saved', metadata: { source: 'escalation_ack' } as Record<string, unknown> });
        return;
      }
      // Someone who just asked for a human gets the hand-off line only, no sales question.
      await escalateConversation(
        conv, reason, entry.escalationJid, askGap, entry.phoneNumber,
        complaint ? CANNED_COMPLAINT_REPLY : notBuyer ? CANNED_NON_SALES_REPLY : undefined
      );
      return;
    }

    // Again, right before sending: the first check runs as the AI call returns, and a message that
    // lands during the escalation checks and staff sync above was missed (live 2026-11-08: "Dengan Rudi
    // ka" typed as a reply about Malang was being sent, which then asked the name again).
    if (supersedeStaleTurn(entry, filesSent)) return;
    const { followUp, poForm } = await onceOnlyFollowUp(conv, aiResponse, combinedText);
    if (needsTeam(followUp)) await handToTeam(conv, combinedText, followUp);
    else if (conv.status === 'escalated') notifyEscalatedTurnAnswered(conversationId, combinedText);
    const reply = replyText(aiResponse, followUp);
    let sentId: string | null = null;
    try { sentId = await entry.sendReply(reply); } catch { /* ignore */ }
    // After the text: the reference photos in order, the team's design-examples promise, then the PO
    // form link (or the team's promise).
    const photos = await sendReferencePhotos(aiResponse.imageUrls, async (url) => (await entry.sendImage?.(url)) ?? null);
    const examplesSent = followUp.examples ? await sendFixedLine(CANNED_DESIGN_EXAMPLES_FROM_TEAM, 'design_examples', (text) => entry.sendReply(text)) : null;
    const poSent = poForm ? await sendFixedLine(poForm.body, 'po_form', (text) => entry.sendReply(text)) : null;
    if (aiResponse.catalogUrl) {
      // The model spotted a price-list request the keywords missed (say, the answer to "barang apa
      // yang mau dikemas?"), or learned this turn the brand the keyword path did not know yet. Send
      // the real file - never the model-provided URL (closed catalog). Same rule as the keyword
      // path, never explicit: the once-per-brand record keeps what that path just sent from going
      // twice. It runs after the reply, so the brands and items given in this very message count.
      const delivery = await resolveCatalogDelivery(conv.contactId, combinedText, {
        explicit: false,
        fresh: { facts: aiResponse.profileUpdate },
      });
      for (const f of delivery.files) {
        void Promise.resolve(entry.sendDoc?.(f.url, f.filename)).catch((err) =>
          console.warn('[messageRouter] Failed to send catalog:', err instanceof Error ? err.message : err)
        );
      }
    }
    // Rows in send order, so the thread reads as the customer saw it.
    await insertMessage({ conversationId, role: 'assistant', body: reply, waMessageId: sentId || undefined, status: sentId ? 'sent' : 'saved' });
    await recordAfterReply(conversationId, photos, [examplesSent, poSent]);
    saveConversationInsights(conversationId, conv.contactId, aiResponse).catch(() => { });
  } finally {
    inFlightConversations.delete(conversationId);
  }
}

/** The quiet window after the latest photo, capped from the first like the text batch. */
function nextPhotoWait(batch: Pick<PhotoBatch, 'firstAt'>): number {
  const remainingCap = TYPING_DEBOUNCE_MAX_WAIT_MS - (Date.now() - batch.firstAt);
  return Math.max(0, Math.min(PHOTO_DEBOUNCE_MS, remainingCap));
}

async function firePhotoBatch(conversationId: string): Promise<void> {
  const batch = photoBatchMap.get(conversationId);
  if (!batch) return;
  // Serialize with other turns via inFlightConversations (same defer pattern as fireTextDebounce).
  // Without this, a photo arriving while a text turn is in flight spawns a concurrent AI call whose
  // context lacks the other turn's reply - the bot then greets/asks the customer's name twice. The
  // batch stays in the map meanwhile, so photos still arriving join it.
  // has→add must stay synchronous (no await between them) or two turns can pass.
  if (inFlightConversations.has(conversationId)) {
    batch.timer = setTimeout(() => { firePhotoBatch(conversationId).catch((err) => console.error('[messageRouter] photo turn error:', err)); }, INFLIGHT_RETRY_MS);
    return;
  }
  photoBatchMap.delete(conversationId);
  // Same synchronous step that takes the batch: a /new landing during any await below must count.
  const generation = generationOf(conversationId);
  inFlightConversations.add(conversationId);
  try {
    await runPhotoTurn(batch, generation);
  } finally {
    inFlightConversations.delete(conversationId);
  }
}

/**
 * Why the photos cannot be answered by the bot, or null when every one is a confirmed match. Client
 * 2026-11-11: "klu tidak bisa menangkap itu gambar apa, tolong diprioritaskan lempar ke human. Tp klu AI
 * yakin itu gambar apa, dan sesuai dg punya kita, bru bisa tawarkan." Only a "same" verdict is that
 * certainty. A "mirip" used to become "apakah yang dimaksud X?", and no verdict at all (nothing to compare,
 * a timeout, a failed call) or "none" left the model to judge the photo from the catalog by itself -
 * which is how a customer's photo got an unrelated product offered.
 */
function photoUnsureReason(matches: (PhotoMatch | null)[]): string | null {
  const why = matches.map((m, i) => {
    const tag = matches.length > 1 ? `foto ${i + 1}: ` : '';
    if (m?.certainty === 'same' && m.product) return null;
    if (m?.certainty === 'similar' && m.product) return `${tag}mirip ${m.product.name}, belum pasti`;
    if (m) return `${tag}tidak sama dengan foto produk yang dibandingkan`;
    return `${tag}tidak ada hasil perbandingan foto`;
  }).filter((w): w is string => w !== null);
  return why.length > 0 ? why.join('; ') : null;
}

async function runPhotoTurn(batch: PhotoBatch, generation: number): Promise<void> {
  const { conversationId, phoneNumber, replyJid } = batch;
  // In the order they were sent: webhooks for an album do not arrive in order.
  const items = [...batch.items].sort((a, b) => a.sentAt - b.sentAt);
  const images = items.length === 1 ? items[0]!.imageData : items.map((i) => i.imageData);
  // One photo keeps its own body (caption or placeholder); several are one message of their captions.
  const body = items.length === 1
    ? items[0]!.body
    : items.map((i) => captionOf(i.body)).filter(Boolean).join('\n') || items[0]!.body;
  const nonSales = items.map((i) => i.nonSales).find(Boolean) ?? null;
  const quotedWaMessageId = [...items].reverse().map((i) => i.quotedWaMessageId).find(Boolean) ?? null;

  await catchUpStaffReplies(batch.contactWaId, conversationId);
  // Re-fetch: the deferral can outlast an escalation/assignment status change.
  const conv = await findConversationById(conversationId);
  if (!conv) return;
  if (['needs_human', 'resolved'].includes(conv.status) || conv.assignedAgent !== null) return;

  const quotedBody = await resolveQuotedBody(quotedWaMessageId);
  // Same silent-failure fix as the text path: a thrown AI call becomes a
  // low-confidence response and rides the escalation/ack branches below.
  let aiResponse: AIResponse;
  let matches: (PhotoMatch | null)[] = items.map(() => null);
  try {
    matches = await Promise.all(items.map((i) => i.match));
    matches.forEach((m, i) => {
      const tag = items.length > 1 ? ` (FOTO ${i + 1}/${items.length})` : '';
      if (m) {
        console.log(`[messageRouter] photo match for ${conv.id}${tag}: ${m.certainty}${m.product ? ` ${m.product.name}` : ''} (compared ${m.compared.length}: ${m.compared.join('; ')}) - ${m.reason}${m.searched ? ` [searched: ${m.searched.join(', ')}]` : ''}`);
      }
    });
    if (items.length > 1) console.log(`[messageRouter] answering ${items.length} photos for ${conv.id} in one turn`);
    const unsure = photoUnsureReason(matches);
    if (unsure && !nonSales) console.log(`[messageRouter] photo for ${conv.id} not matched for certain (${unsure}) - handing to the team`);
    aiResponse = nonSales
      ? { message: '', confidence: 'low', escalationReason: `${nonSales} - bukan pertanyaan produk` }
      : unsure
      ? { message: '', confidence: 'low', escalationReason: `${PHOTO_UNSURE_REASON} (${unsure})` }
      : await buildContextAndCallAI(
        conv.id, body, phoneNumber.promptSections,
        Promise.all(items.map((i) => i.keywords)).then((kws) => [...new Set(kws.flat())]), images, quotedBody,
        { photoNote: photoBatchNote(items.map((_, i) => ({ match: matches[i] ?? null }))) }
      );
  } catch (err) {
    if (silentWithoutClaude(conv.id, body)) return;
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[messageRouter] AI call failed → escalating:', msg);
    aiResponse = { message: '', confidence: 'low', escalationReason: `AI call failed: ${msg}` };
  }
  if (generationOf(conv.id) !== generation) {
    console.log(`[messageRouter] /new during the photo turn for ${conv.id} - dropping its reply`);
    return;
  }
  // The customer wrote again while these photos were being answered - the text path's
  // supersedeStaleTurn, for photos: an answer typed during the photo turn must not be followed by
  // the photo's reply asking the same question again. Nothing is
  // sent yet: hand the photos' question to the waiting text batch, which answers both. It
  // knows what each photo was from the note stored on its message (aiLayer.historyBody).
  const waiting = textDebounceMap.get(conv.id);
  if (waiting && !waiting.superseded) {
    const lines = await Promise.all(items.map(async (it, i) => photoLine(it.body, photoHistoryNote(matches[i] ?? null, await it.keywords))));
    waiting.texts = [...lines, ...waiting.texts];
    waiting.sentAt = [...items.map((i) => i.sentAt), ...waiting.sentAt];
    waiting.quotedWaMessageId ??= quotedWaMessageId;
    waiting.superseded = true;
    console.log(`[messageRouter] customer wrote again during the photo turn for ${conv.id} - dropping the draft, answering both together`);
    return;
  }
  // More photos arrived while these were being answered: one album can reach us further apart than
  // the quiet window, each webhook downloading its photo first. Drop the draft and answer them all in
  // the next turn, which sees every image. Once per batch, like the text path.
  const nextPhotos = photoBatchMap.get(conv.id);
  if (nextPhotos && !batch.superseded) {
    nextPhotos.items = [...items, ...nextPhotos.items];
    nextPhotos.superseded = true;
    console.log(`[messageRouter] more photos arrived during the photo turn for ${conv.id} - dropping the draft, answering all ${nextPhotos.items.length} together`);
    return;
  }

  // A caption can ask about tax just as a text message can — same gate, both paths. So can a
  // screenshot of a chat: live 2026-10-26 the faktur question was only in the picture.
  const ppnAsked = detectPpnQuestion(body) || items.some((i) => detectPpnQuestion(i.seen.chatText));
  const humanRequested = detectHumanRequest(body);
  const complaint = detectComplaint(body);
  const notBuyer = notABuyer(nonSales, aiResponse, conv);
  const askGap = !humanRequested && !isNonSalesHandoff(body) && !notBuyer && !ppnAsked && !taxHandoff(aiResponse);
  // humanRequested belongs in this condition exactly as it does on the text path: it was
  // computed here and used below for askProfileGap, but left OUT of the gate, so a photo
  // captioned "ini fotonya, tolong sambungkan ke CS" kept talking to the bot whenever the
  // model answered confidently. Asking for a human must not depend on the AI also failing.
  if (aiResponse.confidence === 'low' || humanRequested || ppnAsked || nonSales || !aiResponse.message) {
    // Same as the text path: profile facts from the escalating turn still count, and
    // must land before the hand-off question picks what to ask.
    await saveConversationInsights(conv.id, conv.contactId, aiResponse).catch(() => { });
    if (nonSales) void tagNonSalesLead(conv.contactId, nonSales).catch((err) => console.error('[leads] tag non-sales failed:', err));
    const reason = withExamplesAsked(aiResponse.escalationReason
      ?? (ppnAsked ? 'Pertanyaan PPN/pajak — kebijakan pajak hanya dari tim'
        : nonSales ? `${nonSales} - bukan pertanyaan produk` : 'Low confidence'), aiResponse);
    // No second escalation, but acknowledge the new question (same as the text path).
    if (conv.status === 'escalated') {
      console.warn(`[messageRouter] escalated conversation ${conv.id}: low-confidence turn → still-checking ack`);
      await updateConversationStatus(conv.id, 'escalated', reason)
        .catch((err) => console.warn('[messageRouter] escalated-status refresh failed:', err instanceof Error ? err.message : err));
      // Same as the text path: a photo sent while waiting is still the customer talking.
      notifyStaff({
        title: 'Pelanggan menunggu balasan',
        body: body.slice(0, 180),
        path: `/conversations/${conv.id}`,
      });
      const ack = await stillCheckingReply(conv.id, conv.contactId, askGap, humanRequested || ppnAsked);
      let ackId: string | null = null;
      try { ackId = await sendTextMessage(phoneNumber.phoneNumberId, replyJid, ack); } catch { /* recorded below as 'saved' */ }
      await insertMessage({ conversationId: conv.id, role: 'assistant', body: ack, waMessageId: ackId || undefined, status: ackId ? 'sent' : 'saved', metadata: { source: 'escalation_ack' } as Record<string, unknown> });
      return;
    }
    // Same as the text path: a caption explicitly asking for a human gets the hand-off
    // line only, no sales question - and a complaint gets the apology instead.
    await escalateConversation(
      conv, reason, replyJid, askGap, phoneNumber,
      complaint ? CANNED_COMPLAINT_REPLY : notBuyer ? CANNED_NON_SALES_REPLY
        : reason.startsWith(PHOTO_UNSURE_REASON) ? CANNED_PHOTO_CHECK_REPLY : undefined
    );
    return;
  }

  const { followUp, poForm } = await onceOnlyFollowUp(conv, aiResponse, body);
  if (needsTeam(followUp)) await handToTeam(conv, body, followUp);
  else if (conv.status === 'escalated') notifyEscalatedTurnAnswered(conv.id, body);
  const reply = replyText(aiResponse, followUp);
  let sentId: string | null = null;
  try { sentId = await sendTextMessage(phoneNumber.phoneNumberId, replyJid, reply); } catch { /* ignore */ }
  // After the text: the reference photos, the design-examples promise, then the PO form - as on the text path.
  const photos = await sendReferencePhotos(aiResponse.imageUrls, (url) => sendImageMessage(phoneNumber.phoneNumberId, replyJid, url, ''));
  const sendLine = (text: string) => sendTextMessage(phoneNumber.phoneNumberId, replyJid, text);
  const examplesSent = followUp.examples ? await sendFixedLine(CANNED_DESIGN_EXAMPLES_FROM_TEAM, 'design_examples', sendLine) : null;
  const poSent = poForm ? await sendFixedLine(poForm.body, 'po_form', sendLine) : null;
  if (aiResponse.catalogUrl) {
    // Price list asked for via the photo's caption. No keyword trigger runs on this path,
    // so without this the model says "katalognya sudah dikirim" and nothing is sent. Nothing was
    // sent for this caption yet, so a caption naming the list ("minta pricelist") counts as explicit.
    const delivery = await resolveCatalogDelivery(conv.contactId, body, {
      fresh: { facts: aiResponse.profileUpdate },
    });
    for (const f of delivery.files) {
      void sendDocumentMessage(phoneNumber.phoneNumberId, replyJid, f.url, f.filename)
        .then((wamid) => recordOutboundMedia({ conversationId: conv.id, kind: 'document', link: f.url, filename: f.filename, wamid, source: 'bot_media' }))
        .catch((err) => console.warn('[messageRouter] Failed to send catalog:', err instanceof Error ? err.message : err));
    }
  }
  await insertMessage({ conversationId: conv.id, role: 'assistant', body: reply, waMessageId: sentId || undefined, status: sentId ? 'sent' : 'saved', metadata: { source: 'vision_recommend' } as Record<string, unknown> });
  await recordAfterReply(conv.id, photos, [examplesSent, poSent]);
  saveConversationInsights(conv.id, conv.contactId, aiResponse).catch(() => { });
}

/**
 * Sends each reference photo in order (at most 3, extractFromToolInput's cap) and returns the ones
 * that went out, for recordAfterReply. A failed photo is logged and skipped - the rest still go.
 */
async function sendReferencePhotos(
  urls: string[] | undefined,
  send: (url: string) => Promise<string | null>
): Promise<{ url: string; wamid: string }[]> {
  const sent: { url: string; wamid: string }[] = [];
  for (const url of urls ?? []) {
    try {
      const wamid = await send(url);
      if (wamid !== null) sent.push({ url, wamid });
    } catch (err) {
      console.warn('[messageRouter] Failed to send reference photo:', err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

const PO_FORM_NOT_SET_REASON = 'Form PO belum diatur di Pengaturan';

/**
 * What follows the reply on a send_po_form turn: the PO form link from settings (the model never
 * writes it - spec 7.3). While the setting is still the placeholder, or cannot be read, no link goes
 * out: the customer gets the team's promise instead and `teamReason` hands the chat to the team, who
 * send the form by hand.
 */
interface PoFormLine { body: string; teamReason: string | null }

async function poFormToSend(): Promise<PoFormLine> {
  const fromTeam = (why: string) => ({ body: CANNED_PO_FORM_FROM_TEAM, teamReason: `${why} - pelanggan setuju harga, mohon kirimkan form PO` });
  try {
    const url = await getPoFormUrl();
    if (url !== PO_FORM_PLACEHOLDER_URL) return { body: poFormMessage(url), teamReason: null };
    console.warn('[messageRouter] PO form link is still the placeholder - the team sends the form');
    return fromTeam(PO_FORM_NOT_SET_REASON);
  } catch (err) {
    console.warn('[messageRouter] PO form link unavailable - the team sends the form:', err instanceof Error ? err.message : err);
    return fromTeam('Form PO tidak bisa dibaca dari Pengaturan');
  }
}

interface FixedLineSent { body: string; source: string; wamid: string | null }

/** Sends a fixed line after the reply (the PO form, the design-examples promise); a failed send is still stored, as 'saved'. */
async function sendFixedLine(body: string, source: string, send: (text: string) => Promise<string | null>): Promise<FixedLineSent> {
  let wamid: string | null = null;
  try { wamid = await send(body); } catch { /* recorded as 'saved' */ }
  return { body, source, wamid };
}

/** The rows for what followed the reply, after the reply's own row and in the same order. */
async function recordAfterReply(
  conversationId: string,
  photos: { url: string; wamid: string }[],
  lines: (FixedLineSent | null)[]
): Promise<void> {
  for (const p of photos) {
    await recordOutboundMedia({ conversationId, kind: 'image', link: p.url, wamid: p.wamid, source: 'bot_media' });
  }
  for (const line of lines) {
    if (!line) continue;
    await insertMessage({
      conversationId, role: 'assistant', body: line.body,
      waMessageId: line.wamid || undefined, status: line.wamid ? 'sent' : 'saved',
      metadata: { source: line.source } as Record<string, unknown>,
    });
  }
}

// A noun that could name the document...
const CATALOG_NOUNS = [
  'katalog', 'catalog', 'brosur', 'daftar harga', 'price list', 'pricelist',
  'product list', 'daftar produk',
];
// ...but "berapa daftar harga box nasi 20x20?" is a price question, not a request for the file,
// and the file is now a PRICELIST document. So a bare noun no longer fires: either the message
// asks for it ("minta katalog", "ada brosur?"), or it is essentially just the noun on its own.
const CATALOG_VERBS = /\b(minta|mau|boleh|bisa|kirim|share|send|ada|punya|lihat|liat|tolong|info|infokan|pdf|file)\b/i;

function detectCatalogRequest(text: string): boolean {
  const lower = text.toLowerCase();
  const noun = CATALOG_NOUNS.find((kw) => lower.includes(kw));
  if (!noun) return false;
  if (CATALOG_VERBS.test(lower)) return true;
  // "katalog?" / "brosur dong" - short enough that the noun IS the request.
  return lower.replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).length <= 3;
}

// Exact match, never includes(): a customer quoting "/new" inside a sentence must stay an
// ordinary message. The whitelist is the real guard, this is the second one.
export function isResetCommand(text: string): boolean {
  return text.trim().toLowerCase() === '/new';
}

// Digits-only comparison, so +62 812-3456, 62812-3456 and 628123456 are one number - the wa_id
// format differs between the Meta and Chakra transports and nobody should have to know which.
export function isResetAllowed(waId: string): boolean {
  // The empty default needs no special case: ''.split(',') -> [''] -> filter(Boolean) -> [],
  // and nothing is ever in an empty list. Unset env var = command off.
  return getConfig().RESET_COMMAND_NUMBERS.split(',')
    .map((n) => n.replace(/\D/g, ''))
    .filter(Boolean)
    .includes(waId.replace(/\D/g, ''));
}

export async function routeInboundBaileysMessage(payload: BaileysInboundPayload): Promise<void> {
  // Use fromJid (full JID with @s.whatsapp.net or @lid) for sending replies,
  // and bare from (no suffix) as the stable contact identifier.
  const fromWaId = payload.from;
  const replyJid = payload.fromJid ?? payload.from;
  const contactName = payload.pushName ?? undefined;

  // Independent lookups — overlap the round trips.
  //
  // Reply AS the number the message arrived on. getFirstPhoneNumber() alone was wrong the
  // moment a second row existed: it orders by created_at, so with both a production and a
  // demo number configured every reply was sent from whichever was added first. Chakra then
  // answers 400 "phone number ... is not part of plugin configuration or is not connected",
  // the send throws, and because each send site swallows that into a console.warn the symptom
  // is total silence on WhatsApp while inbound keeps working perfectly.
  const [phoneNumber, contact] = await Promise.all([
    payload.toPhoneNumberId
      ? findPhoneNumberByProviderId(payload.toPhoneNumberId).then((p) => p ?? getFirstPhoneNumber())
      : getFirstPhoneNumber(),
    upsertContact(fromWaId, contactName),
  ]);
  if (!phoneNumber) {
    console.warn('[messageRouter] No phone number configured — ignoring inbound message');
    return;
  }
  let conversation = await upsertConversation(contact.id, phoneNumber.id);

  if (conversation.status === 'resolved') {
    const reopened = await resetConversationToActive(conversation.id);
    if (reopened) conversation = reopened;
    await insertMessage({
      conversationId: conversation.id,
      role: 'system_note',
      body: 'Percakapan dibuka kembali oleh pesan baru dari pelanggan.',
    });
  }

  const isText = payload.type === 'text';
  const isImage = payload.type === 'image';
  const isDocument = payload.type === 'document';

  const body =
    isText
      ? (payload.text ?? '')
      : isImage
        // Prefer the photo's caption (the customer's actual question) so it drives RAG
        // and the reply; fall back to the placeholder when there's no caption.
        ? (payload.text?.trim() || '[Pelanggan mengirim foto — analisis gambar terlampir]')
        : isDocument
          ? (payload.text?.trim() || '[Pelanggan mengirim dokumen]')
          : payload.text ?? '[Pelanggan mengirim pesan]';

  // created_at is backdated to the WhatsApp send time, so a webhook that reaches us late looks on
  // time in the data - which is how 16-99 minute stalls on 2026-09-22..24 went unexplained. Say so
  // in the log, and keep it on the row.
  const lateMs = payload.timestamp > 0 ? Date.now() - payload.timestamp * 1000 : 0;
  if (lateMs > LATE_DELIVERY_MS) {
    console.warn(`[messageRouter] ${payload.waMessageId} arrived ${Math.round(lateMs / 60_000)} min after it was sent - delivery to this host was delayed`);
  }

  let inboundMediaUrl: string | null = null;
  if (isImage && payload.media?.base64) {
    try {
      const inboundDir = join(process.cwd(), 'uploads', 'inbound');
      await mkdir(inboundDir, { recursive: true });
      const ext = payload.media.mimeType === 'image/png' ? 'png' : payload.media.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const filename = `${Date.now()}_${payload.waMessageId.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
      await writeFile(join(inboundDir, filename), Buffer.from(payload.media.base64, 'base64'));
      inboundMediaUrl = `/uploads/inbound/${filename}`;
    } catch (err) {
      console.warn('[messageRouter] Failed to save inbound image:', err instanceof Error ? err.message : err);
    }
  }

  const inbound = {
    conversationId: conversation.id,
    role: 'user',
    body,
    waMessageId: payload.waMessageId,
    // Real WhatsApp send time, not DB-insert time - chakraSync stamps its imports this way, so
    // without it the two write paths order one history on two different clocks. Guarded because
    // webhooks.ts falls back to 0, and epoch 0 would sort worse than now().
    ...(payload.timestamp > 0 && { createdAt: new Date(payload.timestamp * 1000) }),
    metadata: {
      baileys: { from: payload.from, type: payload.type, ...(payload.providerType && payload.providerType !== payload.type && { providerType: payload.providerType }) },
      // Kept so a quote is auditable after the turn: it is used live and then discarded, which
      // is why nobody could tell whether Chakra forwards it. jsonb, so no migration.
      ...(payload.quotedWaMessageId && { quotedWaMessageId: payload.quotedWaMessageId }),
      ...(lateMs > LATE_DELIVERY_MS && { deliveredLateMs: lateMs }),
      ...(isImage && { attachmentType: 'image', mimeType: payload.media?.mimeType ?? 'image/jpeg', ...(inboundMediaUrl && { mediaUrl: inboundMediaUrl }) }),
      ...(isDocument && { attachmentType: 'document', filename: payload.media?.filename ?? null }),
    } as Record<string, unknown>,
  };
  // A taken wamid is a duplicate delivery only if the webhook stored it. chakraSync can store the
  // message first - it never answers anything - and then this delivery is the only one that will.
  const saved = (await insertMessageIfNew(inbound)) ?? (await claimSyncedInbound(inbound));
  if (!saved) return; // duplicate
  if (saved.metadata?.['syncedFirst']) {
    console.log(`[messageRouter] ${payload.waMessageId} was stored by chakraSync before its webhook - answering it anyway`);
  }

  // /new — start this thread over. Above the lead hook and the AI gate on purpose: the command
  // is not a sales message, so it must neither create a lead nor draw a reply from the model.
  if (isResetCommand(body) && isResetAllowed(fromWaId)) {
    // The floor is the command's own send time, never later than now - see resetConversationContext.
    const floor = new Date(Math.min(payload.timestamp > 0 ? payload.timestamp * 1000 : Infinity, Date.now()));
    // Before any await: a turn that takes its batch meanwhile must already see the new generation.
    dropBufferedBefore(conversation.id, Math.floor(floor.getTime() / 1000));
    resetGeneration.set(conversation.id, generationOf(conversation.id) + 1);
    await resetConversationContext(conversation.id, floor);
    await deleteContactProfile(contact.id);
    await resetLeadsForContact(contact.id);
    forgetSentPriceLists(contact.id);
    // inFlightConversations is a mutex freed in finally - clearing it would let a second turn in;
    // the running turn drops its own reply instead (resetGeneration). escalationNudge reconciles
    // itself once status is back to 'active'.
    let ackId: string | null = null;
    try {
      ackId = await sendTextMessage(phoneNumber.phoneNumberId, replyJid,
        'Konteks direset. Percakapan berikutnya dimulai dari nol.');
    } catch (err) {
      console.warn('[messageRouter] reset ack failed:', err instanceof Error ? err.message : err);
    }
    // The note sits AT the floor, so like the "/new" row itself it stays out of the floored readers
    // and the summarizer count. role 'system_note' is dropped by buildContext anyway; staff see it.
    // It carries the ack's wamid: chakraSync reads any outbound text it does not already have as a
    // staff reply, and this ack would otherwise be the one bot text it has never seen.
    await insertMessage({
      conversationId: conversation.id,
      role: 'system_note',
      body: 'Konteks AI dan data CRM direset via /new.',
      createdAt: floor,
      ...(ackId && { waMessageId: ackId }),
    });
    console.log(`[messageRouter] /new reset conversation ${conversation.id}`);
    return;
  }

  // Lead attribution. Above the AI gate on purpose: an AI-off contact is still a lead, and
  // `body` here already covers text, image captions and document captions in one value, so
  // this is the single hook both message shapes route through.
  // Dated by the stored row's send time, so first_contact_at is not later than the first message
  // (which would put that message outside the lead's lifecycle - it could never be Won evidence).
  void recordLeadFromMessage(body, contact.id, saved.createdAt ?? undefined);

  // Auto-reply gate. The inbound message is already saved above, so an AI-off
  // contact is recorded in full — the bot just stays silent for them.
  const aiOn = contact.aiEnabled ?? (await getAiEnabledDefault());
  if (!aiOn) return;

  const humanStatuses = ['needs_human', 'resolved'];
  if (humanStatuses.includes(conversation.status) || conversation.assignedAgent !== null) return;

  // Voice note / video / sticker / reaction / location / contact share. There is no text to
  // answer, and the placeholder body ("[Pelanggan mengirim pesan]") used to go to the model as
  // though it were the customer's question - producing a confident sales reply to something
  // nobody said. Say plainly that it cannot be opened and name the next step, rather than
  // guessing. Below the lead hook so the contact is still attributed; the row is already saved.
  if (!isText && !isImage && !isDocument) {
    const reply = payload.type === 'audio' || payload.type === 'video' ? CANNED_UNSUPPORTED_MEDIA_REPLY : CANNED_UNSUPPORTED_OTHER_REPLY;
    // Once per burst: two stickers, or a voice note sent twice, are one thing to say. Checked and
    // stamped with no await in between, because a burst arrives as concurrent webhooks.
    const key = `${conversation.id}:${reply}`;
    const lastAt = unsupportedRepliedAt.get(key);
    if (lastAt !== undefined && Date.now() - lastAt < UNSUPPORTED_REPLY_COOLDOWN_MS) return;
    unsupportedRepliedAt.set(key, Date.now());
    let sentId: string | null = null;
    try { sentId = await sendTextMessage(phoneNumber.phoneNumberId, replyJid, reply); } catch { /* recorded below as 'saved' */ }
    await insertMessage({
      conversationId: conversation.id,
      role: 'assistant',
      body: reply,
      waMessageId: sentId || undefined,
      status: sentId ? 'sent' : 'saved',
      metadata: { source: 'unsupported_media', inboundType: payload.type } as Record<string, unknown>,
    }).catch(() => { });
    return;
  }

  // A document with no caption is almost always an invoice, a PO, a transfer receipt or a list -
  // paperwork for a person, and nothing the model can read. It used to go to the model as the
  // placeholder "[Pelanggan mengirim dokumen]", which answered some earlier question instead, or
  // told the customer to ask about products only (UAT F-22). Hand it to the team, no sales question.
  if (isDocument && !payload.text?.trim()) {
    const name = payload.media?.filename;
    await escalateConversation(
      conversation,
      `Pelanggan mengirim dokumen tanpa keterangan${name ? `: ${name}` : ''} - mohon dicek tim.`,
      replyJid,
      false,
      phoneNumber
    );
    return;
  }

  if (isImage && payload.media && payload.media.base64) {
    // Cancel any pending text debounce — those texts are already saved to the DB, so
    // the photo turn answers them via conversation history in one combined
    // reply. Only safe here: the no-media fallback has no AI turn to absorb them.
    const pending = textDebounceMap.get(conversation.id);
    if (pending) {
      clearTimeout(pending.timer);
      textDebounceMap.delete(conversation.id);
    }

    const imageData: { base64: string; mimeType: string } = {
      base64: payload.media.base64,
      mimeType: payload.media.mimeType,
    };

    // Each photo's vision step and comparison start on arrival, before the photos are batched: they
    // do not depend on the others, and they run during the quiet window instead of after it.
    // A non-sales caption ("bukti transfer", a courier) goes to the team as it is: no vision, no photo
    // comparison, no AI call - the same gate as the text path, decided before anything is spent.
    const nonSales = detectNonSalesTopic(body, await earlierCustomerText(conversation.id));
    const visionPromise: Promise<VisionExtract | null> = nonSales ? Promise.resolve(null) : extractCatalogKeywordsFromImage(imageData)
      .catch((err) => {
        console.warn('[messageRouter] visionKeywords extraction failed:', err instanceof Error ? err.message : err);
        return null;
      });
    const imageKeywordsPromise: Promise<string[]> = visionPromise.then((v) => (v ? visionExtractToKeywords(v) : []));
    // The messages written in a chat screenshot, for the tax gate. Read when the reply starts, never
    // waited for: a catalog with no photos keeps the vision head start. With photos it is always set
    // by then - the comparison waits for the vision step.
    const seen = { chatText: '' };
    void visionPromise.then((v) => { seen.chatText = (v?.chat_text ?? []).join('\n'); }).catch(() => { });
    // The photo against our own product photos (services/photoMatch.ts), awaited BEFORE the reply is
    // written: the verdict is what the reply is about. Never rejects; null when no candidate product
    // has a photo, which is the old path. Cropped to the product the vision step boxed (a marketplace
    // screenshot is mostly prices and buttons), and a pick of another type of item than the vision
    // step saw is dropped (sharesItemWord).
    const photoMatchPromise = nonSales ? Promise.resolve(null)
      : matchCustomerPhoto(imageData, imageKeywordsPromise, body, visionPromise.then((v) => v && { box: v.product_box, category: v.primary_category }));
    // Kept on the message so a later turn knows what the photo was (aiLayer.historyBody) - only
    // this turn ever sees the image itself.
    void Promise.all([photoMatchPromise, imageKeywordsPromise])
      .then(([m, kw]) => {
        const note = photoHistoryNote(m, kw);
        return note ? mergeMessageMetadata(saved.id, { photoContext: note }) : undefined;
      })
      .catch((err) => console.warn('[messageRouter] photo note not saved:', err instanceof Error ? err.message : err));

    const item: PhotoItem = {
      body,
      sentAt: payload.timestamp > 0 ? payload.timestamp : 0,
      quotedWaMessageId: payload.quotedWaMessageId ?? null,
      imageData,
      nonSales,
      keywords: imageKeywordsPromise,
      match: photoMatchPromise,
      seen,
    };
    const batch = photoBatchMap.get(conversation.id);
    if (batch) {
      clearTimeout(batch.timer);
      batch.items.push(item);
      batch.timer = setTimeout(() => { firePhotoBatch(conversation.id).catch((err) => console.error('[messageRouter] photo turn error:', err)); }, nextPhotoWait(batch));
    } else {
      photoBatchMap.set(conversation.id, {
        timer: setTimeout(() => { firePhotoBatch(conversation.id).catch((err) => console.error('[messageRouter] photo turn error:', err)); }, PHOTO_DEBOUNCE_MS),
        firstAt: Date.now(),
        items: [item],
        conversationId: conversation.id,
        contactWaId: contact.waId,
        replyJid,
        phoneNumber,
      });
    }
    return;
  }

  if (isImage && !payload.media?.base64 && !payload.text?.trim()) {
    // Image we couldn't open AND no caption to work with — ask them to describe it. Logged: every
    // photo in the 2026-09-23 UAT ended here, and nothing in the log said so.
    console.warn(`[messageRouter] image ${payload.waMessageId} arrived without downloadable media - sent the unreadable-photo reply`);
    let sentId: string | null = null;
    try { sentId = await sendTextMessage(phoneNumber.phoneNumberId, replyJid, CANNED_IMAGE_UNREADABLE_REPLY); } catch { /* ignore */ }
    await insertMessage({ conversationId: conversation.id, role: 'assistant', body: CANNED_IMAGE_UNREADABLE_REPLY, waMessageId: sentId || undefined, status: sentId ? 'sent' : 'saved' });
    return;
  }
  // An image WITH a caption but no downloadable media falls through to the text path below,
  // so the caption (e.g. "ada box seperti ini? butuh 2000 pcs") still drives a normal RAG answer.

  // Text path — debounce AI call per conversation to avoid spam on rapid messages
  const textBody = payload.text ?? body;

  const existing = textDebounceMap.get(conversation.id);
  if (existing) {
    clearTimeout(existing.timer);
    existing.texts.push(textBody);
    existing.sentAt.push(payload.timestamp > 0 ? payload.timestamp : 0);
    const timer = setTimeout(() => { fireTextDebounce(conversation.id).catch((err) => console.error('[messageRouter] debounce fire error:', err)); }, nextDebounceWait(existing));
    // Latest quoted message in the batch wins; keep the previous one if this msg had none.
    textDebounceMap.set(conversation.id, { ...existing, timer, quotedWaMessageId: payload.quotedWaMessageId ?? existing.quotedWaMessageId });
  } else {
    const timer = setTimeout(() => { fireTextDebounce(conversation.id).catch((err) => console.error('[messageRouter] debounce fire error:', err)); }, TYPING_DEBOUNCE_FIRST_MS);
    textDebounceMap.set(conversation.id, {
      timer,
      firstAt: Date.now(),
      texts: [textBody],
      sentAt: [payload.timestamp > 0 ? payload.timestamp : 0],
      sendReply: async (text: string) => {
        try { return await sendTextMessage(phoneNumber.phoneNumberId, replyJid, text); } catch { return null; }
      },
      escalationJid: replyJid,
      phoneNumber,
      sendDoc: async (path: string, filename: string) => {
        const wamid = await sendDocumentMessage(phoneNumber.phoneNumberId, replyJid, path, filename);
        await recordOutboundMedia({ conversationId: conversation.id, kind: 'document', link: path, filename, wamid, source: 'bot_media' });
      },
      sendImage: (url: string) => sendImageMessage(phoneNumber.phoneNumberId, replyJid, url, ''),
      conversationId: conversation.id,
      promptSections: phoneNumber.promptSections,
      quotedWaMessageId: payload.quotedWaMessageId ?? null,
    });
  }
}
