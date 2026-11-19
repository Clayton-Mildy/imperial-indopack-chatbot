/**
 * API response types — mirrors the backend domain types in api/.
 * The backend serializes camelCase objects directly; all keys here are camelCase.
 */
import type { BrandSlug } from "@/lib/brands";

export type PromptSection = { name: string; content: string };

export type ConversationStatus =
  | "active"
  | "escalated"
  | "resolved"
  | "needs_human";

export type MessageRole = "user" | "assistant" | "system_note";

/** "saved" = stored but the provider refused the send — it never reached WhatsApp. */
export type MessageStatus = "sent" | "saved" | "delivered" | "read" | "failed";

export interface Contact {
  id: string;
  waId: string;
  displayName: string | null;
  /** null = follow the global default; true/false pins this contact. */
  aiEnabled: boolean | null;
  firstSeen: string;
  lastSeen: string;
}

export interface PhoneNumber {
  id: string;
  number: string;
  label: string | null;
  wabaId: string;
  phoneNumberId: string;
  customSystemPrompt: string | null;
  promptSections: PromptSection[] | null;
  createdAt: string;
  updatedAt: string;
}

export type ContactProfileFollowUpStatus = "none" | "needs_followup" | "done";
// profile may contain: upsell_offered (boolean), upsell_accepted (boolean),
// crosssell_offered (boolean), crosssell_accepted (boolean) — set by AI when relevant
export interface ContactProfile {
  id: string;
  contactId: string;
  profile: Record<string, unknown>;
  followUpStatus: ContactProfileFollowUpStatus;
  followUpNotes: string | null;
  updatedAt: string;
}

/** A contact plus its extracted CRM profile — the /contacts list row. */
export interface ContactWithProfile extends Contact {
  conversationId: string | null;
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
  followUpNotes: string | null;
  createdAt: string;
  /** Row mtime — only bumped on status/follow-up changes. Not "last activity". */
  updatedAt: string;
  /** When the last message actually arrived from WhatsApp. List routes only. */
  lastMessageAt?: string;
  /** When the AI actually handed off. Null if never escalated. Not updatedAt - see api types note. */
  escalatedAt?: string | null;
  // Joined fields (may be present depending on route)
  contact?: Contact;
  phoneNumber?: PhoneNumber;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  body: string;
  waMessageId: string | null;
  status: MessageStatus | null;
  metadata?: Record<string, unknown> | null;
  senderName: string | null;
  createdAt: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

/** A quantity or price unit: 1 rim = 500 pcs (api/src/domain/pricing.ts). */
export type QtyUnit = "rim" | "pcs";

/** One quantity tier of a size (api/src/domain/pricing.ts). */
export interface PriceTier {
  minQty: number;
  qtyUnit: QtyUnit;
  priceIdr: number;
  priceUnit: QtyUnit;
  includesDelivery: boolean;
  note?: string | null;
}

/** A product as the Katalog editor shows it (api/src/services/catalogEditor.ts). */
export interface CatalogProduct {
  id: string;
  brand: BrandSlug;
  name: string;
  gsm: string | null;
  print: string | null;
  finishing: string | null;
  use: string;
  isActive: boolean;
  sizes: { id: string; size: string; tiers: PriceTier[] }[];
  referenceImages: { id: string; imageUrl: string; sort: number }[];
  updatedAt: string;
}

/** GET /catalog/products meta: per brand tab, following search and status but not the brand filter. */
export type CatalogCounts = Record<"all" | BrandSlug, number>;

/** api/src/domain/pricing.ts, without `no_tiers` (the price check reports that as not_in_catalog). */
export type PriceQuote =
  | {
      kind: "quote";
      tier: PriceTier;
      qtyInPriceUnit: number;
      unitPriceIdr: number;
      totalIdr: number;
      includesDelivery: boolean;
      nextTier: PriceTier | null;
    }
  | { kind: "below_minimum"; minimum: PriceTier }
  | { kind: "above_top_tier"; top: PriceTier };

/** hitung_harga's input (api/src/services/priceTool.ts PriceToolInput). */
export interface PriceToolInput {
  product: string;
  size: string;
  qty: number;
  unit: QtyUnit;
}

export type PriceOutcome = "quote" | "below_minimum" | "above_top_tier" | "not_in_catalog";

/** What one hitung_harga call came to (api/src/services/priceTool.ts). */
export interface PriceToolCall {
  input: PriceToolInput;
  outcome: PriceOutcome;
  productId: string | null;
  productName: string | null;
  variantName: string | null;
  /** The quote behind a `quote`, `below_minimum` or `above_top_tier` call; null for `not_in_catalog`. */
  quote: PriceQuote | null;
}

/** A brand's price-list PDF, the file the bot sends (api/src/repositories/products.ts). */
export interface BrandPriceList {
  brand: BrandSlug;
  url: string | null;
  fileName: string | null;
  uploadedAt: string | null;
}

/** What importing a file would do, counted without writing (api/src/services/catalogImport.ts). */
export interface ImportPreview {
  newProducts: number;
  newSizes: number;
  changedPrices: number;
  unchanged: number;
  validRows: number;
  totalRows: number;
  errors: { row: number; message: string }[];
}

export interface ApiKey {
  id: string;
  keyHash: string;
  label: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    total: number;
    limit: number;
  };
}

export type TestConversationSummary = {
  id: string;
  phoneNumberLabel: string;
  phoneNumberId: string;
  status: string;
  messageCount: number;
  updatedAt: string;
};

export type StaffRole = 'admin' | 'agent' | 'marketing';

export interface StaffPublic {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  message: string;
  performedBy: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

export type LeadStatus = "new" | "contacted" | "quoted" | "won" | "lost";

/** `lead` is a prospective buyer; the rest are chats that are not about buying. */
export type LeadKind = "lead" | "kurir" | "status_pesanan" | "lamaran_kerja" | "supplier" | "lainnya";
export type LeadKindSetBy = "ai" | "rule" | "staff";
export type LostReason =
  | "barang_tidak_ada"
  | "harga"
  | "beli_di_tempat_lain"
  | "tidak_jadi"
  | "tidak_cocok"
  | "tidak_ada_respon"
  | "di_bawah_minimum"
  | "lainnya";

/** How warm the lead is, judged by the AI each turn. No human editor. */
export type LeadTemperature = "hot" | "cold";

/** One line of an order as the AI recorded it (api/src/domain/orderProfile.ts). */
export interface OrderItem {
  product?: string;
  size?: string;
  gsm?: string;
  print?: string;
  qty?: number;
  qty_unit?: "rim" | "pcs";
  has_design?: boolean;
}

/** One row of GET /leads/brand-summary (api/src/repositories/leads.ts). */
export interface BrandPerformance {
  brand: BrandSlug;
  leads: number;
  chats: number;
  won: number;
  lost: number;
  /** round(won / leads * 100); null when there are no leads. */
  winPct: number | null;
}

/** A lead plus the contact/conversation it resolved to. */
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
  /** Form answers — keys vary per landing page, so never index one by name blindly. */
  payload: Record<string, unknown>;
  status: LeadStatus;
  /** Which brands the customer asked about, Kertas Supreme first. */
  brands: BrandSlug[];
  items: OrderItem[];
  /** Brands/items lock: non-null once staff edited them - the AI's lead pass then leaves both alone. */
  orderFieldsSetAt: string | null;
  orderFieldsSetBy: string | null;
  /** Contact name and business name from the AI-extracted profile. */
  name: string | null;
  company: string | null;
  dealValueIdr: number | null;
  leadTemperature: LeadTemperature | null;
  totalOrders: number;
  /** Status lock: non-null once staff set the status - the AI then leaves it alone. */
  humanUpdatedAt: string | null;
  /** Per-field locks (2026-11-10): staff set that number by hand, the AI never writes it again. */
  totalOrdersSetAt: string | null;
  dealValueSetAt: string | null;
  /** Who set each locked field; null when unknown. Only on list/detail rows. */
  statusSetByName?: string | null;
  totalOrdersSetByName?: string | null;
  dealValueSetByName?: string | null;
  submittedAt: string;
  matchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  waId: string | null;
  displayName: string | null;
  conversationId: string | null;
  conversationStatus: string | null;
  /** When the WhatsApp thread began — not `submittedAt`, which is the form submission. */
  conversationStartedAt: string | null;
  /** The newest customer/bot/staff message in any of the contact's chats. */
  lastChatAt: string | null;
  // The contact_profiles half — this list replaced the separate /contacts page.
  /** The AI-extracted profile, distinct from `payload` (the marketing form). */
  contactProfile: Record<string, unknown>;
  followUpStatus: string | null;
  followUpNotes: string | null;
  /** null = follow the global default; true/false pins this contact. */
  aiEnabled: boolean | null;
  lastSeen: string | null;
  kind: LeadKind;
  kindSetBy: LeadKindSetBy | null;
  lostReason: LostReason | null;
  /** The AI's proof for won / lost, quoted from the chat. */
  outcomeEvidence: string | null;
  outcomeMessageId: string | null;
  closedAt: string | null;
  /** Set when this lead reopened an earlier, closed one ("pernah gagal"). */
  previousLeadId: string | null;
  firstContactAt: string | null;
  /** The customer's first message since the lead began (max 300 chars); null when there is none. */
  firstMessage: string | null;
  /** When the customer's unanswered message arrived; null = nothing waiting. */
  waitingSince: string | null;
}

export type LeadWithContact = Lead;

export interface LeadEvent {
  id: string;
  leadId: string;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus | null;
  fromKind: LeadKind | null;
  toKind: LeadKind | null;
  actor: "ai" | "staff" | "system";
  staffId: string | null;
  evidence: string | null;
  messageId: string | null;
  createdAt: string;
}

export interface LeadOrder {
  id: string;
  messageId: string | null;
  /** The customer's own order message; null for a read-only (marketing) session. */
  evidence: string | null;
  createdAt: string;
}

/** The price the bot quoted for one item (api/src/services/leadDetailExtras.ts). */
export interface QuotedPrice {
  unitPriceIdr: number;
  priceUnit: "rim" | "pcs";
  totalIdr: number;
  at: string;
}

/** The lead detail's extras, read from the contact's chat since the lead began (api/src/services/leadDetailExtras.ts). */
export interface LeadDetailExtras {
  /** A click-to-WhatsApp ad (with the ad's headline when known) or a direct chat. */
  source: { kind: "ad" | "direct"; headline: string | null };
  /** When the bot last sent the PO form link; null = never. */
  poFormSentAt: string | null;
  /** Minutes from first contact to Won; null unless won. */
  closingMinutes: number | null;
  /** One per `lead.items` entry, in the same order; null = no quote for that item. */
  quotedPrices: (QuotedPrice | null)[];
}

export interface LeadDetail {
  lead: LeadWithContact;
  events: LeadEvent[];
  previousLead: Lead | null;
  orders: LeadOrder[];
  extras: LeadDetailExtras;
}

export interface LeadReport {
  newLeads: number;
  returningLeads: number;
  contactedLeads: number;
  won: number;
  lost: number;
  conversionPct: number | null;
  avgDaysToClose: number | null;
  daily: { day: string; newLeads: number; contacted: number }[];
  /** New leads per WIB day per brand; a two-brand lead counts in both. */
  dailyByBrand: { day: string; kertas_supreme: number; imperial_indopack: number }[];
  funnel: Record<LeadStatus, number>;
  lostReasons: { reason: LostReason | null; count: number }[];
  unreplied: {
    leadId: string;
    name: string | null;
    waId: string | null;
    status: LeadStatus;
    lastMessage: string | null;
    waitingSince: string;
  }[];
}

export interface LeadCampaignFields {
  utmId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
}

export interface LeadCampaignSummary {
  campaign: string;
  source: string | null;
  leads: number;
  chats: number;
  escalated: number;
  won: number;
  lost: number;
  dealValueIdr: number;
}

export interface LeadImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

export interface CatalogImportResult {
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  lookupsCreated: number;
  skipped: number;
  /** Products in the database the uploaded file never mentioned. Left untouched by design. */
  untouched: number;
  errors: { row: number; reason: string }[];
}

export interface ChakraSyncStatus {
  watermarkMs: number;
  lastRunAt: string | null;
  lastResult: {
    chats: number;
    messages: number;
    mediaFailed: number;
    errors: number;
    truncated: boolean;
  } | null;
  running: boolean;
}
