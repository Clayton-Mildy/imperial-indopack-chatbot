/**
 * categorize-product.ts
 * Maps a product (name + descriptive text) to one of the existing `categories`
 * rows by keyword. Categories are never created here — only matched against
 * whatever already exists in the DB (KC curates the category list manually;
 * the source Excel has no category column at all).
 *
 * Ordered rules, first match wins — more specific phrases first so e.g.
 * "HANDLE TANGGUNG ... (WIDE)" doesn't fall through to plain "Door Handle Tanggung".
 */

export interface CategorizableProduct {
  name: string;
  fungsi?: string | null;
  kataKunci?: string | null;
}

interface Rule {
  category: string;
  keywords: string[]; // ALL must appear (word-boundary) in the normalized text
}

// Ordered by specificity — a rule earlier in this list wins over a later one.
const RULES: Rule[] = [
  { category: 'Door Handle Tanggung Wide', keywords: ['HANDLE TANGGUNG', 'WIDE'] },
  { category: 'Handle Pintu Aluminium', keywords: ['HANDLE PINTU ALUMINIUM'] },
  { category: 'Door Handle Pisah', keywords: ['HANDLE PISAH'] },
  { category: 'Door Handle Tanggung', keywords: ['HANDLE TANGGUNG'] },
  { category: 'Door Handle Besar', keywords: ['HANDLE BESAR'] },
  { category: 'Door Handle', keywords: ['HANDLE KECIL'] },
  { category: 'Knob Handle', keywords: ['KNOB HANDLE'] },
  { category: 'Door Stop', keywords: ['DOOR STOP'] },
  { category: 'Door Closer', keywords: ['DOORCLOSER'] },
  { category: 'Door Closer', keywords: ['DOOR CLOSER'] },
  { category: 'Door Pull', keywords: ['DOORPULL'] },
  { category: 'Door Pull', keywords: ['DOOR PULL'] },
  { category: 'Ball Valve', keywords: ['BALLVALVE'] },
  { category: 'Ball Valve', keywords: ['BALL VALVE'] },
  // Engsel Salon's own kata_kunci list includes "Engsel gunting" (its Indonesian trade name) —
  // must be checked before the Gunting rules or it'd be misclassified as Gunting.
  { category: 'Engsel Salon', keywords: ['ENGSEL SALON'] },
  { category: 'Engsel', keywords: ['ENGSEL'] },
  { category: 'Gunting Seng', keywords: ['GUNTING SENG'] },
  { category: 'Gunting Seng', keywords: ['HOLLOW'] },
  { category: 'Gunting', keywords: ['GUNTING'] },
  { category: 'Grendel', keywords: ['GRENDEL'] },
  { category: 'Gembok', keywords: ['GEMBOK'] },
  { category: 'Betel Topi', keywords: ['BETEL TOPI'] },
  { category: 'Body Lock', keywords: ['BODY BIASA'] },
  { category: 'Body Lock', keywords: ['BODY PELOR'] },
  { category: 'Body Lock', keywords: ['BODY PINTU'] },
  { category: 'Cetok Semen', keywords: ['CETOK SEMEN'] },
  { category: 'Gergaji', keywords: ['GERGAJI'] },
  { category: 'Hak Angin', keywords: ['HAK ANGIN'] },
  { category: 'Aksesoris Cat', keywords: ['KAPI CAT'] },
  { category: 'Aksesoris Cat', keywords: ['TONGKAT CAT'] },
  { category: 'Kuas', keywords: ['KUAS'] },
  // "Ring Kunci Bulat ..." contains "KUNCI BULAT" as a substring — Ring Kunci must win.
  { category: 'Ring Kunci', keywords: ['RING KUNCI'] },
  { category: 'Kunci Bulat', keywords: ['KUNCI BULAT'] },
  { category: 'Kunci Bulat', keywords: ['KUNCI PINTU KAMAR MANDI'] },
  { category: 'Lamskar', keywords: ['LAMSKAR'] },
  { category: 'Meteran', keywords: ['METERAN'] },
  { category: 'Obeng', keywords: ['MATA OBENG'] },
  { category: 'Obeng', keywords: ['OBENG'] },
  { category: 'Palu', keywords: ['PALU'] },
  { category: 'Silinder', keywords: ['SILINDER'] },
  { category: 'Spring Knife', keywords: ['SPRING KNIFE'] },
  { category: 'Tarikan Laci', keywords: ['TARIKAN LACI'] },
  { category: 'Tang', keywords: ['TANG'] },
  { category: 'Tata Kayu', keywords: ['TATA KAYU'] },
  { category: 'Trowel Coratex', keywords: ['TROWEL CORATEX'] },
  { category: 'Waterpass', keywords: ['WATERPASS'] },
];

/** Uppercase, fix known data-entry typos, strip punctuation, pad with word-boundary spaces. */
function normalize(text: string): string {
  return (
    ' ' +
    text
      .toUpperCase()
      .replace(/HANDLEBLACK/g, 'HANDLE BLACK') // KNOB HANDLEBLACK SILVER — missing space in source
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() +
    ' '
  );
}

function firstMatch(blob: string): string | null {
  for (const rule of RULES) {
    if (rule.keywords.every((kw) => blob.includes(` ${kw} `))) {
      return rule.category;
    }
  }
  return null;
}

/**
 * Returns the matched category name, or null if no rule fires (a legitimate uncategorized SKU).
 *
 * The product's own name is tried first and, if it matches, wins outright. Only when the name
 * is uninformative (bare SKU codes like "BC9020") do we fall back to fungsi/kataKunci — those
 * fields list Indonesian trade synonyms across hardware types (e.g. Lamskar's kata_kunci
 * includes "hak angin tarik", a related-but-different category) and can misfire if checked
 * first. `usp` is excluded entirely — free-form marketing copy that namedrops other tools
 * (e.g. a socket-wrench USP mentioning "mata obeng").
 */
export function categorizeProduct(product: CategorizableProduct): string | null {
  const byName = firstMatch(normalize(product.name));
  if (byName) return byName;

  const fallbackBlob = normalize([product.fungsi, product.kataKunci].filter(Boolean).join(' '));
  return firstMatch(fallbackBlob);
}
