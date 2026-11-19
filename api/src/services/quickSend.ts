import { extname } from 'path';
import type { BrandSlug } from '../domain/orderProfile.js';
import { BRAND_NAME } from '../domain/brands.js';
import { contactHeadline } from '../domain/orderDetails.js';
import { MESSAGE_SOURCE } from '../domain/messageSources.js';
import { isPoFormPlaceholder, poFormMessage } from '../domain/constants.js';
import { findConversationById, insertMessage } from '../repositories/conversations.js';
import { findContactById } from '../repositories/contacts.js';
import { findPhoneNumberById } from '../repositories/phoneNumbers.js';
import { getContactProfile } from '../repositories/contactProfiles.js';
import { getBrandRowsBySlug } from '../repositories/products.js';
import { listReferenceImageUrls, productExists } from '../repositories/referenceImages.js';
import { getPoFormUrl } from '../repositories/appSettings.js';
import { sendDocumentMessage, sendImageMessage, sendTextMessage } from './whatsappSender.js';
import { outboundMediaRow } from './outboundMedia.js';
import { markHumanTakeover } from './humanTakeover.js';

export type QuickSendAction = { kind: 'price_list'; brand?: BrandSlug } | { kind: 'reference_photos'; productId: string } | { kind: 'po_form' };
export type QuickSendError = 'NOT_FOUND' | 'BRAND_UNKNOWN' | 'NO_PRICE_LIST' | 'NO_REFERENCE_PHOTOS' | 'PO_FORM_PLACEHOLDER';
/** One stored row per item, in send order; `status` 'saved' = the provider refused it (the dashboard shows "gagal terkirim"). */
export type QuickSendItem = { messageId: string; kind: 'text' | 'image' | 'document'; status: 'sent' | 'saved' };
export type QuickSendResult = { ok: true; sent: QuickSendItem[] } | { ok: false; error: QuickSendError };

type Item =
  | { kind: 'text'; body: string; source: string }
  | { kind: 'image' | 'document'; link: string; filename?: string; source: string; extra: Record<string, unknown> };

const IMAGE_MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/** What the action sends, in order - or why nothing can go. Nothing is sent here. */
async function itemsFor(action: QuickSendAction, contactId: string): Promise<Item[] | QuickSendError> {
  if (action.kind === 'po_form') {
    // The placeholder link never reaches a customer, from the bot or from staff.
    const url = await getPoFormUrl();
    if (isPoFormPlaceholder(url)) return 'PO_FORM_PLACEHOLDER';
    return [{ kind: 'text', body: poFormMessage(url), source: MESSAGE_SOURCE.poForm }];
  }

  if (action.kind === 'reference_photos') {
    if (!(await productExists(action.productId))) return 'NOT_FOUND';
    // Sort order, at most 3. Only reference photos: the bot never sends a product's own image_url either.
    const urls = (await listReferenceImageUrls([action.productId])).get(action.productId) ?? [];
    if (urls.length === 0) return 'NO_REFERENCE_PHOTOS';
    return urls.map((url) => {
      const mimeType = IMAGE_MIME[extname(url).toLowerCase()];
      return { kind: 'image', link: url, source: MESSAGE_SOURCE.referencePhoto, extra: { productId: action.productId, ...(mimeType && { mimeType }) } };
    });
  }

  // The brand asked for, else every brand the customer's profile names (BRAND_SLUGS order).
  const slugs = action.brand ? [action.brand] : contactHeadline((await getContactProfile(contactId))?.profile, null).brands;
  if (slugs.length === 0) return 'BRAND_UNKNOWN';
  const rows = await getBrandRowsBySlug();
  const items: Item[] = [];
  for (const slug of slugs) {
    const row = rows[slug];
    if (!row?.catalogFileUrl) continue;
    items.push({
      kind: 'document',
      link: row.catalogFileUrl,
      // The name the bot sends it under (catalogDelivery).
      filename: row.catalogFileName ?? `Daftar Harga ${BRAND_NAME[slug]}.pdf`,
      source: MESSAGE_SOURCE.priceList,
      // The brand's name, as on the bot's own price-list rows.
      extra: { brand: BRAND_NAME[slug], mimeType: 'application/pdf' },
    });
  }
  return items.length > 0 ? items : 'NO_PRICE_LIST';
}

/**
 * One-click sends from the Percakapan screen: a brand's price list, a product's reference photos or
 * the PO form link, to the customer through whatsappSender. Best effort, like POST /api/v1/send:
 * every item is stored as the staff member's row - 'sent', or 'saved' when the provider refused it,
 * returned per item so the dashboard can say which failed - and once the batch is out, the chat is
 * handed to that staff member (the AI stops) if at least one item went. A refusal (no brand known,
 * no file, no photos, the placeholder PO link) sends and stores nothing.
 */
export async function quickSend(conversationId: string, action: QuickSendAction, staffName: string): Promise<QuickSendResult> {
  const conversation = await findConversationById(conversationId);
  if (!conversation) return { ok: false, error: 'NOT_FOUND' };

  const items = await itemsFor(action, conversation.contactId);
  if (typeof items === 'string') return { ok: false, error: items };

  const [phoneNumber, contact] = await Promise.all([
    findPhoneNumberById(conversation.phoneNumberId),
    findContactById(conversation.contactId),
  ]);
  if (!phoneNumber || !contact) return { ok: false, error: 'NOT_FOUND' };

  const sent: QuickSendItem[] = [];
  for (const item of items) {
    let wamid: string | null = null;
    try {
      wamid = item.kind === 'text'
        ? await sendTextMessage(phoneNumber.phoneNumberId, contact.waId, item.body)
        : item.kind === 'image'
          ? await sendImageMessage(phoneNumber.phoneNumberId, contact.waId, item.link, '')
          : await sendDocumentMessage(phoneNumber.phoneNumberId, contact.waId, item.link, item.filename ?? '');
    } catch { /* whatsappSender logged the provider's reason; stored below as 'saved' */ }
    const status = wamid !== null ? 'sent' : 'saved';

    const row = await insertMessage(item.kind === 'text'
      ? {
        conversationId, role: 'assistant', body: item.body, waMessageId: wamid || undefined, status,
        senderName: staffName, metadata: { source: item.source },
      }
      : outboundMediaRow({
        conversationId, kind: item.kind, link: item.link, wamid: wamid ?? '', filename: item.filename,
        senderName: staffName, source: item.source, extra: item.extra, status,
      }));
    sent.push({ messageId: row.id, kind: item.kind, status });
  }

  // Once the batch is out, so the takeover note follows the last item; not when nothing went.
  if (sent.some((s) => s.status === 'sent')) await markHumanTakeover(conversationId, staffName).catch(() => { });
  return { ok: true, sent };
}
