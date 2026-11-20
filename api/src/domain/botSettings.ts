import { z } from 'zod';
import { PCS_PER_RIM } from './pricing.js';

export type SignAs = 'brand_discussed' | 'imperial_indopack';

export interface BotSettings {
  botName: string;
  signAs: SignAs;
  greeting: string;
  fallbackMinPcs: number;
  teamReminderMinutes: number;
  /** 0 = the WhatsApp history sync schedule is off. */
  whatsappSyncMinutes: number;
}

export const DEFAULT_BOT_SETTINGS: BotSettings = {
  botName: 'Admin',
  signAs: 'brand_discussed',
  greeting: 'Halo kak, terima kasih sudah menghubungi {merek}. Boleh tahu kertas atau box-nya untuk produk apa?',
  fallbackMinPcs: 2500,
  teamReminderMinutes: 30,
  whatsappSyncMinutes: 60,
};

export const BotSettingsPatchSchema = z.object({
  botName: z.string().trim().min(1).max(40),
  signAs: z.enum(['brand_discussed', 'imperial_indopack']),
  greeting: z.string().trim().min(1).max(500),
  fallbackMinPcs: z.number().int().min(1).max(1_000_000),
  teamReminderMinutes: z.number().int().min(5).max(1440),
  whatsappSyncMinutes: z.number().int().min(0).max(1440),
}).partial();

/** 2500 -> "2.500 pcs / 5 rim"; 1200 -> "1.200 pcs" (the rim count only when it is whole). */
export function formatMinOrder(pcs: number): string {
  const grouped = String(pcs).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return pcs % PCS_PER_RIM === 0 ? `${grouped} pcs / ${pcs / PCS_PER_RIM} rim` : `${grouped} pcs`;
}

const SIGN_AS_LINE: Record<SignAs, string> = {
  brand_discussed: 'merek yang sedang dibahas (Kertas Supreme atau Imperial Indopack); bila belum jelas, Imperial Indopack.',
  // Live 2026-11-20: set to Imperial Indopack, the bot still introduced itself as "Imperial Indopack & Kertas
  // Supreme". The paper line is still sold and recorded (brands) - only its name stays out of the chat.
  imperial_indopack: 'selalu Imperial Indopack: di perkenalan, di sapaan ({merek} = Imperial Indopack), dan di kalimat asisten virtual. ' +
    'JANGAN menyebut nama "Kertas Supreme" ke pelanggan: produk kertas (kertas nasi/bungkus cetak logo, greaseproof, paper bag, paper sleeve, amplop) ' +
    'kamu tawarkan sebagai produk Imperial Indopack juga. Baris "Merek: Kertas Supreme" di KATALOG PRODUK dan INFORMASI MEREK hanya untuk pencatatan (field brands), bukan untuk ditulis. ' +
    'Kalau pelanggan sendiri menyebut Kertas Supreme (mis. dari teks iklan), iyakan bahwa produk itu juga dari kami.',
};

export function buildBotSettingsBlock(s: BotSettings): string {
  return [
    '--- PENGATURAN BOT ---',
    `Nama kamu: ${s.botName}. Perkenalkan diri dengan nama ini, jangan nama lain.`,
    `Menyebut diri dari: ${SIGN_AS_LINE[s.signAs]}`,
    `Sapaan pertama (pakai di balasan PERTAMA percakapan, sesuaikan dengan pesan pelanggan termasuk teks bawaan iklan; ganti {merek}): "${s.greeting}"`,
    `Minimum order untuk produk tanpa tingkat harga: ${formatMinOrder(s.fallbackMinPcs)}.`,
    '--- AKHIR PENGATURAN BOT ---',
  ].join('\n');
}
