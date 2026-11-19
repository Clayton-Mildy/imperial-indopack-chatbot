/**
 * po-forms.test.ts - which PO form(s) an order gets (domain/poForms.ts) and the customer message for
 * one form or both (domain/constants.ts). Client rule, 2026-11-19: "cetak is if have design, plano if
 * don't have design". Pure, no DB.
 */
import { describe, it, expect } from 'vitest';
import { poFormsForOrder, PO_FORM_KINDS } from '../src/domain/poForms.js';
import { poFormMessage, poFormsMessage, PO_FORM_LABELS } from '../src/domain/constants.js';

describe('poFormsForOrder', () => {
  it('every design fact says there is a design: cetak', () => {
    expect(poFormsForOrder({ items: [{ product: 'Box Ivory', size: '22x22x7', has_design: true }] })).toEqual(['cetak']);
    expect(poFormsForOrder({ items: [{ product: 'Box Ivory', has_design: true }, { product: 'Kertas Supreme', has_design: true }] })).toEqual(['cetak']);
  });

  it('the order-level has_design (said before any product) counts like an item', () => {
    expect(poFormsForOrder({ has_design: true })).toEqual(['cetak']);
    expect(poFormsForOrder({ has_design: false })).toEqual(['plano']);
    // An item that says nothing about the design does not undo the order-level fact.
    expect(poFormsForOrder({ has_design: true, items: [{ product: 'Box Ivory', size: '22x22x7' }] })).toEqual(['cetak']);
  });

  it('every design fact says there is none: plano', () => {
    expect(poFormsForOrder({ items: [{ product: 'Kertas Supreme 64 gsm', size: '30x30', has_design: false }] })).toEqual(['plano']);
    expect(poFormsForOrder({ has_design: false, items: [{ product: 'Kertas Supreme 64 gsm', has_design: false }] })).toEqual(['plano']);
  });

  it('facts that disagree: both, cetak first', () => {
    expect(poFormsForOrder({ items: [{ product: 'Box Ivory', has_design: true }, { product: 'Kertas Supreme', has_design: false }] })).toEqual(['cetak', 'plano']);
    expect(poFormsForOrder({ has_design: false, items: [{ product: 'Box Ivory', has_design: true }] })).toEqual(['cetak', 'plano']);
  });

  it('no design fact known: both', () => {
    expect(poFormsForOrder({})).toEqual(['cetak', 'plano']);
    expect(poFormsForOrder({ name: 'Contoh Budi', items: [{ product: 'Box Ivory', size: '22x22x7', qty: 100 }] })).toEqual(['cetak', 'plano']);
    // Anything that is not a boolean is not a fact; a malformed items value is no items.
    expect(poFormsForOrder({ has_design: 'ya', items: [{ product: 'Box', has_design: 'sudah' }, 'x', null] })).toEqual(['cetak', 'plano']);
    expect(poFormsForOrder({ items: 'Box Ivory' })).toEqual(['cetak', 'plano']);
  });

  it('PO_FORM_KINDS is cetak then plano', () => expect(PO_FORM_KINDS).toEqual(['cetak', 'plano']));
});

describe('poFormsMessage', () => {
  const URLS = { cetak: 'https://forms.gle/ContohCetak', plano: 'https://forms.gle/ContohPlano' };

  it('one form: the single-form line, unchanged', () => {
    expect(poFormsMessage(['cetak'], URLS)).toBe(poFormMessage(URLS.cetak));
    expect(poFormsMessage(['plano'], URLS)).toBe(poFormMessage(URLS.plano));
    expect(poFormMessage(URLS.cetak)).toBe('Untuk pemesanannya, silakan isi form PO berikut ya kak 🙏\nhttps://forms.gle/ContohCetak');
  });

  it('both forms: one message, each link under its label, cetak first', () => {
    expect(PO_FORM_LABELS).toEqual({
      cetak: 'Form order cetak (bila sudah ada desain/logo)',
      plano: 'Form order plano (bila belum ada desain)',
    });
    expect(poFormsMessage(['cetak', 'plano'], URLS)).toBe(
      'Untuk pemesanannya, silakan isi form PO yang sesuai ya kak 🙏\n\n' +
      'Form order cetak (bila sudah ada desain/logo):\nhttps://forms.gle/ContohCetak\n\n' +
      'Form order plano (bila belum ada desain):\nhttps://forms.gle/ContohPlano'
    );
    // The order asked for does not change the order sent.
    expect(poFormsMessage(['plano', 'cetak'], URLS)).toBe(poFormsMessage(['cetak', 'plano'], URLS));
  });
});
