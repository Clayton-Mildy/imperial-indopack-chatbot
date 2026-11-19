/** The scripted customer conversations and their checks. Never weaken a check to make a scenario pass. */
import { sql } from 'drizzle-orm';
import { getDb } from '../../src/db/client.js';
import type { Conversation, Lead, Message } from '../../src/domain/types.js';
import type { CapturedMessage } from '../../src/services/captureClient.js';
import { poFormMessage } from '../../src/domain/constants.js';
import { writesEnglish } from '../../src/services/aiLayer.js';
import { getLeadDetailExtras } from '../../src/services/leadDetailExtras.js';
import { PRICE_RE, type Check } from './lib.js';
import { PO_FORM_QA_URLS } from './env.js';

export interface ScenarioCtx {
  customer: string;
  say(text: string, o?: { referral?: string }): Promise<CapturedMessage[]>;
  sendImage(mediaId: string, caption?: string): Promise<CapturedMessage[]>;
  sayExpectingSilence(text: string): Promise<CapturedMessage[]>;
  leadPass(): Promise<void>;
  backdate(days: number): Promise<void>;
  silenceSweep(): Promise<void>;
  lead(): Promise<Lead | null>;
  leads(): Promise<Lead[]>;
  conversation(): Promise<Conversation>;
  profile(): Promise<Record<string, unknown>>;
  lastReplyRow(): Promise<Message | null>;
}
export interface Scenario { id: string; title: string; run(ctx: ScenarioCtx): Promise<Check[]> }

const check = (name: string, ok: boolean, detail?: string): Check => ({ name, ok, ...(detail ? { detail } : {}) });
const texts = (msgs: CapturedMessage[]): string[] => msgs.filter((m) => m.kind === 'text').map((m) => m.text ?? '');
const docs = (msgs: CapturedMessage[]): CapturedMessage[] => msgs.filter((m) => m.kind === 'document');
const images = (msgs: CapturedMessage[]): CapturedMessage[] => msgs.filter((m) => m.kind === 'image');
const anyText = (msgs: CapturedMessage[], re: RegExp): boolean => texts(msgs).some((t) => re.test(t));
const anyIncludes = (msgs: CapturedMessage[], s: string): boolean => texts(msgs).some((t) => t.includes(s));
const noPrice = (msgs: CapturedMessage[]): Check => check('no rupiah figure in any reply', !anyText(msgs, PRICE_RE), texts(msgs).find((t) => PRICE_RE.test(t)));
const none = (msgs: CapturedMessage[], re: RegExp, name: string): Check => check(name, !anyText(msgs, re), texts(msgs).find((t) => re.test(t)));
const got = (msgs: CapturedMessage[]): Check => check('the bot answered', texts(msgs).length > 0);

async function referenceUrls(): Promise<string[]> {
  const { rows } = await getDb().execute<{ image_url: string }>(sql`
    SELECT r.image_url FROM product_reference_images r JOIN products p ON p.id = r.product_id
    WHERE p.name = 'Kertas Supreme 64 gsm cetak 1 warna' ORDER BY r.sort`);
  return rows.map((r) => r.image_url);
}

const ORDER_STEPS = {
  intro: 'halo kak saya Budi dari RM Siang Contoh',
  withLogo: 'mau kertas supreme 64 gsm cetak 1 warna 30x30, 12 rim, logo sudah ada',
  noLogo: 'mau kertas supreme 64 gsm cetak 1 warna 30x30, 12 rim, belum punya desain',
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'ad_default_empty_profile',
    title: 'Click-to-WhatsApp ad, bare question, empty profile',
    async run(c) {
      const r = await c.say('berapa harga kertas supreme?', { referral: 'Kertas Supreme cetak logo' });
      const lead = await c.lead();
      const extras = lead ? await getLeadDetailExtras(lead) : null;
      return [
        got(r),
        check('one document named the Kertas Supreme price list', docs(r).length === 1 && docs(r)[0]!.filename === 'Daftar Harga Kertas Supreme (QA).pdf', docs(r).map((d) => d.filename).join(', ')),
        check('no Imperial document', !docs(r).some((d) => /imperial/i.test(d.filename ?? ''))),
        noPrice(r),
        check('the reply asks a question', anyText(r, /\?/)),
        check('lead source is ad', extras?.source.kind === 'ad', JSON.stringify(extras?.source)),
      ];
    },
  },
  {
    id: 'unsure_recommendation',
    title: 'Customer unsure which packaging fits',
    async run(c) {
      const r = await c.say('kak saya jualan nasi padang, cocoknya pakai kemasan apa ya?');
      return [got(r), check('recommends Kertas Supreme or greaseproof', anyText(r, /kertas supreme|greaseproof/i)), noPrice(r)];
    },
  },
  {
    id: 'full_order_quote',
    title: 'Full order: quote with a next-tier hint',
    async run(c) {
      await c.say(ORDER_STEPS.intro);
      const r = await c.say(ORDER_STEPS.withLogo);
      const row = await c.lastReplyRow();
      const calls = (row?.metadata as { priceCalls?: { outcome: string }[] } | null)?.priceCalls;
      await c.leadPass();
      const lead = await c.lead();
      return [
        got(r),
        check('mentions Rp 165.000', anyIncludes(r, 'Rp 165.000')),
        check('mentions Rp 1.980.000', anyIncludes(r, 'Rp 1.980.000')),
        check('mentions Rp 160.000', anyIncludes(r, 'Rp 160.000')),
        check('priceCalls[0].outcome is quote', calls?.[0]?.outcome === 'quote', JSON.stringify(calls?.map((x) => x.outcome))),
        check('lead brands include kertas_supreme', !!lead?.brands.includes('kertas_supreme'), JSON.stringify(lead?.brands)),
        check('an item has qty 12 rim', !!lead?.items.some((i) => i.qty === 12 && i.qty_unit === 'rim'), JSON.stringify(lead?.items)),
      ];
    },
  },
  {
    id: 'between_tiers',
    title: 'Box between tiers',
    async run(c) {
      const r = await c.say('mau box ivory 310 gsm 20x20x7,5 cm 8 rim');
      return [got(r), check('mentions Rp 2.000', anyIncludes(r, 'Rp 2.000')), check('mentions Rp 8.000.000', anyIncludes(r, 'Rp 8.000.000')), check('mentions Rp 1.800', anyIncludes(r, 'Rp 1.800'))];
    },
  },
  {
    id: 'below_minimum',
    title: 'Below the minimum order',
    async run(c) {
      const r = await c.say('kertas supreme 64 gsm 30x30 3 rim berapa kak?');
      const row = await c.lastReplyRow();
      const calls = (row?.metadata as { priceCalls?: { outcome: string }[] } | null)?.priceCalls;
      const conv = await c.conversation();
      return [
        got(r),
        check('mentions the minimum (minim ... 5 rim)', anyText(r, /minim/i) && anyText(r, /5 rim/)),
        check('no Rp 555.000', !anyIncludes(r, 'Rp 555.000')),
        check('priceCalls[0].outcome is below_minimum', calls?.[0]?.outcome === 'below_minimum', JSON.stringify(calls?.map((x) => x.outcome))),
        check('conversation not escalated', conv.status !== 'escalated', conv.status),
      ];
    },
  },
  {
    id: 'above_top_tier',
    title: 'Above the top price tier goes to the team',
    async run(c) {
      const r = await c.say('box ivory 310 gsm 20x20x7,5 150 rim berapa?');
      const conv = await c.conversation();
      return [check('escalated', conv.status === 'escalated', conv.status), check('category pesanan_besar', conv.handoffCategory === 'pesanan_besar', String(conv.handoffCategory)), noPrice(r)];
    },
  },
  {
    id: 'custom_size',
    title: 'Custom size is not in the catalog',
    async run(c) {
      const r = await c.say('box ivory 22x22x7 cm 5000 pcs, berapa?');
      const conv = await c.conversation();
      return [
        check('escalated', conv.status === 'escalated', conv.status),
        check('category harga_custom', conv.handoffCategory === 'harga_custom', String(conv.handoffCategory)),
        noPrice(r),
        check('a reply mentions the team', anyText(r, /tim/i)),
      ];
    },
  },
  {
    id: 'both_brands',
    title: 'One customer, both brands',
    async run(c) {
      const a = await c.say('mau kertas supreme 64 gsm 35x35 10 rim');
      const b = await c.say('sekalian box ivory 270 gsm 21x14x5 5000 pcs juga');
      const r = [...a, ...b];
      await c.leadPass();
      const lead = await c.lead();
      return [
        got(r),
        ...['Rp 217.500', 'Rp 2.175.000', 'Rp 1.500', 'Rp 7.500.000'].map((s) => check(`mentions ${s}`, anyIncludes(r, s))),
        check('brands include both', !!lead && lead.brands.includes('kertas_supreme') && lead.brands.includes('imperial_indopack'), JSON.stringify(lead?.brands)),
        check('at least 2 items', (lead?.items.length ?? 0) >= 2, JSON.stringify(lead?.items)),
      ];
    },
  },
  {
    id: 'logo_image',
    title: 'Customer sends a logo: handed to the team for a design check',
    async run(c) {
      await c.say('mau cetak kertas supreme 64 gsm 30x30 10 rim');
      const r = await c.sendImage('logo.png', 'ini logonya kak');
      const conv = await c.conversation();
      const profile = await c.profile();
      const items = (Array.isArray(profile['items']) ? profile['items'] : []) as { has_design?: boolean }[];
      return [
        got(r),
        check('a reply mentions logo or desain', anyText(r, /logo|desain/i)),
        check('escalated', conv.status === 'escalated', conv.status),
        check('category desain_masuk', conv.handoffCategory === 'desain_masuk', String(conv.handoffCategory)),
        check('a profile item has has_design true', items.some((i) => i.has_design === true), JSON.stringify(profile['items'])),
      ];
    },
  },
  {
    id: 'no_design_reference_photos',
    title: 'No design yet: reference photos are sent',
    async run(c) {
      const r = await c.say('mau kertas supreme 64 gsm cetak 1 warna 30x30 10 rim, belum punya desain. ada contohnya?');
      const refs = await referenceUrls();
      const imgs = images(r);
      return [
        check('1 to 3 images captured', imgs.length >= 1 && imgs.length <= 3, String(imgs.length)),
        check('each image is one of the product reference photos', imgs.length > 0 && imgs.every((i) => refs.some((u) => (i.path ?? '').endsWith(u))), imgs.map((i) => i.path).join(', ')),
      ];
    },
  },
  {
    id: 'no_design_no_photos',
    title: 'No design and no reference photos: the team follows up',
    async run(c) {
      const r = await c.say('mau box ivory 270 gsm 21x14x5 5000 pcs, belum ada desain, ada contoh?');
      const conv = await c.conversation();
      return [
        check('no image captured', images(r).length === 0, String(images(r).length)),
        check('escalated', conv.status === 'escalated', conv.status),
        check('a reply mentions the team', anyText(r, /tim/i)),
      ];
    },
  },
  {
    id: 'agrees_po_form',
    title: 'Agrees to order with a design: cetak form',
    async run(c) {
      await c.say(ORDER_STEPS.intro);
      await c.say(ORDER_STEPS.withLogo);
      const r = await c.say('oke kak saya ambil 12 rim');
      await c.leadPass();
      const lead = await c.lead();
      return [
        check('a text equals the cetak PO form message', texts(r).includes(poFormMessage(PO_FORM_QA_URLS.cetak)), texts(r).join(' | ')),
        check('lead is won', lead?.status === 'won', lead?.status),
      ];
    },
  },
  {
    id: 'agrees_po_form_no_design',
    title: 'Agrees to order without a design: plano form',
    async run(c) {
      await c.say(ORDER_STEPS.intro);
      await c.say(ORDER_STEPS.noLogo);
      const r = await c.say('oke kak saya ambil 12 rim');
      return [check('a text equals the plano PO form message', texts(r).includes(poFormMessage(PO_FORM_QA_URLS.plano)), texts(r).join(' | '))];
    },
  },
  {
    id: 'price_list_no_details',
    title: 'Asks for the box price list',
    async run(c) {
      const r = await c.say('kak minta pricelist box nya dong');
      return [
        check('one document named the Imperial price list', docs(r).length === 1 && docs(r)[0]!.filename === 'Daftar Harga Imperial Indopack (QA).pdf', docs(r).map((d) => d.filename).join(', ')),
        noPrice(r),
      ];
    },
  },
  {
    id: 'courier',
    title: 'A courier, not a buyer',
    async run(c) {
      const r = await c.say('Paket untuk gudang Jatinegara, penerimanya siapa kak?');
      await c.leadPass();
      const lead = await c.lead();
      const conv = await c.conversation();
      return [
        check('lead kind kurir', lead?.kind === 'kurir', lead?.kind),
        check('category bukan_pembeli', conv.handoffCategory === 'bukan_pembeli', String(conv.handoffCategory)),
        none(r, /berapa|ukuran/i, 'no sales questions (berapa / ukuran)'),
        noPrice(r),
      ];
    },
  },
  {
    id: 'supplier',
    title: 'A supplier offering their goods',
    async run(c) {
      await c.say('Kami supplier kertas kraft roll, boleh kirim penawaran ke bagian pembelian?');
      await c.leadPass();
      const lead = await c.lead();
      const conv = await c.conversation();
      return [check('lead kind supplier', lead?.kind === 'supplier', lead?.kind), check('category bukan_pembeli', conv.handoffCategory === 'bukan_pembeli', String(conv.handoffCategory))];
    },
  },
  {
    id: 'job_seeker',
    title: 'A job seeker',
    async run(c) {
      await c.say('Permisi kak, apakah ada lowongan operator mesin cetak?');
      await c.leadPass();
      const lead = await c.lead();
      const conv = await c.conversation();
      return [check('lead kind lamaran_kerja', lead?.kind === 'lamaran_kerja', lead?.kind), check('category bukan_pembeli', conv.handoffCategory === 'bukan_pembeli', String(conv.handoffCategory))];
    },
  },
  {
    id: 'complaint',
    title: 'A complaint goes to the team with an apology',
    async run(c) {
      const r = await c.say('Kak kertas yang saya terima kemarin sobek semua, saya kecewa');
      await c.leadPass();
      const lead = await c.lead();
      const conv = await c.conversation();
      return [
        check('lead kind stays lead (a complaining customer is a buyer)', lead?.kind === 'lead', lead?.kind),
        check('escalated', conv.status === 'escalated', conv.status),
        check('category komplain', conv.handoffCategory === 'komplain', String(conv.handoffCategory)),
        check('the reply apologises (maaf)', anyText(r, /maaf/i)),
        none(r, /berapa|ukuran/i, 'no sales questions (berapa / ukuran)'),
      ];
    },
  },
  {
    id: 'asks_human',
    title: 'Asks for a person',
    async run(c) {
      const r = await c.say('bisa langsung bicara dengan orang/admin saja kak?');
      const conv = await c.conversation();
      return [
        check('escalated', conv.status === 'escalated', conv.status),
        check('category minta_orang', conv.handoffCategory === 'minta_orang', String(conv.handoffCategory)),
        none(r, /berapa|ukuran/i, 'no sales questions (berapa / ukuran)'),
      ];
    },
  },
  {
    id: 'english',
    title: 'An English-speaking customer is answered in English',
    async run(c) {
      const r = await c.say('Hi, I need Kertas Supreme 64 gsm printed 1 colour, 30x30 cm, 10 rim. How much?');
      const ok = texts(r).some((t) => writesEnglish(t) && t.includes('Rp 165.000') && t.includes('Rp 1.650.000'));
      return [check('one English reply with Rp 165.000 and Rp 1.650.000', ok, texts(r).join(' | '))];
    },
  },
  {
    id: 'ack_only',
    title: 'A thank-you after the answer gets no reply',
    async run(c) {
      await c.say('berapa harga kertas supreme?');
      const r = await c.sayExpectingSilence('terima kasih kak 🙏');
      return [check('nothing captured for the thank-you', r.length === 0, texts(r).join(' | '))];
    },
  },
  {
    id: 'returning_lost_after_window',
    title: 'A lost customer returns after the reopen window',
    async run(c) {
      await c.say('mau kertas supreme 30x30 5 rim');
      await c.leadPass();
      const first = await c.lead();
      if (first) {
        await getDb().execute(sql`UPDATE leads SET status = 'lost', lost_reason = 'tidak_jadi', closed_at = now(), human_updated_at = NULL WHERE id = ${first.id}::uuid`);
      }
      await c.backdate(100);
      await c.say('kak mau order lagi kertas supreme 30x30 10 rim');
      await c.leadPass();
      const all = await c.leads();
      const newest = all[all.length - 1];
      return [
        check('the contact has 2 leads', all.length === 2, String(all.length)),
        check('the newest lead points at the old one', !!first && newest?.previousLeadId === first.id, `${newest?.previousLeadId} vs ${first?.id}`),
        check('the newest lead is not lost', !!newest && newest.status !== 'lost', newest?.status),
      ];
    },
  },
  {
    id: 'silence_lost',
    title: 'Silence for 31 days closes the lead as lost',
    async run(c) {
      await c.say('berapa harga box ivory 270 gsm 21x14x5?');
      await c.backdate(31);
      await c.silenceSweep();
      const lead = await c.lead();
      return [check('lead is lost', lead?.status === 'lost', lead?.status), check('reason tidak_ada_respon', lead?.lostReason === 'tidak_ada_respon', String(lead?.lostReason))];
    },
  },
];
