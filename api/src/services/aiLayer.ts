import Anthropic from '@anthropic-ai/sdk';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { photoLine } from './photoMatch.js';
import { brandsNamedInText, otherBrandNote } from './otherBrands.js';
import {
  SYSTEM_PROMPT_BEHAVIORAL_RULES,
  KAMUS_ISTILAH,
  MAX_CONTEXT_MESSAGES,
  ASK_NAME_REPLY,
  ASK_BUYER_TYPE_REPLY,
  CATALOG_SENT_MARKER,
  LEAKED_TOOL_MARKUP_RE,
} from '../domain/constants.js';
import { buildCatalogContext, getFullCatalogBlock } from './ragQuery.js';
import { withoutInventedTotals, verifyReplyPrices, verifyReplyPacks, verifyReplyDiscount, verifyReplyShowroomLink, verifyReplyTone, verifyReplyNotCarried, verifyReplyPhotoClaim, verifyReplyOtherBrand, saysNotCarried, verifyReplyTier, verifyReplyMeta, verifyReplyCatalogClaim, verifyReplyOpener, verifyReplyFirstGreeting, verifyReplyNameRepeat, verifyReplyNotCarriedCloses, verifyReplyNoService, nameGivenIn, ASKS_NAME_RE } from './replyChecks.js';
import {
  getLastNMessages,
  getConversationSummary,
  updateConversationSummary,
  countConversationMessages,
  getMessagesForSummary,
} from '../repositories/conversations.js';
import { getDefaultPromptSections } from '../repositories/appSettings.js';
import { listBrands } from '../repositories/products.js';
import { CUSTOMER_TYPES } from '../domain/types.js';
import type { AIResponse, CustomerType, PromptSection } from '../domain/types.js';
import { resolveLink } from './linkResolver.js';
import { PRICE_TOOL, PRICE_TOOL_DESC, PRICE_TOOL_NAME, PriceToolInput, runPriceTool } from './priceTool.js';
import { getClient, isDevMode, isFullCatalogEnabled, agentQuery, logUsageLine, CLAUDE_MODEL } from './claude.js';

// ─── Tool contract (single source for both prod API and dev Agent SDK) ───────

const RESPOND_TOOL_NAME = 'respond_to_customer';
const RESPOND_TOOL_DESC =
  'Send your final response to the customer. You MUST call this tool for every turn — never output plain text, and never write your own reasoning or analysis anywhere. Call the other tools first if you need them (hitung_harga for any price for a quantity), then call this tool once you are ready to respond. If the customer\'s message needs no answer at all, call it with no_reply true instead of writing anything.';

export const RESPOND_FIELD_DESC = {
  message: 'The customer-facing reply, in the language the customer writes in (Indonesian unless they write in English). Plain WhatsApp text exactly as the customer will read it, up to ~800 characters (use the room when listing a product range). Use empty string only when escalating without a message, or when no_reply is true. Never put analysis of the conversation, notes about the customer, or an explanation of why you are not replying here: whatever is in this field is sent to the customer word for word.',
  no_reply:
    'Set true, with message empty, ONLY when the customer\'s latest message is purely an acknowledgement - "baik kak", "oke siap", "saya tunggu ya kak" - and holds no question, request, new information, or answer to something you asked, and you have nothing to add (including when the team already has the matter and the customer is just waiting). Nothing is sent. One exception: a THANK-YOU that ends the conversation ("ok terima kasih", "baik kak makasih") when nothing is pending - their question was answered, or we do not carry what they wanted - gets one short warm closing line instead, e.g. "Kembali kasih ya kak 🙏 Kalau di lain kesempatan membutuhkan produk-produk kami, jangan sungkan untuk menghubungi kami kembali ya kak." Never send that closing line mid-sale, while the team is handling the chat, or to a plain "oke". Never use no_reply because a question is hard, to dodge an answer, or when the customer asked or told you anything else; then answer, or hand off with confidence "low". Keep confidence "high".',
  confidence:
    '"high" for normal helpful responses, including honest hedged ones - and for telling the customer plainly that we do not carry what they asked for (no relevant product, or the data rules it out): that is a complete answer, not a hand-off. "low" whenever a human must take over: the customer explicitly asked for one, or insists an item exists after you said we do not have it. A product that exists but is out of stock is still relevant: say it is empty, offer what is ready, keep "high". "Are you a bot?" is not a request for a human - answer it with the Scope line, "high". One relevant supporting field (usually Fungsi) is enough to claim fit with "high" even if other fields are silent. When ALL relevant fields are silent, keep "high" but hedge honestly ("sepertinya cocok, saya pastikan dulu ya") instead of claiming certainty.',
  escalation_reason: 'Internal escalation reason. Set only when confidence is "low". When the customer is not a buyer at all - a supplier or factory offering its goods or services to us, a job seeker, a courier - start it with "BUKAN PEMBELI:".',
  total_for_team:
    'When the customer asks for a total ("jadi total berapa", "totalkan"), compute it yourself whenever you can: every item is in the catalog block with its price and the quantity of each is known. Write one line per item - quantity x catalog price = amount - then the total; for several units, the total for one unit then "Total N unit" = N x it. The system checks the arithmetic. Set this true ONLY when you cannot: an item we do not carry or that has no price in the block, a quantity you do not know, or a list too unclear to price. Then give the items you can price, leave the total out of message, and do not write that someone will calculate it - the system adds that line and tells the team, who calculate it. Never promise to calculate it yourself later. Keep confidence "high".',
  topics_detected: 'Key topics detected in the customer message.',
  catalog_url: 'URL to a catalog file if the customer explicitly requested one. Which file goes out, if any, is decided by the system (the KATALOG line in INFORMASI PELANGGAN); never write a path in message.',
  image_url: 'When the catalog block shows [FOTO TERSEDIA: url] for a product your message names, put that url here - without asking first. Never write the url in message.',
  profile_update:
    'CATAT: customer profile fields learned in this turn (the buyer type goes in customer_type, not here). Reseller fields: business_name, store_address, city, business_type, target_buyer, pain_points (array), estimated_volume, price_range. End-user fields: name, product_sought, usage_location, object_material, object_condition, style_preference, quantity, budget, deadline, recommended_product. Project fields: name, company_name, project_location, product_sought, quantity, budget, deadline. Whatever the buyer type, write "quantity" on the turn the customer states how many they need, in their own words (e.g. "300 an per ukuran") - if your message says you noted it, it must be here. Upsell/cross-sell tracking: upsell_offered (boolean, set true when you offered an upsell this turn), upsell_accepted (boolean, set when customer responded to upsell offer), crosssell_offered (boolean, set true when you offered cross-sell this turn), crosssell_accepted (boolean, set when customer responded to cross-sell offer). Only set upsell/crosssell fields when relevant — do not set them on every turn. Lead tracking (these three go on the sales report, not the customer profile): "lead_temperature" ("hot" when this person shows real buying intent for something we can supply — asked a price, named a quantity, gave a deadline, or asked how to order; "cold" when they are only browsing, have gone quiet, or what they want is not something we sell or have, and they have not taken up an alternative you offered). "order_confirmed" (true ONLY on the single turn the customer first commits to a concrete order — a product plus a quantity, e.g. "mau order 3 karton". Never repeat it on later turns about the same order, it is counted each time). "order_value_idr" (integer rupiah total for THAT order only, not a running total: quantity x the price you quoted from the catalog block. Omit it entirely if you are not sure — a missing number is fine, a guessed one is not). Only include fields learned in THIS turn.',
  follow_up_notes:
    'Fill when a follow-up action is required before the conversation can proceed, OR when the customer has just stated a concrete intent to order (a product plus a quantity, e.g. "mau order 3 karton") — record what they want in one line so a human can follow up and close it, even when your own message this turn already handles everything else. E.g. "Tunggu foto handle lama dari Kak Budi untuk cocokkan tipe body kunci." / "Order: knob handle 3 karton (150 Lsn), tunggu konfirmasi nama toko." Leave empty if no follow-up needed.',
  customer_type:
    'REQUIRED every turn. The buyer type the customer has STATED so far in this conversation, this message included: "end_user" (dipakai sendiri), "project" (for a construction/contractor project), "reseller" (dijual lagi), or "unknown" if they have not said it. Never infer it from the product, the quantity or the tone. When INFORMASI PELANGGAN states the type, repeat it unless the customer has just said otherwise. Price figures are checked against this: with "unknown" the message may not contain any Rp figure.',
  fit_basis:
    'REQUIRED whenever your message names a product from the catalog block. For each product you name, copy the exact text from that product\'s own [DATA KATALOG RESMI] fields (Fungsi / Bahan / Ketebalan / Kelengkapan) that shows it fits the customer\'s situation. Copy it verbatim, character for character — do not paraphrase, summarise or translate, and never quote the "Kategori (petunjuk pencarian)" line, the Playbook, or your own reasoning. One supporting field is enough. If the fields explicitly CONTRADICT or restrict against the situation, put the single word DIAM instead and set confidence "low". If they are merely silent (no field mentions the situation either way), put DIAM but keep confidence "high" and hedge honestly in the message. Leave this empty only when your message names no product at all (greetings, asking for a name, sending the catalog).',
};

// General web search (Anthropic server-side). Haiku 4.5 supports only the basic
// variant. Scoped by the system prompt to UNDERSTANDING unfamiliar customer
// terms — never as a source of products/prices/stock (those stay closed-catalog).
const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 2,
};

// Client-side link opener — see linkResolver.ts for why this is ours and not a hosted fetch
// tool (both hosted options failed live on a maps.app.goo.gl store link). Exists for one
// job: a reseller sends their store's link as identity, and the bot must read the name from
// it instead of claiming "sudah aku lihat lokasinya" with no way to look.
const RESOLVE_LINK_TOOL_NAME = 'resolve_link';
const RESOLVE_LINK_TOOL_DESC =
  'Open a URL the customer sent (Google Maps, marketplace, Instagram, website) and return the final URL plus the page/place name. Follows short-link redirects itself — one call is enough. Use ONLY on links the customer sent; never to look up Legacy products or prices.';
const RESOLVE_LINK_URL_DESC = 'The exact URL the customer sent';

const RESOLVE_LINK_TOOL: Anthropic.Tool = {
  name: RESOLVE_LINK_TOOL_NAME,
  description: RESOLVE_LINK_TOOL_DESC,
  input_schema: {
    type: 'object' as const,
    properties: {
      url: { type: 'string', description: RESOLVE_LINK_URL_DESC },
    },
    required: ['url'],
  },
};

// Structured output — the model must reply through this tool, never free text.
const RESPOND_TOOL: Anthropic.Tool = {
  name: RESPOND_TOOL_NAME,
  description: RESPOND_TOOL_DESC,
  input_schema: {
    type: 'object' as const,
    properties: {
      message: { type: 'string', description: RESPOND_FIELD_DESC.message },
      confidence: { type: 'string', enum: ['high', 'low'], description: RESPOND_FIELD_DESC.confidence },
      escalation_reason: { type: 'string', description: RESPOND_FIELD_DESC.escalation_reason },
      no_reply: { type: 'boolean', description: RESPOND_FIELD_DESC.no_reply },
      total_for_team: { type: 'boolean', description: RESPOND_FIELD_DESC.total_for_team },
      topics_detected: { type: 'array', items: { type: 'string' }, description: RESPOND_FIELD_DESC.topics_detected },
      catalog_url: { type: 'string', description: RESPOND_FIELD_DESC.catalog_url },
      image_url: { type: 'string', description: RESPOND_FIELD_DESC.image_url },
      profile_update: {
        type: 'object',
        description: RESPOND_FIELD_DESC.profile_update,
        additionalProperties: true,
      },
      follow_up_notes: { type: 'string', description: RESPOND_FIELD_DESC.follow_up_notes },
      fit_basis: { type: 'array', items: { type: 'string' }, description: RESPOND_FIELD_DESC.fit_basis },
      customer_type: { type: 'string', enum: [...CUSTOMER_TYPES, 'unknown'], description: RESPOND_FIELD_DESC.customer_type },
    },
    required: ['message', 'confidence', 'fit_basis', 'customer_type'],
  },
};

// Same contract as RESPOND_TOOL, expressed as a zod shape for the Agent SDK.
const RESPOND_SHAPE = {
  message: z.string().describe(RESPOND_FIELD_DESC.message),
  confidence: z.enum(['high', 'low']).describe(RESPOND_FIELD_DESC.confidence),
  escalation_reason: z.string().optional().describe(RESPOND_FIELD_DESC.escalation_reason),
  no_reply: z.boolean().optional().describe(RESPOND_FIELD_DESC.no_reply),
  total_for_team: z.boolean().optional().describe(RESPOND_FIELD_DESC.total_for_team),
  topics_detected: z.array(z.string()).optional().describe(RESPOND_FIELD_DESC.topics_detected),
  catalog_url: z.string().optional().describe(RESPOND_FIELD_DESC.catalog_url),
  image_url: z.string().optional().describe(RESPOND_FIELD_DESC.image_url),
  profile_update: z.record(z.string(), z.unknown()).optional().describe(RESPOND_FIELD_DESC.profile_update),
  follow_up_notes: z.string().optional().describe(RESPOND_FIELD_DESC.follow_up_notes),
  fit_basis: z.array(z.string()).describe(RESPOND_FIELD_DESC.fit_basis),
  customer_type: z.enum(['reseller', 'end_user', 'project', 'unknown']).describe(RESPOND_FIELD_DESC.customer_type),
};

// One array for the loop, the failsafe and the cache warmup: the tools are part of the cached
// prefix, so a different list or order is a different cache line.
const API_TOOLS: Anthropic.ToolUnion[] = [WEB_SEARCH_TOOL, RESOLVE_LINK_TOOL, PRICE_TOOL, RESPOND_TOOL];

/**
 * The model sometimes writes the rest of its tool call INTO `message`: UAT Run 3 sent
 * '...pintunya 😊",\n<parameter name="confidence">low' to a customer, and because the real
 * `confidence` field was then missing it defaulted to "high" - a complaint the model meant to hand
 * off was answered instead (E-05). Cut the leak off the text and let the fields it carried fill the
 * ones the input lacks; a field the model did send properly always wins.
 */
export function recoverLeakedFields(input: Record<string, unknown>): Record<string, unknown> {
  const message = typeof input.message === 'string' ? input.message : '';
  const leak = LEAKED_TOOL_MARKUP_RE.exec(message);
  if (!leak) return input;
  const leaked = Object.fromEntries(
    [...leak[0].matchAll(/<parameter name="(\w+)">([^<]*)/g)].map(([, name, value]) => [name, value!.trim()])
  );
  return { ...leaked, ...input, message: message.slice(0, leak.index) };
}

export function extractFromToolInput(rawInput: Record<string, unknown>): AIResponse {
  const input = recoverLeakedFields(rawInput);
  const fallbackEscalationMsg = 'Pertanyaan Anda akan saya teruskan ke tim kami ya! Sebentar lagi mereka akan menghubungi Anda. 🙏';
  const msg = (typeof input.message === 'string' ? input.message : '').trim();
  const escalationReason = typeof input.escalation_reason === 'string' ? input.escalation_reason : undefined;
  const confidence = input.confidence === 'low' ? 'low' : 'high';
  // Honoured only as a bare "send nothing": text in `message` is a reply and goes out, and a "low"
  // is a hand-off, which has its own flow - either one wins over a stray no_reply.
  const noReply = input.no_reply === true && !msg && confidence === 'high';
  return {
    message: msg || (escalationReason ? fallbackEscalationMsg : ''),
    confidence,
    noReply: noReply || undefined,
    totalForTeam: input.total_for_team === true || undefined,
    escalationReason,
    topicsDetected: Array.isArray(input.topics_detected) ? input.topics_detected as string[] : undefined,
    catalogUrl: typeof input.catalog_url === 'string' ? input.catalog_url : undefined,
    imageUrl: typeof input.image_url === 'string' ? input.image_url : undefined,
    profileUpdate: input.profile_update && typeof input.profile_update === 'object' && !Array.isArray(input.profile_update)
      ? input.profile_update as Record<string, unknown>
      : undefined,
    followUpNotes: typeof input.follow_up_notes === 'string' && input.follow_up_notes.trim()
      ? input.follow_up_notes.trim()
      : undefined,
    fitBasis: Array.isArray(input.fit_basis)
      ? input.fit_basis.filter((q): q is string => typeof q === 'string')
      : [],
    customerType: CUSTOMER_TYPES.find((t) => t === input.customer_type) ?? null,
  };
}

// ─── Fit verification ────────────────────────────────────────────────────────

// The recommendation and its safety check must not come from the same model call. Four
// generations of string heuristics here (prompt precedence rules, verbatim-citation checks,
// substrate vocabularies) each caught the previous replay's phrasing and missed the next one:
// the model once cited DOORPULL's "khususnya pada pintu kayu" verbatim - a real quote - while
// telling a customer with a glass-door photo it was "pas untuk pintu seperti itu". So the check
// is now an independent judge call: given the customer's situation, the named products' official
// data, and the proposed reply, does the data support what the reply claims? Generic over
// substrate, size, mounting, environment - anything the data can contradict - with no
// vocabulary to maintain. Up to two repair attempts; if those fail too, the customer gets the canned
// escalation hand-off (escalationHandler sends only CANNED_ESCALATION_REPLY), never wrong text.

const CATALOG_START = '--- KATALOG PRODUK ---';
const CATALOG_END = '--- AKHIR KATALOG ---';

// Lowercase, strip everything that is not a letter/digit, collapse spaces. Survives the model
// re-wrapping or bolding a product name, still requires the actual words.
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function extractCatalogBlock(systemPrompt: string): string {
  // lastIndexOf: the behavioral-rules prose quotes the START marker verbatim ("Blok
  // `--- KATALOG PRODUK ---` adalah ..."), so the FIRST occurrence can be prose. The real
  // block is always the last occurrence in both prompt layouts.
  const end = systemPrompt.lastIndexOf(CATALOG_END);
  const start = end === -1 ? -1 : systemPrompt.lastIndexOf(CATALOG_START, end);
  if (start === -1 || end === -1 || end < start) return '';
  return systemPrompt.slice(start + CATALOG_START.length, end);
}

// "Produk: NAME" / "Produk: NAME — description", as written by ragQuery.formatProducts.
function catalogProductNames(catalogBlock: string): string[] {
  return [...catalogBlock.matchAll(/^Produk: (.+)$/gm)]
    .map((m) => m[1].split(' — ')[0].trim())
    .filter(Boolean);
}

// The catalog records for the named products — the judge reads the official data itself instead
// of trusting the writer's citations.
export function productBlocks(catalogBlock: string, names: string[]): string {
  // Split on the RECORD boundary, not on blank lines. formatProducts() renders each product as
  // "Merek: <brand>\nProduk: <name>\n...", and free-text fields carry their own blank lines - the
  // Keunggulan bullets on GRENDEL BULAT STAINLESS STEEL do, which cut its record in three and left
  // the chunk holding "Produk:" with no Varian lines at all. Both callers then got a paragraph
  // with zero prices in it: the price scope could not accept the product's own figures, and the
  // judge was asked to check a quote against evidence that contained no quote.
  return catalogBlock
    .split(/\n(?=Merek: )/)
    .filter((rec) => names.some((n) => rec.includes(`Produk: ${n}`)))
    .join('\n\n');
}

const NAME_TOKEN_MIN = 4;    // "3", "SS", "36CM" identify nothing on their own
const RARE_MAX_PRODUCTS = 3; // a token in <= 3 of the block's names pins down a family

function nameTokens(name: string): string[] {
  return [...new Set(normalize(name).split(' '))].filter((t) => t.length >= NAME_TOKEN_MIN);
}

/**
 * Which catalog products this reply actually recommends.
 *
 * The full catalog name is the easy case, but the model routinely shortens it - it answered
 * "DOORPULL PERTH" for "DOORPULL PERTH VINTAGE BLUE", which a whole-name match misses entirely.
 * So a shortened mention counts too, on two conditions that together keep generic family talk
 * ("kami punya handle besar juga") from being read as a recommendation: at least two tokens of
 * the same catalog name, one of them rare enough across the block to identify that family.
 */
function namedProducts(catalogBlock: string, message: string): string[] {
  const names = catalogProductNames(catalogBlock);

  const productsPerToken = new Map<string, number>();
  for (const name of names) {
    for (const t of nameTokens(name)) productsPerToken.set(t, (productsPerToken.get(t) ?? 0) + 1);
  }

  const normalizedMessage = normalize(message);
  const messageTokens = new Set(normalizedMessage.split(' '));

  return names.filter((name) => {
    const full = normalize(name);
    if (full.length > 0 && normalizedMessage.includes(full)) return true;
    const hits = nameTokens(name).filter((t) => messageTokens.has(t));
    return hits.length >= 2 && hits.some((t) => (productsPerToken.get(t) ?? 0) <= RARE_MAX_PRODUCTS);
  });
}

/**
 * Catalog products whose paragraph prints a price this reply quotes.
 *
 * Identity insurance for the judge: namedProducts() reasons about NAMES, which the model
 * shortens and which collide across brands, while a rendered price is an exact string that
 * belongs to one product's paragraph. When the two disagree, the price is the better witness.
 * Capped because a round number like Rp 50.000 legitimately appears under several products and
 * the judge should get evidence, not the whole catalog.
 */
const MAX_PRICE_MATCHED_PRODUCTS = 6;

export function productsQuotingPrices(catalogBlock: string, message: string): string[] {
  const quoted = [...message.matchAll(/\bRp\.?\s*[\d][\d.,]*/gi)]
    .map((m) => m[0].replace(/\D/g, ''))
    .filter((d) => d.length >= 4);
  if (quoted.length === 0) return [];

  // Same record boundary productBlocks() uses, and for the same reason: free-text fields carry
  // blank lines, so splitting on those detaches a product's Varian/price lines from its
  // "Produk:" line and the product this function exists to find becomes invisible to it.
  const out: string[] = [];
  for (const rec of catalogBlock.split(/\n(?=Merek: )/)) {
    const name = /^Produk: (.+)$/m.exec(rec)?.[1]?.split(' — ')[0]?.trim();
    if (!name) continue;
    const recDigits = [...rec.matchAll(/\bRp\s*[\d][\d.,]*/gi)].map((m) => m[0].replace(/\D/g, ''));
    if (quoted.some((q) => recDigits.includes(q))) out.push(name);
    if (out.length >= MAX_PRICE_MATCHED_PRODUCTS) break;
  }
  return out;
}

const FIT_CLAIM_RE = /\b(?:cocok|pas\s+(?:untuk|buat|di)|bisa\s+(?:dipakai|dipasang)|sesuai\s+untuk)\b/i;
// ponytail: the catalog's category names are the type vocabulary. A claim about something as broad
// as "handle" (53 products across several categories) matches no single category and stays
// unjudged; raise the cap or split by category if such claims show up live.
const MAX_TYPE_PRODUCTS = 12;

/**
 * The products of every category the reply names - "doorpull" and "door pull" both name Door Pull -
 * so a claim about the type is judged against those products' own data. Empty when the categories
 * named add up to more than MAX_TYPE_PRODUCTS: evidence that wide is noise to the judge.
 */
export function productsOfNamedType(catalogBlock: string, message: string): string[] {
  const text = ` ${normalize(message)} `;
  const byCategory = new Map<string, string[]>();
  for (const rec of catalogBlock.split(/\n(?=Merek: )/)) {
    const category = /^Kategori \(petunjuk pencarian\): (.+)$/m.exec(rec)?.[1]?.trim();
    const name = /^Produk: (.+)$/m.exec(rec)?.[1]?.split(' — ')[0]?.trim();
    if (category && name) byCategory.set(category, [...(byCategory.get(category) ?? []), name]);
  }
  const names = [...byCategory].flatMap(([category, products]) => {
    const words = normalize(category);
    return text.includes(` ${words} `) || text.includes(` ${words.replace(/ /g, '')} `) ? products : [];
  });
  return names.length <= MAX_TYPE_PRODUCTS ? names : [];
}

export interface FitVerdict {
  ok: boolean;
  reason: string;
  /** The draft quoted a figure while the buyer type is still unknown (verifyReplyTier). */
  askBuyerType?: boolean;
  /** Worth a repair, never a hand-off: the draft is still sent once the repairs run out. */
  soft?: boolean;
  /** The only thing wrong was these figures not being in the catalog - see withoutInventedTotals. */
  invented?: number[];
}

// Contradiction-only mandate. The earlier "silent data = unsupported" rule vetoed ordinary
// selling language per-adjective (live: rejected "ketebalan normal" — the customer's own word
// "biasa" echoed back — while admitting the Fungsi listed jendela) and fabricated restrictions
// from dimensions. Silence-honesty now lives in the generation prompt; the judge only blocks
// claims the data actually contradicts.
export const JUDGE_SYSTEM_PROMPT = `Kamu adalah pemeriksa QA internal untuk customer service toko hardware. Tugasmu SATU: mendeteksi KONTRADIKSI eksplisit antara BALASAN YANG DIUSULKAN dan DATA RESMI PRODUK. Kamu BUKAN editor gaya bahasa dan BUKAN pemilih produk — hanya pemeriksa fakta.

Baris "[Analisis otomatis foto ...]" adalah PERKIRAAN MESIN tentang isi foto, bukan kata-kata pelanggan. Konteks pemasangan yang terlihat (jenis daun pintu kaca/kayu, lokasi pemakaian) tetap dihitung sebagai situasi pelanggan. Tapi perkiraan atribut produk yang difoto (bahan, warna/finishing, angka dimensi terbaca dari gambar) BUKAN syarat dari pelanggan — produk krom di foto bisa salah terbaca "stainless steel". Jika pelanggan hanya menanyakan apakah produk di foto tersedia dan balasan mengidentifikasi produk katalog yang sejenis, JANGAN menolak hanya karena perkiraan foto berbeda dari data resmi produk itu sendiri.

ok=false HANYA jika salah satu dari ini benar-benar terjadi, berdasarkan yang TERTULIS EKSPLISIT di data (bukan simpulanmu sendiri):
1. RESTRIKSI DILANGGAR — data eksplisit membatasi cakupan produk (mis. "khususnya pada pintu kayu", "hanya untuk X") dan balasan mengklaim cocok DI LUAR batas itu.
2. FAKTA SALAH — balasan menyebut harga, nama produk, varian/warna, atau spesifikasi yang BERBEDA dari yang tertulis di data resmi, atau menyebut varian yang tidak ada di data. TENTANG HARGA, batasnya sempit: sebuah angka hanya SALAH kalau angka itu TIDAK MUNCUL di baris varian yang bersangkutan. Baris varian memuat DUA harga (pricelist lalu MP) dan KEDUANYA sama-sama benar — mengutip yang mana pun BUKAN fakta salah, dan kamu TIDAK pernah menolak hanya karena menurutmu angka yang satunya yang seharusnya dipakai. Siapa berhak atas harga yang mana sudah diperiksa di tempat lain; itu bukan tugasmu. Termasuk ANGKA spesifikasi yang DIKARANG: kapasitas beban, daya tahan, dimensi, atau angka teknis lain yang dinyatakan sebagai fakta padahal TIDAK ADA di data — prosa boleh berhati-hati soal data yang diam, tapi angka wajib bersumber dari data. Termasuk juga klaim "ready"/"tersedia"/"ada stok" untuk varian yang datanya bertanda [STOK HABIS SEMENTARA].
3. KETIDAKCOCOKAN FISIK KASAT MATA — perbedaan besar dan jelas antara kebutuhan pelanggan dan produk (mis. pelanggan butuh handle ±1 meter, produk 36cm).

ok=TETAP true dalam semua kasus berikut — ini aturan utama, bukan pengecualian:
- SATU field relevan (biasanya Fungsi) sudah eksplisit mendukung situasi pelanggan → CUKUP, walau field lain (Ketebalan, Kelengkapan, dst.) tidak menyebut situasi itu. Diamnya field lain BUKAN kontradiksi.
- Data diam total soal satu detail, dan tidak ada restriksi eksplisit yang dilanggar → BUKAN kontradiksi.
- Balasan berparafrase atau meringkas data dengan kata lain (mis. "ketebalan normal" untuk jendela biasa) — kutipan identik TIDAK diwajibkan.
- Balasan menyebut nama keluarga/lini produk (mis. "HANDLE TANGGUNG + BODY AOMORI SLIM") lalu merinci tipe-tipenya (JARDIN, KOBE, LEBRON) — itu ringkasan yang memang diminta, BUKAN nama produk yang salah.
- Balasan merekomendasikan produk A padahal menurutmu produk B lebih cocok, atau tidak menyebut alternatif — pemilihan produk adalah keputusan penjual, bukan tugasmu.
- Nama varian di data sering memuat beberapa kode warna sekaligus (mis. 'BNSN SNCP SS', 'BNSN, SNCP') atau keterangan kemasan (mis. '4" SN (BLISTER)'). Menyebut salah satu kode itu, menawarkannya sebagai pilihan warna terpisah (BNSN / SNCP / SS), atau menyingkat nama varian (mis. '4" SN', 'BC9030') BUKAN varian karangan. Yang karangan hanyalah kode, warna, atau ukuran yang TIDAK muncul sama sekali di data produk itu (mis. 'Black Silver' atau 'hitam' yang tidak tertulis di sana).
- Menyatakan varian bertanda [STOK HABIS SEMENTARA] sedang habis/kosong SELALU benar, dan menawarkan varian lain yang ready (ukuran atau tipe berbeda) sebagai gantinya BUKAN kontradiksi maupun ketidakcocokan fisik — itu pilihan penjual.
- Balasan memakai KONVERSI SATUAN standar yang memang diinstruksikan ke penulis: 1 Lusin/Lsn = 12 pcs, dan isi per CTN/Box seperti tertulis di baris varian. Angka konversi itu BUKAN klaim tentang produk dan tidak perlu tertulis di data — menulis "Rp 327.500/Lsn (12 pcs)" atau harga per-pcs hasil pembagiannya BUKAN mengarang.
- Kamu MENYIMPULKAN sendiri sebuah batasan dari angka/ukuran yang tidak dinyatakan sebagai batasan (mis. "hanya untuk furnitur kecil" dari ukuran 2-3 inci padahal Fungsi-nya menyebut jendela) — itu mengarang restriksi, bukan menemukan kontradiksi.
- Balasan JUJUR atau memakai bahasa hedge ("sepertinya cocok, saya pastikan dulu ya") — selalu ok=true.
- Balasan mengulang ukuran atau spesifikasi yang DIMINTA pelanggan untuk menyatakan barang itu belum ada atau untuk menanyakannya (mis. "engsel bubut ukuran 19mm belum ada di kami") — angka itu milik permintaan pelanggan, bukan klaim tentang produk kami, walaupun tidak ada di data dan walaupun pelanggan menyebutnya di pesan lain.
- Satu varian bisa punya DUA harga tertulis (harga pricelist lalu "MP: ...", kadang dengan satuan berbeda - "Rp 46.000/Lsn | MP: Rp 5.500/Pcs" adalah SATU varian). Balasan yang mengutip salah satu angka itu PERSIS seperti tertulis BUKAN kontradiksi — walaupun menurutmu angka yang satunya lagi yang seharusnya dipakai untuk pelanggan ini. Memilih harga mana yang berlaku bukan tugasmu.

Balas HANYA dengan JSON valid: {"ok": true/false, "reason": "satu kalimat Bahasa Indonesia, sebut restriksi/fakta spesifik yang dilanggar — bukan 'datanya kurang lengkap'"}. Tanpa teks lain.`;

// Exported for tests — the parser is where a judge silently breaking would hide.
export function parseJudgeVerdict(raw: string): FitVerdict {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { ok?: unknown; reason?: unknown };
    if (typeof parsed.ok !== 'boolean') throw new Error('ok is not boolean');
    return { ok: parsed.ok, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
  } catch (err) {
    // Fail open: a broken judge must degrade to today's behavior (no check), not mute the bot.
    console.warn('[aiLayer] judge verdict unparseable, failing open:', err instanceof Error ? err.message : err);
    return { ok: true, reason: 'judge-parse-failure' };
  }
}

/**
 * The judge's "customer situation": the customer's words, plus the photo analysis labeled as
 * the machine guess it is. Unlabeled, the two are indistinguishable — live, an aluminium
 * chrome handle photographed by the customer was extracted as "stainless steel" with the spec
 * drawing's numbers, and the judge vetoed the correct product for not matching "requirements"
 * the customer never stated (the NEWTON incident).
 */
export function buildJudgeSituation(userMessage: string, extraKeywords?: string[], priorContext?: string | null): string {
  const lines: string[] = [];
  if (priorContext) lines.push(`[Konteks — pesan CS sebelumnya yang sedang dijawab pelanggan: "${priorContext}"]`);
  lines.push(userMessage);
  if (extraKeywords && extraKeywords.length > 0) {
    lines.push(`[Analisis otomatis foto pelanggan — perkiraan mesin, BUKAN permintaan eksplisit pelanggan: ${extraKeywords.join(', ')}]`);
  }
  return lines.join('\n');
}

// The judge's verdict routes the turn, and on Haiku it misread the data it was handed: in UAT Run 3
// about half its rejections were wrong - "SS is not a Newton variant" of a variant named
// 'BNSN SNCP SS', "Vintage has no 3 inch" of an in-stock 3" SN, a correct MP x 12 total called
// wrong - and each drove a correct answer through two repairs into a hand-off (Fix Plan R-01).
// Only the check moved up; replies stay on CLAUDE_MODEL. Read per call, so tests and the QA harness
// see the env they set; JUDGE_MODEL=claude-haiku-4-5-20251001 pins the old judge.
const judgeModel = (): string => process.env['JUDGE_MODEL'] || 'claude-sonnet-5-5';

// The judge model needs a credential that allows it: the OAuth token this bot ran on in UAT Run 3
// answers 429 for every non-Haiku model. An unreachable judge must not fail the turn - every judged
// reply would become a hand-off - so it falls back to the reply model at once (no SDK retries) and
// leaves the judge model alone for a while before trying again.
const JUDGE_MODEL_RETRY_MS = 10 * 60_000;
let judgeModelDownUntil = 0;

function judgeRequest(model: string, userContent: string): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    // 300 truncated a long verdict mid-JSON in the 2026-09-24 replay ("Unexpected end of JSON
    // input"), and an unparseable verdict fails OPEN - the reply went out unchecked.
    max_tokens: 800,
    // Haiku gets temperature 0: the verdict routes the turn, and the same reply must not pass once and
    // fail the next time. Sonnet 5 rejects sampling parameters and thinks by default - the verdict is
    // one short JSON object, so thinking stays off and the check stays fast.
    ...(model.includes('haiku') ? { temperature: 0 } : { thinking: { type: 'disabled' as const } }),
    system: JUDGE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  };
}

async function judgeFit(situation: string, officialData: string, proposedReply: string): Promise<FitVerdict> {
  const userContent = `SITUASI PELANGGAN:\n${situation || '(tidak disebutkan)'}\n\nDATA RESMI PRODUK:\n${officialData}\n\nBALASAN YANG DIUSULKAN:\n${proposedReply}`;

  let raw: string;
  if (isDevMode()) {
    raw = await agentQuery({ systemPrompt: JUDGE_SYSTEM_PROMPT, userContent, maxTurns: 1 });
  } else {
    let response: Anthropic.Message | null = null;
    const preferred = judgeModel();
    if (preferred !== CLAUDE_MODEL && Date.now() >= judgeModelDownUntil) {
      try {
        response = await getClient().messages.create(judgeRequest(preferred, userContent), { maxRetries: 0 });
        logUsage('judge', response.usage);
      } catch (err) {
        if (!(err instanceof Anthropic.APIError)) throw err;
        judgeModelDownUntil = Date.now() + JUDGE_MODEL_RETRY_MS;
        console.warn(`[aiLayer] judge model ${preferred} unavailable (${err.status ?? err.message}) - judging on ${CLAUDE_MODEL} for the next ${JUDGE_MODEL_RETRY_MS / 60_000} min`);
      }
    }
    if (!response) {
      response = await getClient().messages.create(judgeRequest(CLAUDE_MODEL, userContent));
      logUsage(preferred === CLAUDE_MODEL ? 'judge' : 'judge-fallback', response.usage);
    }
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    raw = text?.text ?? '';
  }
  return parseJudgeVerdict(raw);
}

interface VerifyFitDeps {
  /** Re-run the generation with the judge's objection appended. */
  regenerate: (correction: string) => Promise<AIResponse>;
  /** Test seam; production always uses judgeFit. */
  judge?: (situation: string, officialData: string, proposedReply: string) => Promise<FitVerdict>;
  /** No assistant turn in the history yet - the Rules ask the name before anything else. */
  firstReply?: boolean;
  /** The reply answering the name question - see verifyReplyOpener. */
  openingTurn?: boolean;
  /** The bot's previous message told the customer we do not have what they asked for. */
  afterNotCarried?: boolean;
  /** The name the customer gave in answer to our name question - see verifyReplyNameRepeat. */
  givenName?: string | null;
}

// The judge sees BOTH figures on every variant line and, told only that choosing between them is
// not its job, still rejected correct MP quotes to an end user as "harga MP, bukan pricelist ...
// menyesatkan" - all three drafts of the Run 2 replay of D-03, at temperature 0. It is told the
// buyer type the deterministic checks already enforced, so the figure it sees quoted is the one it
// expects.
const TIER_FOR_JUDGE: Record<string, string> = {
  end_user: 'pengguna akhir - angka yang benar untuknya adalah harga MP',
  project: 'pembeli proyek - angka yang benar untuknya adalah harga pricelist',
  reseller: 'reseller - angka yang benar untuknya adalah harga pricelist',
};

export function withBuyerType(situation: string, customerType: string | null): string {
  const tier = customerType ? TIER_FOR_JUDGE[customerType] : undefined;
  if (tier) return `${situation}\n[Tipe pembeli: ${tier}. Sudah diperiksa sistem - bukan dasar penolakan.]`;
  // Not told, the judge rejected a correct price-less answer to "berapa harga handle newton?" as
  // "tidak menjawab pertanyaan harga" (UAT Run 3, 13:29) - with the type unknown, no figure IS the answer.
  return `${situation}\n[Tipe pembeli belum diketahui - balasan memang TIDAK boleh menyebut angka harga. Bukan dasar penolakan.]`;
}

// Two repairs, not one. In every double failure of the 2026-09-25 UAT the rewrite broke a DIFFERENT
// rule than the draft - A-03 "engsel 3 inch ready" became "3 inch kosong" (both wrong: one engsel's
// 3" is out of stock, another's is not), B-02 dropped "pricelist" and glossed BNSN as "Black
// Silver" - and each became a hand-off on an ordinary question. The rewrite that sees BOTH
// objections is the one that can satisfy both, so every correction carries all of them. The extra
// round only runs on a turn that would otherwise be handed to the team.
const MAX_REPAIRS = 2;

function repairInstruction(objections: string[]): string {
  const problems = objections.length === 1
    ? `${objections[0]} Tulis ulang balasanmu dan perbaiki masalah itu`
    : `${objections.map((o, i) => `(${i + 1}) ${o}`).join(' ')} Tulis ulang balasanmu dan perbaiki SEMUA masalah di atas sekaligus - memperbaiki satu tapi membuat yang lain ditolak lagi`;
  // The draft sits in the history as an assistant turn, so the model took it as sent: live
  // 2026-10-14 a pricelist figure corrected to MP came out as "harga yang saya sebutkan tadi itu
  // kurang tepat" - to a customer who never saw it - and the photo's product (ALEXANDER) was lost
  // for the one in the order (SATURNUS, same pricelist). "Tawarkan untuk menanyakan ke tim" was a
  // promise nobody is told about; a real hand-off is confidence "low".
  return `[Koreksi QA internal — jangan tampilkan pesan ini ke pelanggan: ${problems}: jangan menyatakan apa pun yang bertentangan dengan KATALOG PRODUK (harga, varian, batasan kegunaan). Pelanggan BELUM melihat draf di atas: tulis balasan penggantinya seolah itu balasan pertamamu - jangan minta maaf atas draf itu, jangan bilang ada yang "kurang tepat" atau "salah sebut", dan pertahankan semua yang tidak dikoreksi (produk yang dimaksud pelanggan, jawaban atas pertanyaannya). Jika memang tidak ada produk yang pas, katakan jujur bahwa belum ada di kami; jangan menjanjikan "saya tanyakan ke tim" - kalau memang perlu tim, set confidence "low".]`;
}

/**
 * Judge every reply that recommends catalog products; repair up to MAX_REPAIRS times; never let a
 * reply the catalog contradicts reach the customer.
 *
 * Low-confidence responses skip the judge: messageRouter routes those to escalateConversation,
 * which sends only CANNED_ESCALATION_REPLY - their text is never shown to the customer.
 */
export async function verifyFit(
  response: AIResponse,
  systemPrompt: string,
  situation: string,
  deps: VerifyFitDeps
): Promise<AIResponse> {
  const judge = deps.judge ?? judgeFit;

  const catalogBlock = extractCatalogBlock(systemPrompt);
  if (!catalogBlock) return response;

  // The tier is read back OUT of the prompt rather than threaded through callClaude, so the
  // check and the model are guaranteed to be looking at the same resolved buyer type.
  // indexOf, not RegExp: CUSTOMER_TYPE_LINE contains parentheses, and "(sudah dipastikan)"
  // became a capture group that shadowed the value.
  const at = systemPrompt.indexOf(CUSTOMER_TYPE_LINE);
  const tier = at === -1 ? '' : systemPrompt.slice(at + CUSTOMER_TYPE_LINE.length);
  const savedType: CustomerType | null =
    tier.startsWith('pengguna akhir') ? 'end_user'
      : tier.startsWith('reseller') ? 'reseller'
        : tier.startsWith('pembeli proyek') ? 'project'
          : null;
  // Same idiom: the catalog note the model was shown is the record of whether a file went out.
  const catalogSent = systemPrompt.includes(CATALOG_SENT_MARKER);

  const check = async (r: AIResponse): Promise<FitVerdict | null> => {
    if (r.confidence === 'low' || !r.message) return null; // text never reaches the customer
    const named = namedProducts(catalogBlock, r.message);
    // Deterministic floor: a misquoted price must never depend on the fuzzy name matcher or
    // the LLM judge (never scoped to arithmetic). When products were identified, check their
    // own paragraphs — against the FULL catalog, an invented figure could coincidentally be a
    // multiple/division of some unrelated product's price. A follow-up that quotes figures
    // without naming the product ("25MM Rp 40.000") is about the product in the question it
    // answers, so that is the next scope; whole block only as the last fallback. Without that
    // middle step round figures collide across the block: BC9025's PRICELIST Rp 40.000 is KUAS
    // CAT's MP, and the end-user leak check waved it through (UAT D-03, 2026-09-22).
    const scopeNames = named.length > 0 ? named : namedProducts(catalogBlock, situation);
    const priceScope = scopeNames.length > 0 ? productBlocks(catalogBlock, scopeNames) : catalogBlock;
    // Arithmetic stays inside the scope; a figure printed VERBATIM anywhere in the catalog is
    // exempt, so a matcher miss can no longer reject a product's own real price.
    // The saved profile wins; the model's own reading fills the turn where the customer states
    // the type for the first time (it is only saved after this reply).
    const customerType = savedType ?? r.customerType ?? null;
    const prices = verifyReplyPrices(r.message, priceScope, catalogBlock, customerType);
    const results: { ok: boolean; reason: string; askBuyerType?: boolean; soft?: boolean }[] = [
      verifyReplyTier(r.message, customerType),
      verifyReplyMeta(r.message),
      prices,
      verifyReplyPacks(r.message, priceScope),
      verifyReplyDiscount(r.message, priceScope, customerType),
      verifyReplyShowroomLink(r.message),
      verifyReplyTone(r.message),
      verifyReplyNotCarried(r.message),
      verifyReplyNotCarriedCloses(r.message, named.length > 0),
      verifyReplyNoService(r.message),
      verifyReplyNameRepeat(r.message, deps.givenName ?? null),
      verifyReplyPhotoClaim(r.message, systemPrompt),
      verifyReplyOtherBrand(r.message, systemPrompt),
      verifyReplyCatalogClaim(r.message, catalogSent, customerType),
      // Not after a "belum ada": greeting the name and offering help with something else is the right
      // reply there, and the opener's buyer-type repair pushed the funnel for an item we do not sell
      // (replayed 2026-10-13: "budi" after "mesin gerinda belum ada" -> "dipakai sendiri ...?" 2/2).
      ...(deps.openingTurn && !deps.afterNotCarried ? [verifyReplyOpener(r.message, customerType)] : []),
      ...(deps.firstReply ? [verifyReplyFirstGreeting(r.message)] : []),
    ];
    const failed = results.filter((c) => !c.ok);
    // All reasons at once: a repair has to fix every problem, not the first found.
    if (failed.some((c) => !c.soft)) {
      // Soft objections alongside it do not count against a total being cut: whatever is left is
      // checked again, all of it, before it is sent.
      const onlyPrices = failed.filter((c) => !c.soft).length === 1 && !prices.ok && prices.onlyInvented;
      return {
        ok: false, reason: failed.map((c) => c.reason).join(' '), askBuyerType: failed.some((c) => c.askBuyerType),
        ...(onlyPrices && { invented: prices.invented }),
      };
    }
    // Only soft objections left: the judge still has to pass this draft before it can be sent as is.
    const soft: FitVerdict | null = failed.length > 0 ? { ok: false, reason: failed.map((c) => c.reason).join(' '), soft: true } : null;
    // The judge gets a WIDER set than the price scope, and deliberately so. namedProducts() can
    // miss the product a reply is really about (11 of 133 catalog names have no token rare enough
    // to survive the model shortening them) or, worse, match a DIFFERENT one: a reply quoting
    // Aomori GRENDEL BULAT's own Rp 50.000 contains Shind's shorter "GRENDEL STAINLESS STEEL"
    // verbatim, so the judge was handed Shind's Rp 24.000 paragraph as ground truth and rejected a
    // correct answer twice into an escalation. Any paragraph carrying a price the reply quotes is
    // evidence about that reply, so add those. This must NOT feed priceScope - widening the
    // accept-set there is exactly what the floor exists to prevent.
    let judgeNames = [...new Set([...named, ...productsQuotingPrices(catalogBlock, r.message)])];
    // A fit claim about a product TYPE names no product, so it used to skip the judge entirely:
    // "handle tarik (doorpull) ... cocok untuk pintu kaca frameless" went out unchecked (UAT Run 3
    // D-10), while the judge rejected the same claim on the next two turns, once a name was used.
    if (judgeNames.length === 0 && FIT_CLAIM_RE.test(r.message)) judgeNames = productsOfNamedType(catalogBlock, r.message);
    if (judgeNames.length === 0) {
      // At full-catalog scale a matcher miss silently skips the judge — make it visible.
      if (r.message.length > 160) console.warn('[aiLayer] fit-check skipped: reply names no catalog product (matcher miss or generic reply)');
      return soft;
    }
    const verdict = await judge(withBuyerType(situation, customerType), productBlocks(catalogBlock, judgeNames), r.message);
    if (verdict.ok) return soft;
    return soft ? { ...verdict, reason: `${verdict.reason} ${soft.reason}` } : verdict;
  };

  let current = response;
  let objection = await check(current);
  // The last draft that failed nothing but a soft rule: a repair asked for a nicer reply must never
  // turn a sendable one into a hand-off by breaking something else.
  let sendable = objection?.soft ? current : null;
  const objections: string[] = [];
  // Every rejected draft, for the totals fallback below.
  const rejected: { draft: AIResponse; verdict: FitVerdict }[] = [];
  while (objection && objections.length < MAX_REPAIRS) {
    rejected.push({ draft: current, verdict: objection });
    objections.push(objection.reason);
    console.warn(`[aiLayer] judge rejected reply → repairing (${objections.length}/${MAX_REPAIRS}). ${objection.reason}`);
    current = await deps.regenerate(repairInstruction(objections));
    objection = await check(current);
    if (objection?.soft) sendable = current;
  }
  // A repair can also come back "low" (check() passes those through, their text is never sent).
  if (!objection) return sendable && (current.confidence === 'low' || !current.message) ? sendable : current;
  if (objection.soft) return current;
  if (sendable) return sendable;

  // Every draft still quotes a price to someone whose buyer type is unknown. By Kebijakan Harga the
  // answer to that question IS the buyer-type question, so ask it in fixed words - handing the chat
  // to a person for it was the most common way an ordinary price question ended the sale (F-09).
  if (objection.askBuyerType) {
    console.warn('[aiLayer] every draft quoted a price before the buyer type → asking for it instead of escalating');
    return {
      ...current,
      message: deps.firstReply ? ASK_NAME_REPLY : ASK_BUYER_TYPE_REPLY,
      confidence: 'high',
      escalationReason: undefined,
      imageUrl: undefined,
      catalogUrl: undefined,
      fitBasis: [],
    };
  }

  // The only thing wrong is a total the catalog cannot back - the customer asked for one over many
  // items, and the model added them up. The per-item answer is right and the team calculates totals
  // (owner, 2026-10-27): send it without the total, checked again in full, and mark the turn for the
  // team (messageRouter adds CANNED_TOTAL_FOR_TEAM). The latest such draft is the one tried.
  rejected.push({ draft: current, verdict: objection });
  const totalled = [...rejected].reverse().find((d) => d.verdict.invented?.length);
  const cut = totalled && withoutInventedTotals(totalled.draft.message, totalled.verdict.invented!);
  if (totalled && cut) {
    const again = await check({ ...totalled.draft, message: cut });
    if (!again || again.soft) {
      console.warn(`[aiLayer] only the total was unbacked (${totalled.verdict.reason}) → sending the per-item answer, total to the team`);
      return { ...totalled.draft, message: cut, confidence: 'high', escalationReason: undefined, totalForTeam: true };
    }
    console.warn(`[aiLayer] cut the unbacked total, but the rest failed too → escalating. ${again.reason}`);
  } else if (totalled) {
    // Logged with the line it stopped at: whether that was a misquoted price or a total the pattern missed.
    const at = totalled.draft.message.split('\n').find((l) => totalled.verdict.invented!.some((n) => l.replace(/\D/g, '').includes(String(n))));
    console.warn(`[aiLayer] an unbacked figure is not on a total line → escalating. Line: ${at?.trim().slice(0, 160)}`);
  }

  // Out of repairs: hand off with the canned escalation reply, never the contested text. Only the
  // TEXT is contested - the turn's profile facts are still true, and dropping them left
  // customer_type unsaved, so the hand-off re-asked "dipakai sendiri atau dijual lagi?" right
  // after the customer answered it and the next turn ran with no tier at all (UAT F-06).
  console.warn(`[aiLayer] judge rejected repair → escalating. ${objection.reason}`);
  return { ...current, message: '', confidence: 'low', escalationReason: objection.reason };
}

// ─── System prompt assembly ──────────────────────────────────────────────────

const TOOL_USE_SEARCH_INSTRUCTION = `\nPENCARI INFORMASI WEBSITE:
Jika pertanyaan pelanggan tidak terjawab dari katalog produk (misalnya kegunaan produk, cara pemasangan, perbandingan produk), gunakan tool search_legacy_website SEBELUM menyatakan tidak tahu. Tool ini mencari artikel informatif dari website resmi Legacy.

PENCARI WEB UMUM (web_search):
Untuk memahami istilah atau situasi customer yang tidak kamu kenal dan tidak bisa diterka dari pengetahuan umum (mis. jenis pintu pada suatu bangunan, istilah lokal, NAMA MEREK atau nama produk yang disebut customer), kamu WAJIB memakai tool web_search lebih dulu — JANGAN mengaku "belum familiar" dan JANGAN meminta customer menjelaskan istilah publik; bertanya ke customer hanya untuk fakta situasi pribadi mereka. Gunakan HANYA untuk memahami maksud/kebutuhan customer — BUKAN untuk mencari produk, harga, varian, atau stok. Produk yang direkomendasikan tetap wajib berasal dari KATALOG PRODUK. Jangan memakai web_search untuk hal yang sudah kamu ketahui.

Satu pemakaian web_search lain yang diizinkan: memeriksa apakah toko atau toko online milik CALON RESELLER benar-benar ada, sebelum harga price list reseller disebutkan (lihat Kebijakan Harga). Larangan di atas tetap berlaku penuh — web_search tetap tidak boleh dipakai untuk mencari produk, harga, varian, atau stok Legacy sendiri. Hasil yang tidak ketemu bukan alasan menolak customer, dan jangan pernah memberi tahu customer bahwa kamu sedang mengeceknya.

PEMBUKA TAUTAN (resolve_link):
Jika customer MENGIRIM tautan (link Google Maps, marketplace, Instagram, atau website) — terutama calon reseller yang mengirim link tokonya — kamu WAJIB membukanya dengan tool resolve_link SEBELUM membalas. Satu panggilan cukup: tool ini mengikuti redirect sendiri dan mengembalikan URL akhir plus nama tempat/judul halamannya (field "nama_tempat" / "judul_halaman"). Pakai nama dari hasil itu — JANGAN menanyakan lagi informasi yang sudah ada di dalam tautannya, dan JANGAN PERNAH mengaku sudah "melihat" isi tautan tanpa benar-benar memanggil resolve_link. Jika hasilnya menyatakan tautan tidak bisa dibuka atau tidak ada nama yang terbaca, katakan jujur lalu tanyakan nama tokonya secara langsung. resolve_link hanya untuk tautan yang customer kirim — bukan untuk mencari produk, harga, varian, atau stok Legacy.`;

function buildSystemPromptFromSections(sections: PromptSection[]): string {
  return sections.map((s) => `## ${s.name}\n${s.content}`).join('\n\n');
}

async function buildBrandContext(): Promise<string> {
  try {
    const allBrands = await listBrands();
    if (allBrands.length === 0) return '';

    const ownBrands = allBrands.filter((b) => b.brandType !== 'distributed');
    const distributedBrands = allBrands.filter((b) => b.brandType === 'distributed');

    const formatLine = (b: (typeof allBrands)[0]) =>
      b.description ? `- ${b.name}: ${b.description}` : `- ${b.name}`;

    const sections: string[] = ['--- INFORMASI MEREK ---'];
    if (ownBrands.length > 0) {
      sections.push('MEREK SENDIRI (Legacy):');
      sections.push(...ownBrands.map(formatLine));
    }
    if (distributedBrands.length > 0) {
      sections.push('');
      sections.push('MEREK DISTRIBUSI (pihak ketiga yang kami distribusikan):');
      sections.push('(Garansi pabrik / layanan purna jual → arahkan ke tim kami, bukan Legacy sebagai produsen)');
      sections.push(...distributedBrands.map(formatLine));
    }
    sections.push('--- AKHIR INFORMASI MEREK ---');

    const context = sections.join('\n');
    // Single company-wide catalogue — always available, never tied to a brand.
    // No reason given here on purpose: the model repeated the old one ("File itu memuat HARGA
    // PRICELIST, jadi hanya boleh dikirim ke reseller/agen dan pembeli proyek") to an end user
    // word for word - "Katalog price list kami khusus untuk reseller dan proyek" (UAT F-15).
    const result = context + `\n\nKATALOG PRODUK: File katalog tersedia PER MEREK — satu file untuk tiap merek, bukan satu file gabungan.
Yang menentukan terkirim atau tidak adalah sistem, bukan kamu. Baris "KATALOG:" di INFORMASI PELANGGAN menyatakan apa yang BARUSAN terjadi — ikuti baris itu persis:
- Jika di situ tertulis file sudah dikirim → sampaikan dengan hangat bahwa price list merek tersebut sudah dikirim.
- Jika tertulis belum dikirim karena merek belum disebut → tanyakan merek mana yang diinginkan dan sebutkan pilihannya, serta boleh minta semuanya sekaligus. JANGAN bilang sudah dikirim.
- Jika tertulis belum dikirim karena tipe pembeli belum diketahui → tanyakan tipe pembeli lebih dulu sesuai Rules. JANGAN bilang sudah dikirim.
- Jika tertulis TIDAK ada file untuk customer ini → ikuti petunjuk di baris itu. JANGAN menyebut file, price list, reseller, atau tipe harga apa pun, dan JANGAN menjelaskan alasannya.
Cara menulis pesannya:
- Hangat, ramah, dan natural seperti CS toko sungguhan. VARIASIKAN kalimatnya setiap kali — jangan pakai template yang sama berulang.
- JANGAN tanya apakah pelanggan sudah menerima/dapat filenya, dan JANGAN arahkan ke website seolah pengirimannya gagal.
- Kalaupun pelanggan minta katalog lagi/berulang, tetap ramah dan kirim ulang dengan senang hati. DILARANG KERAS menyiratkan pelanggan sudah dikirimi "berkali-kali", atau terdengar kesal/menegur/tidak sabar — itu terasa kasar.
- Setelah menyampaikan katalognya dikirim, JANGAN akhiri percakapan di situ — lanjutkan seperti CS sungguhan dengan pertanyaan prioritas berikutnya sesuai Rules: nama dulu jika belum diketahui, lalu tipe pembeli (dipakai sendiri / untuk proyek / dijual lagi), lalu gali kebutuhan — supaya bisa dibantu pilihkan produk yang pas (termasuk alternatif ekonomis/premium bila relevan).`;
    return result;
  } catch {
    return '';
  }
}

async function resolveIdentitySection(promptSections: PromptSection[] | null | undefined): Promise<string> {
  if (promptSections && promptSections.length > 0) {
    return buildSystemPromptFromSections(promptSections);
  }
  const defaultSections = await getDefaultPromptSections();
  return buildSystemPromptFromSections(defaultSections);
}

/** Marker the tier check reads back out of the prompt - see verifyFit. */
export const CUSTOMER_TYPE_LINE = 'Tipe pembeli (sudah dipastikan): ';

// The owner wants English answered in English (2026-09-24), and the Tone rule alone did not hold:
// the prompt is thousands of Indonesian words that dictate Indonesian phrasings ("Sebelumnya, dengan
// siapa saya terhubung ya?"), and the UAT G-08 replay answered in Indonesian twice. A per-turn line
// in the customer block does - it is the last thing the model reads.
// ponytail: stop-word vote, not language detection; anything mixed counts as Indonesian.
const EN_WORDS_RE = /\b(?:the|you|your|do|does|is|are|have|has|what|which|how|much|price|sell|selling|please|hello|hi|thanks|thank|can|could|would|want|need|looking|any|available)\b/gi;
const ID_WORDS_RE = /\b(?:ada|yang|kak|saya|aku|berapa|harga|mau|bisa|untuk|dong|ya|gak|nggak|tidak|dengan|apa|sama|min|pak|bu|halo|kalau|buat|ini|itu)\b/gi;

export function writesEnglish(text: string): boolean {
  const en = text.match(EN_WORDS_RE)?.length ?? 0;
  const id = text.match(ID_WORDS_RE)?.length ?? 0;
  return en >= 2 && en > id * 2;
}

async function buildSystemPrompt(
  ragQuery: string,
  promptSections: PromptSection[] | null | undefined,
  extraKeywords?: string[],
  turn?: { catalogNote?: string | null; customerType?: string | null; customerMessage?: string; photoNote?: string | null }
): Promise<string> {
  const fullCatalog = isFullCatalogEnabled();
  const [catalogContext, identitySection, brandContext] = await Promise.all([
    fullCatalog ? getFullCatalogBlock() : buildCatalogContext(ragQuery, extraKeywords),
    resolveIdentitySection(promptSections),
    buildBrandContext(),
  ]);

  // No name line. The WhatsApp profile name is not the customer's name: it falls back to the
  // MSISDN for most of this audience ("Pak +6281236295157"), and where it is set it is a nickname,
  // a shop, or whoever owns the phone - UAT 2026-09-22 greeted tester Naftali as "Kak Clayton
  // Mildy", twice per reply, and never asked. The owner's call (2026-09-24): ignore it, and let
  // the Rules' ask-for-the-name flow run for everyone; the name the customer gives lives in the
  // conversation (and the summary) from then on.
  // catalogNote states what resolveCatalogDelivery() actually did with the PDF this turn. It
  // belongs in the per-customer block AFTER the cache breakpoint - it changes every turn, so
  // putting it in the static prefix would give each turn its own cache line.
  // The catalog block prints BOTH prices for every variant, and the Kebijakan Harga section
  // describes the policy in the abstract - which left the model to infer, per turn, which of
  // two equally-present numbers this customer may hear. It inferred wrong. Stating the
  // already-resolved buyer type here, next to the name, turns that inference into a lookup.
  const tier =
    turn?.customerType === 'end_user'
      ? `${CUSTOMER_TYPE_LINE}pengguna akhir. Sebutkan HARGA MP. JANGAN sebutkan harga pricelist.`
      : turn?.customerType === 'reseller'
        ? `${CUSTOMER_TYPE_LINE}reseller. Sebutkan HARGA PRICELIST (syarat reseller berlaku).`
        : turn?.customerType === 'project'
          ? `${CUSTOMER_TYPE_LINE}pembeli proyek. Sebutkan HARGA PRICELIST.`
          : '';
  const language = turn?.customerMessage && writesEnglish(turn.customerMessage)
    ? 'Bahasa: customer menulis dalam bahasa Inggris - tulis SELURUH isi message dalam bahasa Inggris, termasuk sapaan dan pertanyaan yang contohnya berbahasa Indonesia di aturan; nama produk dan harga tetap persis seperti di katalog.'
    : '';
  // photoNote: the customer's photo compared with our own product photos (services/photoMatch.ts).
  // Per turn, so it sits here after the cache breakpoint like catalogNote.
  // A brand the customer typed that is not ours ("gembok solid") - the photo's own is in photoNote.
  const brandNote = turn?.customerMessage ? otherBrandNote('pesan', brandsNamedInText(turn.customerMessage)) : null;
  const customerLines = [tier, turn?.catalogNote ?? '', turn?.photoNote ?? '', brandNote ?? '', language].filter(Boolean);
  const customerCtx = customerLines.length
    ? `--- INFORMASI PELANGGAN ---\n${customerLines.join('\n')}\n--- AKHIR INFORMASI PELANGGAN ---`
    : '';

  if (fullCatalog) {
    // Static-first order: everything up to and including CATALOG_END is byte-identical
    // across customers and turns — toSystemBlocks() puts the cache breakpoint there. The
    // customer block must stay last, or every named customer gets their own cache line.
    return [
      identitySection,
      '',
      brandContext,
      '',
      SYSTEM_PROMPT_BEHAVIORAL_RULES + TOOL_USE_SEARCH_INSTRUCTION,
      '',
      KAMUS_ISTILAH,
      '',
      CATALOG_START,
      catalogContext,
      CATALOG_END,
      '',
      customerCtx,
    ].filter(Boolean).join('\n');
  }

  return [
    identitySection,
    '',
    brandContext,
    '',
    customerCtx,
    '',
    SYSTEM_PROMPT_BEHAVIORAL_RULES + TOOL_USE_SEARCH_INSTRUCTION,
    '',
    '--- KATALOG PRODUK ---',
    catalogContext,
    '--- AKHIR KATALOG ---',
  ].filter(Boolean).join('\n');
}

// ─── Transport: same prompt + tools through either the API or the Agent SDK ──

type ChatMessage = { role: 'user' | 'assistant'; content: Anthropic.MessageParam['content'] };

/**
 * One hitung_harga call from the Messages API, whose input nothing has validated yet (the Agent SDK
 * validates against PriceToolInput itself). A malformed call gets an error the model can correct
 * on the next iteration instead of a price.
 */
async function priceToolResult(block: Anthropic.ToolUseBlock, figures: number[]): Promise<Anthropic.ToolResultBlockParam> {
  const parsed = PriceToolInput.safeParse(block.input);
  if (!parsed.success) {
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      is_error: true,
      content: `Input ${PRICE_TOOL_NAME} tidak valid (${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}). Kirim product, size, qty (angka) dan unit ("rim" atau "pcs").`,
    };
  }
  const { text, figures: returned } = await runPriceTool(parsed.data);
  figures.push(...returned);
  return { type: 'tool_result', tool_use_id: block.id, content: text };
}

const isToolUse = (name: string) => (b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock =>
  b.type === 'tool_use' && b.name === name;

/**
 * The reply in a response that also calls hitung_harga was written before the prices came back, so
 * its figures are the model's own arithmetic. It is answered as not sent, and asked for again.
 */
const UNSENT_REPLY_RESULT =
  'Balasan ini BELUM terkirim ke pelanggan: kamu menulisnya sebelum hasil hitung_harga keluar. Panggil respond_to_customer lagi dan pakai angka dari hasil hitung_harga di atas, persis seperti tertulis.';

/** A tool_result for EVERY tool_use in the response - the next request is rejected otherwise. */
async function answerToolCalls(content: Anthropic.ContentBlock[], figures: number[]): Promise<Anthropic.ToolResultBlockParam[]> {
  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const block of content) {
    if (block.type !== 'tool_use') continue;
    if (block.name === PRICE_TOOL_NAME) {
      results.push(await priceToolResult(block, figures));
    } else if (block.name === RESOLVE_LINK_TOOL_NAME) {
      results.push({ type: 'tool_result', tool_use_id: block.id, content: await resolveLink((block.input as { url: string }).url) });
    } else if (block.name === RESPOND_TOOL_NAME) {
      results.push({ type: 'tool_result', tool_use_id: block.id, content: UNSENT_REPLY_RESULT });
    } else {
      // e.g. a call to the website search tool this bot no longer has.
      results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: `Tool ${block.name} tidak tersedia.` });
    }
  }
  return results;
}

/** Final only when no hitung_harga rides in the same response (see UNSENT_REPLY_RESULT). */
function finalReply(response: Anthropic.Message): Anthropic.ToolUseBlock | undefined {
  if (response.content.some(isToolUse(PRICE_TOOL_NAME))) return undefined;
  return response.content.find(isToolUse(RESPOND_TOOL_NAME));
}

// Split the assembled prompt into system content-blocks with the cache breakpoint at the
// catalog-end marker: everything before it is byte-stable across customers (identity, rules,
// glossary, full catalog), everything after (customer name) varies. Marker-based because the
// same markers are already the parsing contract for extractCatalogBlock. 1h TTL: WhatsApp
// replies are human-paced (many gaps exceed the 5-minute default) — 2x write cost, but reads
// at 0.1x more than pay it back on a shared prefix this large.
function toSystemBlocks(systemPrompt: string): Anthropic.TextBlockParam[] {
  // lastIndexOf for the same reason as extractCatalogBlock: prompt prose may quote markers.
  const idx = isFullCatalogEnabled() ? systemPrompt.lastIndexOf(CATALOG_END) : -1;
  if (idx === -1) return [{ type: 'text', text: systemPrompt }];
  const cut = idx + CATALOG_END.length;
  const tail = systemPrompt.slice(cut).trim();
  return [
    { type: 'text', text: systemPrompt.slice(0, cut), cache_control: { type: 'ephemeral', ttl: '1h' } },
    ...(tail ? [{ type: 'text' as const, text: tail }] : []),
  ];
}

// Cache telemetry — the only way to know caching is actually landing (and what a turn costs).
// Shares claude.ts's sink so the API path and the Agent SDK path land in the same monthly file:
// a transport switch must not split the usage history in two.
function logUsage(tag: string, usage: Anthropic.Usage | undefined): void {
  if (!usage) return;
  logUsageLine('[aiLayer] usage', {
    tag,
    in: usage.input_tokens,
    out: usage.output_tokens,
    cache_write: usage.cache_creation_input_tokens ?? 0,
    cache_read: usage.cache_read_input_tokens ?? 0,
  });
}

/**
 * Re-warm the Anthropic prompt cache so the first customer after a >1h quiet gap doesn't
 * pay the full-price cache write on the whole catalog prefix. max_tokens: 0 is the
 * documented pre-warm shape: prefill only, returns immediately, no output tokens billed.
 * The request must be byte-identical to real traffic's cached tier — same buildSystemPrompt
 * output, same toSystemBlocks breakpoint, same tools array as callViaAPI — or it warms nothing.
 * A ping while the cache is live is a cheap cache read that refreshes the TTL.
 */
export async function warmPromptCache(): Promise<void> {
  if (!isFullCatalogEnabled() || isDevMode()) return; // legacy RAG prefix varies per query; dev uses the Agent SDK
  try {
    const systemPrompt = await buildSystemPrompt('', null);
    const response = await getClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 0,
      system: toSystemBlocks(systemPrompt),
      tools: API_TOOLS,
      messages: [{ role: 'user', content: 'warmup' }],
    });
    logUsage('warmup', response.usage);
  } catch (err) {
    console.warn('[aiLayer] prompt-cache warmup failed:', err instanceof Error ? err.message : err);
  }
}

async function callViaAPI(systemPrompt: string, messages: ChatMessage[]): Promise<AIResponse> {
  const client = getClient();
  const loopMessages: Anthropic.MessageParam[] = [...messages];
  const tools = API_TOOLS;
  const system = toSystemBlocks(systemPrompt);
  // Every figure hitung_harga returned this turn - the only figures the price check accepts.
  const figures: number[] = [];
  const respond = (block: Anthropic.ToolUseBlock): AIResponse =>
    ({ ...extractFromToolInput(block.input as Record<string, unknown>), toolFigures: figures });

  // Tool-use loop: Claude may call resolve_link or hitung_harga (client) or web_search
  // (server-side), and exits by calling respond_to_customer (our structured
  // output — no free-text JSON).
  for (let turn = 0; turn < 5; turn++) {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      // Pinned because `confidence` decides whether messageRouter sends this reply at all or
      // replaces it with the canned ack. At the API default, the same customer message could
      // come back "low" one turn and "high" the next - live, "Boleh, 3 karton" was held and
      // "Aku mau order 3 karton" answered, two minutes apart. Not a guarantee of determinism,
      // just the cheapest way to stop sampling noise flipping a routing decision.
      temperature: 0,
      system,
      tools,
      messages: loopMessages,
    });
    logUsage('main', response.usage);

    // Server-side web_search can pause the turn at its iteration limit; echo the
    // accumulated search blocks back so the server resumes, instead of dropping
    // to the failsafe mid-search. No synthetic "continue" message is needed.
    if (response.stop_reason === 'pause_turn') {
      loopMessages.push({ role: 'assistant', content: response.content });
      continue;
    }

    if (response.stop_reason !== 'tool_use') break;

    const respondBlock = finalReply(response);
    if (respondBlock) return respond(respondBlock);

    loopMessages.push({ role: 'assistant', content: response.content });
    loopMessages.push({ role: 'user', content: await answerToolCalls(response.content, figures) });
  }

  // Failsafe: same tool array as the loop — a different tools list would invalidate the
  // Tools+System cache tier and turn every failsafe firing into a full-price cache write
  // nothing ever reads back. Forced tool_choice is incompatible with the web_search server
  // tool, so instead of forcing we instruct hard. A plain-text answer is dropped, not sent
  // (structuredOutputFailed); a turn with nothing to say has no_reply: the escalation default is what the customer gets.
  loopMessages.push({ role: 'user', content: FAILSAFE_INSTRUCTION });
  const forcedCall = async (tag: string): Promise<Anthropic.Message> => {
    const r = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      temperature: 0, // same reason as the loop above
      system,
      tools,
      messages: loopMessages,
    });
    logUsage(tag, r.usage);
    return r;
  };
  let forcedResponse = await forcedCall('failsafe');
  // Price calls in the forced answer (with a reply written before their results, or alone) get
  // their results and exactly one more ask, through the same tools.
  if (forcedResponse.content.some(isToolUse(PRICE_TOOL_NAME))) {
    loopMessages.push({ role: 'assistant', content: forcedResponse.content });
    loopMessages.push({ role: 'user', content: await answerToolCalls(forcedResponse.content, figures) });
    forcedResponse = await forcedCall('failsafe-resend');
  }

  const forcedBlock = finalReply(forcedResponse);
  if (forcedBlock) return respond(forcedBlock);
  const plainText = forcedResponse.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text).join('').trim();
  return structuredOutputFailed(plainText);
}

/**
 * The model never produced a respond_to_customer call. Whatever it wrote instead is NOT a reply:
 * with no tool call there is nothing to tell its answer apart from its reasoning, and this used to
 * ship the text as `high` confidence. Live 2026-10-05, a customer who only said "baik kak, saya
 * tunggu ya kak. terima kasih" received the model's analysis of the chat - "Pesan customer ...
 * adalah acknowledgment dan closing statement", a checklist of what it knew about them, "Tidak ada
 * balasan tambahan yang diperlukan". The tool had no way to say "nothing to answer" (it has no_reply
 * now), so a model with nothing to say wrote that instead. An empty low-confidence response is the safe failure: the
 * router sends the fixed hand-off (or, in an escalated chat, the fixed still-checking ack).
 */
const FAILSAFE_INSTRUCTION =
  '[Instruksi sistem: panggil tool respond_to_customer SEKARANG dengan balasan finalmu (atau no_reply true bila pesan pelanggan tidak perlu dibalas) — jangan menulis teks bebas dan jangan memakai tool lain.]';

function structuredOutputFailed(discardedText: string): AIResponse {
  if (discardedText) {
    console.warn(`[aiLayer] no respond_to_customer call - dropped ${discardedText.length} chars of free text: ${discardedText.slice(0, 120).replace(/\s+/g, ' ')}`);
  }
  return { message: '', confidence: 'low', escalationReason: 'AI response failed structured output' };
}

async function callViaAgentSDK(systemPrompt: string, messages: ChatMessage[]): Promise<AIResponse> {
  // The Agent SDK accepts only user input, so prior turns ride along as a
  // transcript prefix on the current message.
  const historyLines = messages.slice(0, -1).map((m) => {
    const role = m.role === 'user' ? 'Customer' : 'Bot';
    const body = typeof m.content === 'string' ? m.content : '[media]';
    return `${role}: ${body}`;
  });
  const prefix = historyLines.length > 0
    ? `[Riwayat percakapan:\n${historyLines.join('\n')}\n]\n\nPesan saat ini: `
    : '';

  const last = messages[messages.length - 1];
  const userContent = typeof last.content === 'string'
    ? prefix + last.content
    : [
      ...(prefix ? [{ type: 'text' as const, text: prefix }] : []),
      ...last.content,
    ];

  let captured: Record<string, unknown> | null = null;
  // Same as callViaAPI: every figure hitung_harga returned this turn, the retry below included.
  const figures: number[] = [];
  const respond = (input: Record<string, unknown>): AIResponse => ({ ...extractFromToolInput(input), toolFigures: figures });
  const respondTool = tool(RESPOND_TOOL_NAME, RESPOND_TOOL_DESC, RESPOND_SHAPE, async (input) => {
    captured = input as Record<string, unknown>;
    return { content: [{ type: 'text' as const, text: 'Tersampaikan ke pelanggan.' }] };
  });
  const tools = [
    tool(
      RESOLVE_LINK_TOOL_NAME,
      RESOLVE_LINK_TOOL_DESC,
      { url: z.string().describe(RESOLVE_LINK_URL_DESC) },
      async ({ url }) => ({ content: [{ type: 'text' as const, text: await resolveLink(url) }] })
    ),
    tool(PRICE_TOOL_NAME, PRICE_TOOL_DESC, PriceToolInput.shape, async (input) => {
      const { text, figures: returned } = await runPriceTool(input);
      figures.push(...returned);
      return { content: [{ type: 'text' as const, text }] };
    }),
    respondTool,
  ];

  // A run that never calls respond_to_customer - it wrote the answer as text, or ran out of turns -
  // gets the failsafe callViaAPI has always had: one more ask, with only the respond tool on offer
  // and the draft in view, to send it properly. Without it every such run became a hand-off on the
  // production PC, which took this route (live 2026-10-09: a padlock order waited 7 minutes, then
  // "AI response failed structured output").
  let resultText = '';
  let firstError: unknown = null;
  try {
    resultText = await agentQuery({ systemPrompt, userContent, tools, allowWebSearch: true });
  } catch (err) {
    firstError = err;
  }
  if (captured) return respond(captured);

  const draft = resultText.trim();
  console.warn(`[aiLayer] Agent SDK run ended without respond_to_customer${firstError ? ` (${firstError instanceof Error ? firstError.message : firstError})` : ''} - asking once more through the tool`);
  const retryText = `${draft ? `[Draf jawabanmu tadi - BELUM terkirim ke pelanggan:\n${draft}]\n\n` : ''}${FAILSAFE_INSTRUCTION}`;
  const retryContent = typeof userContent === 'string'
    ? `${userContent}\n\n${retryText}`
    : [...userContent, { type: 'text' as const, text: retryText }];
  try {
    await agentQuery({ systemPrompt, userContent: retryContent, tools: [respondTool], maxTurns: 2 });
  } catch (err) {
    if (!captured) throw firstError ?? err;
  }
  if (captured) return respond(captured);
  if (firstError) throw firstError;
  return structuredOutputFailed(draft);
}

async function callClaude(
  systemPrompt: string,
  messages: ChatMessage[],
  situation: string | (() => Promise<string>) = ''
): Promise<AIResponse> {
  const generate = (msgs: ChatMessage[]): Promise<AIResponse> =>
    isDevMode() ? callViaAgentSDK(systemPrompt, msgs) : callViaAPI(systemPrompt, msgs);

  const response = await generate(messages);
  const lastBot = messages.slice(0, -1).reverse().find((m) => m.role === 'assistant');

  // A situation thunk is resolved only now, after the main call: the vision extraction it
  // depends on has been running concurrently with generate() instead of in front of it.
  const situationStr = typeof situation === 'function' ? await situation() : situation;

  // Both transports and every failsafe path exit through here, so the judge cannot be bypassed
  // by whichever branch produced the reply. `situation` is what the customer actually has - for
  // a photo that is the vision extract, the only place the words "pintu kaca" exist at all.
  return verifyFit(response, systemPrompt, situationStr, {
    // The repair sees only the draft's text, not the tool results behind it, so the figures
    // hitung_harga returned earlier in this turn stay accepted for the rewrite.
    regenerate: async (correction) => {
      const repaired = await generate([
        ...messages,
        { role: 'assistant', content: response.message },
        { role: 'user', content: correction },
      ]);
      return { ...repaired, toolFigures: [...(response.toolFigures ?? []), ...(repaired.toolFigures ?? [])] };
    },
    firstReply: !lastBot,
    // Not the first reply: a greeting with no need stated gets "Ada yang bisa saya bantu?" there (client,
    // 2026-11-02) - a supplier or a courier says what they want only after it. The reply to the name
    // question still has to ask the buyer type.
    openingTurn: typeof lastBot?.content === 'string' && ASKS_NAME_RE.test(lastBot.content),
    afterNotCarried: typeof lastBot?.content === 'string' && saysNotCarried(lastBot.content),
    givenName: nameGivenIn(messages),
  });
}

// ─── Conversation summarization ──────────────────────────────────────────────

const SUMMARY_THRESHOLD = 25;
const SUMMARY_WINDOW = 20;
const RESUMMARY_INTERVAL = 10;

type ContextMessage = { role: 'user' | 'assistant'; body: string };

type HistoryMessage = { role: string; body: string; senderName?: string | null; metadata?: Record<string, unknown> | null };

/**
 * A customer photo, as later turns see it. Only the photo's own turn has the image; afterwards the
 * row was just its caption ("yang kaya gini ada ga?") or a placeholder claiming an analysis was
 * attached, so "foto yang itu ada ga ya?" got "saya tidak bisa lihat foto" (2026-10-09).
 * messageRouter stores what that turn found as metadata.photoContext.
 */
export function historyBody(m: HistoryMessage): string {
  const body = labelHumanTurn(m.body, m.senderName);
  if (m.role !== 'user' || m.metadata?.attachmentType !== 'image') return body;
  return photoLine(body, typeof m.metadata.photoContext === 'string' ? m.metadata.photoContext : '');
}

/**
 * A human-authored 'assistant' row - chakraSync importing a reply a human typed in ChakraHQ's
 * inbox (chakraSync.ts, senderName 'Agen ChakraHQ') or a dashboard send (routes/dashboard/send.ts)
 * - is shaped exactly like one of the bot's own turns. senderName is the only thing that tells
 * them apart, and neither builder below used to read it. Unlabeled, the model reads a colleague's
 * message as something IT said and stands behind it on the next turn: live, a staff member
 * forwarded an unrelated returns note into a sales thread and the bot lost the thread completely.
 *
 * Prefix, never drop: the customer already saw that reply, so removing it would have the bot
 * repeat or contradict an answer that has already been given.
 */
function labelHumanTurn(body: string, senderName?: string | null): string {
  return senderName ? `[Rekan tim CS menulis: ${body}]` : body;
}

export function buildContext(
  recentMessages: HistoryMessage[],
  summary: string | null
): ContextMessage[] {
  const recent = recentMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-SUMMARY_WINDOW)
    .map((m) => ({ role: m.role as 'user' | 'assistant', body: historyBody(m) }));

  if (summary) {
    return [
      { role: 'user', body: `[Conversation summary so far: ${summary}]` },
      { role: 'assistant', body: 'Understood.' },
      ...recent,
    ];
  }
  return recent;
}

// Same labelling as buildContext, and it matters more here: this text is persisted to
// conversations.conversation_summary and replayed into every later turn, long after the raw
// message has aged out of the 20-message window.
async function summarizeOldMessages(
  msgs: HistoryMessage[]
): Promise<string> {
  const formatted = msgs
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? 'Customer' : 'Bot'}: ${historyBody(m)}`)
    .join('\n');

  // Buyer type is called out explicitly because it decides which price the bot may quote
  // (Kebijakan Harga). It is established early, so in a long conversation it is exactly the
  // fact that ages out of the raw window first — and losing it means re-asking, or worse,
  // quoting the wrong tier.
  const prompt = `Summarize this WhatsApp sales conversation concisely. Capture:\n- What the customer asked about\n- Products discussed\n- Prices or offers mentioned\n- Any agreements or rejections\n- Customer tone and intent\n- The customer's buyer type if it has been established (dipakai sendiri / proyek / reseller) — state it explicitly and never drop it\n- The customer's name if they stated it (the bot is never told it any other way)\nKeep it under 150 words.\n\n${formatted}`;

  if (isDevMode()) {
    return (await agentQuery({ systemPrompt: '', userContent: prompt, maxTurns: 1 })).trim();
  }

  const response = await getClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  return text.trim();
}

async function maybeSummarizeConversation(conversationId: string): Promise<void> {
  // Stamped before the reads: this whole function is fire-and-forget and awaits a Claude call,
  // so a /new can land mid-flight. updateConversationSummary drops the write if the conversation
  // was reset after this instant.
  const startedAt = new Date();
  const total = await countConversationMessages(conversationId);
  if (total <= SUMMARY_THRESHOLD) return;

  const pastThreshold = total - SUMMARY_THRESHOLD;
  const existingSummary = await getConversationSummary(conversationId);
  const shouldResummarize = pastThreshold % RESUMMARY_INTERVAL === 0;

  if (existingSummary && !shouldResummarize) return;

  const oldMessages = await getMessagesForSummary(conversationId, SUMMARY_WINDOW);
  if (oldMessages.length === 0) return;

  const summary = await summarizeOldMessages(oldMessages);
  if (summary) {
    // The oldest row summarized, not the job's start: /new floors at the command's own send time,
    // which can be seconds before the reset is processed, so a job that started in between would
    // pass a start-time guard with pre-reset rows in hand. A summary is stale exactly when its
    // rows sit under the floor.
    const oldest = oldMessages.reduce((min, m) => (m.createdAt < min ? m.createdAt : min), startedAt);
    await updateConversationSummary(conversationId, summary, oldest);
  }
}

// ─── Public entry points ─────────────────────────────────────────────────────

const IMAGE_MESSAGE_INSTRUCTION = `[Pelanggan mengirim foto produk. LANGKAH PERTAMA: cek blok KATALOG PRODUK — apakah produk pada foto (dan/atau yang disebut di caption) termasuk yang kami jual dan tersedia. Sampaikan jawaban KETERSEDIAAN ini lebih dulu, sebelum komentar desain/estetik atau menanyakan nama. SEBELUM menyatakan cocok: bandingkan apa yang terlihat di foto (jenis/bahan daun pintu, cara pemasangan, ukuran) dengan blok [DATA KATALOG RESMI] milik produk kandidat. Jika situasi di foto bertentangan dengan Fungsi/Bahan produk itu, itu BUKAN produk yang cocok — jangan dikonfirmasi sebagai produk kami, ikuti ATURAN KECOCOKAN KEGUNAAN PRODUK (jujur + confidence "low"). Jika cocok dengan produk di katalog, konfirmasikan dengan percaya diri dan sebutkan nama produk katalog yang cocok (mis. "iya, tipe Newton-nya ada di kami kak"). Jika produk pada foto memang cocok dengan produk katalog (mis. tipe/namanya disebut di caption dan ada di katalog), TEGASKAN bahwa itu MEMANG produk yang kami jual — contoh: "iya kak, ini produk kami — Handle Newton dari Vintage." JANGAN memakai kata "mirip", "serupa", atau "menyerupai" yang seolah-olah barang lain yang cuma mirip; itu memang produk kami, bukan sekadar yang mirip. Jika tidak ada produk yang cocok di KATALOG PRODUK: kalau fotonya sendiri belum jelas, JANGAN mengarang ketersediaan — minta klarifikasi natural seperti staf manusia, contoh: "Maaf, yang dimaksud itu produknya bagaimana ya? Bisa dijelaskan lebih detail?". Tetapi kalau sudah jelas apa yang dibutuhkan dan katalog memang tidak punya produk yang melayaninya, JANGAN berputar-putar minta klarifikasi — sampaikan terus terang lalu eskalasi ke tim (confidence "low"). Tetap patuhi closed-catalog rule — jangan mengarang SKU/varian.]`;

type ImageInput = { base64: string; mimeType: string };

/**
 * One photo as before; several (sent together - messageRouter batches them) each labelled FOTO 1..N,
 * the numbers the photo verdicts in photoNote use. Live 2026-10-25 five screenshots sent as one request
 * were five turns, each answering one photo alone.
 */
function imageContent(images: ImageInput | ImageInput[], text: string): Anthropic.MessageParam['content'] {
  const list = Array.isArray(images) ? images : [images];
  const block = (img: ImageInput) => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
      data: img.base64,
    },
  });
  if (list.length === 1) return [block(list[0]!), { type: 'text', text }];
  return [
    ...list.flatMap((img, i) => [{ type: 'text' as const, text: `FOTO ${i + 1}:` }, block(img)]),
    { type: 'text', text: `[Pelanggan mengirim ${list.length} foto sekaligus (FOTO 1-${list.length}) dalam satu permintaan. Tanggapi semuanya dalam satu balasan - setiap foto, bukan hanya salah satu.]\n\n${text}` },
  ];
}

export async function buildContextAndCallAI(
  conversationId: string | null,
  userMessage: string,
  promptSections?: PromptSection[] | null,
  extraKeywords?: string[] | Promise<string[]>,
  /** Several when photos were sent together - see imageContent. */
  imageData?: ImageInput | ImageInput[] | null,
  quotedMessageBody?: string | null,
  /** Per-turn context for the customer block. An object, not a growing tail of positionals. */
  turn?: { catalogNote?: string | null; customerType?: string | null; photoNote?: string | null }
): Promise<AIResponse> {
  // Vision keywords may arrive as a still-running promise so the extraction overlaps the
  // main AI call. Only the legacy RAG path consumes them BEFORE that call (they feed
  // buildCatalogContext), so only it awaits here — full catalog defers the await to the
  // judge, inside callClaude, after generate() returns.
  const fullCatalog = isFullCatalogEnabled();
  const extraKeywordsP: Promise<string[]> = Promise.resolve(extraKeywords ?? []);
  const resolvedKeywords: string[] | undefined = fullCatalog ? undefined : await extraKeywordsP;

  // Fetch recent messages and conversation summary in parallel
  const [recentMessages, conversationSummary] = await Promise.all([
    conversationId ? getLastNMessages(conversationId, MAX_CONTEXT_MESSAGES) : Promise.resolve([]),
    conversationId ? getConversationSummary(conversationId) : Promise.resolve(null),
  ]);

  // If the customer used WhatsApp's reply/quote, anchor the RAG query to the quoted
  // message — a far stronger signal than "the last thing we said". Otherwise, for a
  // short/ambiguous message (no product keywords), fall back to the last assistant
  // message to enrich the query — handles "fotonya ada?", "mau", etc.
  let ragQuery = userMessage;
  const isShortOrAmbiguous = userMessage.trim().split(/\s+/).length <= 4;
  // Skip human-authored rows (senderName set): this anchors both the RAG query and the judge's
  // situation, so a colleague's unrelated message would drag the whole turn off-topic - the same
  // failure labelHumanTurn fixes one layer up, but here the label alone would not help.
  const lastAssistant = [...recentMessages].reverse().find((m) => m.role === 'assistant' && !m.senderName);
  if (quotedMessageBody) {
    ragQuery = `${quotedMessageBody} ${userMessage}`;
  } else if (isShortOrAmbiguous && lastAssistant) {
    ragQuery = `${lastAssistant.body} ${userMessage}`;
  }

  // Image messages must use extraKeywords regardless of the short/ambiguous gate,
  // because the body is the image placeholder and contains no product terms.
  // (resolvedKeywords is undefined under full catalog — buildCatalogContext never runs there.)
  const ragExtraKeywords = imageData
    ? resolvedKeywords
    : (isShortOrAmbiguous ? resolvedKeywords : undefined);

  // For image messages, seed ragQuery with the caption (the customer's actual
  // question, e.g. "handle newton") PLUS the vision keywords — so RAG can match the
  // specific product the customer named, not just the category the vision model saw.
  // Legacy-only: getFullCatalogBlock() takes no query, so full catalog never reads ragQuery.
  if (imageData && !fullCatalog) {
    const caption = userMessage.startsWith('[Pelanggan mengirim') ? '' : userMessage;
    const seeded = [caption, ...(resolvedKeywords ?? [])].filter(Boolean).join(' ').trim();
    if (seeded) ragQuery = seeded;
  }

  const systemPrompt = await buildSystemPrompt(ragQuery, promptSections, ragExtraKeywords, { ...turn, customerMessage: userMessage });

  // Trigger lazy summarization in the background — does not block the response
  if (conversationId) {
    maybeSummarizeConversation(conversationId).catch(() => { });
  }

  const messages: ChatMessage[] = buildContext(recentMessages, conversationSummary)
    .map((m) => ({ role: m.role, content: m.body }));

  // If the customer replied/quoted a specific earlier message, tell the model which
  // one — otherwise it assumes the reply refers to the most recent topic. Neutral
  // wording because the quoted message may be the customer's own earlier message.
  const userText = quotedMessageBody
    ? `[Konteks — pelanggan membalas pesan ini: "${quotedMessageBody}"]\n\n${userMessage}`
    : userMessage;

  // The verdict also rides on the photo's own turn: in the system prompt alone it lost to an earlier
  // photo's verdict replayed beside the conversation (see photoMatch.LATEST_PHOTO).
  messages.push({
    role: 'user',
    content: imageData
      ? imageContent(imageData, `${userText}\n\n${turn?.photoNote ? `[${turn.photoNote}]\n\n` : ''}${IMAGE_MESSAGE_INSTRUCTION}`)
      : userText,
  });

  // The vision extract carries what the photo actually shows ("handle pintu kaca"); the caption
  // rarely does. Both feed the contradiction check — but labeled apart, so the judge can tell
  // installation context from machine guesses about the pictured product itself.
  // A short answer ("biasa kak") is meaningless as a situation on its own: give the judge the
  // question it answers — the same anchoring the RAG query gets above. Without it the judge
  // reconstructs the situation from the draft reply and invents requirements (live: it demanded
  // ENGSEL SALON appear in a recommendation whose situation input was just "biasa kak").
  const judgeContext = quotedMessageBody ?? (isShortOrAmbiguous && lastAssistant ? lastAssistant.body : null);
  // Full catalog: hand callClaude a thunk so the vision keywords are awaited only after
  // the main call. Legacy: the keywords were already resolved above — same string as ever.
  // The photo verdict goes to the judge as well: a reply confirming "iya, ini produk kami" on the
  // strength of a matching catalog photo is not a claim the judge should reject from text alone.
  const withPhoto = (s: string): string => (turn?.photoNote ? `${s}\n[${turn.photoNote}]` : s);
  const situation = fullCatalog
    ? (): Promise<string> => extraKeywordsP.then((kw) => withPhoto(buildJudgeSituation(userMessage, kw, judgeContext)))
    : withPhoto(buildJudgeSituation(userMessage, resolvedKeywords, judgeContext));
  return callClaude(systemPrompt, messages, situation);
}

// Priority-ordered list — longer phrases first to prevent "handle" matching before "handle pintu"
const CATALOG_PRODUCT_KEYWORDS = [
  'handle pintu', 'body kunci', 'door closer', 'door stopper', 'door bolt',
  'staple hasp', 'hak angin', 'anak kunci', 'pensil tukang', 'siku aluminium',
  'strike plate', 'engsel', 'silinder', 'grendel', 'gembok', 'meteran',
  'waterpass', 'sekrup', 'rantai', 'obeng', 'cutter', 'handle',
];

const RANGKUM_RE = /berarti kebutuhannya|jadi kebutuhannya|kebutuhannya adalah|berarti .{0,50} mencari|berarti .{0,50} membutuhkan/i;

// Extract the primary product keyword from conversation history.
// Looks for RANGKUM-style summary messages first (highest precision), then falls back
// to any bot message that mentions a catalog product keyword.
function extractProductKeywordFromHistory(msgs: { role: string; content: string }[]): string | null {
  const botMessages = [...msgs].reverse().filter((m) => m.role === 'bot');

  for (const msg of botMessages) {
    if (RANGKUM_RE.test(msg.content)) {
      const lc = msg.content.toLowerCase();
      for (const kw of CATALOG_PRODUCT_KEYWORDS) {
        if (lc.includes(kw)) return kw;
      }
    }
  }

  for (const msg of botMessages) {
    const lc = msg.content.toLowerCase();
    for (const kw of CATALOG_PRODUCT_KEYWORDS) {
      if (lc.includes(kw)) return kw;
    }
  }

  return null;
}

export async function callAIWithHistory(
  messages: { role: string; content: string }[],
  newMessage: string,
  promptSections?: PromptSection[] | null,
  imageData?: { base64: string; mimeType: string } | null,
  /** The buyer type production would have saved by now - renders the same tier line. */
  turn?: { customerType?: string | null }
): Promise<AIResponse> {
  // Enrich RAG query for short/contextual follow-up messages in an active product discussion.
  // Cases: "Betul" (pure ambiguous), "Yang Rekomendasi Utama saja" (short non-product phrase),
  // "Betul, rekomendasikan saja" (mixed). All should inherit the product context from last bot msg.
  let ragQuery = newMessage;
  const words = newMessage.trim().split(/\s+/);
  // Detect if the last bot message discussed a product (active product conversation)
  const PRODUCT_CONTEXT_RE = /handle|body kunci|engsel|silinder|gembok|meteran|grendel|door stopper|door closer|kunci pintu|pintu|hinge|padlock/i;
  const lastBot = [...messages].reverse().find(m => m.role === 'bot');
  const hasProductContext = lastBot ? PRODUCT_CONTEXT_RE.test(lastBot.content) : false;
  // Enrich when: message is short (≤6 words) AND there's an active product discussion.
  // This handles pure confirmations ("Betul"), tier selections ("Yang Rekomendasi Utama saja"),
  // and mixed confirmations ("Betul, rekomendasikan saja").
  const isShortFollowUp = words.length <= 6 && hasProductContext;
  if (isShortFollowUp) {
    // Extract just the product keyword from RANGKUM/conversation history rather than
    // concatenating all messages — long mixed queries return unrelated products (gembok/tools).
    const keyword = extractProductKeywordFromHistory(messages);
    ragQuery = keyword ?? (lastBot ? lastBot.content : newMessage);
  }

  const systemPrompt = await buildSystemPrompt(ragQuery, promptSections, undefined, { ...turn, customerMessage: newMessage });

  const chatMessages: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'customer') {
      chatMessages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'bot') {
      chatMessages.push({ role: 'assistant', content: msg.content });
    }
    // skip other roles
  }

  chatMessages.push({
    role: 'user',
    content: imageData
      ? imageContent(imageData, newMessage || 'Ini foto yang saya kirim.')
      : newMessage,
  });

  return callClaude(systemPrompt, chatMessages, newMessage);
}

export async function buildContextForTest(
  phoneNumberId: string,
  userMessage: string,
  promptSections?: PromptSection[] | null
): Promise<{ systemPrompt: string; conversationContext: string }> {
  const systemPrompt = await buildSystemPrompt(userMessage, promptSections);
  return {
    systemPrompt,
    conversationContext: `[Test for phone_number_id: ${phoneNumberId}, message: "${userMessage}"]`,
  };
}
