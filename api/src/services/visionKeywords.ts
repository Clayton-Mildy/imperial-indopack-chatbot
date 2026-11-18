import { z } from 'zod';
import { getClient, isDevMode, agentQuery, CLAUDE_MODEL } from './claude.js';

// IMPORTANT: Haiku's output is fed into RAG plumbing ONLY (extraKeywords →
// buildCatalogContext). It MUST NEVER be injected into Sonnet's system prompt,
// otherwise the closed-catalog rule from task-legacy-007 weakens.

/** Where the product sits in the photo: [left, top, right, bottom], percent of width and height. */
export type ProductBox = [number, number, number, number];

// A box the model got wrong is dropped, never the whole extract: a schema failure here would lose
// every keyword along with it.
function toProductBox(v: unknown): ProductBox | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && n >= 0 && n <= 100)) return null;
  const [l, t, r, b] = v as ProductBox;
  return l < r && t < b ? [l, t, r, b] : null;
}

const VisionExtractSchema = z.object({
  confidence: z.enum(['high', 'low', 'none']),
  primary_category: z.string().nullish().transform((v) => v ?? ''),
  secondary_categories: z.array(z.string()).nullish().transform((v) => v ?? []),
  visual_features: z.array(z.string()).nullish().transform((v) => v ?? []),
  colors: z.array(z.string()).nullish().transform((v) => v ?? []),
  materials: z.array(z.string()).nullish().transform((v) => v ?? []),
  brand_names: z.array(z.string()).nullish().transform((v) => v ?? []),
  chat_text: z.array(z.string()).nullish().transform((v) => v ?? []),
  // optional(): without it zod reads a missing key as an error, and the whole extract is lost.
  product_box: z.unknown().optional().transform(toProductBox),
  non_product_reason: z.string().nullish().transform((v) => v ?? undefined),
});

export type VisionExtract = z.infer<typeof VisionExtractSchema>;

const VISION_KEYWORDS_PROMPT = `Kamu adalah pengekstrak kata kunci visual untuk katalog hardware (handle, engsel, kunci, rel laci, aksesoris pintu/jendela/furnitur).

Lihat foto yang dikirim pelanggan. Identifikasi:
- primary_category: kategori produk utama (mis. "handle pintu", "engsel", "kunci", "rel laci"). Gunakan istilah katalog Indonesia.
- secondary_categories: kategori alternatif yang juga mungkin cocok.
- visual_features: ciri visual yang penting untuk pencocokan (panjang, bentuk, gaya — mis. "minimalis", "tipis", "lengkung", "kotak"). Untuk handle pintu, sebutkan juga cara pemasangannya: "roset" bila gagang terpasang di atas roset bulat/kotak tanpa plat panjang, atau "plat" bila gagang menyatu dengan plat panjang.
- colors: warna yang terlihat (mis. "hitam", "silver", "emas").
- materials: tebakan material berbasis tampilan (mis. "stainless", "aluminium", "kuningan").
- brand_names: nama merek/logo yang TERCETAK di produk atau kemasannya, persis seperti tertulis (mis. "SOLID"). Hanya nama mereknya - bukan jenis barang ("PADLOCK"), nama tipe/model barang ("Santa Cruz", "Newton"), nama toko/penjual/akun di screenshot marketplace atau media sosial ("Power Shop", "... Store"), slogan, ukuran, atau tulisan lain. [] bila tidak ada merek yang terbaca.
- product_box: kotak tempat barang utama terlihat di foto, [kiri, atas, kanan, bawah] dalam persen (0-100) dari lebar dan tinggi foto. Di screenshot marketplace/TikTok, kotak itu hanya gambar barangnya - tanpa teks harga, tombol, atau video kecil di atasnya. null bila tidak ada barang.
- chat_text: bila foto adalah screenshot percakapan chat (WhatsApp, chat marketplace, DM), salin isi pesan-pesannya yang terbaca, satu pesan per item, apa adanya. [] bila bukan screenshot chat.
- confidence:
  - "high" — jelas merupakan produk dalam kategori Legacy.
  - "low" — kemungkinan produk Legacy tapi sudut/cahaya/kualitas membuat tidak yakin.
  - "none" — bukan produk Legacy sama sekali (orang, kendaraan, screenshot, produk yang jelas bukan hardware furnitur/pintu).
- non_product_reason: WAJIB diisi jika confidence="none", jelaskan singkat dalam Bahasa Indonesia.

Balas HANYA dengan JSON valid sesuai skema. Tanpa teks lain.`;

function lowConfidenceFallback(): VisionExtract {
  return {
    confidence: 'low',
    primary_category: '',
    secondary_categories: [],
    visual_features: [],
    colors: [],
    materials: [],
    brand_names: [],
    chat_text: [],
    product_box: null,
    non_product_reason: undefined,
  };
}

export async function extractCatalogKeywordsFromImage(
  imageData: { base64: string; mimeType: string }
): Promise<VisionExtract> {
  const content = [
    {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: imageData.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: imageData.base64,
      },
    },
    { type: 'text' as const, text: 'Ekstrak kata kunci katalog dari foto ini dalam format JSON.' },
  ];

  let raw: string;
  if (isDevMode()) {
    raw = await agentQuery({ systemPrompt: VISION_KEYWORDS_PROMPT, userContent: content, maxTurns: 1, noThinking: true });
  } else {
    const response = await getClient().messages.create({
      model: CLAUDE_MODEL,
      // chat_text copies a screenshot's messages; at 400 a long chat would end the JSON early and lose every keyword with it.
      max_tokens: 1000,
      system: VISION_KEYWORDS_PROMPT,
      messages: [{ role: 'user', content }],
    });
    raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
  }
  return parseVisionExtract(raw);
}

export function parseVisionExtract(raw: string): VisionExtract {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const json = start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw;
  try {
    return VisionExtractSchema.parse(JSON.parse(json));
  } catch (err) {
    console.warn('[visionKeywords] parse/schema failure:', err instanceof Error ? err.message : err);
    console.warn('[visionKeywords] raw was:', raw.slice(0, 400));
    return lowConfidenceFallback();
  }
}

export function visionExtractToKeywords(extract: VisionExtract): string[] {
  const tokens = [
    ...extract.primary_category.split(/\s+/),
    ...extract.secondary_categories.flatMap((c) => c.split(/\s+/)),
    ...extract.visual_features,
    ...extract.colors,
    ...extract.materials,
  ]
    .map((k) => k.toLowerCase().trim())
    .filter((k) => k.length >= 3);
  return Array.from(new Set(tokens));
}
