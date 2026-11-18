/**
 * lead-stages.test.ts - pure stage rules: forward-only advance, evidence matching, enum parsing,
 * price-figure detection and non-sales topic mapping. No DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  STAGE_RANK,
  canAdvance,
  matchEvidence,
  hasPriceFigure,
  parseLeadKind,
  parseLostReason,
  kindFromNonSalesTopic,
} from '../src/domain/leadStages.js';

describe('leadStages', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('ranks stages new < contacted < quoted < won = lost', () => {
    expect(STAGE_RANK).toEqual({ new: 0, contacted: 1, quoted: 2, won: 3, lost: 3 });
  });

  it('canAdvance only moves forward', () => {
    expect(canAdvance('new', 'contacted')).toBe(true);
    expect(canAdvance('contacted', 'quoted')).toBe(true);
    expect(canAdvance('new', 'won')).toBe(true);
    expect(canAdvance('quoted', 'contacted')).toBe(false);
    expect(canAdvance('new', 'new')).toBe(false);
  });

  it('canAdvance is never true from won or lost (reopen is a separate path)', () => {
    expect(canAdvance('won', 'lost')).toBe(false);
    expect(canAdvance('lost', 'won')).toBe(false);
    expect(canAdvance('won', 'quoted')).toBe(false);
    expect(canAdvance('lost', 'contacted')).toBe(false);
  });

  it('matchEvidence finds a normalised substring in a customer message', () => {
    expect(
      matchEvidence('saya ambil 10 rim', [{ id: 'm1', body: 'Oke kak, saya ambil 10 rim ya!' }])?.id,
    ).toBe('m1');
  });

  it('matchEvidence returns the first matching message', () => {
    const hit = matchEvidence('ambil 10 rim', [
      { id: 'm1', body: 'tanya dulu' },
      { id: 'm2', body: 'ambil 10 rim' },
      { id: 'm3', body: 'ambil 10 rim juga' },
    ]);
    expect(hit?.id).toBe('m2');
  });

  it('matchEvidence returns null when the evidence is not in any message', () => {
    expect(matchEvidence('saya ambil 3 karton', [{ id: 'm1', body: 'saya ambil 10 rim' }])).toBeNull();
  });

  it('matchEvidence returns null for evidence under 4 normalised chars', () => {
    expect(matchEvidence('ok', [{ id: 'm1', body: 'ok' }])).toBeNull();
    expect(matchEvidence('ok!!', [{ id: 'm1', body: 'ok' }])).toBeNull();
  });

  it('matchEvidence looks only at the messages passed in', () => {
    expect(matchEvidence('saya ambil 10 rim', [])).toBeNull();
    expect(matchEvidence('saya ambil 10 rim', [{ id: 'm1', body: 'tanya harga' }])).toBeNull();
  });

  it('hasPriceFigure detects an Rp figure', () => {
    expect(hasPriceFigure('Harga Rp 46.000/Lsn')).toBe(true);
    expect(hasPriceFigure('Rp.5000')).toBe(true);
  });

  it('hasPriceFigure needs a word boundary before Rp (product codes are not prices)', () => {
    expect(hasPriceFigure('kode LRP 8161')).toBe(false);
    expect(hasPriceFigure('HRP 8161i ada')).toBe(false);
  });

  it('parseLeadKind accepts enum values, case and spacing variants', () => {
    expect(parseLeadKind('Status Pesanan')).toBe('status_pesanan');
    expect(parseLeadKind('  LAMARAN-kerja ')).toBe('lamaran_kerja');
    expect(parseLeadKind('lead')).toBe('lead');
  });

  it('parseLeadKind returns undefined and warns on unknown values', () => {
    expect(parseLeadKind('courier')).toBeUndefined();
    expect(parseLeadKind(42)).toBeUndefined();
    expect(parseLeadKind(undefined)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('[leadStages] ignoring unknown');
  });

  it('parseLostReason accepts enum values and rejects unknown ones with a warning', () => {
    expect(parseLostReason('Barang Tidak Ada')).toBe('barang_tidak_ada');
    expect(parseLostReason('harga')).toBe('harga');
    expect(parseLostReason('mahal')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('kindFromNonSalesTopic maps detectNonSalesTopic strings to kinds', () => {
    expect(kindFromNonSalesTopic('Kurir / pengambilan pesanan')).toBe('kurir');
    expect(kindFromNonSalesTopic('Lowongan kerja')).toBe('lamaran_kerja');
    expect(kindFromNonSalesTopic('Pembayaran / status pesanan')).toBe('status_pesanan');
    expect(kindFromNonSalesTopic('Penawaran kerja sama / supplier')).toBe('supplier');
    expect(kindFromNonSalesTopic('sesuatu yang lain')).toBe('lainnya');
  });
});
