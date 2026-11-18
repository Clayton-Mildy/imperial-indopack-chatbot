/**
 * linkResolver.ts
 * Opens a customer-sent link (store identity: Google Maps, marketplace, Instagram, website)
 * and returns what a human would see at a glance: the final URL and the page's name.
 *
 * This is a client-side tool we own, on purpose. Both hosted fetch options failed live:
 * Anthropic's server-side web_fetch stops at maps.app.goo.gl's cross-host 302 and expects a
 * second call the model rarely makes, and the Agent SDK's built-in WebFetch is not reachable
 * in the headless dev harness — the model fabricated a call and invented a place. A plain
 * Node fetch follows the redirect chain itself, so the model gets one call, one answer, on
 * both transports.
 *
 * Google Maps pages are JS-rendered and mostly empty to a text fetcher; the reliable datum is
 * the FINAL URL's /maps/place/<name> path segment. That extraction is pure and unit-tested.
 */

const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 200_000; // name/title live in <head>; never swallow a whole page

// Exported for tests — pure. "+" is a space in maps place paths; the segment is URI-encoded.
export function mapsPlaceNameFromUrl(url: string): string | null {
  const m = url.match(/\/maps\/place\/([^/@?]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() || null;
  } catch {
    return m[1].replace(/\+/g, ' ').trim() || null;
  }
}

// Exported for tests — pure. og:title first (sites put the real name there), <title> fallback.
export function titleFromHtml(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (og?.[1]) return og[1].trim();
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return title?.[1]?.trim() || null;
}

export function descriptionFromHtml(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  return og?.[1]?.trim() || null;
}

/**
 * The tool result, as a compact JSON string the model reads directly. Errors come back as
 * text, not throws: a dead link is an answer ("say so honestly, ask for the name"), never a
 * broken turn.
 */
export async function resolveLink(rawUrl: string): Promise<string> {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) return `Tautan tidak valid: ${rawUrl}`;

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // Some hosts (Google included) serve bots an empty shell; a browser UA gets the
        // normal head with its title/meta.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
      },
    });

    const finalUrl = res.url || url;
    const placeName = mapsPlaceNameFromUrl(finalUrl);
    const html = (await res.text()).slice(0, MAX_BODY_BYTES);

    const facts: Record<string, string> = { final_url: finalUrl };
    if (placeName) facts['nama_tempat'] = placeName;
    const title = titleFromHtml(html);
    if (title && title !== 'Google Maps') facts['judul_halaman'] = title;
    const desc = descriptionFromHtml(html);
    if (desc) facts['deskripsi'] = desc;

    if (!placeName && !title && !res.ok) {
      return `Tautan tidak bisa dibuka (HTTP ${res.status}).`;
    }
    return JSON.stringify(facts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Tautan tidak bisa dibuka: ${msg}`;
  }
}
