import { describe, it, expect } from 'vitest';
import { inboundPayload, settled, PRICE_RE } from '../scripts/qa/lib.js';

describe('QA harness lib', () => {
  it('builds a Meta text payload the webhook maps', () => {
    const b = inboundPayload({ from: '6281200007001', id: 'wamid.qa1', phoneNumberId: 'local-phone-70', text: 'halo', at: new Date(1_800_000_000_000) }) as any;
    expect(b.entry[0].changes[0].value).toMatchObject({
      metadata: { phone_number_id: 'local-phone-70' },
      messages: [{ from: '6281200007001', id: 'wamid.qa1', type: 'text', text: { body: 'halo' }, timestamp: '1800000000' }],
    });
  });
  it('an image payload carries the media id and caption', () => {
    const b = inboundPayload({ from: '6281200007001', id: 'wamid.qa2', phoneNumberId: 'local-phone-70', image: { mediaId: 'logo.png', caption: 'ini logonya' } }) as any;
    expect(b.entry[0].changes[0].value.messages[0]).toMatchObject({ type: 'image', image: { id: 'logo.png', mime_type: 'image/png', caption: 'ini logonya' } });
  });
  it('a referral rides on the message', () => {
    const b = inboundPayload({ from: '6281200007001', id: 'wamid.qa3', phoneNumberId: 'local-phone-70', text: 'halo', referral: { headline: 'Iklan' } }) as any;
    expect(b.entry[0].changes[0].value.messages[0].referral).toMatchObject({ source_type: 'ad', headline: 'Iklan' });
  });
  it('settles only after a text and a quiet period', () => {
    const T = { at: '2026-11-18T03:00:00Z', kind: 'text' }, D = { at: '2026-11-18T03:00:00Z', kind: 'document' };
    expect(settled([T], Date.parse('2026-11-18T03:00:07Z'), 8000)).toBe(false);
    expect(settled([T], Date.parse('2026-11-18T03:00:09Z'), 8000)).toBe(true);
    expect(settled([D], Date.parse('2026-11-18T03:01:00Z'), 8000)).toBe(false);
    expect(settled([], 0, 8000)).toBe(false);
  });
  it('PRICE_RE finds rupiah figures only', () => {
    expect(PRICE_RE.test('Rp 165.000/rim')).toBe(true);
    expect(PRICE_RE.test('minimal 5 rim')).toBe(false);
  });
});
