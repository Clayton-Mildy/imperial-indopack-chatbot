import { upsertContactProfile } from '../repositories/contactProfiles.js';
import { applyAiLeadUpdate } from '../repositories/leads.js';
import { updateConversationFollowUp } from '../repositories/conversations.js';
import { CUSTOMER_TYPES, LEAD_TEMPERATURES } from '../domain/types.js';
import type { AIResponse, CustomerType, LeadTemperature } from '../domain/types.js';
import { notifyStaff } from './staffNotify.js';

// The model writes these free-hand, and it does not always pick the snake_case spelling.
// Normalising rather than rejecting matters: pickProfileGapQuestion only tests customerType
// for truthiness, so before this function existed a stored "End User" counted as known and
// stopped the bot re-asking. Dropping those outright would have made it ask again.
const CUSTOMER_TYPE_ALIASES: Record<string, CustomerType> = {
  enduser: 'end_user', pengguna: 'end_user', pemakai: 'end_user', retail: 'end_user',
  dipakaisendiri: 'end_user', pakaisendiri: 'end_user', penggunaakhir: 'end_user',
  sendiri: 'end_user', pribadi: 'end_user', personal: 'end_user', konsumen: 'end_user',
  reseller: 'reseller', agen: 'reseller', toko: 'reseller', distributor: 'reseller',
  project: 'project', proyek: 'project', kontraktor: 'project',
};

/**
 * customer_type comes from the model and lands in a plain text column with no DB enum, so an
 * unchecked cast let anything at all become the stored buyer type — and buyer type now decides
 * which price the bot may quote. Anything still unrecognised after normalising is dropped
 * rather than written: no value is better than a wrong one the next turn will trust.
 */
export function parseCustomerType(raw: unknown): CustomerType | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;

  const exact = CUSTOMER_TYPES.find((t) => t === value);
  if (exact) return exact;

  const squashed = value.replace(/[\s_-]/g, '');
  const alias = CUSTOMER_TYPE_ALIASES[squashed];
  if (!alias) console.warn(`[insights] ignoring unknown customer_type "${raw}"`);
  return alias;
}

const TEMPERATURE_ALIASES: Record<string, LeadTemperature> = {
  hot: 'hot', panas: 'hot', warm: 'hot', hangat: 'hot', tinggi: 'hot',
  cold: 'cold', dingin: 'cold', rendah: 'cold',
};

/**
 * Same contract as parseCustomerType: normalise what the model actually writes, drop what
 * cannot be mapped. The value is rendered as a badge and filtered on, so an unmapped string
 * would show up verbatim in the marketing report.
 *
 * "warm" maps to hot on purpose - the UI offers two buckets, and a lead the model thought
 * worth calling warm belongs on the side that gets chased.
 */
export function parseTemperature(raw: unknown): LeadTemperature | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  const exact = LEAD_TEMPERATURES.find((t) => t === value);
  if (exact) return exact;
  const alias = TEMPERATURE_ALIASES[value.replace(/[\s_-]/g, '')];
  if (!alias) console.warn(`[insights] ignoring unknown lead_temperature "${raw}"`);
  return alias;
}

/** Rupiah, from the model. Rejects anything that isn't a finite positive number. */
function parseOrderValue(raw: unknown): number | undefined {
  const value = typeof raw === 'string' ? Number(raw.replace(/[^\d.]/g, '')) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

/**
 * Persist any CATAT data and follow-up notes the AI extracted in this turn.
 * Called after each AI response — fire-and-forget (errors are logged, not re-thrown).
 */
export async function saveConversationInsights(
  conversationId: string,
  contactId: string,
  aiResponse: AIResponse
): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  // The buyer type is its own required field, answered every turn. It used to ride in
  // profile_update, which the model fills only with what it thinks is NEW - so a type stated two
  // turns earlier was often never written, the tier line never rendered, and the end-user price
  // check never ran (UAT F-06 / F-08). profile_update's copy stays as a fallback.
  const customerType = aiResponse.customerType ?? parseCustomerType(aiResponse.profileUpdate?.['customer_type']);

  // ── Contact profile (CATAT) ──────────────────────────────────────────────
  if (aiResponse.profileUpdate && Object.keys(aiResponse.profileUpdate).length > 0) {
    const patch = aiResponse.profileUpdate;
    // Lead-level fields ride in the same bag (profile_update is additionalProperties:true, so
    // documenting a key in RESPOND_FIELD_DESC is the whole contract) but belong on `leads`,
    // not in contact_profiles.profile. Destructured out so they never land in the jsonb.
    const {
      customer_type: _type,
      lead_temperature: _temp,
      lead_status: _leadStatus,
      order_confirmed: _ordered,
      order_value_idr: _orderValue,
      ...rest
    } = patch;

    tasks.push(
      upsertContactProfile(contactId, {
        customerType,
        profilePatch: rest,
        followUpStatus: aiResponse.followUpNotes ? 'needs_followup' : undefined,
        followUpNotes: aiResponse.followUpNotes ?? undefined,
      }).catch((err) => {
        console.error('[insights] Failed to upsert contact profile:', err);
      })
    );
  } else if (aiResponse.followUpNotes || customerType) {
    // Even if no profile data, still record the buyer type and mark follow-up on the profile
    tasks.push(
      upsertContactProfile(contactId, {
        customerType,
        followUpStatus: aiResponse.followUpNotes ? 'needs_followup' : undefined,
        followUpNotes: aiResponse.followUpNotes ?? undefined,
      }).catch((err) => {
        console.error('[insights] Failed to set follow-up on profile:', err);
      })
    );
  }

  // ── Conversation-level follow-up notes ───────────────────────────────────
  if (aiResponse.followUpNotes !== undefined) {
    tasks.push(
      updateConversationFollowUp(conversationId, aiResponse.followUpNotes || null).catch((err) => {
        console.error('[insights] Failed to update conversation follow-up:', err);
      })
    );
  }

  // ── Lead row (temperature / status / orders / deal value) ────────────────
  // ponytail: order_confirmed is trusted per turn, so a model that re-flags the same order
  // on the next reply double-counts it. Same discipline the upsell_offered booleans already
  // rely on; tighten only if live data shows inflation.
  if (aiResponse.profileUpdate) {
    const patch = aiResponse.profileUpdate;
    const orderConfirmed = patch['order_confirmed'] === true;
    tasks.push(
      applyAiLeadUpdate(contactId, {
        temperature: parseTemperature(patch['lead_temperature']),
        orderConfirmed,
        // A value without a confirmed order is a quote, not a deal - don't bank it.
        orderValueIdr: orderConfirmed ? parseOrderValue(patch['order_value_idr']) : undefined,
      }).catch((err) => {
        console.error('[insights] Failed to apply AI lead update:', err);
      })
    );
  }

  // A follow-up note is the model telling us a human has to do something - most valuably, that
  // the customer just said what they want to order. Live, "Aku mau order 3 karton" (1.800 pcs)
  // drew "kami catat" from the bot and nothing at all from the system. This is the one place
  // that fact is already known, so it is the one place worth pinging from.
  if (aiResponse.followUpNotes) {
    notifyStaff({
      title: 'Perlu tindak lanjut',
      body: aiResponse.followUpNotes,
      path: `/conversations/${conversationId}`,
    });
  }

  await Promise.all(tasks);
}
