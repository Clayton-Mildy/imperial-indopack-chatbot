import { stat, writeFile } from 'fs/promises';
import { join, extname } from 'path';
import sharp from 'sharp';
import { getConfig } from '../config.js';

// ChakraHQ WhatsApp client — same positional signatures as metaClient.
// Chakra is a pass-through proxy over Meta's Cloud API: text/media request bodies are
// Meta's, only the base path (plugin-scoped), the token, and the send response field differ.
//
// IMPORTANT: Chakra's pass-through does NOT expose Meta's /media upload endpoint (it 404s), so
// everything sent from here goes by public LINK — WhatsApp fetches the file from PUBLIC_BASE_URL.
// ponytail: PUBLIC_BASE_URL must be publicly reachable (the tunnel hostname, not localhost).
// Images are normalized to JPEG/PNG (WhatsApp rejects webp by link); PDFs link as-is.
//
// Chakra DOES have its own upload API, outside the Meta pass-through:
//   POST {CHAKRA_BASE_URL}/v1/ext/plugin/whatsapp/{pluginId}/upload-public-media
//   multipart: file, filename  ->  { _data: { publicMediaUrl } }
// It returns a Chakra-hosted public URL (not a Meta media id), and absolute URLs pass through
// toLink() untouched — which is how large files such as the brand price lists
// (brands.catalog_file_url) are kept off this server's bandwidth.
// Large or rarely-changing files are uploaded once by hand rather than on every send;
// per-send upload would re-transfer the file each time.

// Plugin-scoped pass-through prefix: .../whatsapp/{pluginId}/api/{version}
function apiPrefix(): string {
  const c = getConfig();
  return `${c.CHAKRA_BASE_URL}/v1/ext/plugin/whatsapp/${c.CHAKRA_PLUGIN_ID}/api/${c.CHAKRA_API_VERSION}`;
}

function getToken(): string {
  return getConfig().CHAKRA_ACCESS_TOKEN;
}

// Local /uploads/* path -> a public URL WhatsApp can fetch; absolute URLs pass through.
function toLink(path: string): string {
  if (!path.startsWith('/uploads/')) return path;
  return getConfig().PUBLIC_BASE_URL.replace(/\/$/, '') + path;
}

// WhatsApp image-by-link only accepts JPEG/PNG (webp is sticker-only). Convert a local /uploads
// webp to a sibling .jpg once and send that; jpg/png and remote URLs pass through untouched.
// The converted .jpg on disk is the cache: skip the sharp re-encode when it's already newer
// than its source (mtime, not existence, so a re-uploaded webp at the same path re-converts).
async function ensureSendableImage(imagePath: string): Promise<string> {
  if (!imagePath.startsWith('/uploads/') || extname(imagePath).toLowerCase() !== '.webp') return imagePath;
  const jpgPath = imagePath.replace(/\.webp$/i, '.jpg');
  try {
    const [src, dst] = await Promise.all([stat(join(process.cwd(), imagePath)), stat(join(process.cwd(), jpgPath))]);
    if (dst.mtimeMs >= src.mtimeMs) return jpgPath;
  } catch { /* dst missing — convert below */ }
  const buf = await sharp(join(process.cwd(), imagePath)).jpeg({ quality: 90 }).toBuffer();
  await writeFile(join(process.cwd(), jpgPath), buf);
  return jpgPath;
}

export async function sendTextMessage(
  phoneNumberId: string,
  to: string,
  text: string,
  _accessToken?: string | null
): Promise<string> {
  const url = `${apiPrefix()}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: to.split('@')[0], type: 'text', text: { body: text } }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Chakra API error ${response.status}: ${errText}`);
  }
  const data = (await response.json()) as { _data?: { whatsappMessageId?: string } };
  return data._data?.whatsappMessageId ?? '';
}

export async function sendDocumentMessage(
  phoneNumberId: string,
  to: string,
  filePath: string,
  filename: string,
  _accessToken?: string | null
): Promise<string> {
  const url = `${apiPrefix()}/${phoneNumberId}/messages`;
  const documentBody = { link: toLink(filePath), filename };

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: to.split('@')[0], type: 'document', document: documentBody }),
  });
  if (!res.ok) throw new Error(`Chakra sendDocument error ${res.status}: ${await res.text()}`);
  return sentId(res);
}

// Same response shape as a text send. The wamid is what lets chakraSync tell the bot's own photos
// and PDFs from the ones staff send off the phone - see PHONE_REPLY_SENDER there.
async function sentId(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { _data?: { whatsappMessageId?: string } } | null;
    return data?._data?.whatsappMessageId ?? '';
  } catch {
    return '';
  }
}

export async function sendImageMessage(
  phoneNumberId: string,
  to: string,
  imagePath: string,
  caption: string,
  _accessToken?: string | null
): Promise<string> {
  const url = `${apiPrefix()}/${phoneNumberId}/messages`;
  const imageBody = { link: toLink(await ensureSendableImage(imagePath)), caption };

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: to.split('@')[0], type: 'image', image: imageBody }),
  });
  if (!res.ok) throw new Error(`Chakra sendImage error ${res.status}: ${await res.text()}`);
  return sentId(res);
}

// ─── Chat history (read APIs) ───────────────────────────────────────────────
// /v1/ext/chat is NOT plugin-scoped — it sits outside the Meta pass-through prefix above.
// Same base URL and bearer token, different path. Used by chakraSync to backfill history
// the webhook never saw (pre-webhook messages, and replies agents type in Chakra's inbox).

export interface ChakraChat {
  id: string;
  provider?: string | null;
  providerHandle?: string | null;
  providerHandleId?: string | null;
  primaryContact?: { name?: string | null } | null;
  primaryContactHandle?: { value?: string | null } | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface ChakraMessage {
  id: string;
  externalId?: string | null;
  dataType?: string | null;
  body?: Record<string, unknown> | null;
  text?: string | null;
  attachments?: unknown;
  deliveryStatus?: string | null;
  direction?: string | null;
  timestamp?: number | null;
  createdAt?: number | null;
  user?: string | null;
}

async function listFrom<T>(path: string, body: unknown): Promise<T[]> {
  const c = getConfig();
  const res = await fetch(`${c.CHAKRA_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.CHAKRA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Chakra ${path} error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { _data?: T[] };
  return data._data ?? [];
}

// Newest-updated first. Chakra caps limit at 100.
export function listChats(page: number, limit = 100): Promise<ChakraChat[]> {
  return listFrom<ChakraChat>('/v1/ext/chat', { orderField: 'updatedAt', limit, page });
}

// Chakra caps limit at 1000. Page ordering is not documented — chakraSync derives it from
// the returned timestamps rather than assuming.
export function listChatMessages(chatId: string, page: number, limit = 500): Promise<ChakraMessage[]> {
  return listFrom<ChakraMessage>(`/v1/ext/chat/${chatId}/message`, { limit, page });
}

// Inbound media download via Chakra's Show Media API: GET /v2/whatsapp/{ver}/media/{id}/show
// (NOT the /v1/ext/plugin apiPrefix path — that 404s). The Chakra bearer token authorizes it, and the
// answer is a 302 to a presigned S3 url that must be fetched WITHOUT our Authorization header - S3
// rejects a request carrying both ("Only one auth mechanism allowed"), and Chakra's docs say the
// client must not forward headers on that hop. fetch() happens to drop the header on a cross-origin
// redirect today; the hop is taken by hand so that stays true whatever the runtime does.
//
// Since 2026-09-21 this answers 404 for every newer inbound media id (verified on the ids of two
// PDFs forwarded 2026-09-24), although Chakra's own inbox still shows and downloads those files -
// its API no longer returns inbound messages at all. The 404 message says so, and webhooks.ts
// falls back to Meta.
const MEDIA_TIMEOUT_MS = 20_000; // one webhook's messages are handled in order: never hang them

export async function downloadMedia(
  mediaId: string,
  _accessToken?: string | null
): Promise<{ base64: string; mimeType: string }> {
  const c = getConfig();
  const url = `${c.CHAKRA_BASE_URL}/v2/whatsapp/${c.CHAKRA_API_VERSION}/media/${mediaId}/show`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${c.CHAKRA_ACCESS_TOKEN}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
  if (res.status === 404) {
    throw new Error(`Chakra's media API has no record of media ${mediaId} (404)`);
  }
  const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
  const file = location ? await fetch(location, { signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) }) : res;
  if (!file.ok) throw new Error(`Chakra downloadMedia error ${file.status}: ${(await file.text()).slice(0, 200)}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) throw new Error(`Chakra downloadMedia: empty body for media ${mediaId}`);
  return { base64: bytes.toString('base64'), mimeType: file.headers.get('content-type') ?? 'image/jpeg' };
}
