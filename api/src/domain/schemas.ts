import { z } from 'zod';
import { LEAD_KINDS, LOST_REASONS } from './types.js';

const BRAND_SLUGS = ['imperial_indopack', 'kertas_supreme'] as const;

// ─── Baileys Inbound Payload ───────────────────────────────────────────────

export const BaileysInboundPayloadSchema = z.object({
  waMessageId: z.string(),
  from: z.string(),
  fromJid: z.string(),
  timestamp: z.number(),
  type: z.enum(['text', 'image', 'document', 'audio', 'video', 'other']),
  // The provider's own type ('sticker', 'location', 'unsupported', ...) - only for the record.
  providerType: z.string().nullish(),
  text: z.string().nullable(),
  media: z
    .object({
      base64: z.string(),
      mimeType: z.string(),
      filename: z.string().nullable(),
    })
    .nullable(),
  // A document's own name as WhatsApp sent it, kept even when its bytes could not be downloaded
  // (media is then null), so the stored row and the team hand-off still say which file it was.
  filename: z.string().nullish(),
  pushName: z.string().nullable(),
  // The WABA number this message ARRIVED on (Meta/Chakra metadata.phone_number_id). Optional
  // because the Baileys payload shape has no equivalent; absent means "fall back to the first
  // configured number", which is what every caller did before multi-number routing existed.
  toPhoneNumberId: z.string().nullish(),
  // wamid of the message the customer replied/quoted to (WhatsApp reply feature).
  quotedWaMessageId: z.string().nullish(),
  // Click-to-WhatsApp ad the customer came from (Meta's messages[].referral); absent for a direct chat.
  referral: z
    .object({ sourceType: z.string().nullish(), sourceId: z.string().nullish(), headline: z.string().nullish() })
    .nullish(),
  messageKey: z.object({
    remoteJid: z.string(),
    fromMe: z.boolean(),
    id: z.string(),
    participant: z.string().optional(),
  }),
});

export type BaileysInboundPayload = z.infer<typeof BaileysInboundPayloadSchema>;

// ─── Request / Response Bodies ─────────────────────────────────────────────

export const VerifyCredentialsBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const ConversationsQuerySchema = PaginationQuerySchema.extend({
  agentId: z.string().optional(),
  // The inbox tabs: team = escalated or needs_human, ai = active, resolved = resolved. None = all.
  view: z.enum(['team', 'ai', 'resolved']).optional(),
  search: z.string().trim().max(200).optional(),
});

export const TeamQueueQuerySchema = z.object({
  assignedTo: z.string().trim().max(200).optional(),
});

export const ContactsQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  customerType: z.enum(['reseller', 'end_user', 'project']).optional(),
  followUpStatus: z.enum(['none', 'needs_followup', 'done']).optional(),
});

// null clears the override so the contact follows the global default again.
export const PatchContactBodySchema = z.object({
  aiEnabled: z.boolean().nullable(),
});

export const MarkReadBodySchema = z.object({
  agentId: z.string().min(1),
});

export const ConversationStatusSchema = z.enum(['active', 'escalated', 'resolved', 'needs_human']);

export const PatchConversationBodySchema = z.object({
  status: ConversationStatusSchema.optional(),
  assignedAgent: z.string().optional(),
});

// Catatan tim on the conversation panel: the whole text (it replaces the last one) and who wrote it.
export const TeamNotesBodySchema = z.object({
  text: z.string().max(2000),
  staffName: z.string().trim().min(1).max(200),
});

// Quick-send on the conversation panel (services/quickSend.ts). The staff name comes from the
// dashboard session, capped like the attachment route's.
export const QuickSendBodySchema = z.object({
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('price_list'), brand: z.enum(BRAND_SLUGS).optional() }),
    z.object({ kind: z.literal('reference_photos'), productId: z.string().uuid() }),
    z.object({ kind: z.literal('po_form') }),
  ]),
  staffName: z.string().trim().min(1).transform((s) => s.slice(0, 100)),
});

export const CreatePhoneNumberBodySchema = z.object({
  number: z.string().min(1),
  label: z.string().optional(),
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
});

export const PromptSectionSchema = z.object({
  name: z.string(),
  content: z.string(),
});

export const PatchPhoneNumberBodySchema = z.object({
  label: z.string().optional(),
  metaAccessToken: z.string().nullable().optional(),
  customSystemPrompt: z.string().nullable().optional(),
  promptSections: z.array(PromptSectionSchema).nullable().optional(),
});

export const CreateBrandBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export const CreateCategoryBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});
export const PatchCategoryBodySchema = CreateCategoryBodySchema.partial();

export const PatchBrandBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  catalogFileUrl: z.string().nullable().optional(),
});

export const CreateUomBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export const PatchUomBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

export const StockStatusSchema = z.enum(['normal', 'no_stock', 'price_rise', 'price_drop']);

export const CreateProductBodySchema = z.object({
  brandId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  fungsi: z.string().nullable().optional(),
  usp: z.string().nullable().optional(),
  kataKunci: z.string().nullable().optional(),
  kelengkapan: z.string().nullable().optional(),
  bahan: z.string().nullable().optional(),
  ketebalan: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  tier: z.enum(['economic', 'mid', 'premium']).nullable().optional(),
  upsellProductId: z.string().uuid().nullable().optional(),
  relatedProductIds: z.array(z.string().uuid()).nullable().optional(),
});
export const PatchProductBodySchema = CreateProductBodySchema.partial();

export const CreateVariantBodySchema = z.object({
  name: z.string().min(1),
  sku: z.string().nullable().optional(),
  priceIdr: z.number().nullable().optional(),
  mpPriceIdr: z.number().nullable().optional(),
  isiCtn: z.number().int().nullable().optional(),
  isiBox: z.number().int().nullable().optional(),
  uomPriceId: z.string().uuid().nullable().optional(),
  mpUomId: z.string().uuid().nullable().optional(),
  uomCtnId: z.string().uuid().nullable().optional(),
  uomBoxId: z.string().uuid().nullable().optional(),
  // Exported by catalogExport since day one with no way to write them back - the Excel import
  // needs that round trip to close.
  minOrderQty: z.number().int().nullable().optional(),
  minOrderUomId: z.string().uuid().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  stockStatus: StockStatusSchema.optional().default('normal'),
  isActive: z.boolean().default(true),
  description: z.string().nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
});
export const PatchVariantBodySchema = CreateVariantBodySchema.partial();

export const SendMessageBodySchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().min(1),
  senderName: z.string().optional(),
});

export const TestPromptBodySchema = z.object({
  phoneNumberId: z.string().uuid(),
  message: z.string().min(1),
});

export const ChatMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
});

export const TestPromptChatBodySchema = z.object({
  phoneNumberId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  messages: z.array(ChatMessageSchema).optional().default([]),
  newMessage: z.string().min(0).default(''),
  imageData: z.object({ base64: z.string(), mimeType: z.string() }).optional(),
}).refine((d) => d.newMessage.length > 0 || d.imageData !== undefined, {
  message: 'Either newMessage or imageData must be provided',
});

export const TestPromptStartBodySchema = z.object({
  phoneNumberId: z.string().uuid(),
});

// ─── Staff Management ──────────────────────────────────────────────────────

export const CreateStaffBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
  role: z.enum(['admin', 'agent', 'marketing']).default('agent'),
});

export const PatchStaffBodySchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().min(1).optional(),
  role: z.enum(['admin', 'agent', 'marketing']).optional(),
  isActive: z.boolean().optional(),
  newPassword: z.string().min(8).optional(),
});

// ─── Activity Logs ─────────────────────────────────────────────────────────

export const CreateActivityLogBodySchema = z.object({
  message: z.string().min(1),
  performedBy: z.string().min(1),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
});

export const ActivityLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// ─── Leads ─────────────────────────────────────────────────────────────────

// Text the way orderProfile's sanitiser stores it: trimmed, and a blank is no value. A gsm typed as a
// number (64) is the string "64", as the lead pass stores it; product and size are an item's identity
// (itemKey), so " Box Nasi " and "Box Nasi" must not become two different items.
const itemText = (max: number) => z.string().max(max).transform((v) => v.trim() || undefined);
const OrderItemSchema = z.object({
  product: itemText(200).optional(),
  size: itemText(100).optional(),
  gsm: z.union([z.string().max(50), z.number().finite().positive()]).transform((v) => String(v).trim() || undefined).optional(),
  print: itemText(100).optional(),
  qty: z.number().positive().optional(),
  qty_unit: z.enum(['rim', 'pcs']).optional(),
  has_design: z.boolean().optional(),
}).strict();

export const LeadStatusSchema = z.enum(['new', 'contacted', 'quoted', 'won', 'lost']);

// startDate/endDate are YYYY-MM-DD and read in WIB — see repositories/leads.ts.
// Shared so the export takes exactly the filters the list took: the .xlsx is the view on
// screen, and a column the list can filter by but the export ignores is a silent lie.
const LEAD_FILTER_SHAPE = {
  search: z.string().optional(),
  campaign: z.string().optional(),
  source: z.string().optional(),
  status: LeadStatusSchema.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  // From the retired /contacts page — same rows, so the filters moved here too.
  brand: z.enum(BRAND_SLUGS).optional(),
  followUpStatus: z.enum(['none', 'needs_followup', 'done']).optional(),
  // Absent = real leads only; 'non_lead' = every other kind (couriers, job seekers ...).
  kind: z.enum([...LEAD_KINDS, 'non_lead']).optional(),
  // Query strings are text, and z.coerce.boolean() reads "false" as true - accept only the two words.
  unreplied: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  // Absent = newest submitted first (or longest wait first on the unreplied tab).
  sort: z.enum(['submitted', 'chat_started', 'last_chat']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
};

export const LeadsQuerySchema = PaginationQuerySchema.extend(LEAD_FILTER_SHAPE);

// No pagination: the export is one file for the whole filtered set.
export const LeadsExportQuerySchema = z.object(LEAD_FILTER_SHAPE);

// A real calendar day, not just the right shape: "2020-02-30" must be a 400, not a silent roll-over.
const ReportDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });

export const LeadReportQuerySchema = z
  .object({ startDate: ReportDay.optional(), endDate: ReportDay.optional(), brand: z.enum(BRAND_SLUGS).optional() })
  .refine((q) => {
    // Resolve the defaults the way getLeadReport does (end = WIB today), then check the range can
    // be served: year >= 2000, start <= end, at most 366 days apart. A future end is fine (zeros).
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const end = q.endDate ?? today;
    const start = q.startDate ?? new Date(Date.parse(`${end}T00:00:00Z`) - 13 * 86_400_000).toISOString().slice(0, 10);
    if (start < '2000-01-01' || end < '2000-01-01') return false;
    const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
    return days >= 0 && days <= 366;
  });

export const LeadsSummaryQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// Campaign fields are optional and nullable: the modal writes only what the user filled in,
// and clearing a field back to null is a legitimate correction.
const LeadCampaignFieldsSchema = z.object({
  utmId: z.string().max(255).nullable().optional(),
  utmSource: z.string().max(255).nullable().optional(),
  utmMedium: z.string().max(255).nullable().optional(),
  utmCampaign: z.string().max(255).nullable().optional(),
  utmTerm: z.string().max(255).nullable().optional(),
  utmContent: z.string().max(255).nullable().optional(),
});

export const PatchLeadBodySchema = LeadCampaignFieldsSchema.extend({
  status: LeadStatusSchema.optional(),
  dealValueIdr: z.number().nonnegative().nullable().optional(),
  // Correctable by hand, like the two above - the model only ever increments it.
  totalOrders: z.number().int().nonnegative().optional(),
  kind: z.enum(LEAD_KINDS).optional(),
  lostReason: z.enum(LOST_REASONS).nullable().optional(),
  // Staff's own brands and item lines: they replace what the AI collected.
  brands: z.array(z.enum(BRAND_SLUGS)).max(10).transform((a) => [...new Set(a)]).optional(),
  items: z.array(OrderItemSchema).max(50).optional(),
  // Who made the edit, so lead_events records the person.
  staffId: z.string().uuid().optional(),
});

// One campaign row typed by hand — the single-row equivalent of the Excel import, so it is
// keyed the same way. request_id is required for the same reason the import skips rows
// without one: a campaign that isn't tied to a submission id can never reach a conversation.
export const AddCampaignBodySchema = LeadCampaignFieldsSchema.extend({
  requestId: z.string().uuid(),
});

export const LeadsBrandSummaryQuerySchema = z.object({
  startDate: ReportDay.optional(),
  endDate: ReportDay.optional(),
});
