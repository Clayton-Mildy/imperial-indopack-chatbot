import { insertMessage } from '../repositories/conversations.js';
import { getConfig } from '../config.js';

/**
 * Where the dashboard can load a file we sent by link. Our own /uploads files are stored as the
 * relative path (the dashboard puts the API's address in front); a file on the public tunnel
 * address is folded back to that same path, so it still loads when the tunnel's hostname changes.
 * Anything else (Chakra-hosted catalogues) stays absolute.
 */
export function storedMediaUrl(link: string): string {
  if (link.startsWith('/uploads/')) return link;
  const base = (getConfig().PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  if (base && link.startsWith(`${base}/uploads/`)) return link.slice(base.length);
  return link;
}

/**
 * Stores a photo or PDF the bot (or a dashboard user) just sent, under its wamid. Until 2026-11-10
 * these were never stored at send time: chakraSync imported them later with no file and no sender,
 * so the dashboard showed "Gambar dikirim" under an "AI" label - and, the bot's files being
 * indistinguishable from staff's, every photo staff sent off the phone was labelled "AI" too.
 * With the bot's files stored under their wamid, an outbound file the sync still finds new was
 * sent by a person (chakraSync's PHONE_REPLY_SENDER).
 *
 * Never throws: the file is already with the customer, and a failed insert must not turn into a
 * failed send.
 */
export async function recordOutboundMedia(opts: {
  conversationId: string;
  kind: 'image' | 'document';
  link: string;
  wamid: string;
  filename?: string | null;
  caption?: string | null;
  /** null = the bot; a staff name for a dashboard upload. */
  senderName?: string | null;
  source: string;
}): Promise<void> {
  const placeholder = opts.kind === 'image' ? '[Foto]' : '[Dokumen]';
  try {
    await insertMessage({
      conversationId: opts.conversationId,
      role: 'assistant',
      // Same body the sync gives an imported file, so the AI's history reads the same either way.
      body: opts.caption?.trim() || opts.filename || placeholder,
      waMessageId: opts.wamid || undefined,
      status: 'sent',
      senderName: opts.senderName ?? null,
      metadata: {
        source: opts.source,
        attachmentType: opts.kind,
        mediaUrl: storedMediaUrl(opts.link),
        ...(opts.filename && { filename: opts.filename }),
      },
    });
  } catch (err) {
    console.warn('[outboundMedia] could not store a sent file:', err instanceof Error ? err.message : err);
  }
}
