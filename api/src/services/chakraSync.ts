import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { getConfig } from '../config.js';
import { listChats, listChatMessages, downloadMedia } from './chakraClient.js';
import { downloadMedia as metaDownloadMedia } from './metaClient.js';
import type { ChakraChat, ChakraMessage } from './chakraClient.js';
import { upsertContact } from '../repositories/contacts.js';
import { upsertConversation, insertMessageIfNew, backdateConversation, hasUnlinkedAssistantTwin, existingWaMessageIds, findSyncedOutboundRows, patchSyncedOutboundRow } from '../repositories/conversations.js';
import { findPhoneNumberByProviderId, getFirstPhoneNumber } from '../repositories/phoneNumbers.js';
import { getChakraSyncState, setChakraSyncState } from '../repositories/appSettings.js';
import type { ChakraSyncResult } from '../repositories/appSettings.js';
import { recordLeadFromMessage } from './leadMatcher.js';
import { markHumanTakeover } from './humanTakeover.js';
import { storedMediaUrl } from './outboundMedia.js';

// Backfills conversation history from ChakraHQ into our own tables. Two gaps the inbound
// webhook can't cover: everything that happened before the webhook was pointed at us, and
// replies a human agent types in Chakra's own inbox (the webhook carries inbound messages
// and delivery statuses, not agent-authored outbound).
//
// This module writes through the repositories ONLY. It never calls routeInboundBaileysMessage,
// so no debounce entry is created, no AI turn runs and nothing is ever sent to a customer.
// It also never writes contacts.ai_enabled, so imported contacts stay NULL = follow the
// global app_settings.ai_enabled_default switch.
//
// Idempotency comes free from the existing UNIQUE index on messages.wa_message_id: Chakra's
// `externalId` is the same wamid the webhook stores, so re-running only inserts what's new.

const OVERLAP_MS = 5 * 60_000; // re-check a little either side of the watermark for clock skew
const CHAT_PAGE_SIZE = 100; // Chakra's documented maximum
const MESSAGE_PAGE_SIZE = 500; // Chakra allows up to 1000

// Who wrote an outbound message, decided by elimination. Every text the bot sends is stored with
// the wamid WhatsApp returned, so the dedup above already skips it; an outbound TEXT this importer
// still finds new was typed by a person - on the WhatsApp Business phone, or in Chakra's inbox.
// Chakra's `user` was meant to say so, but it is never set: not one of 3,505 synced outbound rows
// in the 2026-09-22 restore carried it, so every staff reply was stored unlabeled, rendered "AI",
// and fed back to the model as the bot's own words. Live 2026-10-08 staff told Ika "kami tidak
// menyediakan" from the phone and the bot answered over it as if the item were still being checked.
// Photos and documents too, since 2026-11-10: the bot now stores every file it sends under its wamid
// (services/outboundMedia.ts), and a file sent through the API carries the `link` it was sent by, which
// nothing typed on the phone does. Before that, every file staff sent showed as "AI".
// Label only - unlike a dashboard reply this does not pause the AI (owner's call 2026-10-08).
const PHONE_REPLY_SENDER = 'Tim CS';
// Too new to judge: the bot stores a reply just AFTER sending it, so a sync landing in between
// would see the bot's own text as new. Held back, it is picked up on the next run - the watermark
// sits at the chat's updatedAt, and its 5-minute overlap keeps that chat in the next walk.
const OUTBOUND_SETTLE_MS = 2 * 60_000;

export interface ChakraSyncOptions {
  /** Ignore the watermark and walk everything Chakra has. */
  full?: boolean;
  /** Stop after this many chats — the trial escape hatch before a first full backfill. */
  maxChats?: number;
}

let running: Promise<ChakraSyncResult> | null = null;

export function isChakraSyncRunning(): boolean {
  return running !== null;
}

/**
 * Kick off a sync without waiting for it. The button, the hourly tick and a manual curl all
 * come through here and share one in-flight run.
 */
export function startChakraSync(opts: ChakraSyncOptions = {}): { started: boolean; reason?: string } {
  const config = getConfig();
  if (config.WHATSAPP_TRANSPORT !== 'chakra') return { started: false, reason: 'transport_not_chakra' };
  if (!config.CHAKRA_ACCESS_TOKEN) return { started: false, reason: 'no_access_token' };
  if (running) return { started: false, reason: 'already_running' };

  running = runChakraSync(opts).finally(() => {
    running = null;
  });
  running.catch((err) => {
    console.error('[chakraSync] run failed:', err instanceof Error ? err.message : err);
  });
  return { started: true };
}

export async function runChakraSync(opts: ChakraSyncOptions = {}): Promise<ChakraSyncResult> {
  const state = await getChakraSyncState();
  // The first run IS the backfill, so it must walk every page of every chat. Stopping a chat
  // at "this page was all already known" is only correct once a watermark exists: the webhook
  // has usually already stored a chat's most recent messages, and the older history that
  // actually needs importing sits on the pages behind them.
  const walkAll = opts.full === true || state.watermarkMs === 0;
  const cutoff = walkAll ? 0 : Math.max(0, state.watermarkMs - OVERLAP_MS);
  const result: ChakraSyncResult = { chats: 0, messages: 0, mediaFailed: 0, errors: 0, truncated: false };
  let watermark = state.watermarkMs;

  console.log(
    `[chakraSync] start walkAll=${walkAll} cutoff=${cutoff ? new Date(cutoff).toISOString() : 'none'}`
  );

  let attempted = 0;

  outer: for (let page = 1; ; page++) {
    const chats = await listChats(page, CHAT_PAGE_SIZE);
    if (chats.length === 0) break;

    // `orderField: 'updatedAt'` doesn't say which direction, and the cutoff shortcut is only
    // sound on a descending page — on an ascending one it would stop at the oldest chat and
    // sync nothing at all. So derive it rather than trust it: guessing wrong here costs a
    // full walk, never missing history.
    const descending = isDescending(chats.map((c) => c.updatedAt ?? 0));

    for (const chat of chats) {
      if ((chat.provider ?? 'WHATSAPP') !== 'WHATSAPP') continue;

      const updatedAt = chat.updatedAt ?? 0;
      if (updatedAt > watermark) watermark = updatedAt;
      if (descending && cutoff > 0 && updatedAt > 0 && updatedAt < cutoff) break outer;

      attempted++;
      try {
        result.messages += await syncChat(chat, result, walkAll);
        result.chats++;
      } catch (err) {
        result.errors++;
        console.warn(
          `[chakraSync] chat ${chat.id} failed:`,
          err instanceof Error ? err.message : err
        );
      }

      // Counts attempts, not successes — a run of failures must still respect the cap.
      if (opts.maxChats !== undefined && attempted >= opts.maxChats) {
        result.truncated = true;
        break outer;
      }
    }

    if (chats.length < CHAT_PAGE_SIZE) break;
  }

  // Only advance the watermark after a clean, complete pass. A truncated or partly-failed run
  // has holes below the newest chat, and a watermark would hide them from the next run forever.
  // ponytail: one failed chat therefore makes the next run re-walk everything. Re-walking is
  // cheap (an already-synced chat costs one page that inserts nothing) and self-heals on the
  // first clean run — add a per-chat retry if a flaky Chakra keeps runs from ever completing.
  const complete = !result.truncated && result.errors === 0;
  await setChakraSyncState({
    watermarkMs: complete ? watermark : state.watermarkMs,
    lastRunAt: new Date().toISOString(),
    lastResult: result,
  });

  console.log('[chakraSync] done', result);
  return result;
}

// Inside a reply's slot the bot's own earlier texts in this chat are already stored, so the
// 2-minute hold-back is not needed - only the moment between a send and its insert, which the
// dashboard's send and the /new ack also have. 10 s covers that and still lets a staff reply typed
// before the customer's debounced message (8 s) into the reply's context.
const TURN_SETTLE_MS = 10_000;
// Inbound is the webhook's job, and the per-reply sync runs seconds after the customer's previous
// message: a message typed during a turn is already in Chakra's list while its own webhook is still
// being handled (a photo's downloads its media first, up to 40 s). Stored here first, it used to read
// as a duplicate to the webhook and was never answered. The webhook now takes such a row over
// (claimSyncedInbound); holding fresh inbound back keeps that the exception. A message whose webhook
// never comes is still imported - by a later reply's sync or the periodic run.
const TURN_INBOUND_SETTLE_MS = 2 * 60_000;
// Chat ids are stable; the lookup costs a chat-list call, so it is made once per customer. A miss is
// remembered for a while too - otherwise a customer outside the newest 100 chats costs a list call on
// every reply - and a chat id that stops working is forgotten.
const chatByWaId = new Map<string, ChakraChat>();
const chatMissAt = new Map<string, number>();
const CHAT_MISS_TTL_MS = 10 * 60_000;

/**
 * Imports what staff typed on the WhatsApp phone (or in Chakra's inbox) into ONE conversation,
 * right before the bot answers it. Those replies reach us only through this importer, and the
 * periodic run holds outbound texts back 2 minutes and then waits for its next tick - so live
 * the bot answered a customer with staff's "kalau yang persis belum ada, tapi ada yang mirip" still
 * missing from its context, and stuck to its own wrong product. Returns how
 * many messages were added; 0 when the transport is not Chakra or the chat is not found.
 */
export async function syncContactChat(waId: string): Promise<number> {
  const config = getConfig();
  if (config.WHATSAPP_TRANSPORT !== 'chakra' || !config.CHAKRA_ACCESS_TOKEN) return 0;
  const wa = waId.replace(/\D/g, '');
  if (!wa) return 0;
  let chat = chatByWaId.get(wa);
  if (!chat) {
    if (Date.now() - (chatMissAt.get(wa) ?? 0) < CHAT_MISS_TTL_MS) return 0;
    // The customer has just written, so their chat is at the top of the newest-updated list.
    chat = (await listChats(1, CHAT_PAGE_SIZE)).find(
      (c) => (c.provider ?? 'WHATSAPP') === 'WHATSAPP' && (c.primaryContactHandle?.value ?? '').replace(/\D/g, '') === wa
    );
    if (!chat) {
      chatMissAt.set(wa, Date.now());
      return 0;
    }
    chatByWaId.set(wa, chat);
  }
  const result: ChakraSyncResult = { chats: 0, messages: 0, mediaFailed: 0, errors: 0, truncated: false };
  try {
    return await syncChat(chat, result, false, TURN_SETTLE_MS, TURN_INBOUND_SETTLE_MS);
  } catch (err) {
    chatByWaId.delete(wa); // a stale chat id is looked up afresh next time
    throw err;
  }
}

/** Newest-first? A single-item page counts as descending — there's nothing to contradict it. */
function isDescending(timestamps: number[]): boolean {
  const first = timestamps[0] ?? 0;
  const last = timestamps[timestamps.length - 1] ?? 0;
  return timestamps.length < 2 || first >= last;
}

/** Returns how many messages were newly inserted for this chat. */
async function syncChat(
  chat: ChakraChat,
  result: ChakraSyncResult,
  walkAll: boolean,
  settleMs = OUTBOUND_SETTLE_MS,
  inboundSettleMs = 0
): Promise<number> {
  // Chakra hands back "+628123…", contacts.wa_id holds bare digits (the webhook's msg.from).
  // Stripping is what makes an imported contact land on the existing row instead of forking one.
  const waId = (chat.primaryContactHandle?.value ?? '').replace(/\D/g, '');
  if (!waId) {
    console.warn(`[chakraSync] chat ${chat.id}: no contact handle — skipped`);
    return 0;
  }

  const phone =
    (chat.providerHandleId ? await findPhoneNumberByProviderId(chat.providerHandleId) : null) ??
    (await getFirstPhoneNumber());
  if (!phone) {
    console.warn('[chakraSync] no phone number configured — skipping chat');
    return 0;
  }

  const contact = await upsertContact(
    waId,
    chat.primaryContact?.name ?? undefined,
    chat.createdAt ? new Date(chat.createdAt) : undefined
  );
  // Never touches contacts.ai_enabled or conversations.status: the team's own
  // takeover/resolve state must survive a re-sync.
  const conversation = await upsertConversation(contact.id, phone.id);
  // The staff WhatsApp the bot pings on escalation (staffNotify): those pings are the bot's, and
  // like a PDF they go out without a stored wamid.
  const notifyWa = (getConfig().ESCALATION_NOTIFY_WA ?? '').replace(/\D/g, '');
  const isStaffNotifyChat = notifyWa !== '' && notifyWa === waId;

  let inserted = 0;
  let minTs = Number.POSITIVE_INFINITY;

  for (let page = 1; ; page++) {
    const msgs = await listChatMessages(chat.id, page, MESSAGE_PAGE_SIZE);
    if (msgs.length === 0) break;

    const descending = isDescending(msgs.map((m) => m.timestamp ?? m.createdAt ?? 0));

    let pageInserted = 0;
    // Known rows are skipped BEFORE importMessage: it downloads a message's media before the insert can
    // dedup it, so every run re-fetched every catalog PDF and product photo in the chat - and the
    // per-reply sync runs on every customer message (review 2026-10-13).
    const known = await existingWaMessageIds(msgs.map((m) => m.externalId ?? `chakra:${m.id}`));
    for (const msg of msgs) {
      const ts = msg.timestamp ?? msg.createdAt ?? 0;
      if (ts > 0 && ts < minTs) minTs = ts;
      if (known.has(msg.externalId ?? `chakra:${msg.id}`)) continue;
      if (await importMessage(conversation.id, contact.id, msg, result, isStaffNotifyChat, settleMs, inboundSettleMs)) pageInserted++;
    }
    inserted += pageInserted;

    // Newest-first pages: a page that inserted nothing means this chat is already caught up.
    if (!walkAll && descending && pageInserted === 0) break;
    if (msgs.length < MESSAGE_PAGE_SIZE) break;
  }

  if (minTs !== Number.POSITIVE_INFINITY) {
    await backdateConversation(conversation.id, new Date(minTs));
  }
  return inserted;
}

async function importMessage(
  conversationId: string,
  contactId: string,
  msg: ChakraMessage,
  result: ChakraSyncResult,
  isStaffNotifyChat = false,
  settleMs = OUTBOUND_SETTLE_MS,
  inboundSettleMs = 0
): Promise<boolean> {
  // externalId is the wamid — the same value the webhook stores, which is what makes the
  // ON CONFLICT dedup line up. The fallback only applies to messages Chakra never got a
  // wamid for (failed sends); prefixed so it can't collide with a real wamid.
  const waMessageId = msg.externalId ?? `chakra:${msg.id}`;
  const role = msg.direction === 'INBOUND' ? 'user' : 'assistant';
  const ts = msg.timestamp ?? msg.createdAt ?? Date.now();
  if (role === 'assistant' && ts > Date.now() - settleMs) return false;
  if (role === 'user' && inboundSettleMs > 0 && ts > Date.now() - inboundSettleMs) return false;
  const { body, media } = await mapBody(msg, waMessageId, ts, result);

  const senderName = await outboundSender(conversationId, msg, body, ts, isStaffNotifyChat, media);
  if (senderName === SKIP) return false;

  const saved = await insertMessageIfNew({
    conversationId,
    role,
    body,
    waMessageId,
    ...(role === 'assistant' && { status: 'sent' }),
    // The dashboard labels a right-side bubble with no senderName as "AI" - see PHONE_REPLY_SENDER.
    senderName,
    metadata: {
      // The rollback handle: DELETE FROM messages WHERE metadata->>'source' = 'chakra_sync';
      source: 'chakra_sync',
      chakraMessageId: msg.id,
      ...(msg.dataType && { dataType: msg.dataType }),
      ...(msg.deliveryStatus && { deliveryStatus: msg.deliveryStatus }),
      ...storableMedia(media),
    },
    createdAt: new Date(ts),
  });
  // Same lead attribution the webhook path does, so a message that only ever reached us
  // through the backfill still gets its campaign. The message's own timestamp, not now(),
  // keeps submitted_at honest — the campaign report buckets on it.
  // An agent replying from ChakraHQ's inbox (or the WhatsApp Business app behind it) is the one
  // human signal Chakra states outright, via `user`. Treat it as a takeover: the customer has a
  // person now, and a bot answering over the top of them is worse than silence. Only on a
  // newly-saved row, so re-syncing history cannot re-pause a conversation already handed back.
  if (saved && role === 'assistant' && msg.user) {
    await markHumanTakeover(conversationId, 'Tim CS').catch((err) =>
      console.warn('[chakraSync] takeover failed:', err instanceof Error ? err.message : err)
    );
  }
  if (saved && role === 'user') void recordLeadFromMessage(body, contactId, new Date(ts));
  return saved !== null;
}

// ─── history repair ─────────────────────────────────────────────────────────

export interface OutboundRepairResult {
  chats: number;
  /** Synced outbound file rows looked at. */
  files: number;
  /** Rows whose sender label changes ("AI" -> "Tim CS"). */
  relabelled: number;
  /** Rows that now have a file to show (sent link, or a download that worked). */
  fileFound: number;
  /** Rows still without a file: staff phone media Chakra and Meta would not serve. */
  fileMissing: number;
  /** Files Chakra shows as sent by link - the bot's. Zero means Chakra does not keep the link. */
  sentByLink: number;
  /** False when labels were left alone because sentByLink was 0 (see below). */
  labelsWritten: boolean;
  samples: string[];
}

/**
 * Applies today's rules to outbound photos and documents imported BEFORE 2026-11-10, which all
 * read "AI" with no file. The sync never revisits a row it has (dedup on wamid), so this walks
 * every Chakra chat once and patches the stored rows in place: sender label from the same
 * outboundSender() the sync uses, and the file from the link it was sent by or a fresh download.
 *
 * Read-only unless `apply`: a dry run downloads nothing and writes nothing. Texts are not here -
 * scripts/backfill-outbound-senders.ts relabels those with SQL alone.
 *
 * The label rule needs Chakra to keep the `link` the bot sent each file by. That is not verified
 * against a live Chakra (it was written without a token): if a whole walk finds no file sent by
 * link, the bot's own catalogues would all come out "Tim CS", so labels are left alone and only
 * files are attached.
 */
export async function repairOutboundFiles(opts: { apply: boolean }): Promise<OutboundRepairResult> {
  const out: OutboundRepairResult = { chats: 0, files: 0, relabelled: 0, fileFound: 0, fileMissing: 0, sentByLink: 0, labelsWritten: false, samples: [] };
  const patches: { id: string; senderName: string | null; oldSender: string | null; metadata: Record<string, unknown> }[] = [];
  const notifyWa = (getConfig().ESCALATION_NOTIFY_WA ?? '').replace(/\D/g, '');
  const counters: ChakraSyncResult = { chats: 0, messages: 0, mediaFailed: 0, errors: 0, truncated: false };

  for (let page = 1; ; page++) {
    const chats = await listChats(page, CHAT_PAGE_SIZE);
    if (chats.length === 0) break;
    for (const chat of chats) {
      if ((chat.provider ?? 'WHATSAPP') !== 'WHATSAPP') continue;
      out.chats++;
      const waId = (chat.primaryContactHandle?.value ?? '').replace(/\D/g, '');
      const isStaffNotifyChat = notifyWa !== '' && notifyWa === waId;
      for (let msgPage = 1; ; msgPage++) {
        const msgs = await listChatMessages(chat.id, msgPage, MESSAGE_PAGE_SIZE);
        if (msgs.length === 0) break;
        const files = msgs.filter((m) => m.direction !== 'INBOUND' && findAttachment(m) !== null);
        const rows = await findSyncedOutboundRows(files.map((m) => m.externalId ?? `chakra:${m.id}`));
        const byWamid = new Map(rows.map((r) => [r.waMessageId, r]));
        for (const msg of files) {
          const row = byWamid.get(msg.externalId ?? `chakra:${msg.id}`);
          if (!row) continue;
          out.files++;
          const ts = row.createdAt.getTime();
          const attachment = findAttachment(msg)!;
          // A dry run must not download: mapBody only when applying, or when the link alone answers it.
          const media: MediaMeta = { attachmentType: attachment.kind };
          if (attachment.link) {
            out.sentByLink++;
            media.sentByLink = true;
            media.mediaUrl = storedMediaUrl(attachment.link);
          } else if (opts.apply && !row.metadata['mediaUrl']) {
            Object.assign(media, (await mapBody(msg, row.waMessageId, ts, counters)).media);
          }
          const sender = await outboundSender(row.conversationId, msg, row.body, ts, isStaffNotifyChat, media);
          const senderName = sender === SKIP ? row.senderName : sender;
          const hasFile = Boolean(row.metadata['mediaUrl'] ?? media.mediaUrl);
          if (hasFile) out.fileFound++;
          else out.fileMissing++;
          const relabel = senderName !== row.senderName;
          if (relabel) out.relabelled++;
          if ((relabel || (!row.metadata['mediaUrl'] && media.mediaUrl)) && out.samples.length < 15) {
            out.samples.push(`${new Date(ts).toISOString().slice(0, 16)} ${attachment.kind} ${row.senderName ?? 'AI'} -> ${senderName ?? 'AI'}${attachment.link ? ' (sent by link)' : ''}: ${row.body.slice(0, 60)}`);
          }
          if (relabel || (!row.metadata['mediaUrl'] && media.mediaUrl)) {
            patches.push({ id: row.id, senderName, oldSender: row.senderName, metadata: storableMedia(media) });
          }
        }
        if (msgs.length < MESSAGE_PAGE_SIZE) break;
      }
    }
    if (chats.length < CHAT_PAGE_SIZE) break;
  }
  out.labelsWritten = out.sentByLink > 0;
  if (opts.apply) {
    for (const p of patches) {
      await patchSyncedOutboundRow(p.id, {
        senderName: out.labelsWritten ? p.senderName : p.oldSender,
        metadata: p.metadata,
      });
    }
  }
  return out;
}

const SKIP = Symbol('skip');

/**
 * Who sent an outbound row: null for the bot (or a customer's own message), a label for a person,
 * SKIP for a bot send already in the thread. Shared with the history repair below.
 */
async function outboundSender(
  conversationId: string,
  msg: ChakraMessage,
  body: string,
  ts: number,
  isStaffNotifyChat: boolean,
  media: MediaMeta
): Promise<string | null | typeof SKIP> {
  if (msg.direction === 'INBOUND') return null;
  if (msg.user) return 'Agen ChakraHQ';
  // The bot's escalation pings to the staff number go out without a stored wamid, like a PDF did.
  if (isStaffNotifyChat) return null;
  const kind = msg.dataType ?? 'text';
  const isFile = media.attachmentType === 'image' || media.attachmentType === 'document';
  if (kind !== 'text' && !isFile) return null; // audio, stickers, templates: no way to tell
  // The one way a bot send reaches here: it threw (or Chakra returned no id) after WhatsApp had
  // accepted it, so the row was stored without a wamid. Importing it would show it twice.
  if (await hasUnlinkedAssistantTwin(conversationId, body, new Date(ts))) return SKIP;
  // A file sent by link went through the API - the bot, or a dashboard upload.
  if (isFile && media.sentByLink) return null;
  return PHONE_REPLY_SENDER;
}

// ─── body + media mapping ───────────────────────────────────────────────────

interface MediaMeta {
  attachmentType?: string;
  mimeType?: string;
  filename?: string;
  mediaUrl?: string;
  /** Sent by URL through the API: the bot or the dashboard. Never stored, only read for the label. */
  sentByLink?: boolean;
}

interface Attachment {
  kind: 'image' | 'document';
  mediaId: string | null;
  /** The URL a file was SENT by (bot, dashboard). Absent on anything typed on the phone or received. */
  link: string | null;
  mimeType: string | null;
  filename: string | null;
  caption: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// Chakra's `body` is the raw provider payload, so Meta's shapes apply:
//   image    -> { image:    { id, mime_type, caption } }
//   document -> { document: { id, mime_type, filename, caption } }
// `attachments` is undocumented (null in every Chakra example), so it's only a fallback.
function findAttachment(msg: ChakraMessage): Attachment | null {
  const body = asRecord(msg.body);
  for (const kind of ['image', 'document'] as const) {
    const node = asRecord(body?.[kind]);
    if (!node) continue;
    return {
      kind,
      mediaId: str(node['id']) ?? fallbackAttachmentId(msg),
      link: str(node['link']),
      mimeType: str(node['mime_type']),
      filename: str(node['filename']),
      caption: str(node['caption']),
    };
  }
  if (msg.dataType === 'image' || msg.dataType === 'document') {
    return { kind: msg.dataType, mediaId: fallbackAttachmentId(msg), link: null, mimeType: null, filename: null, caption: null };
  }
  return null;
}

function fallbackAttachmentId(msg: ChakraMessage): string | null {
  if (!Array.isArray(msg.attachments)) return null;
  for (const item of msg.attachments) {
    if (typeof item === 'string') return item;
    const rec = asRecord(item);
    if (!rec) continue;
    const id = str(rec['mediaId']) ?? str(rec['mid']) ?? str(rec['id']);
    if (id) return id;
  }
  return null;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

// messages.body is NOT NULL, so every branch here has to produce a string.
async function mapBody(
  msg: ChakraMessage,
  waMessageId: string,
  ts: number,
  result: ChakraSyncResult
): Promise<{ body: string; media: MediaMeta }> {
  const text = (msg.text ?? str(asRecord(asRecord(msg.body)?.['text'])?.['body']) ?? '').trim();
  const attachment = findAttachment(msg);

  if (!attachment) {
    // Audio, video, stickers, location, templates: keep the text, mark the type, no download.
    if (text) return { body: text, media: {} };
    return { body: msg.dataType ? `[${msg.dataType}]` : '[pesan kosong]', media: {} };
  }

  const media: MediaMeta = { attachmentType: attachment.kind };
  if (attachment.mimeType) media.mimeType = attachment.mimeType;
  if (attachment.filename) media.filename = attachment.filename;

  if (attachment.link) {
    // Our own file, still where we sent it from: show that, no download needed.
    media.sentByLink = true;
    media.mediaUrl = storedMediaUrl(attachment.link);
  } else if (attachment.mediaId) {
    try {
      const file = await downloadWithFallback(attachment.mediaId);
      media.mediaUrl = await saveMedia(file, waMessageId, ts, attachment.filename);
      if (!media.mimeType) media.mimeType = file.mimeType;
    } catch (err) {
      // WhatsApp expires media ids after ~30 days, so a deep backfill legitimately 404s on old
      // photos. Keep the caption and the attachment marker — just no file.
      result.mediaFailed++;
      console.warn(
        `[chakraSync] media ${attachment.mediaId} unavailable:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const placeholder = attachment.kind === 'image' ? '[Foto]' : '[Dokumen]';
  return { body: text || attachment.caption || attachment.filename || placeholder, media };
}

function storableMedia({ sentByLink: _sentByLink, ...rest }: MediaMeta): Omit<MediaMeta, 'sentByLink'> {
  return rest;
}

// Chakra's Show Media API, then Meta Graph when META_ACCESS_TOKEN is set - the webhook's order
// (fetchInboundMedia in routes/webhooks.ts). Chakra 404s on newer media ids, so without the second
// a photo staff sent off the phone never had a file to show.
async function downloadWithFallback(mediaId: string): Promise<{ base64: string; mimeType: string }> {
  try {
    return await downloadMedia(mediaId);
  } catch (err) {
    if (!getConfig().META_ACCESS_TOKEN) throw err;
    return metaDownloadMedia(mediaId);
  }
}

function extFromName(name: string | null): string | null {
  const parts = (name ?? '').split('.');
  if (parts.length < 2) return null;
  const ext = (parts[parts.length - 1] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ext.length > 0 && ext.length <= 8 ? ext : null;
}

async function saveMedia(
  file: { base64: string; mimeType: string },
  waMessageId: string,
  ts: number,
  originalName: string | null
): Promise<string> {
  const dir = join(process.cwd(), 'uploads', 'inbound');
  await mkdir(dir, { recursive: true });
  const mime = file.mimeType.split(';')[0]?.trim() ?? '';
  // Prefer the mime map; fall back to the document's own extension (.docx, .xlsx … aren't
  // worth enumerating) before giving up on .bin.
  const ext = EXTENSIONS[mime] ?? extFromName(originalName) ?? 'bin';
  // Message timestamp, not Date.now(), so a re-download would overwrite rather than pile up.
  const filename = `${ts}_${waMessageId.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
  await writeFile(join(dir, filename), Buffer.from(file.base64, 'base64'));
  return `/uploads/inbound/${filename}`;
}
