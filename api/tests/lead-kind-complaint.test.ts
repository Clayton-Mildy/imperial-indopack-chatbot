/** A complaining customer is a buyer: the lead-pass prompt keeps a complaint as kind "lead", never "status_pesanan". */
import { describe, it, expect } from 'vitest';
process.env['DATABASE_URL'] ??= 'postgres://localhost/test';
const { PROMPT } = await import('../src/services/leadInsights.js');

describe('lead pass prompt', () => {
  it('names the complaint as a lead, not status_pesanan', () => {
    expect(PROMPT).toMatch(/MENGELUH atau kecewa[^.]*tetap "lead", BUKAN "status_pesanan"/);
  });
});
