/**
 * A product's spec - gramasi, cetak, finishing - lives in products.description as one labelled line:
 * "Gramasi: 64 gsm · Cetak: 1 warna · Finishing: Laminasi food grade". The Excel template joins its
 * three columns into it and splits it back out; the product editor does the same with its fields.
 */

export interface ProductSpec {
  gsm: string | null;
  print: string | null;
  finishing: string | null;
}

const SEP = ' · ';
const LABELS: readonly [keyof ProductSpec, string][] = [
  ['gsm', 'Gramasi'],
  ['print', 'Cetak'],
  ['finishing', 'Finishing'],
];
const SEGMENT_RE = /^(Gramasi|Cetak|Finishing):\s*(.+)$/;

/** The labelled line, empty parts left out; null when all three are empty. */
export function formatProductSpec(s: ProductSpec): string | null {
  const parts = LABELS.flatMap(([key, label]) => {
    const v = s[key]?.trim();
    return v ? [`${label}: ${v}`] : [];
  });
  return parts.length > 0 ? parts.join(SEP) : null;
}

/** The inverse: each labelled part back to its field. Unlabelled text and unknown labels read as nothing. */
export function parseProductSpec(description: string | null): ProductSpec {
  const out: ProductSpec = { gsm: null, print: null, finishing: null };
  for (const seg of (description ?? '').split(SEP)) {
    const m = SEGMENT_RE.exec(seg.trim());
    if (!m) continue;
    const key = LABELS.find(([, label]) => label === m[1])![0];
    out[key] = m[2]!.trim();
  }
  return out;
}
