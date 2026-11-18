const SEARCH_URL = 'https://www.previous-client.example/search?keyword=';
const TIMEOUT_MS = 5000;
const MAX_RESULTS = 5;

export interface SearchResult {
  name: string;
  description: string;
  url: string;
}

function parseArticles(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const re =
    /<a\s+href="(https:\/\/www\.legacy\.co\.id\/articles\/[^"]+)"[^>]*>[\s\S]*?<span\s+class="home-article-list-title">\s*([\s\S]*?)\s*<\/span>[\s\S]*?<span\s+class="home-article-desc">\s*([\s\S]*?)\s*<\/span>/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < 20) {
    results.push({
      url: m[1],
      name: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      description: m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200),
    });
  }
  return results;
}

function score(result: SearchResult, terms: string[]): number {
  const haystack = `${result.name} ${result.url} ${result.description}`.toLowerCase();
  return terms.reduce((n, t) => n + (haystack.includes(t) ? 1 : 0), 0);
}

export async function searchLegacyWebsite(query: string): Promise<SearchResult[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${SEARCH_URL}${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LegacySearchBot/1.0)' },
    });
    clearTimeout(timer);

    if (!res.ok) return [];

    const html = await res.text();
    const articles = parseArticles(html);
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

    return articles
      .map((r) => ({ r, s: score(r, terms) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_RESULTS)
      .map(({ r }) => r);
  } catch {
    return [];
  }
}
