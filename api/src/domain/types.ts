// Pure TypeScript types — no imports from Fastify, Drizzle, or services

export type ConversationStatus = 'active' | 'escalated' | 'resolved' | 'needs_human';
export type MessageRole = 'user' | 'assistant' | 'system_note';
export type StaffRole = 'admin' | 'agent' | 'marketing';
export type AIConfidence = 'high' | 'low';
export type StockStatus = 'normal' | 'no_stock' | 'price_rise' | 'price_drop';

import type { PriceTier } from './pricing.js';
import type { BrandSlug, OrderItem } from './orderProfile.js';

export type Brand = {
  id: string;
  name: string;
  description: string | null;
  catalogFileUrl: string | null;
  brandType: string;
  createdAt: string;
};

export type Category = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

export type Uom = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

export type ProductVariant = {
  id: string;
  productId: string;
  name: string;
  sku: string | null;
  priceIdr: number | null;
  /** Legacy marketplace price (the tiered price list replaced it). null means "tanya tim". */
  mpPriceIdr: number | null;
  isiCtn: number | null;
  isiBox: number | null;
  uomPriceId: string | null;
  mpUomId: string | null;
  uomCtnId: string | null;
  uomBoxId: string | null;
  minOrderQty: number | null;
  minOrderUomId: string | null;
  uomPrice?: Uom;
  /** Legacy marketplace-price unit (unused by the tiered price list). */
  mpUom?: Uom;
  uomCtn?: Uom;
  uomBox?: Uom;
  uomMinOrder?: Uom;
  priceTiers?: PriceTier[];
  imageUrl: string | null;
  stockStatus: StockStatus;
  isActive: boolean;
  description: string | null;
  sourceUrl: string | null;
  scrapedAt: string | null;
  sourceHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductTier = 'economic' | 'mid' | 'premium';

export type Product = {
  id: string;
  brandId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  fungsi: string | null;
  usp: string | null;
  kataKunci: string | null;
  kelengkapan: string | null;
  bahan: string | null;
  ketebalan: string | null;
  imageUrl: string | null;
  tier?: ProductTier | null;
  relatedProductIds?: string[] | null;
  upsellProductId?: string | null;
  createdAt: string;
  updatedAt: string;
  brand?: Brand;
  category?: Category | null;
  variants?: ProductVariant[];
  referenceImageUrls?: string[];
};

export type PromptSection = { name: string; content: string };
export type PromptSections = PromptSection[];

export interface PhoneNumber {
  id: string;
  number: string;
  label: string | null;
  wabaId: string;
  phoneNumberId: string;
  metaAccessToken: string | null;
  customSystemPrompt: string | null;
  promptSections: PromptSections | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Contact {
  id: string;
  waId: string;
  displayName: string | null;
  /** null = follow the global default; true/false pins this contact. */
  aiEnabled: boolean | null;
  firstSeen: Date;
  lastSeen: Date;
}

/** A contact plus its extracted CRM profile, for the contacts list. */
export interface ContactWithProfile extends Contact {
  conversationId: string | null;
  customerType: CustomerType | null;
  profile: Record<string, unknown>;
  followUpStatus: ContactProfileFollowUpStatus | null;
  followUpNotes: string | null;
}

export interface Conversation {
  id: string;
  contactId: string;
  phoneNumberId: string;
  status: ConversationStatus;
  escalationReason: string | null;
  assignedAgent: string | null;
  conversationSummary: string | null;
  followUpNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ContactProfileFollowUpStatus = 'none' | 'needs_followup' | 'done';
// The contact_profiles.customer_type column and the contacts filter on it are kept for old rows;
// the bot no longer asks or writes a buyer type (Imperial prices by quantity tier, not by buyer).
export type CustomerType = 'reseller' | 'end_user' | 'project';

export interface ContactProfile {
  id: string;
  contactId: string;
  customerType: CustomerType | null;
  profile: Record<string, unknown>;
  followUpStatus: ContactProfileFollowUpStatus;
  followUpNotes: string | null;
  updatedAt: Date;
}

// ─── Leads ─────────────────────────────────────────────────────────────────

export type LeadStatus = 'new' | 'contacted' | 'quoted' | 'won' | 'lost';

/** The numbers behind the daily "Ringkasan" page (repositories/leadReport.ts has the definitions). */
export interface LeadReport {
  newLeads: number;
  returningLeads: number;
  contactedLeads: number;
  won: number;
  lost: number;
  conversionPct: number | null;
  avgDaysToClose: number | null;
  daily: { day: string; newLeads: number; contacted: number }[];
  funnel: Record<LeadStatus, number>;
  lostReasons: { reason: LostReason | null; count: number }[];
  unreplied: {
    leadId: string;
    name: string | null;
    waId: string | null;
    status: LeadStatus;
    lastMessage: string;
    waitingSince: string;
  }[];
}

export const LEAD_STATUSES: readonly LeadStatus[] = ['new', 'contacted', 'quoted', 'won', 'lost'];

/** How warm the lead is, as judged by the model each turn. */
export type LeadTemperature = 'hot' | 'cold';

export const LEAD_TEMPERATURES: readonly LeadTemperature[] = ['hot', 'cold'];

/** The bucket organic (no request_id) leads are grouped under in the campaign report. */
export const ORGANIC_CAMPAIGN = 'Organik';

export type LeadKind = 'lead' | 'kurir' | 'status_pesanan' | 'lamaran_kerja' | 'supplier' | 'lainnya';
export const LEAD_KINDS: readonly LeadKind[] = ['lead', 'kurir', 'status_pesanan', 'lamaran_kerja', 'supplier', 'lainnya'];

export type LeadKindSetBy = 'ai' | 'rule' | 'staff';

export type LostReason =
  | 'barang_tidak_ada'
  | 'harga'
  | 'beli_di_tempat_lain'
  | 'tidak_jadi'
  | 'tidak_cocok'
  | 'tidak_ada_respon'
  | 'lainnya';
export const LOST_REASONS: readonly LostReason[] = [
  'barang_tidak_ada',
  'harga',
  'beli_di_tempat_lain',
  'tidak_jadi',
  'tidak_cocok',
  'tidak_ada_respon',
  'lainnya',
];

export type LeadActor = 'ai' | 'staff' | 'system';

export interface LeadEvent {
  id: string;
  leadId: string;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus | null;
  fromKind: LeadKind | null;
  toKind: LeadKind | null;
  actor: LeadActor;
  staffId: string | null;
  evidence: string | null;
  messageId: string | null;
  createdAt: Date;
}

export interface Lead {
  id: string;
  /** null = organic walk-in; set = arrived through a marketing form. */
  requestId: string | null;
  contactId: string | null;
  utmId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  /** Form answers, keys vary per landing page. */
  payload: Record<string, unknown>;
  status: LeadStatus;
  /** Accumulated from the per-order totals the live bot reports, unless staff set it (dealValueSetAt). */
  dealValueIdr: number | null;
  /** Model-maintained; no human editor. */
  leadTemperature: LeadTemperature | null;
  /** The count of lead_orders (customer messages that placed an order), unless staff set it (totalOrdersSetAt). */
  totalOrders: number;
  /** The status lock: non-null once staff set the status - the AI then leaves it alone. */
  humanUpdatedAt: Date | null;
  statusSetBy: string | null;
  /** Staff typed the order count: the AI never writes it again. */
  totalOrdersSetAt: Date | null;
  totalOrdersSetBy: string | null;
  /** Staff typed the deal value: the AI never writes it again. */
  dealValueSetAt: Date | null;
  dealValueSetBy: string | null;
  /** Brands the customer asked about, and their item lines. */
  brands: BrandSlug[];
  items: OrderItem[];
  /** Staff edited brands/items: the AI pass leaves them alone. */
  orderFieldsSetAt: Date | null;
  orderFieldsSetBy: string | null;
  submittedAt: Date;
  matchedAt: Date | null;
  kind: LeadKind;
  /** 'staff' locks kind against the AI. */
  kindSetBy: LeadKindSetBy | null;
  lostReason: LostReason | null;
  /** Customer message quoted for the current Won/Lost. */
  outcomeEvidence: string | null;
  outcomeMessageId: string | null;
  /** When it became Won/Lost; cleared on reopen. */
  closedAt: Date | null;
  /** The Lost lead this one came back from. */
  previousLeadId: string | null;
  firstContactAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A lead plus everything known about the person behind it.
 *
 * The contact_profiles half (customer type, AI-extracted facts, follow-up state, the AI
 * toggle) used to have its own /contacts page. After the backfill every contact has exactly
 * one lead, so the two lists were the same rows with different columns — this is the merged
 * shape that replaced both.
 */
export interface LeadWithContact extends Lead {
  waId: string | null;
  displayName: string | null;
  conversationId: string | null;
  conversationStatus: ConversationStatus | null;
  /** When the WhatsApp thread began - conversations.created_at, not submitted_at. */
  conversationStartedAt: Date | null;
  /** The newest customer/bot/staff message in any of the contact's chats. */
  lastChatAt: Date | null;
  /** Who set each staff-locked field (null when the AI owns it, or the account was removed). */
  statusSetByName: string | null;
  totalOrdersSetByName: string | null;
  dealValueSetByName: string | null;
  /** Profile `name` / `business_name`, for the list columns. */
  name: string | null;
  company: string | null;
  /** The AI-extracted profile — distinct from `payload`, which is the marketing form. */
  contactProfile: Record<string, unknown>;
  followUpStatus: ContactProfileFollowUpStatus | null;
  followUpNotes: string | null;
  /** null = follow the global default; true/false pins this contact. */
  aiEnabled: boolean | null;
  lastSeen: Date | null;
  /** When the customer's unanswered newest message arrived; null when the bot/staff spoke last. */
  waitingSince: Date | null;
}

export interface LeadCampaignSummary {
  campaign: string;
  source: string | null;
  leads: number;
  /** Leads that actually reached WhatsApp. Always equals `leads` for the organic bucket. */
  chats: number;
  escalated: number;
  won: number;
  lost: number;
  dealValueIdr: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  body: string;
  waMessageId: string | null;
  status: string | null;
  senderName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}


export interface StaffProfile {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: StaffRole;
  isActive: boolean;
  language: 'id' | 'en';
  createdAt: Date;
}

// Safe public projection — never includes passwordHash
export interface StaffProfilePublic {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  isActive: boolean;
  language: 'id' | 'en';
  createdAt: Date;
}

export interface ApiKey {
  id: string;
  keyHash: string;
  label: string;
  createdBy: string | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface AIResponse {
  message: string;
  confidence: AIConfidence;
  escalationReason?: string;
  topicsDetected?: string[];
  /** Set when the turn asks for the price list; which file goes out is catalogDelivery's call, never this value. */
  catalogUrl?: string;
  /** Reference photos of the recommended product (at most 3, in order), sent after the text. */
  imageUrls?: string[];
  /** The customer just agreed to buy at the quoted price: the PO form link from settings follows the reply. */
  sendPoForm?: boolean;
  /** No design and no reference photos for the product: the team sends design examples (a fixed line follows the reply). */
  examplesForTeam?: boolean;
  profileUpdate?: Record<string, unknown>;
  followUpNotes?: string;
  /** Verbatim quotes from the catalog block backing each product named in `message`. */
  fitBasis?: string[];
  /** The customer only acknowledged or closed ("baik kak", "terima kasih"): the model chose to send nothing. */
  noReply?: boolean;
  /**
   * The customer asked for a total over several items, which the team calculates (owner, 2026-10-27):
   * the reply carries per-item prices only, messageRouter adds CANNED_TOTAL_FOR_TEAM and tells the team.
   */
  totalForTeam?: boolean;
  /**
   * Every Rp figure hitung_harga returned in this turn (unit prices, totals, next-tier prices), set
   * by both call paths. Empty when the tool did not run.
   */
  toolFigures?: number[];
  /**
   * A hitung_harga call ran this turn, whatever it returned. DI_BAWAH_MINIMUM, DI_ATAS_TINGKAT_TERATAS
   * and TIDAK_ADA_DI_KATALOG return no figures, so `toolFigures` alone cannot tell "the tool priced
   * nothing" from "the tool was not called" - and after the former no price may be quoted at all.
   */
  priceToolRan?: boolean;
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
  meta?: {
    page: number;
    total: number;
    limit: number;
  };
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface ActivityLog {
  id: string;
  message: string;
  performedBy: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
}
