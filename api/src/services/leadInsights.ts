import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getClient, isDevMode, agentQuery, logUsageLine, CLAUDE_MODEL } from './claude.js';
import { getLastNMessages, listConversationsDueForInsights, markInsightsExtracted } from '../repositories/conversations.js';
import { getLeadReopenAfterDays, getLeadSilenceLostDays } from '../repositories/appSettings.js';
import { canAdvance, matchEvidence, hasPriceFigure, parseLeadKind, parseLostReason } from '../domain/leadStages.js';
import type { Lead, LeadKind, LeadStatus, LeadTemperature, LostReason } from '../domain/types.js';
import { fillContactProfileGaps } from '../repositories/contactProfiles.js';
import { applyAiLeadUpdate, applyLeadStage, closeSilentLeads, findCurrentLeadForContact, getLeadLifecycleStart, applyLeadOrderSnapshot, recordLeadOrders, reopenOrRenewLostLead, type LeadStageChange } from '../repositories/leads.js';
import { parseTemperature } from './conversationInsights.js';
import type { Message } from '../domain/types.js';
import type { BrandSlug, OrderItem } from '../domain/orderProfile.js';

/**
 * Background pass that reads a conversation after the fact and fills the lead's Tipe, Hot/Cold and
 * Kebutuhan / Minat - for every chat, replied to by the bot or not.
 *
 * Those fields used to come only from the live bot's own turns, and only when the model chose to
 * report them that turn. So a contact with AI replies switched off never got any, nor did a chat
 * whose turn ended in a fixed hand-off, nor one where the model just left them out: the leads
 * list was mostly dashes.
 *
 * It only ever FILLS. whatever the live
 * bot wrote was read mid-conversation with the catalog in view, so neither is overwritten.
 * Hot/Cold is the exception: it is a reading of where the chat stands now, so the latest wins.
 *
 * It is also the one AI decider of the lead's kind and stage (CLAUDE.md, "Lead stages"): kind while
 * the lead is new/contacted, Penawaran from the first outbound Rp figure, Won/Lost only with a
 * customer message as evidence, a Lost lead reopened or renewed - all through applyLeadStage, which
 * moves forward only and never over staff. LEAD_STAGE_AI=0 turns those writes off; the fills go on.
 * It counts orders too (client 2026-11-10): every customer message that places an order, picked by
 * number in a call of its own (extractOrderMessageIds), becomes a lead_orders row and total_orders is their count - unless
 * staff typed the count, which locks it. Never the deal value: the rupiah total is rarely in the chat
 * (staff send price lists and invoices as files), so it stays with staff and the live bot.
 */

// A chat still in motion is the live bot's; the pass waits until the customer has gone quiet.
const QUIET_MS = 5 * 60_000;
const TRANSCRIPT_MESSAGES = 40;
const MAX_INTEREST_CHARS = 80;

// Field by field, never all or nothing. A strict schema threw the whole answer away for one odd
// value - a quantity written as a number (3, not "3"), a buyer type spelled "end user", a "warm" -
// and the first backfill on 2026-10-08 logged a run of "unreadable answer" lines for exactly that.
// An odd value now costs only its own field. Each is .optional() first: in zod 4 a missing key on a
// bare z.unknown().transform() is an error, which would put the all-or-nothing failure right back.
const NO_VALUE = new Set(['', 'null', 'none', 'unknown', 'n/a', 'tidak diketahui', 'belum diketahui', 'tidak disebutkan', '-']);
const enumField = <T>(parse: (raw: unknown) => T | undefined) =>
  z.unknown().optional().transform((v) =>
    v == null || (typeof v === 'string' && NO_VALUE.has(v.trim().toLowerCase())) ? null : parse(v) ?? null);
const textField = z.unknown().optional().transform((v): string | null => {
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' || typeof x === 'number').join(', ') || null;
  return typeof v === 'string' ? v : null;
});
// A name the model did not find, written as a word: "unknown", "tidak diketahui", "-" would otherwise
// fill the profile's name (and the hand-off would stop asking for it).
const nameField = textField.transform((v) => (v !== null && NO_VALUE.has(v.trim().toLowerCase()) ? null : v));

type AiStage = 'contacted' | 'won' | 'lost';
const parseStage = (raw: unknown): AiStage | undefined => {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return v === 'contacted' || v === 'won' || v === 'lost' ? v : undefined;
};

// An item as the model wrote it. Kept loose on purpose (a qty of "300", a size of 30 x 30): the
// merge (mergeOrderFacts) sanitises the fields, so a number in a string costs nothing here.
const OrderItemSchema = z.unknown().transform((v) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null));

const InsightsObject = z.object({
  is_sales_conversation: z.unknown().optional().transform((v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null)),
  lead_kind: enumField<LeadKind>(parseLeadKind),
  stage: enumField<AiStage>(parseStage),
  evidence: textField,
  lost_reason: enumField<LostReason>(parseLostReason),
  lead_temperature: enumField(parseTemperature),
  name: nameField,
  business_name: nameField,
  brands: z.array(z.unknown()).catch([]).transform((a) => a.filter((b): b is BrandSlug => b === 'imperial_indopack' || b === 'kertas_supreme')),
  items: z.array(OrderItemSchema).catch([]).transform((a) => a.filter((i): i is Record<string, unknown> => i !== null)),
});
// An older answer (or one that kept the old key) says only is_sales_conversation: false = "lainnya".
const InsightsSchema = InsightsObject.transform((o) => ({
  ...o,
  lead_kind: o.lead_kind ?? (o.is_sales_conversation === false ? ('lainnya' as LeadKind) : null),
}));
/**
 * `orderMessageIds`: the customer messages that placed an order - not the model's main answer but a
 * second, focused call (extractOrderMessageIds) that readConversation adds. Empty when not asked.
 */
export type LeadInsights = z.infer<typeof InsightsSchema> & { orderMessageIds?: string[] };

export const PROMPT = `Kamu membaca percakapan WhatsApp antara pelanggan dan tim penjualan Imperial Indopack / Kertas Supreme (box karton dan kertas bungkus makanan cetak). "Bot" adalah asisten AI, "Staf" adalah orang dari tim.

Isi data lead dari percakapan ini. Hanya dari apa yang benar-benar tertulis - jangan menebak. null selalu boleh.

- lead_temperature: "hot" bila ada niat beli nyata untuk barang yang BISA kami jual (menanyakan harga, menyebut jumlah, ukuran, atau desain, tenggat waktu, atau cara order). "cold" bila hanya melihat-lihat, sudah tidak membalas, ATAU barang yang dicari ternyata tidak kami jual / tidak tersedia (Bot atau Staf sudah bilang tidak ada) dan pelanggan belum tertarik pada alternatif yang kami tawarkan - niat beli untuk barang yang tidak ada bukan lead panas.
- name: nama pelanggan bila disebut.
- business_name: nama toko atau perusahaan pelanggan bila disebut.
- brands: daftar merek yang diminati pelanggan: "imperial_indopack" (box karton cetak) dan/atau "kertas_supreme" (kertas bungkus makanan cetak). Kosongkan [] bila belum jelas.
- items: daftar barang yang diminta pelanggan, satu objek per barang: {"product": nama barang, "size": ukuran mis. "30x30", "gsm": gramatur, "print": cetakan/warna, "qty": jumlah (angka), "qty_unit": "rim" atau "pcs", "has_design": true bila pelanggan sudah punya desain, false bila belum}. Isi hanya field yang disebut. Kosongkan [] bila belum ada barang.

- lead_kind: jenis percakapan ini. "lead" = calon pembeli (termasuk yang mencari barang yang tidak kami jual - barang yang tidak kami jual tetap lead). "kurir" = kurir / ojek online / pengantar paket (termasuk yang mau mengantar paket ke gudang kami dan menanyakan siapa penerimanya; paket yang mereka antar bukan pesanan pelanggan kami). "status_pesanan" = menanyakan atau menagih pesanan, pembayaran, atau pengiriman yang sudah ada. "lamaran_kerja" = melamar kerja. "supplier" = pihak yang menawarkan barangnya kepada kami. "lainnya" = obrolan pribadi, salah sambung, spam. Pelanggan yang MENGELUH atau kecewa (barang rusak, sobek, salah, terlambat, minta ganti rugi) adalah pembeli: tetap "lead", BUKAN "status_pesanan" - keluhan ditangani tim lewat hand-off, bukan jenis percakapan. Pembeli yang menanyakan pesanan / pembayaran / pengiriman miliknya sendiri di chat yang sama tetap "lead", begitu juga pelanggan lama yang memesan lagi di chat ini. Bila bukan "lead", isi stage dengan null. Bila bukan calon pembeli sama sekali, field lain diabaikan.
- stage (hanya bila lead_kind "lead"): "contacted" = pelanggan menyatakan kebutuhan atau menanyakan produk. "won" = pelanggan JELAS setuju membeli, mis. "oke saya ambil 10 rim", minta nomor rekening, atau mengirim alamat pengiriman untuk pesanan; tanya harga atau "nanti saya kabari" BUKAN won. "lost" = pelanggan menolak, sudah membeli di tempat lain, atau menutup percakapan setelah kami bilang barangnya tidak ada (mis. "ok makasih" setelah "belum ada di kami"); diam / tidak membalas BUKAN lost. Bila ragu, isi null.
- evidence: wajib bila stage "won" atau "lost" - salin PERSIS satu pesan Pelanggan (kata per kata, jangan diringkas, jangan memakai kata Bot atau Staf) yang menjadi buktinya. Selain itu null.
- lost_reason (hanya bila stage "lost"): "barang_tidak_ada", "harga", "beli_di_tempat_lain", "tidak_jadi", "tidak_cocok", "di_bawah_minimum" (jumlah pesanan di bawah minimum order kami), atau "lainnya".

Balas HANYA dengan JSON valid, tanpa teks lain:
{"lead_kind": "lead", "stage": null, "evidence": null, "lost_reason": null, "lead_temperature": null, "name": null, "business_name": null, "brands": [], "items": []}`;

function toTranscript(rows: Message[]): string {
  return rows
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? 'Pelanggan' : m.senderName ? 'Staf' : 'Bot'}: ${m.body}`)
    .join('\n');
}

async function askModel(system: string, content: string, label: string): Promise<string> {
  if (isDevMode()) return agentQuery({ systemPrompt: system, userContent: content, maxTurns: 1 });
  const response = await getClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    temperature: 0,
    system,
    messages: [{ role: 'user', content }],
  });
  logUsageLine(`[leadInsights] ${label}usage`, { in: response.usage.input_tokens, out: response.usage.output_tokens });
  return response.content[0]?.type === 'text' ? response.content[0].text : '';
}

const ORDER_PROMPT = `Kamu membaca percakapan WhatsApp antara pelanggan dan tim penjualan Imperial Indopack / Kertas Supreme (box karton dan kertas bungkus makanan cetak). Setiap pesan Pelanggan diberi nomor, mis. [3]; pesan Staf dan Bot hanya konteks.

Sebutkan nomor SETIAP pesan Pelanggan yang MEMESAN barang: pelanggan menyatakan memesan / mengambil / membeli barang tertentu dengan jumlahnya, mis. "Pesan box nasi 20x20 2000 pcs + kertas bungkus 30x30 5 rim", "Mau pesan 10 rim yg 64 gsm", "oke saya ambil 2500 pcs box kuenya". Pelanggan lama yang memesan berulang kali: sebutkan setiap pesanannya.

Satu nomor per pesanan: pesan yang sama dikirim ulang, tambahan, atau ralat untuk pesanan yang sama BUKAN pesanan baru - sebutkan yang pertama saja. Tanya harga, tanya stok, minta penawaran, minta pengganti barang rusak, menagih pesanan lama, atau "nanti saya kabari" BUKAN pesanan.

Balas HANYA dengan JSON valid, tanpa teks lain: {"orders": [3, 17]} - atau {"orders": []} bila tidak ada.`;

/**
 * The customer messages that placed an order, by id - a call of its own, after the main one. Asked
 * inside the main answer, Haiku labelled two repeat buyers status_pesanan and then left their orders
 * out 5 runs in 6 (production 2026-11-10). Here it only picks numbers, so nothing is misquoted: the
 * numbers map back to the exact messages. null when the answer could not be read.
 */
export async function extractOrderMessageIds(rows: Message[]): Promise<string[] | null> {
  const numbered: string[] = [];
  const idByNumber = new Map<number, string>();
  for (const m of rows) {
    if (m.role === 'user') {
      const n = idByNumber.size + 1;
      idByNumber.set(n, m.id);
      numbered.push(`[${n}] Pelanggan: ${m.body}`);
    } else if (m.role === 'assistant') {
      numbered.push(`${m.senderName ? 'Staf' : 'Bot'}: ${m.body}`);
    }
  }
  if (idByNumber.size === 0) return [];
  const raw = await askModel(ORDER_PROMPT, numbered.join('\n'), 'orders ');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  try {
    const parsed = JSON.parse(start !== -1 && end > start ? raw.slice(start, end + 1) : raw) as { orders?: unknown };
    const list = Array.isArray(parsed.orders) ? parsed.orders : [];
    const ids = list
      .map((v) => idByNumber.get(typeof v === 'number' ? v : Number(String(v).replace(/[^\d]/g, ''))))
      .filter((id): id is string => id !== undefined);
    return [...new Set(ids)];
  } catch {
    console.warn(`[leadInsights] unreadable order answer: ${raw.slice(0, 200).replace(/\s+/g, ' ')}`);
    return null;
  }
}

/** null = the model's answer could not be read; the caller treats that as "nothing learned". */
export async function extractLeadInsights(transcript: string): Promise<LeadInsights | null> {
  const raw = await askModel(PROMPT, transcript, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  try {
    return InsightsSchema.parse(JSON.parse(start !== -1 && end > start ? raw.slice(start, end + 1) : raw));
  } catch (err) {
    // The model's own words first: they are what says why, and the error text can be long.
    console.warn(`[leadInsights] unreadable answer: ${raw.slice(0, 300).replace(/\s+/g, ' ')} | ${err instanceof Error ? err.message.slice(0, 200) : err}`);
    return null;
  }
}

const clean = (v: string | null | undefined, max = MAX_INTEREST_CHARS): string | undefined => {
  const t = v?.trim();
  return t ? t.slice(0, max) : undefined;
};

/** One intended write. The plan is data, so the same decisions feed the live pass and the backfill's dry run. */
type PlanStep =
  | { op: 'reopen'; evidence: { body: string; messageId: string } }
  | { op: 'stage'; change: LeadStageChange }
  | { op: 'profile'; facts: Record<string, unknown> }
  | { op: 'order_fields'; brands: BrandSlug[]; items: OrderItem[] }
  | { op: 'temperature'; value: LeadTemperature }
  | { op: 'order'; messageId: string; evidence: string };

export interface InsightsPlan {
  steps: PlanStep[];
  /** Short human lines for the dry run, e.g. `kind lead->kurir`. Only what would really change. */
  wouldChange: string[];
}

const quote = (s: string) => `"${s.replace(/\s+/g, ' ').slice(0, 80)}"`;

/**
 * kind -> quoted -> stage, each its own checked write. The model's word is never enough for won/lost: its
 * evidence must be a customer message in the transcript. Pure: reads nothing, writes nothing; the lead is
 * walked forward in memory so each step is judged against what the one before it would have done.
 */
/** What the pass knew before it read this chat: where the lead's lifecycle starts, and what a pass already read. */
export interface PlanContext {
  /** The open lead's lifecycle start (getLeadLifecycleStart). Ignored for a Lost lead. */
  lifecycleStart?: Date | null;
  /**
   * The conversation's insights watermark as it was BEFORE this pass: the newest customer message a
   * pass already read. A message read by a pass that left the lead Lost did not bring the customer back.
   */
  readUntil?: Date | null;
}

/**
 * Returns the lead's kind once this plan is applied - its own, or the model's when the kind step
 * would really write it - or null with no lead to write to (none yet, or LEAD_STAGE_AI=0).
 */
/** "ok makasih", "baik kak terima kasih" - a short sign-off, no question. */
function isSignOff(body: string): boolean {
  const words = body.trim().split(/\s+/).filter(Boolean);
  return words.length <= 4 && !body.includes('?');
}

function planKindAndStage(
  lead: Lead | null, insights: LeadInsights, rows: Message[], reopenAfterDays: number, ctx: PlanContext, plan: InsightsPlan,
): LeadKind | null {
  if (process.env['LEAD_STAGE_AI'] === '0' || !lead) return null;
  // Only the lead's current lifecycle proves a step: a reopened lead's transcript still holds the
  // quote and the words of the lifecycle that ended Lost, and dating a step by one of those would
  // put it into that old story (or before a renewal lead even existed).
  // For a Lost lead (`rows` cut at closed_at) a new lifecycle can only start at the return message:
  // the first customer message after the close that no pass has read. Not simply the first after
  // the close - that is normally the sign-off right after the refusal ("ok kak makasih"), and a
  // customer back months later would be judged inside the window, dated at it, and a staff-closed
  // lead would hit "staff closed it inside the window" on every pass and never renew.
  const readMs = ctx.readUntil?.getTime() ?? -Infinity;
  const startMs = ctx.lifecycleStart?.getTime() ?? -Infinity;
  const firstIdxRaw = lead.status === 'lost'
    ? rows.findIndex((m) => m.role === 'user' && m.createdAt.getTime() > readMs)
    : rows.findIndex((m) => m.createdAt.getTime() >= startMs);
  const firstIdx = firstIdxRaw === -1 ? rows.length : firstIdxRaw;
  const userRows = rows.filter((m, i) => m.role === 'user' && i >= firstIdx);

  // Orders: customer messages of this lifecycle the order call picked by number, so each is a real
  // message by construction. Read for a buyer or an order chaser only - a courier's "mau ambil
  // pesanan" is not an order of theirs.
  const orderIds = new Set(insights.orderMessageIds ?? []);
  const orderHits = insights.lead_kind === 'lead' || insights.lead_kind === 'status_pesanan'
    ? userRows.filter((m) => orderIds.has(m.id))
    : [];
  // A customer who places orders is a buyer, whatever else the chat is about. A repeat buyer's chat
  // is mostly orders, invoices and deliveries, and Haiku can label it status_pesanan - which would
  // also take them out of /leads.
  const kind: LeadKind | null = insights.lead_kind === 'status_pesanan' && orderHits.length > 0 ? 'lead' : insights.lead_kind;
  // A repeat buyer the model filed as status_pesanan gets no stage at all - asked for one it leaves it
  // null - though every order it placed is the "clearly agrees to buy" Won stands for (repeat buyers
  // with verified orders came out with no Won at all). Their latest order is the proof.
  const wonByOrders = insights.lead_kind === 'status_pesanan' && orderHits.length > 0 && insights.stage !== 'lost';
  const stage = wonByOrders ? 'won' : insights.stage;
  // Every step a message proves is dated by that message (applyLeadStage), so the messages are
  // picked in the order the steps are written - reopen, then Penawaran, then the outcome - or the
  // history would list "Penawaran -> Menang" above "Baru -> Penawaran". Positions in `rows`
  // (oldest first), not times: two rows can share a millisecond.
  const matched = wonByOrders
    ? orderHits[orderHits.length - 1]!
    : (stage === 'won' || stage === 'lost') && insights.evidence ? matchEvidence(insights.evidence, userRows) : null;
  const at = (id: string) => rows.findIndex((m) => m.id === id);
  // A Lost must be the customer CLOSING the chat, not just a customer message: 6 of 7 Lost calls in
  // a dry run quoted the customer's own opening question ("apa ada jual box ukuran ini ya?", then
  // silence), or a "Baik kk" they followed with another order. The evidence check
  // passed them all - they are verbatim customer messages. So the evidence must answer something we
  // said, and the customer must not have gone on talking after it (a sign-off may follow).
  const closesChat = (hitAt: number): boolean =>
    rows.some((m, i) => i >= firstIdx && i < hitAt && m.role === 'assistant')
    && rows.every((m, i) => i <= hitAt || m.role !== 'user' || isSignOff(m.body));
  const outcomeHit = matched && stage === 'lost' && !closesChat(at(matched.id)) ? null : matched;
  if (matched && !outcomeHit) console.warn(`[leadInsights] lost evidence does not close the chat: ${matched.body.slice(0, 120)}`);
  const outcomeAt = outcomeHit ? at(outcomeHit.id) : rows.length;
  let reopenAt = -1;
  let status: LeadStatus = lead.status;
  let curKind: LeadKind = lead.kind;
  let kindLocked = lead.kindSetBy === 'staff';
  let humanLocked = lead.humanUpdatedAt !== null;

  if (status === 'lost') {
    // `rows` was cut to the messages after closed_at. Only a customer who is buying again reopens it;
    // a "lost" (or no) answer on those messages means they are still not buying.
    // The evidence is that return message, so the quote and the outcome that follow it in this
    // pass sort after the reopen. No unread customer message: nothing reopens.
    const back = userRows[0];
    // Closed for no response (closeSilentLeads): the customer never said no, so any message back is a
    // new lead (client, 2026-11-13) - "halo kak" included, which the model often leaves at stage null.
    const silenceLost = lead.lostReason === 'tidak_ada_respon';
    const returning = silenceLost ? stage !== 'lost' : stage === 'contacted' || stage === 'won';
    if (kind !== 'lead' || !returning || !back) return curKind;
    // Measured to the return message, not to now: a backfill run weeks later judges the same gap.
    const closedAt = lead.closedAt ?? lead.updatedAt;
    const withinWindow = !silenceLost && back.createdAt.getTime() - closedAt.getTime() <= reopenAfterDays * 86_400_000;
    if (withinWindow && humanLocked) return curKind; // staff closed it inside the window
    plan.steps.push({ op: 'reopen', evidence: { body: back.body, messageId: back.id } });
    reopenAt = at(back.id);
    plan.wouldChange.push(withinWindow ? `status lost->contacted (reopen, evidence: ${quote(back.body)})` : 'new lead (renewal after the reopen window)');
    status = 'contacted';
    if (!withinWindow) { curKind = 'lead'; kindLocked = false; humanLocked = false; }
  }

  // The AI names the kind only while the chat is still being qualified; a buyer past Penawaran (or Won)
  // asking about their own order is still a lead.
  // A non-buyer kind the live rule set (courier, supplier, job seeker) is not swapped for another non-buyer
  // kind by the model: it called a courier asking who receives a parcel "status_pesanan" (QA courier).
  // Only "lead" - the rule misfired on a buyer - overrides it.
  const ruleHeld = lead.kindSetBy === 'rule' && lead.kind !== 'lead' && kind !== 'lead';
  if (kind && !ruleHeld && (status === 'new' || status === 'contacted')) {
    plan.steps.push({ op: 'stage', change: { kind, kindSetBy: 'ai', actor: 'ai' } });
    if (!kindLocked && kind !== curKind) plan.wouldChange.push(`kind ${curKind}->${kind}`);
    if (!kindLocked) curKind = kind;
  }
  if (kind !== 'lead') return curKind;
  for (const hit of orderHits) {
    plan.steps.push({ op: 'order', messageId: hit.id, evidence: hit.body });
    plan.wouldChange.push(`order ${quote(hit.body)}`);
  }

  const advance = (to: LeadStatus, why?: string) => {
    if (humanLocked || !canAdvance(status, to)) return;
    plan.wouldChange.push(`status ${status}->${to}${why ? ` (${why})` : ''}`);
    status = to;
  };

  // Penawaran is a code check, not an answer: an outbound message with an Rp figure. The FIRST one
  // (when the lead was quoted), and none after the outcome message, before a reopen, or from an
  // earlier lifecycle.
  const quoted = rows.find((m, i) => i > reopenAt && i >= firstIdx && i < outcomeAt && m.role === 'assistant' && hasPriceFigure(m.body));
  if (quoted) {
    plan.steps.push({ op: 'stage', change: { status: 'quoted', actor: 'system', evidence: quoted.body, messageId: quoted.id } });
    advance('quoted');
  }

  if (stage === 'contacted') {
    plan.steps.push({ op: 'stage', change: { status: 'contacted', actor: 'ai' } });
    advance('contacted');
  } else if (stage === 'won' || stage === 'lost') {
    const hit = outcomeHit;
    if (!hit) {
      console.warn(`[leadInsights] won/lost without matching evidence (${stage}): ${(insights.evidence ?? '').slice(0, 120)}`);
    } else {
      plan.steps.push({
        op: 'stage',
        change: {
          status: stage, evidence: hit.body, messageId: hit.id, actor: 'ai',
          ...(stage === 'lost' && insights.lost_reason ? { lostReason: insights.lost_reason } : {}),
        },
      });
      advance(stage, `${stage === 'lost' && insights.lost_reason ? `reason ${insights.lost_reason}, ` : ''}evidence: ${quote(hit.body)}`);
    }
  }
  return curKind;
}

/** Everything one conversation's insights would write, decided but not done. `lead` is the contact's current lead. */
export function planLeadInsights(
  lead: Lead | null, insights: LeadInsights, rows: Message[], reopenAfterDays: number, ctx: PlanContext = {},
): InsightsPlan {
  const plan: InsightsPlan = { steps: [], wouldChange: [] };
  const leadKind = planKindAndStage(lead, insights, rows, reopenAfterDays, ctx, plan);
  // The fills are skipped for a lead that is, or this pass makes, a non-lead kind - not for every
  // non-lead label: a quoted or Won buyer (or one staff called a lead) asking "sudah transfer, kapan
  // dikirim?" may be labelled status_pesanan, the kind write is refused, and the lead stays a lead -
  // so its Tipe / Hot-Cold / Minat must go on too.
  // With no lead to write to (none yet, or LEAD_STAGE_AI=0) the model's answer decides: only an
  // explicit "not a sale" (or a kind other than lead) skips the chat; an answer that left the flag out
  // but named a product is still worth its fields. The switch stops the kind/stage writes, not this -
  // lead_kind replaced is_sales_conversation in the prompt, so without it a courier or job seeker
  // would get profile facts and a temperature again.
  const notASale = leadKind !== null
    ? leadKind !== 'lead'
    : insights.is_sales_conversation === false || (insights.lead_kind != null && insights.lead_kind !== 'lead');
  if (notASale) {
    // Nothing about a non-buyer belongs on the lead - except that a Hot the live bot set mid-chat
    // must not outlive the verdict. A customer asking for an item we do not carry, told so by staff,
    // can be answered cold AND "not a sale"; this early return used to throw the cold away and the
    // lead stayed Hot.
    if (insights.lead_temperature === 'cold') {
      plan.steps.push({ op: 'temperature', value: 'cold' });
      plan.wouldChange.push('temperature cold');
    }
    return plan;
  }
  const facts: Record<string, unknown> = {};
  const name = clean(insights.name);
  const business = clean(insights.business_name);
  if (name) facts['name'] = name;
  if (business) facts['business_name'] = business;
  if (Object.keys(facts).length > 0) {
    plan.steps.push({ op: 'profile', facts });
    plan.wouldChange.push(`profile fill ${Object.keys(facts).join(', ')}`);
  }
  if (insights.brands.length > 0 || insights.items.length > 0) {
    plan.steps.push({ op: 'order_fields', brands: insights.brands, items: insights.items as OrderItem[] });
    plan.wouldChange.push(`order fields ${[insights.brands.length ? `brands ${insights.brands.join('+')}` : '', insights.items.length ? `${insights.items.length} item(s)` : ''].filter(Boolean).join(', ')}`);
  }
  if (insights.lead_temperature) {
    plan.steps.push({ op: 'temperature', value: insights.lead_temperature });
    plan.wouldChange.push(`temperature ${insights.lead_temperature}`);
  }
  return plan;
}

async function planFor(contactId: string, insights: LeadInsights, rows: Message[], readUntil: Date | null): Promise<InsightsPlan> {
  const lead = process.env['LEAD_STAGE_AI'] === '0' ? null : await findCurrentLeadForContact(contactId);
  if (lead?.status === 'lost') return planLeadInsights(lead, insights, rows, await getLeadReopenAfterDays(), { readUntil });
  return planLeadInsights(lead, insights, rows, 0, { lifecycleStart: lead ? await getLeadLifecycleStart(lead.id) : null });
}

async function applyPlan(contactId: string, plan: InsightsPlan): Promise<void> {
  let lead = process.env['LEAD_STAGE_AI'] === '0' ? null : await findCurrentLeadForContact(contactId);
  let stageOpen = lead !== null;
  // A stage this pass wrote leaves `lead` stale - a Lost written a step ago still reads as contacted.
  let stageWritten = false;
  const orders: { messageId: string; evidence: string }[] = [];
  for (const step of plan.steps) {
    if (step.op === 'order') {
      orders.push({ messageId: step.messageId, evidence: step.evidence });
      continue;
    }
    if (step.op === 'reopen') {
      if (!lead) continue;
      lead = await reopenOrRenewLostLead(lead, await getLeadReopenAfterDays(), step.evidence);
      if (lead.status === 'lost') stageOpen = false; // staff closed it inside the window
    } else if (step.op === 'stage') {
      if (stageOpen && lead && await applyLeadStage(lead.id, step.change)) stageWritten = true;
    } else if (step.op === 'profile') {
      await fillContactProfileGaps(contactId, { facts: step.facts });
    } else if (step.op === 'order_fields') {
      // Only a lead that is still open and is a buyer's: not a courier's, not one left Lost - read
      // again when a step above changed it, so a Lost from this very pass counts.
      const target = lead && !stageWritten ? lead : await findCurrentLeadForContact(contactId);
      if (target && target.kind === 'lead' && target.status !== 'lost') {
        await applyLeadOrderSnapshot(target.id, { brands: step.brands, items: step.items });
      }
    } else {
      await applyAiLeadUpdate(contactId, { temperature: step.value });
    }
  }
  // After the reopen/renewal above, so the orders land on the lead they belong to now. Not on a lead
  // staff closed inside the reopen window: it stays as staff left it.
  if (stageOpen && lead && orders.length > 0) await recordLeadOrders(lead.id, orders);
}

/** Writes what one conversation's insights add. Exported for tests. */
export async function applyLeadInsights(
  contactId: string, insights: LeadInsights, transcriptRows: Message[] = [], readUntil: Date | null = null,
): Promise<void> {
  await applyPlan(contactId, await planFor(contactId, insights, transcriptRows, readUntil));
}

export interface LeadInsightsPassOptions {
  /** Decide and report, write nothing - not the lead, the profile, an event or the watermark. */
  dryRun?: boolean;
  /** Select by watermark age (null or older than `since`) instead of "has a newer customer message". */
  ignoreWatermark?: boolean;
  since?: Date;
  /** Only these conversations (one chat re-read by hand; tests on a shared DB). */
  conversationIds?: string[];
  /** How long a chat must be quiet before it is read (default QUIET_MS); 0 in the QA harness. */
  quietMs?: number;
  /** Leave leads staff touched (human_updated_at, kind_set_by 'staff') alone: no model call, no write. */
  skipStaff?: boolean;
  /**
   * How many of the newest messages the model reads (default TRANSCRIPT_MESSAGES). The live pass reads
   * every new burst, so new orders are always in its 40; a backfill reads a chat once and needs its
   * history - a repeat buyer had 9 order messages since June, 7 of them before the last 40.
   */
  transcriptMessages?: number;
  onResult?: (r: { conversationId: string; insights: LeadInsights; wouldChange: string[] }) => void;
  onSkip?: (s: { conversationId: string; reason: 'staff' | 'unreadable' }) => void;
  onError?: (e: { conversationId: string; error: unknown }) => void;
}

type DueConversation = Awaited<ReturnType<typeof listConversationsDueForInsights>>[number];

/** Reads and (unless a dry run) writes one chat. 'model-failed' = the model call itself threw. */
async function readConversation(conv: DueConversation, opts: LeadInsightsPassOptions): Promise<'read' | 'model-failed'> {
  // A Lost lead is read only from what the customer wrote after it closed, or the old refusal
  // would make the model answer "lost" again.
  const current = process.env['LEAD_STAGE_AI'] === '0' ? null : await findCurrentLeadForContact(conv.contactId);
  const staffLocked = opts.skipStaff && current && (current.humanUpdatedAt !== null || current.kindSetBy === 'staff');
  if (staffLocked) {
    opts.onSkip?.({ conversationId: conv.id, reason: 'staff' });
    return 'read';
  }
  // Cut in SQL against the row itself: closed_at is the refusal's own created_at to the
  // microsecond, and a JS Date (milliseconds) would let that refusal back in.
  const since = current?.status === 'lost'
    ? sql`(SELECT coalesce(l.closed_at, l.updated_at) FROM leads l WHERE l.id = ${current.id}::uuid)`
    : undefined;
  const rows = await getLastNMessages(conv.id, opts.transcriptMessages ?? TRANSCRIPT_MESSAGES, since);
  const transcript = toTranscript(rows);
  if (!transcript || (since && !rows.some((m) => m.role === 'user'))) return 'read';
  let insights: LeadInsights | null;
  try {
    insights = await extractLeadInsights(transcript);
  } catch (err) {
    // An API error (rate limit, outage) is about the call, not this chat: leave it due and stop
    // the sweep rather than spend the rest of the batch on the same failure.
    console.warn('[leadInsights] model call failed, retrying next sweep:', err instanceof Error ? err.message : err);
    opts.onError?.({ conversationId: conv.id, error: err });
    return 'model-failed';
  }
  if (!insights) {
    opts.onSkip?.({ conversationId: conv.id, reason: 'unreadable' });
    return 'read';
  }
  // Orders only where a sale is going on (or a buyer chasing theirs) and a lead exists to count them on.
  // A failed or unreadable order call costs only the orders: the rest of this read still stands.
  if ((insights.lead_kind === 'lead' || insights.lead_kind === 'status_pesanan') && current) {
    try {
      insights.orderMessageIds = (await extractOrderMessageIds(rows)) ?? [];
    } catch (err) {
      console.warn('[leadInsights] order call failed:', err instanceof Error ? err.message : err);
    }
  }
  // The watermark as the due-query loaded it, before this pass stamps a new one.
  const plan = await planFor(conv.contactId, insights, rows, conv.insightsExtractedAt);
  if (!opts.dryRun) await applyPlan(conv.contactId, plan);
  opts.onResult?.({ conversationId: conv.id, insights, wouldChange: plan.wouldChange });
  return 'read';
}

/** One sweep: the conversations due, newest first. Returns how many were read. */
export async function runLeadInsightsPass(batchSize: number, opts: LeadInsightsPassOptions = {}): Promise<number> {
  const due = await listConversationsDueForInsights(new Date(Date.now() - (opts.quietMs ?? QUIET_MS)), batchSize, {
    ignoreWatermark: opts.ignoreWatermark,
    since: opts.since,
    conversationIds: opts.conversationIds,
  });
  let done = 0;
  for (const conv of due) {
    let outcome: 'read' | 'model-failed';
    try {
      outcome = await readConversation(conv, opts);
    } catch (err) {
      // Anything but the model call is about this chat (a write that throws on its rows): one such
      // chat must not stop the sweep at itself every 10 minutes and starve every chat behind it of
      // its fills. Not stamped, so it is read again next sweep.
      console.warn(`[leadInsights] chat ${conv.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      opts.onError?.({ conversationId: conv.id, error: err });
      continue;
    }
    if (outcome === 'model-failed') break;
    if (!opts.dryRun) {
      // Stamped at the newest customer row READ, not now(): a message that lands during the call is
      // newer than the stamp and makes the conversation due again. An unreadable answer is stamped
      // too - retrying the same transcript would most likely fail the same way, every sweep.
      // A backfill that selects by watermark age stamps no earlier than `since`, or the chat would be
      // selected again by the very next batch.
      // Never later than now: a future `since` would otherwise stamp every chat into the future and
      // blind the live pass (its "newer customer message than the watermark" test) until then.
      const floor = opts.since && opts.since > conv.lastCustomerAt ? opts.since : conv.lastCustomerAt;
      const stamp = floor.getTime() > Date.now() ? new Date() : floor;
      await markInsightsExtracted(conv.id, stamp);
    }
    done++;
  }
  return done;
}

let running = false;

export function scheduleLeadInsights(intervalMs: number, batchSize: number): void {
  if (intervalMs <= 0 || batchSize <= 0) return;
  const tick = async (): Promise<void> => {
    if (running) return; // a slow sweep must not overlap the next one
    running = true;
    try {
      // Silence is a rule on message times, not a model call - but it moves a status, so it obeys the
      // same off switch as the pass's stage writes.
      if (process.env['LEAD_STAGE_AI'] !== '0') {
        const silent = await closeSilentLeads(await getLeadSilenceLostDays());
        if (silent.length > 0) console.log(`[leadInsights] closed ${silent.length} lead(s) as Lost - no customer reply within the threshold`);
      }
      const n = await runLeadInsightsPass(batchSize);
      if (n > 0) console.log(`[leadInsights] read ${n} conversation(s)`);
    } catch (err) {
      console.warn('[leadInsights] sweep failed:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  setInterval(() => { void tick(); }, intervalMs);
}
