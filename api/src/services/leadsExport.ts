/**
 * Leads -> Excel export.
 *
 * Replaced the Excel *import* button on /leads: marketing now reads the report out rather
 * than feeding campaign rows in. The import endpoint itself still exists (it is the only way
 * UTM data ever reaches a lead), it just has no dashboard surface.
 *
 * Unlike the catalog export this one is DELIBERATELY FILTERED. The catalog file is unfiltered
 * because a future import would replace the catalog and a partial file would be a loaded gun;
 * here the filter bar is the whole point of the page, and a file that ignored the date range
 * the user just picked would silently disagree with the screen it was downloaded from.
 *
 * One flat sheet, one row per lead, no lookup sheets: nothing reads this back in.
 */

import writeExcelFile from 'write-excel-file/node';
import type { Sheet } from 'write-excel-file/node';
import { campaignOf, listLeads } from '../repositories/leads.js';
import { BRAND_NAMES, type OrderItem } from '../domain/orderProfile.js';
import type { LeadKind, LeadStatus, LeadWithContact, LostReason } from '../domain/types.js';

// Same order as the columns on /leads, starting with the date.
const HEADERS = [
  'mulai_chat',
  'chat_terakhir',
  'nama',
  'nomor_whatsapp',
  'campaign',
  'utm_source',
  'utm_medium',
  'utm_content',
  'request_id',
  'kebutuhan',
  'hot_cold',
  'status',
  'total_order',
  'nilai_deal_idr',
  'tanggal_masuk',
  'Jenis',
  'Alasan Kalah',
  'Tanggal Closing',
  'Merek',
  'Barang',
  'Nama',
  'Usaha',
] as const;

const KIND_ID: Record<LeadKind, string> = {
  lead: 'Lead',
  kurir: 'Kurir',
  status_pesanan: 'Status Pesanan',
  lamaran_kerja: 'Lamaran Kerja',
  supplier: 'Supplier',
  lainnya: 'Lainnya',
};

const LOST_REASON_ID: Record<LostReason, string> = {
  barang_tidak_ada: 'Barang Tidak Ada',
  tidak_ada_respon: 'Tidak Ada Respon',
  harga: 'Harga',
  beli_di_tempat_lain: 'Beli di Tempat Lain',
  di_bawah_minimum: 'Di Bawah Minimum',
  tidak_jadi: 'Tidak Jadi',
  tidak_cocok: 'Tidak Cocok',
  lainnya: 'Lainnya',
};

// Indonesian, to match the page the file is downloaded from.
const STATUS_ID: Record<LeadStatus, string> = {
  new: 'Baru',
  contacted: 'Dihubungi',
  quoted: 'Penawaran',
  won: 'Menang',
  lost: 'Kalah',
};

function itemText(i: OrderItem): string {
  const name = [i.product, i.gsm ? `${i.gsm} gsm` : '', i.size, i.print ? `cetak ${i.print}` : '']
    .filter(Boolean).join(' ');
  const qty = i.qty !== undefined ? `${i.qty} ${i.qty_unit ?? ''}`.trim() : '';
  return [name, qty].filter(Boolean).join(' x ');
}

// Same key-probing the leads table does: the marketing form's labels differ per landing
// page, so try what production actually sends rather than assuming one schema.
const NAME_KEYS = ['nama', 'name', 'nama_lengkap'];
const NEED_KEYS = ['apa_yang_anda_butuhkan', 'kebutuhan', 'catatan', 'nama_perusahaan', 'pesan'];
const INTEREST_KEYS = ['product_sought', 'recommended_product', 'business_type', 'business_name'];

function pick(bag: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = bag?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Excel has no timezone, so write the WIB wall-clock the dashboard shows, as text. */
function wib(date: Date | null): string | null {
  if (!date) return null;
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** redact: the read-only (marketing) role's file - the customer's own words are left out. */
export interface LeadsSheetOptions {
  redact?: boolean;
}

/**
 * Pure: rows in, sheet out. Kept apart from the DB and the xlsx writer so the flattening
 * is testable without either - same seam as buildCatalogSheets.
 * Redacted, the kebutuhan column is blank: it is the form's free-text answer (or what the AI read
 * from the chat), the customer's own text, which the dashboard never shows the read-only role.
 */
export function buildLeadsSheet(items: LeadWithContact[], opts: LeadsSheetOptions = {}): Sheet<Buffer>[] {
  const rows: Sheet<Buffer>['data'] = [
    HEADERS.map((value) => ({ value, fontWeight: 'bold' as const })),
  ];

  for (const lead of items) {
    rows.push([
      wib(lead.conversationStartedAt),
      wib(lead.lastChatAt),
      pick(lead.payload, NAME_KEYS) ?? lead.displayName,
      lead.waId,
      campaignOf(lead),
      lead.utmSource,
      lead.utmMedium,
      lead.utmContent,
      lead.requestId,
      opts.redact ? null : pick(lead.payload, NEED_KEYS) ?? pick(lead.contactProfile, INTEREST_KEYS),
      lead.leadTemperature === 'hot' ? 'Hot' : lead.leadTemperature === 'cold' ? 'Cold' : null,
      STATUS_ID[lead.status] ?? lead.status,
      { value: lead.totalOrders, type: Number, format: '#,##0' },
      lead.dealValueIdr === null
        ? null
        : { value: lead.dealValueIdr, type: Number, format: '#,##0' },
      wib(lead.submittedAt),
      KIND_ID[lead.kind] ?? lead.kind,
      lead.lostReason ? LOST_REASON_ID[lead.lostReason] ?? lead.lostReason : null,
      wib(lead.closedAt),
      lead.brands.length ? lead.brands.map((b) => BRAND_NAMES[b] ?? b).join(', ') : null,
      lead.items.length ? lead.items.map(itemText).filter(Boolean).join('; ') : null,
      lead.name,
      lead.company,
    ]);
  }

  return [{ sheet: 'Leads', data: rows, stickyRowsCount: 1 }];
}

/** `limit: 0` = every matching row; the paginated list route still caps at 100. */
export async function buildLeadsWorkbook(
  filters: Omit<Parameters<typeof listLeads>[0], 'page' | 'limit'>,
  opts: LeadsSheetOptions = {}
): Promise<Buffer> {
  const { items } = await listLeads({ ...filters, page: 1, limit: 0 });
  return writeExcelFile(buildLeadsSheet(items, opts)).toBuffer();
}
