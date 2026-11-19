/**
 * leads-export.test.ts
 * buildLeadsSheet is the whole contract of the leads Excel export - marketing reads this
 * file, so the header row is API and the rupiah cells have to be numbers rather than
 * pre-formatted text. Pure - no DB, no xlsx reader.
 */

import { describe, it, expect } from 'vitest';
import writeExcelFile from 'write-excel-file/node';
import { buildLeadsSheet } from '../src/services/leadsExport.js';
import type { LeadWithContact } from '../src/domain/types.js';

function lead(over: Partial<LeadWithContact> = {}): LeadWithContact {
  return {
    id: 'l1',
    requestId: null,
    contactId: 'c1',
    utmId: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
    payload: {},
    status: 'new',
    dealValueIdr: null,
    leadTemperature: null,
    totalOrders: 0,
    humanUpdatedAt: null,
    submittedAt: new Date('2026-09-01T03:00:00Z'),
    matchedAt: null,
    createdAt: new Date('2026-09-01T03:00:00Z'),
    updatedAt: new Date('2026-09-01T03:00:00Z'),
    waId: '628571234567',
    displayName: 'Budi',
    conversationId: 'conv-1',
    conversationStatus: 'active',
    conversationStartedAt: new Date('2026-09-01T04:30:00Z'),
    lastChatAt: new Date('2026-09-03T09:15:00Z'),
    name: null,
    company: null,
    brands: [],
    items: [],
    orderFieldsSetAt: null,
    orderFieldsSetBy: null,
    contactProfile: {},
    followUpStatus: null,
    followUpNotes: null,
    aiEnabled: null,
    lastSeen: null,
    kind: 'lead',
    kindSetBy: null,
    lostReason: null,
    outcomeEvidence: null,
    outcomeMessageId: null,
    closedAt: null,
    previousLeadId: null,
    firstContactAt: null,
    waitingSince: null,
    ...over,
  };
}

const HEADERS = [
  'mulai_chat', 'chat_terakhir', 'nama', 'nomor_whatsapp', 'campaign', 'utm_source', 'utm_medium',
  'utm_content', 'request_id', 'kebutuhan', 'hot_cold', 'status',
  'total_order', 'nilai_deal_idr', 'tanggal_masuk', 'Jenis', 'Alasan Kalah', 'Tanggal Closing',
  'Merek', 'Barang', 'Nama', 'Usaha',
];

function rowFor(over: Partial<LeadWithContact>): unknown[] {
  return buildLeadsSheet([lead(over)])[0]!.data[1] as unknown[];
}

function cell(over: Partial<LeadWithContact>, header: string): unknown {
  return rowFor(over)[HEADERS.indexOf(header)];
}

describe('buildLeadsSheet', () => {
  it('emits one bold header row in the documented order', () => {
    const [sheet] = buildLeadsSheet([]);
    expect(sheet!.sheet).toBe('Leads');
    expect(sheet!.data[0]).toEqual(HEADERS.map((value) => ({ value, fontWeight: 'bold' })));
  });

  it('writes one row per lead', () => {
    expect(buildLeadsSheet([lead(), lead({ id: 'l2' })])[0]!.data).toHaveLength(3);
  });

  it('buckets the campaign the same way the report does', () => {
    expect(cell({}, 'campaign')).toBe('Organik');
    // Came through a form but its UTM row was never imported.
    expect(cell({ requestId: 'r1' }, 'campaign')).toBe('Campaign');
    // An explicit campaign always wins, even with no request_id.
    expect(cell({ utmCampaign: 'brosur_agustus' }, 'campaign')).toBe('brosur_agustus');
  });

  it('prefers the form name over the WhatsApp display name', () => {
    expect(cell({ payload: { nama: 'Budi Santoso' } }, 'nama')).toBe('Budi Santoso');
    expect(cell({}, 'nama')).toBe('Budi');
  });

  it('falls back to the AI-extracted interest when the form asked nothing', () => {
    expect(cell({ payload: { kebutuhan: 'Box nasi' } }, 'kebutuhan')).toBe('Box nasi');
    expect(cell({ contactProfile: { product_sought: 'Kertas bungkus' } }, 'kebutuhan')).toBe('Kertas bungkus');
    expect(cell({}, 'kebutuhan')).toBeNull();
  });

  // Marketing (read-only) never receives the customer's own words: the dashboard's export proxy asks
  // for redact, and the kebutuhan column (the form's free-text answer, or what the AI read from the
  // chat) is left blank. Every other column stays.
  it('redact: the kebutuhan column is blank, the rest of the row stays', () => {
    const over = {
      payload: { nama: 'Contoh Dewi', apa_yang_anda_butuhkan: 'kertas nasi 10 rim', pesan: 'tolong kirim cepat' },
      contactProfile: { product_sought: 'Kertas bungkus' },
    };
    const redacted = buildLeadsSheet([lead(over)], { redact: true })[0]!.data[1] as unknown[];
    expect(redacted[HEADERS.indexOf('kebutuhan')]).toBeNull();
    expect(redacted[HEADERS.indexOf('nama')]).toBe('Contoh Dewi');
    expect(redacted).toHaveLength(HEADERS.length);
    expect(buildLeadsSheet([lead({ payload: { pesan: 'tolong kirim cepat' } })], { redact: true })[0]!.data[1]).not.toContain('tolong kirim cepat');
    // Not redacted: unchanged.
    expect(cell(over, 'kebutuhan')).toBe('kertas nasi 10 rim');
  });

  it('writes brands, items, profile name and company', () => {
    expect(cell({ brands: ['imperial_indopack', 'kertas_supreme'] }, 'Merek')).toBe('Imperial Indopack, Kertas Supreme');
    expect(cell({ items: [{ product: 'Box Nasi', size: '10x10x5', qty: 100, qty_unit: 'pcs' }] }, 'Barang')).toBe('Box Nasi 10x10x5 x 100 pcs');
    expect(cell({ name: 'Budi', company: 'RM Siang' }, 'Nama')).toBe('Budi');
    expect(cell({ name: 'Budi', company: 'RM Siang' }, 'Usaha')).toBe('RM Siang');
    expect(cell({}, 'Merek')).toBeNull();
  });

  it('an item gsm of "300 gsm" exports once', () => {
    expect(cell({ items: [{ product: 'Box Contoh', gsm: '300 gsm', size: '10x10x5', qty: 100, qty_unit: 'pcs' }] }, 'Barang')).toBe('Box Contoh 300 gsm 10x10x5 x 100 pcs');
    expect(cell({ items: [{ product: 'Box Contoh', gsm: '300', size: '10x10x5' }] }, 'Barang')).toBe('Box Contoh 300 gsm 10x10x5');
  });

  it('keeps rupiah and counts as real numbers, not formatted text', () => {
    // Excel must be able to sum these; a "Rp 450.000" string cannot be summed.
    expect(cell({ dealValueIdr: 450000 }, 'nilai_deal_idr')).toEqual({
      value: 450000, type: Number, format: '#,##0',
    });
    expect(cell({ totalOrders: 3 }, 'total_order')).toEqual({
      value: 3, type: Number, format: '#,##0',
    });
    expect(cell({}, 'nilai_deal_idr')).toBeNull();
  });

  it('renders the statuses in Indonesian', () => {
    expect(cell({ status: 'won' }, 'status')).toBe('Menang');
    expect(cell({ leadTemperature: 'hot' }, 'hot_cold')).toBe('Hot');
    expect(cell({}, 'hot_cold')).toBeNull();
  });

  it('writes timestamps as WIB wall-clock, which is what the dashboard shows', () => {
    // 04:30 UTC is 11:30 in Jakarta.
    expect(cell({}, 'mulai_chat')).toBe('2026-09-01 11:30');
    expect(cell({ conversationStartedAt: null }, 'mulai_chat')).toBeNull();
    expect(cell({}, 'chat_terakhir')).toBe('2026-09-03 16:15');
    expect(cell({ lastChatAt: null }, 'chat_terakhir')).toBeNull();
  });

  it('adds Jenis, Alasan Kalah and Tanggal Closing in Indonesian', () => {
    expect(cell({}, 'Jenis')).toBe('Lead');
    expect(cell({ kind: 'kurir' }, 'Jenis')).toBe('Kurir');
    expect(cell({}, 'Alasan Kalah')).toBeNull();
    expect(cell({ status: 'lost', lostReason: 'harga' }, 'Alasan Kalah')).toBe('Harga');
    expect(cell({}, 'Tanggal Closing')).toBeNull();
    expect(cell({ closedAt: new Date('2026-09-02T04:30:00Z') }, 'Tanggal Closing')).toBe('2026-09-02 11:30');
  });

  it('produces a workbook the xlsx writer accepts', async () => {
    const buffer = await writeExcelFile(buildLeadsSheet([lead()])).toBuffer();
    expect(buffer.length).toBeGreaterThan(0);
  });
});
