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

export type StockStatus = 'normal' | 'no_stock' | 'price_rise' | 'price_drop';

export type Brand = {
  id: string;
  name: string;
  description: string | null;
  catalogFileUrl?: string | null;
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
  /** Marketplace price - the figure the AI quotes. null renders as "tanya tim". */
  mpPriceIdr: number | null;
  isiCtn: number | null;
  isiBox: number | null;
  uomPriceId: string | null;
  mpUomId: string | null;
  uomCtnId: string | null;
  uomBoxId: string | null;
  minOrderQty: number | null;
  minOrderUomId: string | null;
  imageUrl: string | null;
  stockStatus: StockStatus;
  isActive: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  uomPrice?: Uom;
  /** May differ from uomPrice: MP carries its own unit. */
  mpUom?: Uom;
  uomCtn?: Uom;
  uomBox?: Uom;
  uomMinOrder?: Uom;
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
};

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

export interface LeadDetail {
  lead: LeadWithContact;
  events: LeadEvent[];
  previousLead: Lead | null;
  orders: LeadOrder[];
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
  funnel: Record<LeadStatus, number>;
  lostReasons: { reason: string; count: number }[];
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

/** One file of a bulk catalog-photo upload (POST /api/v1/catalog/images), as the API reports it. */
export type CatalogImageResult =
  | { file: string; status: 'matched'; target: { kind: 'product' | 'variant'; id: string; label: string } }
  | { file: string; status: 'unmatched' }
  | { file: string; status: 'ambiguous'; options: string[] }
  | { file: string; status: 'rejected'; reason: string };

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
