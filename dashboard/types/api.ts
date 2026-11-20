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

/** Why a chat was handed to the team (api/src/domain/handoff.ts HANDOFF_CATEGORIES). */
export type HandoffCategory =
  | "harga_custom"
  | "desain_masuk"
  | "pesanan_besar"
  | "minta_orang"
  | "komplain"
  | "bukan_pembeli"
  | "lainnya";

export interface Conversation {
  id: string;
  contactId: string;
  phoneNumberId: string;
  status: ConversationStatus;
  escalationReason: string | null;
  assignedAgent: string | null;
  /** Why the chat went to the team; null when it is not held. */
  handoffCategory?: HandoffCategory | null;
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

/** The inbox tabs (api/src/repositories/conversations.ts ConversationView): team = escalated or needs_human, ai = active. */
export type ConversationView = "team" | "ai" | "resolved";

/** GET /conversations meta.counts: each tab's size under the same search. */
export interface ConversationCounts {
  all: number;
  team: number;
  ai: number;
  resolved: number;
}

/** GET /conversations meta: the paging fields and each tab's count. */
export interface ConversationListMeta {
  page: number;
  total: number;
  limit: number;
  counts: ConversationCounts;
}

/** One row of GET /conversations (api/src/repositories/conversations.ts ConversationListRow). */
export interface ConversationListRow
  extends Omit<Conversation, "handoffCategory" | "contact" | "phoneNumber" | "lastMessageAt" | "escalatedAt"> {
  handoffCategory: HandoffCategory | null;
  conversationSummary: string | null;
  teamNotes: string | null;
  teamNotesUpdatedAt: string | null;
  teamNotesUpdatedBy: string | null;
  contact?: { id: string; waId: string; displayName: string | null };
  phoneNumber?: { id: string; number: string; label: string | null };
  unread: boolean;
  lastMessageAt: string;
  escalatedAt: string | null;
  /** The name the bot collected (profile `name`), else the WhatsApp display name. */
  customerName: string | null;
  businessName: string | null;
  /** Brands discussed (profile `brands`), known slugs only. */
  brands: BrandSlug[];
  /** The last chat line (customer, bot or staff); internal system notes are left out. */
  lastMessage: { body: string; role: string; senderName: string | null } | null;
  /** When the real PO form link last went to the customer (the placeholder line does not count). */
  poFormSentAt: string | null;
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
  print: string | null;
  finishing: string | null;
  use: string;
  isActive: boolean;
  /** Gramasi is per size row ("300 gsm"), null when the product has none; a product is all-gramasi or no-gramasi. */
  sizes: { id: string; size: string; gsm: string | null; tiers: PriceTier[] }[];
  /** The product photo (products.image_url): the item itself, what the bot compares customers' photos with. */
  imageUrl: string | null;
  /** Up to 3 photos of the product (assembled, flat, ...), first first; imageUrl is the first. */
  productPhotos: { id: string; imageUrl: string; sort: number }[];
  /** Design examples the bot sends to customers who have no design. Not the product photo. */
  referenceImages: { id: string; imageUrl: string; sort: number }[];
  updatedAt: string;
}

/** GET /catalog/products meta: per brand tab, following search and status but not the brand filter. */
export type CatalogCounts = Record<"all" | BrandSlug, number>;

/**
 * The product form as the API takes it (api/src/services/catalogEditor.ts ProductDraftSchema). A null
 * quantity or price is "not filled in yet"; the API names it by size and tier index.
 */
export interface ProductDraft {
  brand: BrandSlug;
  name: string;
  print: string | null;
  finishing: string | null;
  use: string;
  isActive: boolean;
  sizes: {
    /** The variant id from GET; absent for a size added in the form. */
    id?: string | null;
    size: string;
    /** Gramasi as typed ("300", "300 gsm"); null when the product has none. */
    gsm: string | null;
    tiers: {
      minQty: number | null;
      qtyUnit: QtyUnit;
      priceIdr: number | null;
      priceUnit: QtyUnit;
      includesDelivery: boolean;
    }[];
  }[];
}

export type ProductInputErrorCode =
  | "name_required"
  | "use_required"
  | "no_sizes"
  | "size_required"
  | "duplicate_size"
  | "gsm_mixed"
  | "no_tiers"
  | "qty_missing"
  | "qty_invalid"
  | "price_missing"
  | "price_invalid"
  | "duplicate_tier"
  | "tier_order";

export interface ProductInputError {
  code: ProductInputErrorCode;
  sizeIndex?: number;
  tierIndex?: number;
}

/** One line of a product's change history (api/src/services/catalogEditor.ts). */
export type CatalogChange =
  | { kind: "created"; via: "form" | "import"; fileName?: string }
  | { kind: "field"; field: "name" | "brand" | "gsm" | "print" | "finishing" | "use"; from: string | null; to: string | null }
  | { kind: "active"; to: boolean }
  | { kind: "gsm_added" | "gsm_removed"; gsm: string }
  | { kind: "gsm_renamed"; from: string; to: string }
  // `gsm` names the gramasi a size or tier change sits under; absent when the product has none.
  | { kind: "size_added" | "size_removed"; size: string; gsm?: string | null }
  | { kind: "size_renamed"; from: string; to: string; gsm?: string | null }
  | { kind: "tier_added" | "tier_removed"; size: string; gsm?: string | null; minQty: number; qtyUnit: QtyUnit }
  | { kind: "tier_price"; size: string; gsm?: string | null; minQty: number; qtyUnit: QtyUnit; priceUnit: QtyUnit; from: number; to: number }
  | { kind: "delivery"; size: string; gsm?: string | null; minQty: number; qtyUnit: QtyUnit; to: boolean };

/** POST /catalog/products/preview: the form's "Yang dilihat bot" panel. */
export interface ProductPreview {
  botText: string;
  /** Sizes left out of botText because the validator has something against them, as typed. */
  hiddenSizes: string[];
  errors: ProductInputError[];
  /** What saving this draft over the stored product would record; [] for a new product or an invalid draft. */
  changes: CatalogChange[];
}

/** api/src/repositories/catalogAudit.ts */
export type CatalogChangeType = "created" | "updated" | "imported" | "activated" | "deactivated" | "deleted";

export interface CatalogHistoryEntry {
  id: string;
  changeType: CatalogChangeType;
  changes: CatalogChange[];
  actorName: string;
  changedAt: string;
}

/** GET /catalog/products/:id - the product, its history (newest first) and its use in chats. */
export interface CatalogProductDetail {
  product: CatalogProduct;
  history: CatalogHistoryEntry[];
  usage: { quotedLast30Days: number; wonLeads: number };
}

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
  /** Left out: the result lists every gramasi of the size. */
  gramasi?: string;
}

export type PriceOutcome = "quote" | "below_minimum" | "above_top_tier" | "not_in_catalog";

/** What one hitung_harga call came to (api/src/services/priceTool.ts). */
export interface PriceToolCall {
  input: PriceToolInput;
  outcome: PriceOutcome;
  productId: string | null;
  productName: string | null;
  variantName: string | null;
  /** The gramasi of the size the tool matched; null when the product has none. */
  gsm: string | null;
  /** The quote behind a `quote`, `below_minimum` or `above_top_tier` call; null for `not_in_catalog`. */
  quote: PriceQuote | null;
}

/** The six order details (api/src/domain/orderDetails.ts ORDER_DETAIL_KEYS), always in this order. */
export type OrderDetailKey = "name" | "business_name" | "model" | "size" | "qty" | "design";

/** One row of the order panel (api/src/services/orderPanel.ts PanelDetailRow). */
export interface PanelDetailRow {
  key: OrderDetailKey;
  filled: boolean;
  value: string | null;
  note?: { kind: "out_of_catalog" } | { kind: "file_sent"; at: string };
}

/** "Terdekat di katalog" for one sized item (api/src/services/nearestCatalog.ts NearestMatch). */
export interface NearestMatch {
  item: OrderItem;
  productId: string;
  productName: string;
  variantName: string;
  /** The matched size's gramasi; null when the product has none. */
  gsm: string | null;
  /** The catalog has the size itself, not just a close one. */
  exact: boolean;
  /** The quote for the item's quantity; null when the quantity or its unit is unknown. */
  quote: PriceQuote | { kind: "no_tiers" } | null;
  /** The quote's tier; above the top tier the top one; otherwise the lowest tier. null when the size has no tiers. */
  tier: PriceTier | null;
}

/** A photo or document the customer sent (api/src/services/orderPanel.ts CustomerFile). */
export interface CustomerFile {
  messageId: string;
  kind: "image" | "document";
  url: string | null;
  filename: string;
  at: string;
}

/** Catatan tim (api/src/repositories/conversations.ts TeamNotes). */
export interface TeamNotes {
  text: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** GET /conversations/:id/order-panel (api/src/services/orderPanel.ts OrderPanel). */
export interface OrderPanel {
  brands: BrandSlug[];
  lead: { id: string; status: LeadStatus; kind: LeadKind; temperature: LeadTemperature | null } | null;
  details: PanelDetailRow[];
  detailsFilled: number;
  nearest: NearestMatch[];
  /** Newest first. */
  files: CustomerFile[];
  teamNotes: TeamNotes;
  /** The PO form(s) the bot would send for this order (api/src/domain/poForms.ts poFormsForOrder). */
  suggestedPoForms: PoFormKind[];
}

/** The client's two PO forms (api/src/domain/poForms.ts): cetak with a design, plano without. */
export type PoFormKind = "cetak" | "plano";
/** The po_form quick-send's `form`: one form, or both in one message. Absent, the order's design facts decide. */
export type PoFormChoice = PoFormKind | "both";

/** POST /conversations/:id/quick-send (api/src/services/quickSend.ts). */
export type QuickSendAction =
  | { kind: "price_list"; brand?: BrandSlug }
  | { kind: "reference_photos"; productId: string }
  | { kind: "po_form"; form?: PoFormChoice };
export type QuickSendError = "NOT_FOUND" | "BRAND_UNKNOWN" | "NO_PRICE_LIST" | "NO_REFERENCE_PHOTOS" | "PO_FORM_PLACEHOLDER";
/** One stored row per item, in send order; `saved` = the provider refused it. */
export interface QuickSendItem {
  messageId: string;
  kind: "text" | "image" | "document";
  status: "sent" | "saved";
}

/** A product in the quick-send photo picker: the active catalog with each product's reference-photo count. */
export interface PhotoProduct {
  id: string;
  name: string;
  brand: BrandSlug;
  photos: number;
}

/** One form in GET /settings/po-forms: the link, whether it is still the placeholder, and the message that form alone sends. */
export interface PoFormSetting {
  url: string;
  isPlaceholder: boolean;
  message: string;
}

/** GET|PATCH /settings/po-forms (api/src/routes/dashboard/settings.ts): both forms, and the one message that sends both. */
export interface PoFormsSetting {
  cetak: PoFormSetting;
  plano: PoFormSetting;
  both: { message: string };
}

/** How the bot introduces itself (api/src/domain/botSettings.ts SignAs). */
export type SignAs = "brand_discussed" | "imperial_indopack";

/** GET|PATCH /settings/bot (api/src/domain/botSettings.ts BotSettings). */
export interface BotSettings {
  botName: string;
  signAs: SignAs;
  greeting: string;
  fallbackMinPcs: number;
  teamReminderMinutes: number;
  /** 0 = the WhatsApp history sync schedule is off. */
  whatsappSyncMinutes: number;
}

/** api/src/services/goLive.ts WhatsAppTransport. */
export type WhatsAppTransport = "chakra" | "meta" | "capture";

/** GET /settings/whatsapp-status (api/src/services/goLive.ts WhatsAppStatus). */
export interface WhatsAppStatus {
  transport: WhatsAppTransport;
  credentialsSet: boolean;
  numberCount: number;
  connected: boolean;
  lastInboundAt: string | null;
}

/** One entry of GET /settings/go-live `issues` (api/src/services/goLive.ts GoLiveIssue). */
export type GoLiveIssue =
  | { code: "po_form_placeholder"; form: PoFormKind }
  | { code: "whatsapp_not_connected" }
  | { code: "catalog_empty" }
  | { code: "catalog_demo" }
  | { code: "price_list_missing"; brand: BrandSlug };

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

/** One chat waiting on the team (api/src/services/teamQueue.ts TeamQueueItem). */
export interface TeamQueueItem {
  conversationId: string;
  customerName: string | null;
  businessName: string | null;
  waId: string;
  brands: BrandSlug[];
  itemsSummary: string;
  detailsFilled: number;
  missing: OrderDetailKey[];
  /** ISO time the chat started waiting. */
  waitingSince: string;
  assignedAgent: string | null;
  status: "escalated" | "needs_human";
}

/** GET /team-queue (api/src/services/teamQueue.ts TeamQueue): all seven categories, in HANDOFF_CATEGORIES order. */
export interface TeamQueue {
  waitingCount: number;
  oldestWaitingSince: string | null;
  reminderMinutes: number;
  groups: { category: HandoffCategory; items: TeamQueueItem[] }[];
}
