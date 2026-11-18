import readXlsxFile from 'read-excel-file/node';
import { upsertLeadFromImport, findExistingRequestIds } from '../repositories/leads.js';

/**
 * Marketing's form export -> lead_submissions.
 *
 * This is the ONLY source of UTM data: the customer's WhatsApp template carries the request
 * ID and the form answers, but never utm_source/medium/campaign. The two halves meet on
 * request_id, in whichever order they arrive.
 *
 * Header names are matched loosely (case and punctuation are ignored) because marketing owns
 * the export and renames columns; every column we don't recognise is kept in `payload`
 * rather than dropped, so a renamed field degrades to "still visible in the CRM" instead of
 * "silently lost".
 */

/** The upload isn't a readable workbook. Distinct from a server fault so the route can tell
 *  "your file is broken" (400) from "we are broken" (500). */
export class InvalidXlsxError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'InvalidXlsxError';
  }
}

export interface LeadImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

const MAX_ROWS = 5000;
const MAX_ERRORS = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ordered by specificity: a sheet carrying both "id" and "uuid" must resolve to "uuid".
const HEADER_ALIASES = {
  requestId: ['requestid', 'uuid', 'submissionid', 'submissionuuid', 'id'],
  utmId: ['utmid'],
  utmSource: ['utmsource', 'source', 'sumber'],
  utmMedium: ['utmmedium', 'medium'],
  utmCampaign: ['utmcampaign', 'campaign', 'kampanye'],
  utmTerm: ['utmterm', 'term'],
  utmContent: ['utmcontent', 'content', 'konten'],
  submittedAt: ['submittedat', 'createdat', 'tanggal', 'waktu', 'date', 'timestamp'],
} as const;

type FieldName = keyof typeof HEADER_ALIASES;

/** Shared with catalogImport: both match header cells loosely, ignoring case and punctuation. */
export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function toPayloadKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** Marketing's export writes "-" for an empty UTM field; that is a blank, not a value. */
function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = value instanceof Date ? value.toISOString() : String(value).trim();
  if (text === '' || text === '-') return null;
  return text.slice(0, 500);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = cleanText(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** header index per known field, plus the leftover columns that become payload keys. */
function mapColumns(header: unknown[]): {
  columns: Partial<Record<FieldName, number>>;
  payloadColumns: { index: number; key: string }[];
} {
  const normalized = header.map(normalizeHeader);
  const columns: Partial<Record<FieldName, number>> = {};
  const claimed = new Set<number>();

  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [
    FieldName,
    readonly string[],
  ][]) {
    for (const alias of aliases) {
      const index = normalized.findIndex((h, i) => h === alias && !claimed.has(i));
      if (index !== -1) {
        columns[field] = index;
        claimed.add(index);
        break;
      }
    }
  }

  const payloadColumns = normalized
    .map((_, index) => index)
    .filter((index) => !claimed.has(index) && normalized[index] !== '')
    .map((index) => ({ index, key: toPayloadKey(header[index]) }))
    .filter((c) => c.key !== '');

  return { columns, payloadColumns };
}

export async function importLeadsFromXlsx(buffer: Buffer): Promise<LeadImportResult> {
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    sheets = await readXlsxFile(buffer);
  } catch (err) {
    throw new InvalidXlsxError(err);
  }
  const rows = sheets.find((s) => s.data.length > 0)?.data ?? [];
  const result: LeadImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] };

  const header = rows[0];
  if (!header) {
    result.errors.push({ row: 0, reason: 'File kosong atau tidak ada baris header.' });
    return result;
  }

  const { columns, payloadColumns } = mapColumns(header);
  if (columns.requestId === undefined) {
    result.errors.push({
      row: 1,
      reason: 'Kolom Request ID / UUID tidak ditemukan di baris header.',
    });
    return result;
  }

  const addError = (row: number, reason: string) => {
    if (result.errors.length < MAX_ERRORS) result.errors.push({ row, reason });
  };

  // Deduped by request_id so a row repeated inside one file is counted once, not twice.
  const parsed = new Map<string, Parameters<typeof upsertLeadFromImport>[0]>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const sheetRow = i + 1; // 1-based, matching what the uploader sees in Excel

    if (parsed.size >= MAX_ROWS) {
      result.skipped += rows.length - i;
      addError(sheetRow, `Melebihi batas ${MAX_ROWS} baris per file - sisanya dilewati.`);
      break;
    }

    const requestId = cleanText(row[columns.requestId])?.toLowerCase();
    if (!requestId || !UUID_RE.test(requestId)) {
      // Never stored: a row without a valid request ID can never be joined to a chat, so
      // reporting it is strictly more useful than keeping an orphan.
      result.skipped++;
      addError(sheetRow, requestId ? `Request ID tidak valid: ${requestId}` : 'Request ID kosong.');
      continue;
    }

    const payload: Record<string, string> = {};
    for (const { index, key } of payloadColumns) {
      const value = cleanText(row[index]);
      if (value !== null) payload[key] = value;
    }

    parsed.set(requestId, {
      requestId,
      utmId: columns.utmId !== undefined ? cleanText(row[columns.utmId]) : null,
      utmSource: columns.utmSource !== undefined ? cleanText(row[columns.utmSource]) : null,
      utmMedium: columns.utmMedium !== undefined ? cleanText(row[columns.utmMedium]) : null,
      utmCampaign: columns.utmCampaign !== undefined ? cleanText(row[columns.utmCampaign]) : null,
      utmTerm: columns.utmTerm !== undefined ? cleanText(row[columns.utmTerm]) : null,
      utmContent: columns.utmContent !== undefined ? cleanText(row[columns.utmContent]) : null,
      payload,
      submittedAt: columns.submittedAt !== undefined ? toDate(row[columns.submittedAt]) : null,
    });
  }

  const existing = await findExistingRequestIds([...parsed.keys()]);

  for (const [requestId, row] of parsed) {
    try {
      await upsertLeadFromImport(row);
      if (existing.has(requestId)) result.updated++;
      else result.imported++;
    } catch (err) {
      result.skipped++;
      addError(0, `Gagal menyimpan ${requestId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return result;
}
