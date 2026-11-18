import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { basename, dirname, extname, join, resolve } from 'path';
import { getConfig } from '../config.js';

// Local-testing WhatsApp transport: same positional signatures as chakraClient / metaClient, but
// every send is appended to a JSONL file instead of reaching a customer, and inbound media is
// read from a fixtures folder. Selected with WHATSAPP_TRANSPORT=capture (refused in production).

export interface CapturedMessage {
  id: string;
  at: string;
  kind: 'text' | 'image' | 'document';
  phoneNumberId: string;
  to: string;
  text?: string;
  path?: string;
  caption?: string;
  filename?: string;
}

const digits = (to: string): string => (to.split('@')[0] ?? '').replace(/\D/g, '');

function record(entry: Omit<CapturedMessage, 'id' | 'at' | 'to'> & { to: string }): string {
  const id = `capture-${randomUUID()}`;
  const logPath = resolve(getConfig().CAPTURE_LOG_PATH);
  mkdirSync(dirname(logPath), { recursive: true });
  const line: CapturedMessage = { id, at: new Date().toISOString(), ...entry, to: digits(entry.to) };
  appendFileSync(logPath, JSON.stringify(line) + '\n');
  return id;
}

export async function sendTextMessage(phoneNumberId: string, to: string, text: string): Promise<string> {
  return record({ kind: 'text', phoneNumberId, to, text });
}

export async function sendImageMessage(phoneNumberId: string, to: string, imagePath: string, caption: string): Promise<string> {
  return record({ kind: 'image', phoneNumberId, to, path: imagePath, caption });
}

export async function sendDocumentMessage(phoneNumberId: string, to: string, filePath: string, filename: string): Promise<string> {
  return record({ kind: 'document', phoneNumberId, to, path: filePath, filename });
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

export async function downloadMedia(mediaId: string): Promise<{ base64: string; mimeType: string }> {
  if (!mediaId || basename(mediaId) !== mediaId || mediaId === '..' || mediaId === '.') {
    throw new Error(`capture downloadMedia: invalid media id`);
  }
  const mimeType = MIME[extname(mediaId).toLowerCase()];
  if (!mimeType) throw new Error(`capture downloadMedia: unsupported file type for ${mediaId}`);
  const bytes = await readFile(join(resolve(getConfig().CAPTURE_MEDIA_DIR), mediaId));
  return { base64: bytes.toString('base64'), mimeType };
}

export function readCaptured(logPath: string, filter?: { to?: string; afterId?: string }): CapturedMessage[] {
  if (!existsSync(logPath)) return [];
  let rows = readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as CapturedMessage);
  if (filter?.afterId) {
    const i = rows.findIndex((r) => r.id === filter.afterId);
    if (i >= 0) rows = rows.slice(i + 1);
  }
  if (filter?.to) {
    const want = digits(filter.to);
    rows = rows.filter((r) => r.to === want);
  }
  return rows;
}
