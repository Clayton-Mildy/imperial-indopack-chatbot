/**
 * The right-hand panel of the dashboard's Percakapan screen: which of the six order details the bot
 * has collected (domain/orderDetails.ts), the nearest catalog item and price for each requested item
 * (services/nearestCatalog.ts, over the same catalog the bot quotes from), the files the customer
 * sent, the contact's current lead, and the team's own notes.
 */

import { contactHeadline, orderDetailRows, profileFacts, type OrderDetailRow } from '../domain/orderDetails.js';
import { sanitizeItem, type BrandSlug } from '../domain/orderProfile.js';
import { poFormsForOrder, type PoFormKind } from '../domain/poForms.js';
import type { LeadKind, LeadStatus, Message } from '../domain/types.js';
import { findConversationById, listCustomerFileMessages, teamNotesOf, type TeamNotes } from '../repositories/conversations.js';
import { getContactProfile } from '../repositories/contactProfiles.js';
import { findCurrentLeadForContact } from '../repositories/leads.js';
import { getCatalogProducts } from './ragQuery.js';
import { nearestCatalogItems, type NearestMatch } from './nearestCatalog.js';

export type { TeamNotes } from '../repositories/conversations.js';

export interface CustomerFile { messageId: string; kind: 'image' | 'document'; url: string | null; filename: string; at: string }

export type PanelDetailRow = OrderDetailRow & { note?: { kind: 'out_of_catalog' } | { kind: 'file_sent'; at: string } };

export interface OrderPanel {
  brands: BrandSlug[];
  lead: { id: string; status: LeadStatus; kind: LeadKind; temperature: 'hot' | 'cold' | null } | null;
  details: PanelDetailRow[];
  detailsFilled: number;
  nearest: NearestMatch[];
  /** Newest first. */
  files: CustomerFile[];
  teamNotes: TeamNotes;
  /** The PO form(s) the bot would send for this order (poFormsForOrder): the quick-send dialog's default. */
  suggestedPoForms: PoFormKind[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** A stored inbound photo or document as the panel lists it; the name falls back to the saved file's. */
function customerFile(m: Message): CustomerFile {
  const meta = m.metadata ?? {};
  const url = nonEmpty(meta['mediaUrl']);
  return {
    messageId: m.id,
    kind: meta['attachmentType'] === 'document' ? 'document' : 'image',
    url,
    filename: nonEmpty(meta['filename']) ?? (url ? url.split(/[?#]/)[0]!.split('/').pop() ?? '' : ''),
    at: m.createdAt.toISOString(),
  };
}

export async function getOrderPanel(conversationId: string): Promise<OrderPanel | null> {
  const conversation = await findConversationById(conversationId);
  if (!conversation) return null;

  const [profile, lead, fileRows, catalog] = await Promise.all([
    getContactProfile(conversation.contactId),
    findCurrentLeadForContact(conversation.contactId),
    listCustomerFileMessages(conversationId),
    getCatalogProducts(),
  ]);

  const facts = profileFacts(profile?.profile);
  const items = (Array.isArray(facts.items) ? facts.items : []).filter(isRecord).map(sanitizeItem);
  const sized = items.filter((i) => i.size);
  const matches = sized.flatMap((i) => {
    const found = nearestCatalogItems(i, catalog);
    // An item with no match at all still flags the size row: the catalog has nothing for it.
    return found.length > 0 ? found : [null];
  });
  const files = fileRows.map(customerFile);

  // The size row is flagged when any item with a size has no exact catalog size; the design row
  // points at the newest file the customer sent.
  const outOfCatalog = matches.some((m) => !m?.exact);
  const details: PanelDetailRow[] = orderDetailRows(facts).map((row) => {
    if (row.key === 'size' && outOfCatalog) return { ...row, note: { kind: 'out_of_catalog' } };
    if (row.key === 'design' && files[0]) return { ...row, note: { kind: 'file_sent', at: files[0].at } };
    return row;
  });

  return {
    brands: contactHeadline(facts, null).brands,
    lead: lead ? { id: lead.id, status: lead.status, kind: lead.kind, temperature: lead.leadTemperature } : null,
    details,
    detailsFilled: details.filter((d) => d.filled).length,
    nearest: matches.filter((m): m is NearestMatch => m !== null),
    files,
    teamNotes: teamNotesOf(conversation.teamNotes, conversation.teamNotesUpdatedAt, conversation.teamNotesUpdatedBy),
    suggestedPoForms: poFormsForOrder(facts),
  };
}
