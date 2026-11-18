import { readFile, stat, writeFile } from 'fs/promises';
import { join, extname } from 'path';
import sharp from 'sharp';
import { getConfig } from '../config.js';

// Meta WhatsApp Cloud API client — same positional signatures as chakraClient's send
// fns, plus downloadMedia for inbound image handling.
// Ported from the original pre-monorepo legacy-api Meta implementation.

const META_API_BASE = 'https://graph.facebook.com';

function getToken(perNumberToken?: string | null): string {
  return perNumberToken || getConfig().META_ACCESS_TOKEN;
}

export async function sendTextMessage(
  phoneNumberId: string,
  to: string,
  text: string,
  accessToken?: string | null
): Promise<string> {
  const config = getConfig();
  const url = `${META_API_BASE}/${config.META_API_VERSION}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken(accessToken)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: to.split('@')[0], type: 'text', text: { body: text } }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Meta API error ${response.status}: ${errText}`);
  }
  const data = (await response.json()) as { messages?: Array<{ id: string }> };
  return data.messages?.[0]?.id ?? '';
}

// Meta media ids are reusable across sends, so re-uploading the same unchanged file
// (catalog PDF, product photo) on every send is pure wasted wall-clock. Keyed by
// phoneNumberId too — a media id belongs to the WABA number that uploaded it. mtime in
// the value invalidates naturally when the file is replaced. Meta expires ids eventually;
// senders evict + retry once on a failed send with a cached id.
const mediaIdCache = new Map<string, { id: string; mtimeMs: number }>();

function evictCachedMediaId(phoneNumberId: string, localPath: string): void {
  mediaIdCache.delete(`${phoneNumberId}:${localPath}`);
}

async function uploadLocalFileToMeta(
  localPath: string,
  mimeType: string,
  phoneNumberId: string,
  accessToken: string
): Promise<{ id: string; fromCache: boolean }> {
  const key = `${phoneNumberId}:${localPath}`;
  const { mtimeMs } = await stat(localPath);
  const hit = mediaIdCache.get(key);
  if (hit && hit.mtimeMs === mtimeMs) return { id: hit.id, fromCache: true };

  const config = getConfig();
  const buffer = await readFile(localPath);
  const filename = localPath.split('/').pop() ?? 'file';

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);

  const res = await fetch(`${META_API_BASE}/${config.META_API_VERSION}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Media upload failed: ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  mediaIdCache.set(key, { id: data.id, mtimeMs });
  return { id: data.id, fromCache: false };
}

export async function sendDocumentMessage(
  phoneNumberId: string,
  to: string,
  filePath: string,
  filename: string,
  accessToken?: string | null
): Promise<string> {
  const config = getConfig();
  const token = getToken(accessToken);
  const url = `${META_API_BASE}/${config.META_API_VERSION}/${phoneNumberId}/messages`;

  const post = async (documentBody: Record<string, string>): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.split('@')[0], type: 'document', document: documentBody }),
    });

  if (filePath.startsWith('/uploads/')) {
    const localPath = join(process.cwd(), filePath);
    const upload = await uploadLocalFileToMeta(localPath, 'application/pdf', phoneNumberId, token);
    let res = await post({ id: upload.id, filename });
    if (!res.ok && upload.fromCache && res.status < 500) {
      // Cached media id may have expired on Meta's side — re-upload fresh and retry once.
      evictCachedMediaId(phoneNumberId, localPath);
      const fresh = await uploadLocalFileToMeta(localPath, 'application/pdf', phoneNumberId, token);
      res = await post({ id: fresh.id, filename });
    }
    if (!res.ok) throw new Error(`Meta sendDocument error ${res.status}: ${await res.text()}`);
    return sentId(res);
  }

  const res = await post({ link: filePath, filename });
  if (!res.ok) throw new Error(`Meta sendDocument error ${res.status}: ${await res.text()}`);
  return sentId(res);
}

/** The wamid of an accepted send; '' when the body does not carry one. */
async function sentId(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { messages?: { id?: string }[] } | null;
    return data?.messages?.[0]?.id ?? '';
  } catch {
    return '';
  }
}

export async function sendImageMessage(
  phoneNumberId: string,
  to: string,
  imagePath: string,
  caption: string,
  accessToken?: string | null
): Promise<string> {
  const config = getConfig();
  const token = getToken(accessToken);
  const url = `${META_API_BASE}/${config.META_API_VERSION}/${phoneNumberId}/messages`;

  const post = async (imageBody: Record<string, string>): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.split('@')[0], type: 'image', image: imageBody }),
    });

  if (imagePath.startsWith('/uploads/')) {
    let localPath = join(process.cwd(), imagePath);
    const ext = extname(imagePath).slice(1).toLowerCase();

    // WhatsApp image messages only support JPEG/PNG — convert WebP to a sibling .jpg on
    // disk (mtime-cached, same as chakraClient) so the upload path below can media-id-cache it.
    let mime: string;
    if (ext === 'webp') {
      const jpgPath = localPath.replace(/\.webp$/i, '.jpg');
      let fresh = false;
      try {
        const [src, dst] = await Promise.all([stat(localPath), stat(jpgPath)]);
        fresh = dst.mtimeMs >= src.mtimeMs;
      } catch { /* dst missing — convert below */ }
      if (!fresh) await writeFile(jpgPath, await sharp(localPath).jpeg({ quality: 90 }).toBuffer());
      localPath = jpgPath;
      mime = 'image/jpeg';
    } else {
      const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
      mime = mimeMap[ext] ?? 'image/jpeg';
    }

    const upload = await uploadLocalFileToMeta(localPath, mime, phoneNumberId, token);
    let res = await post({ id: upload.id, caption });
    if (!res.ok && upload.fromCache && res.status < 500) {
      // Cached media id may have expired on Meta's side — re-upload fresh and retry once.
      evictCachedMediaId(phoneNumberId, localPath);
      const freshUpload = await uploadLocalFileToMeta(localPath, mime, phoneNumberId, token);
      res = await post({ id: freshUpload.id, caption });
    }
    if (!res.ok) throw new Error(`Meta sendImage error ${res.status}: ${await res.text()}`);
    return sentId(res);
  }

  const res = await post({ link: imagePath, caption });
  if (!res.ok) throw new Error(`Meta sendImage error ${res.status}: ${await res.text()}`);
  return sentId(res);
}

// Inbound media: resolve the CDN url from the media id, then download it (both bearer-authed).
export async function downloadMedia(
  mediaId: string,
  accessToken?: string | null
): Promise<{ base64: string; mimeType: string }> {
  const config = getConfig();
  const token = getToken(accessToken);

  const metaRes = await fetch(`${META_API_BASE}/${config.META_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`downloadMedia: Graph API error ${metaRes.status}: ${await metaRes.text()}`);
  const metaData = (await metaRes.json()) as { url?: string };
  if (!metaData.url) throw new Error(`downloadMedia: no url for mediaId=${mediaId}`);

  const binaryRes = await fetch(metaData.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!binaryRes.ok) throw new Error(`downloadMedia: binary fetch error ${binaryRes.status}`);

  const mimeType = binaryRes.headers.get('Content-Type') ?? 'image/jpeg';
  const base64 = Buffer.from(await binaryRes.arrayBuffer()).toString('base64');
  return { base64, mimeType };
}
