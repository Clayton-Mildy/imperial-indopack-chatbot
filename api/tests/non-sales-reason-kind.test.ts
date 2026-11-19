import { describe, it, expect } from 'vitest';
import { kindFromNonSalesReason } from '../src/domain/leadStages.js';

describe('kindFromNonSalesReason', () => {
  it.each([
    ['BUKAN PEMBELI: Penanya mengirim paket ke gudang Jatinegara, menanyakan siapa penerimanya - bukan pembeli produk kami', 'kurir'],
    ['BUKAN PEMBELI: kurir ojek online ambil pesanan', 'kurir'],
    ['BUKAN PEMBELI: menanyakan lowongan operator mesin', 'lamaran_kerja'],
    ['BUKAN PEMBELI: supplier kertas kraft menawarkan penawaran', 'supplier'],
    ['BUKAN PEMBELI: salah sambung', 'lainnya'],
  ])('%s -> %s', (reason, kind) => expect(kindFromNonSalesReason(reason)).toBe(kind));
});
