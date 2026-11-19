import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  numeric,
  integer,
  jsonb,
  uniqueIndex,
  unique,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── app_settings ──────────────────────────────────────────────────────────

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── phone_numbers ─────────────────────────────────────────────────────────

export const phoneNumbers = pgTable('phone_numbers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  number: text('number').notNull().unique(),
  label: text('label'),
  wabaId: text('waba_id').notNull(),
  phoneNumberId: text('phone_number_id').notNull(),
  metaAccessToken: text('meta_access_token'),
  customSystemPrompt: text('custom_system_prompt'),
  promptSections: jsonb('prompt_sections'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── contacts ──────────────────────────────────────────────────────────────

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  waId: text('wa_id').notNull().unique(),
  displayName: text('display_name'),
  // null = follow the global ai_enabled_default setting; true/false pins this contact.
  aiEnabled: boolean('ai_enabled'),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
});

// ─── contact_profiles ──────────────────────────────────────────────────────

export const contactProfiles = pgTable(
  'contact_profiles',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    contactId: uuid('contact_id')
      .notNull()
      .unique()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    customerType: text('customer_type'),
    profile: jsonb('profile').notNull().default({}),
    followUpStatus: text('follow_up_status').notNull().default('none'),
    followUpNotes: text('follow_up_notes'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_contact_profiles_followup').on(table.followUpStatus),
  ]
);

// ─── conversations ─────────────────────────────────────────────────────────

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    phoneNumberId: uuid('phone_number_id')
      .notNull()
      .references(() => phoneNumbers.id),
    status: text('status').notNull().default('active'),
    escalationReason: text('escalation_reason'),
    assignedAgent: text('assigned_agent'),
    conversationSummary: text('conversation_summary'),
    followUpNotes: text('follow_up_notes'),
    // The AI's memory floor: it sees no message at or below this instant. Set by /new. The
    // dashboard still shows the whole thread - only the three AI-facing readers in
    // repositories/conversations.ts honour it.
    contextResetAt: timestamp('context_reset_at', { withTimezone: true }),
    // Newest customer message the lead-insights pass has read - see services/leadInsights.ts.
    insightsExtractedAt: timestamp('insights_extracted_at', { withTimezone: true }),
    // Why the chat went to the team (domain/handoff.ts; CHECK list in migration 0028). Written with
    // the hand-off, cleared with escalation_reason when the chat leaves the held state.
    handoffCategory: text('handoff_category'),
    // The team's own notes on the conversation, written from the dashboard.
    teamNotes: text('team_notes'),
    teamNotesUpdatedAt: timestamp('team_notes_updated_at', { withTimezone: true }),
    teamNotesUpdatedBy: text('team_notes_updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_conversations_contact_phone').on(table.contactId, table.phoneNumberId),
  ]
);

// ─── messages ──────────────────────────────────────────────────────────────

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    role: text('role').notNull(),
    body: text('body').notNull(),
    waMessageId: text('wa_message_id').unique(),
    status: text('status'),
    senderName: text('sender_name'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_messages_conversation').on(table.conversationId, table.createdAt),
  ]
);

// ─── uom ───────────────────────────────────────────────────────────────────

export const uomTable = pgTable('uom', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── brands ────────────────────────────────────────────────────────────────

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  description: text('description'),
  catalogFileUrl: text('catalog_file_url'),
  // The price-list file's own name and upload time, for the Katalog page (0029).
  catalogFileName: text('catalog_file_name'),
  catalogFileUploadedAt: timestamp('catalog_file_uploaded_at', { withTimezone: true }),
  brandType: text('brand_type').notNull().default('own'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── categories ────────────────────────────────────────────────────────────

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('uq_categories_name_ci').on(sql`lower(${table.name})`)]
);

// ─── products ──────────────────────────────────────────────────────────────

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    name: text('name').notNull().unique(),
    description: text('description'),
    fungsi: text('fungsi'),
    usp: text('usp'),
    kataKunci: text('kata_kunci'),
    kelengkapan: text('kelengkapan'),
    bahan: text('bahan'),
    ketebalan: text('ketebalan'),
    imageUrl: text('image_url'),
    tier: text('tier'),
    relatedProductIds: jsonb('related_product_ids'),
    upsellProductId: uuid('upsell_product_id'),
    // Switched off in the editor (0029): kept with its history, but the bot neither lists nor prices it.
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_products_brand').on(table.brandId),
    index('idx_products_category').on(table.categoryId),
  ]
);

// ─── product_variants ──────────────────────────────────────────────────────

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sku: text('sku'),
    priceIdr: numeric('price_idr'),
    // Legacy marketplace price with its own UOM, from the schema this bot was ported from. Imperial
    // Indopack's prices are quantity tiers (variant_price_tiers); nothing quotes this column.
    mpPriceIdr: numeric('mp_price_idr'),
    isiCtn: integer('isi_ctn'),
    isiBox: integer('isi_box'),
    uomPriceId: uuid('uom_price_id').references(() => uomTable.id),
    mpUomId: uuid('mp_uom_id').references(() => uomTable.id),
    uomCtnId: uuid('uom_ctn_id').references(() => uomTable.id),
    uomBoxId: uuid('uom_box_id').references(() => uomTable.id),
    minOrderQty: integer('min_order_qty'),
    minOrderUomId: uuid('min_order_uom_id').references(() => uomTable.id),
    imageUrl: text('image_url'),
    stockStatus: text('stock_status').notNull().default('normal'),
    isActive: boolean('is_active').notNull().default(true),
    description: text('description'),
    // Gramasi of this size row, canonical "<n> gsm" (0030). null = the product has no gramasi choice.
    gsm: text('gsm'),
    sourceUrl: text('source_url'),
    scrapedAt: timestamp('scraped_at', { withTimezone: true }),
    sourceHash: text('source_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_variants_product').on(table.productId, table.isActive),
    uniqueIndex('uq_variant_gsm_name_per_product').on(table.productId, sql`coalesce(${table.gsm}, '')`, table.name),
  ]
);


// ─── variant_price_tiers / product_reference_images (0026) ──────────────────

export const variantPriceTiers = pgTable(
  'variant_price_tiers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    minQty: integer('min_qty').notNull(),
    // 'rim' | 'pcs': the unit of min_qty
    qtyUnit: text('qty_unit').notNull(),
    priceIdr: numeric('price_idr').notNull(),
    // 'pcs' | 'rim': the unit price_idr is per
    priceUnit: text('price_unit').notNull(),
    includesDelivery: boolean('includes_delivery').notNull().default(false),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.variantId, table.minQty, table.qtyUnit)]
);

export const productReferenceImages = pgTable(
  'product_reference_images',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    imageUrl: text('image_url').notNull(),
    sort: integer('sort').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_product_reference_images_product').on(table.productId, table.sort)]
);

// ─── staff_profiles ────────────────────────────────────────────────────────

export const staffProfiles = pgTable('staff_profiles', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('agent'),
  isActive: boolean('is_active').notNull().default(true),
  // Dashboard language for this person: 'id' | 'en'.
  language: text('language').notNull().default('id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── staff_push_subscriptions ──────────────────────────────────────────────

// One row per browser a staff member has enabled notifications in - a phone and a desktop are
// two rows. Escalations used to reach a human only if someone had the dashboard open: the
// "escalation notification" sent a canned line to the CUSTOMER, and the only staff-facing
// surface was a polled badge. Push is the first thing in this system that reaches a person.
//
// The endpoint URL is the identity (it is what the push service addresses), so it carries the
// unique constraint and a re-subscribe from the same browser is an upsert, not a duplicate.
// Rows are disposable: a push service answering 404/410 means the subscription is dead and
// pushNotify deletes it. Nothing here is worth a backup.
export const staffPushSubscriptions = pgTable('staff_push_subscriptions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  staffId: uuid('staff_id').notNull().references(() => staffProfiles.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── api_keys ──────────────────────────────────────────────────────────────

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  keyHash: text('key_hash').notNull().unique(),
  label: text('label').notNull(),
  createdBy: uuid('created_by').references(() => staffProfiles.id),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── activity_logs ─────────────────────────────────────────────────────────

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    message: text('message').notNull(),
    performedBy: text('performed_by').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_activity_logs_created').on(table.createdAt),
    index('idx_activity_logs_entity').on(table.entityType, table.entityId),
  ]
);

// ─── catalog_audit ─────────────────────────────────────────────────────────

// One row per product save, switch or delete (repositories/catalogAudit.ts). item_id is the product id
// with no foreign key, so a deleted product's history stays readable; diff holds CatalogChange[].
export const catalogAudit = pgTable(
  'catalog_audit',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    itemId: uuid('item_id'),
    changedBy: uuid('changed_by').references(() => staffProfiles.id, { onDelete: 'set null' }),
    changeType: text('change_type').notNull(),
    diff: jsonb('diff'),
    // The actor's name as shown at the time (0029); survives the staff account being deleted.
    actorName: text('actor_name'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_catalog_audit_item').on(table.itemId, table.changedAt.desc())]
);

// ─── conversation_reads ────────────────────────────────────────────────────

export const conversationReads = pgTable(
  'conversation_reads',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_conversation_reads_conv_agent').on(table.conversationId, table.agentId),
  ]
);

// ─── leads ─────────────────────────────────────────────────────────────────

// One row per lead. request_id set = the customer arrived through a marketing form
// (their prefilled WhatsApp template carries "Request ID: <uuid>"); null = organic
// walk-in. Three writers - the Excel import, the WhatsApp match, and the organic
// fallback - all upsert, in any order. See repositories/leads.ts.
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    requestId: uuid('request_id'),
    contactId: uuid('contact_id').references(() => contacts.id),
    utmId: text('utm_id'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmTerm: text('utm_term'),
    utmContent: text('utm_content'),
    // Form answers, parsed from the template's "Label: value" lines and/or the Excel.
    // Schemaless on purpose: production already shows three different field sets across
    // fifteen submissions. Same convention as contact_profiles.profile.
    payload: jsonb('payload').notNull().default({}),
    status: text('status').notNull().default('new'),
    // Both of these are maintained by the AI from the conversation (see
    // services/conversationInsights.ts) and may be overwritten by a human from the
    // dashboard. deal_value_idr accumulates the per-order totals the model reports;
    // it is NOT read off an invoice, because deals close off-platform.
    dealValueIdr: numeric('deal_value_idr'),
    // 'hot' | 'cold'. Written only by the model - it is a badge with no input, so nothing
    // can contradict it and it is never locked.
    leadTemperature: text('lead_temperature'),
    // Distinct orders heard in the conversation, incremented by the model and correctable
    // by hand on the leads page.
    totalOrders: integer('total_orders').notNull().default(0),
    // The STATUS lock: set by patchLead when staff set the status. Once non-null the AI stops moving
    // it. Until 0025 it locked order count and deal value too; those have their own locks now.
    humanUpdatedAt: timestamp('human_updated_at', { withTimezone: true }),
    statusSetBy: uuid('status_set_by').references(() => staffProfiles.id, { onDelete: 'set null' }),
    // Staff typed the order count / deal value: the AI never writes that field again (0025).
    totalOrdersSetAt: timestamp('total_orders_set_at', { withTimezone: true }),
    totalOrdersSetBy: uuid('total_orders_set_by').references(() => staffProfiles.id, { onDelete: 'set null' }),
    dealValueSetAt: timestamp('deal_value_set_at', { withTimezone: true }),
    dealValueSetBy: uuid('deal_value_set_by').references(() => staffProfiles.id, { onDelete: 'set null' }),
    // Brands the customer asked about, and their item lines (0026). Filled from the chat.
    brands: text('brands').array().notNull().default(sql`'{}'::text[]`),
    items: jsonb('items').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    // Staff edited brands/items by hand: the lead pass no longer merges into them (0027).
    orderFieldsSetAt: timestamp('order_fields_set_at', { withTimezone: true }),
    orderFieldsSetBy: uuid('order_fields_set_by').references(() => staffProfiles.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    // 'lead' | 'kurir' | 'status_pesanan' | 'lamaran_kerja' | 'supplier' | 'lainnya'
    kind: text('kind').notNull().default('lead'),
    // 'ai' | 'rule' | 'staff'; 'staff' locks kind against the AI.
    kindSetBy: text('kind_set_by'),
    lostReason: text('lost_reason'),
    outcomeEvidence: text('outcome_evidence'),
    outcomeMessageId: uuid('outcome_message_id').references(() => messages.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    previousLeadId: uuid('previous_lead_id').references((): AnyPgColumn => leads.id, { onDelete: 'set null' }),
    firstContactAt: timestamp('first_contact_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One lead per marketing submission.
    uniqueIndex('uq_leads_request_id')
      .on(table.requestId)
      .where(sql`${table.requestId} IS NOT NULL`),
    // At most one OPEN (not Lost) organic lead per contact: a Lost lead does not block a
    // returning customer from getting a new one. A contact may also hold several campaign
    // leads (two ads, two months), which is why contact_id is not globally unique.
    uniqueIndex('uq_leads_organic_open_contact')
      .on(table.contactId)
      .where(sql`${table.requestId} IS NULL AND ${table.status} <> 'lost'`),
    index('idx_leads_campaign').on(table.utmCampaign),
    index('idx_leads_submitted').on(table.submittedAt),
    index('idx_leads_closed').on(table.closedAt),
    // Every current-lead / waiting-time / reset query filters by contact.
    index('idx_leads_contact').on(table.contactId),
  ]
);

// Every status or kind change of a lead, written in the same transaction as the change.
// One row per customer message that placed an order (the lead-insights pass, with that message as
// evidence). leads.total_orders counts them while staff have not set it by hand.
export const leadOrders = pgTable(
  'lead_orders',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    evidence: text('evidence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('uq_lead_orders_message').on(table.leadId, table.messageId)]
);

export const leadEvents = pgTable(
  'lead_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    fromKind: text('from_kind'),
    toKind: text('to_kind'),
    // 'ai' | 'staff' | 'system'
    actor: text('actor').notNull(),
    staffId: uuid('staff_id').references(() => staffProfiles.id, { onDelete: 'set null' }),
    evidence: text('evidence'),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_lead_events_lead').on(table.leadId, table.createdAt)]
);
