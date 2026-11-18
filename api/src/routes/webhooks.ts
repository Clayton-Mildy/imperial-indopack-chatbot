import crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../config.js';
import { BaileysInboundPayloadSchema } from '../domain/schemas.js';
import { routeInboundBaileysMessage } from '../services/messageRouter.js';
import { downloadMedia } from '../services/whatsappSender.js';
import { downloadMedia as metaDownloadMedia } from '../services/metaClient.js';

// Meta Cloud API webhook, also used by Chakra's pass-through webhook (Meta-format
// payloads). Feeds the monorepo's debounced pipeline (routeInboundBaileysMessage)
// by mapping each message into a BaileysInboundPayload.

// ─── Meta payload shape (only the bits we use) ──────────────────────────────
interface MetaMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  // Chakra's pass-through webhook includes a direct download `url` alongside the media id;
  // real Meta only sends the id (resolved via Graph API).
  image?: { id?: string; url?: string; mime_type?: string; caption?: string };
  document?: { id?: string; url?: string; mime_type?: string; filename?: string; caption?: string };
  // Present when the customer used WhatsApp's reply/quote: `id` is the wamid of the quoted
  // message. VERIFIED against ChakraHQ's live pass-through on 2026-08-30 - the field was
  // written against Meta's spec and carried over unchanged when the transport switched, so
  // until a real quote-reply was captured nobody could say whether Chakra stripped it.
  // Captured payload (tests/webhooks-quoted-reply.test.ts holds it verbatim):
  //   "context": { "from": "628...", "from_user_id": "ID.316...", "id": "wamid.HBgN..." }
  // Chakra adds `from_user_id`, which Meta does not send and we do not read.
  context?: { id: string; from?: string };
}
interface MetaValue {
  messages?: MetaMessage[];
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  // Which of OUR numbers the message arrived on. Load-bearing: replies must be sent AS this
  // number, and Chakra rejects a send from a phone_number_id its plugin does not own.
  metadata?: { phone_number_id?: string; display_phone_number?: string };
}
interface MetaWebhookBody {
  entry?: Array<{ changes?: Array<{ value?: MetaValue }> }>;
}

function skipHmac(): boolean {
  return getConfig().NODE_ENV === 'development' && process.env['SKIP_HMAC_IN_DEV'] === 'true';
}

function signatureValid(req: FastifyRequest): boolean {
  const config = getConfig();
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!raw) return false;

  // Chakra signs with X-Chakra-Signature-256 (raw hex, no 'sha256=' prefix, own secret);
  // Meta signs with X-Hub-Signature-256 ('sha256=' + hex, App Secret).
  const chakra = config.WHATSAPP_TRANSPORT === 'chakra';
  const secret = chakra ? config.CHAKRA_WEBHOOK_SECRET : config.META_WEBHOOK_SECRET;
  const header = req.headers[chakra ? 'x-chakra-signature-256' : 'x-hub-signature-256'];
  if (!secret || typeof header !== 'string') return false;

  const hex = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const expected = chakra ? hex : 'sha256=' + hex;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Download inbound media. NEVER throws: a failed download must not drop the message - the caption
// alone still lets the AI answer, and an uncaptioned photo gets a fixed reply in messageRouter.
//
// 1. The active transport by media id (Chakra's Show Media API / Meta Graph).
// 2. On the Chakra transport, Meta Graph directly when META_ACCESS_TOKEN is set. Since 2026-09-21
//    Chakra's media API 404s for every newer inbound media id (see chakraClient), so without this
//    every customer photo is unreadable. The token must have access to the production WABA.
// The webhook's own `url` (Meta lookaside) is the same file behind the same Meta auth - fetched
// without a token it answers 401 every time, so it is not tried.
async function fetchInboundMedia(
  id: string | undefined,
  log: FastifyRequest['log']
): Promise<{ base64: string; mimeType: string } | null> {
  if (!id) {
    log.warn('inbound media: the webhook carried no media id');
    return null;
  }
  try {
    return await downloadMedia(id);
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'inbound media: download failed');
  }
  const config = getConfig();
  if (config.WHATSAPP_TRANSPORT === 'chakra' && config.META_ACCESS_TOKEN) {
    try {
      return await metaDownloadMedia(id);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, 'inbound media: Meta Graph fallback failed');
    }
  }
  log.warn('inbound media: could not download - proceeding without media (caption only)');
  return null;
}

async function toInboundPayload(msg: MetaMessage, value: MetaValue, log: FastifyRequest['log']): Promise<unknown> {
  const fromJid = `${msg.from}@s.whatsapp.net`;
  // Voice and video keep their own type so the reply can name them; a sticker, location or contact
  // card is 'other' and must not be told its "pesan suara/video" cannot be opened (UAT F-12).
  const type = ['text', 'image', 'document', 'audio', 'video'].includes(msg.type) ? msg.type : 'other';

  let media: { base64: string; mimeType: string; filename: string | null } | null = null;
  if (msg.type === 'image' && (msg.image?.id || msg.image?.url)) {
    const m = await fetchInboundMedia(msg.image.id, log);
    if (m) media = { base64: m.base64, mimeType: m.mimeType, filename: null };
  } else if (msg.type === 'document' && (msg.document?.id || msg.document?.url)) {
    const m = await fetchInboundMedia(msg.document.id, log);
    if (m) media = { base64: m.base64, mimeType: m.mimeType, filename: msg.document.filename ?? null };
  }

  return {
    waMessageId: msg.id,
    from: msg.from,
    fromJid,
    timestamp: Number(msg.timestamp) || 0,
    type,
    // Meta's own type, kept on the row: 'other' covers stickers, locations, contact cards and more,
    // and a placeholder row that cannot say which of those it was cannot be diagnosed afterwards.
    providerType: msg.type,
    // Capture the caption on image/document messages — otherwise the customer's
    // actual question (e.g. "ada box seperti ini? butuh 2000 pcs") is lost and the AI
    // can only react to the picture.
    text: msg.text?.body ?? msg.image?.caption ?? msg.document?.caption ?? null,
    media,
    pushName: value.contacts?.[0]?.profile?.name ?? null,
    toPhoneNumberId: value.metadata?.phone_number_id ?? null,
    quotedWaMessageId: msg.context?.id ?? null,
    messageKey: { remoteJid: fromJid, fromMe: false, id: msg.id },
  };
}


// Events about a message rather than messages: a reaction, an edit, a deletion. They arrive in
// `messages` like anything else, and used to become a "[Pelanggan mengirim pesan]" row answered with
// "pesan ini belum bisa aku buka" - live 2026-10-06 a customer got that line twice in one minute for
// two things nobody could see in the chat. There is nothing in them to answer.
const NOT_A_MESSAGE = new Set(['reaction', 'edit', 'revoke']);

async function processWebhook(body: MetaWebhookBody, log: FastifyRequest['log']): Promise<void> {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      for (const msg of value?.messages ?? []) {
        if (NOT_A_MESSAGE.has(msg.type)) {
          log.info({ type: msg.type, from: msg.from }, 'Meta webhook: not a message, ignoring');
          continue;
        }
        try {
          const parsed = BaileysInboundPayloadSchema.safeParse(await toInboundPayload(msg, value!, log));
          if (!parsed.success) {
            log.warn({ err: parsed.error }, 'Meta webhook: unmappable message, skipping');
            continue;
          }
          await routeInboundBaileysMessage(parsed.data);
        } catch (err) {
          log.error({ err }, 'Meta webhook: error handling message');
        }
      }
    }
  }
}

// ─── Handlers (registered on both /webhook and /webhooks/whatsapp) ──────────
function verifyHandler(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const q = request.query as Record<string, string | undefined>;
  const token = getConfig().META_WEBHOOK_VERIFY_TOKEN;
  if (q['hub.mode'] === 'subscribe' && token && q['hub.verify_token'] === token) {
    return reply.code(200).type('text/plain').send(q['hub.challenge'] ?? '');
  }
  // Bare GET (no hub params) — treat as health check
  if (!q['hub.mode'] && !q['hub.verify_token'] && !q['hub.challenge']) {
    return reply.code(200).send('OK');
  }
  return reply.code(403).send({ error: 'verification_failed' });
}

function receiveHandler(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (!skipHmac() && !signatureValid(request)) {
    // Return 200 (don't leak rejection / trigger provider retry storms), skip processing.
    // Log the signature headers seen so a first-run header/prefix mismatch is obvious.
    request.log.warn(
      {
        hubSig: request.headers['x-hub-signature-256'] ? 'present' : 'absent',
        chakraSig: request.headers['x-chakra-signature-256'] ? 'present' : 'absent',
      },
      'Webhook: HMAC verification failed — ignoring'
    );
    return reply.code(200).send();
  }
  reply.code(200).send();
  processWebhook(request.body as MetaWebhookBody, request.log).catch((err: unknown) => {
    request.log.error({ err }, 'Meta webhook: processing failed');
  });
  return reply;
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // Capture the raw body (encapsulated to this plugin) for exact-bytes HMAC.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as unknown as { rawBody?: Buffer }).rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString() || '{}'));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  // Serve both the original path (/webhook) and the one configured on Meta (/webhooks/whatsapp).
  for (const path of ['/webhook', '/webhooks/whatsapp']) {
    app.get(path, verifyHandler);
    app.post(path, receiveHandler);
  }
}
