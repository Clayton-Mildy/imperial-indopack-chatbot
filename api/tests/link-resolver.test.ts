/**
 * link-resolver.test.ts
 * The pure extraction half of resolve_link. The network half is exercised by the QA harness
 * (TC-64, a real maps.app.goo.gl store link); these pin the parsing that failure exposed —
 * a Google Maps page is empty to a text fetcher, so the place name must come from the final
 * URL's /maps/place/ segment. Pure — no DATABASE_URL, no network.
 */

import { describe, it, expect } from 'vitest';
import { mapsPlaceNameFromUrl, titleFromHtml, descriptionFromHtml } from '../src/services/linkResolver.js';

describe('mapsPlaceNameFromUrl', () => {
  it('reads the place name from a resolved maps URL (the live JAYAMOTOR case)', () => {
    const url =
      'https://www.google.com/maps/place/Bengkel+JAYAMOTOR+(Honda,+Yamaha,+Suzuki,+Kawasaki)/@-6.2367633,106.6253828,1281m/data=!3m2!1e3!4b1';
    expect(mapsPlaceNameFromUrl(url)).toBe('Bengkel JAYAMOTOR (Honda, Yamaha, Suzuki, Kawasaki)');
  });

  it('decodes URI-encoded segments', () => {
    expect(mapsPlaceNameFromUrl('https://www.google.com/maps/place/Toko%20Sinar%20Jaya/@-7.1,110.4,17z'))
      .toBe('Toko Sinar Jaya');
  });

  it('returns null for URLs without a place segment', () => {
    expect(mapsPlaceNameFromUrl('https://maps.app.goo.gl/74ZwwViLubi81o8G7')).toBeNull();
    expect(mapsPlaceNameFromUrl('https://tokopedia.com/sinarjaya')).toBeNull();
  });
});

describe('titleFromHtml', () => {
  it('prefers og:title over <title>', () => {
    const html = '<head><title>Tokopedia</title><meta property="og:title" content="Sinar Jaya Bangunan | Tokopedia"/></head>';
    expect(titleFromHtml(html)).toBe('Sinar Jaya Bangunan | Tokopedia');
  });

  it('falls back to <title>, and handles attribute order both ways', () => {
    expect(titleFromHtml('<title>Charles Hardware Surabaya</title>')).toBe('Charles Hardware Surabaya');
    const reversed = '<meta content="Toko ABC" property="og:title">';
    expect(titleFromHtml(reversed)).toBe('Toko ABC');
  });

  it('returns null when nothing is there', () => {
    expect(titleFromHtml('<html><body>loading...</body></html>')).toBeNull();
  });
});

describe('descriptionFromHtml', () => {
  it('reads og:description', () => {
    const html = '<meta property="og:description" content="Jl. Mayjend Sungkono 41, Surabaya"/>';
    expect(descriptionFromHtml(html)).toBe('Jl. Mayjend Sungkono 41, Surabaya');
  });
});
