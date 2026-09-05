/**
 * External Research Service
 * Integrates Jina Reader (for clean markdown web page extraction)
 * and Tavily Search API (for secondary source fact checking and claim corroboration).
 */

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface JinaReaderOptions {
  apiKey?: string;
  timeoutMs?: number;
  fallbackText?: string;
  fetchFn?: typeof fetch;
}

export interface TavilySearchOptions {
  apiKey?: string;
  timeoutMs?: number;
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeDomains?: string[];
  fetchFn?: typeof fetch;
}

const HIGH_SIGNAL_TECH_DOMAINS = [
  'techcrunch.com',
  'reuters.com',
  'theverge.com',
  'arstechnica.com',
  'arxiv.org',
];

/**
 * Strips script tags, style tags, tracking params, and navigation junk from extracted markdown.
 */
export function cleanExtractedMarkdown(rawMarkdown: string): string {
  if (!rawMarkdown) return '';

  let cleaned = rawMarkdown
    // Remove raw scripts and styles
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Strip tracking URL parameters (utm_*, ref, etc.)
    .replace(/(\?|&)(utm_[a-z0-9_]+|ref|ref_src|source)=[^)&"\s]+/gi, '')
    // Strip common navigation / cookie boilerplate lines
    .replace(/^\s*\[?(?:Skip to (?:main )?content|Navigation|Menu|Cookie (?:Preferences|Settings|Policy))\]?.*$/gim, '')
    // Normalize excessive blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned;
}

/**
 * Extracts an OpenGraph or Twitter Card image URL from HTML content.
 * Validates that the URL begins with https://.
 */
export function extractOpenGraphImageFromHtml(html: string): string | null {
  if (!html) return null;

  // 1. Check meta[property="og:image"]
  const ogMatch =
    html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["'](https:\/\/[^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["'](https:\/\/[^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);

  if (ogMatch && ogMatch[1]) {
    const url = ogMatch[1].trim();
    if (url.startsWith('https://')) {
      return url;
    }
  }

  // 2. Check for standard <img> tags with absolute https URL
  const imgMatch = html.match(/<img[^>]+src=["'](https:\/\/[^"']+)["']/i);
  if (imgMatch && imgMatch[1]) {
    const url = imgMatch[1].trim();
    if (
      url.startsWith('https://') &&
      !url.includes('tracking') &&
      !url.includes('pixel') &&
      !url.includes('spacer')
    ) {
      return url;
    }
  }

  return null;
}

/**
 * Fetches page HTML and extracts OpenGraph image (og:image or twitter:image).
 */
export async function fetchOpenGraphImage(
  url: string,
  fetchFn: typeof fetch = fetch
): Promise<string | null> {
  if (!url || !url.startsWith('https://')) return null;

  const isTest = process.env.NODE_ENV === 'test' && !process.env.TEST_LIVE_EXTERNAL;
  if (isTest && fetchFn === fetch) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'NAKSHATRA-OpenGraph-Bot/1.0 (+https://nakshatra.ai)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const html = await res.text();
    return extractOpenGraphImageFromHtml(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracts clean, full-text markdown from a URL using Jina Reader (https://r.jina.ai/).
 * Gracefully falls back to fallbackText on timeout, network error, or HTTP error.
 */
export async function extractCleanMarkdown(
  url: string,
  fallbackText: string = '',
  options?: JinaReaderOptions
): Promise<string> {
  if (!url || !url.startsWith('http')) {
    return fallbackText;
  }

  // Prevent unexpected live network delays in offline unit test runners
  const isTest = process.env.NODE_ENV === 'test' && !process.env.TEST_LIVE_EXTERNAL;
  if (isTest && !options?.fetchFn && !options?.apiKey) {
    return fallbackText;
  }

  const apiKey = options?.apiKey || process.env.JINA_API_KEY;
  const timeoutMs = options?.timeoutMs ?? 8000;
  const fetcher = options?.fetchFn || fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const targetUrl = `https://r.jina.ai/${encodeURI(url)}`;
    const headers: Record<string, string> = {
      'X-Return-Format': 'markdown',
      'Accept': 'text/plain, text/markdown',
    };

    if (apiKey && apiKey.trim().length > 0 && !apiKey.includes('placeholder')) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }

    const response = await fetcher(targetUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      return fallbackText;
    }

    const rawText = await response.text();
    const cleaned = cleanExtractedMarkdown(rawText);

    return cleaned.length > 50 ? cleaned : (fallbackText || cleaned);
  } catch {
    // Network failure, timeout, or abort -> return fallback cleanly
    return fallbackText;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Searches secondary sources using Tavily Search REST API (https://api.tavily.com/search).
 * Returns typed results, prioritizing high-signal tech outlets.
 * Returns empty array on rate-limit, absent key, or network failure.
 */
export async function searchSecondarySources(
  query: string,
  options?: TavilySearchOptions
): Promise<TavilySearchResult[]> {
  // Prevent unexpected live network delays in offline unit test runners
  const isTest = process.env.NODE_ENV === 'test' && !process.env.TEST_LIVE_EXTERNAL;
  if (isTest && !options?.fetchFn && !options?.apiKey) {
    return [];
  }

  const apiKey = options?.apiKey || process.env.TAVILY_API_KEY;
  if (!apiKey || apiKey.trim().length === 0 || apiKey.includes('placeholder')) {
    return [];
  }

  const sanitizedQuery = (query || '').trim().slice(0, 400);
  if (sanitizedQuery.length === 0) {
    return [];
  }

  const timeoutMs = options?.timeoutMs ?? 8000;
  const fetcher = options?.fetchFn || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = {
      api_key: apiKey.trim(),
      query: sanitizedQuery,
      search_depth: options?.searchDepth || 'basic',
      max_results: options?.maxResults ?? 3,
      include_domains: options?.includeDomains || HIGH_SIGNAL_TECH_DOMAINS,
    };

    const response = await fetcher('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return [];
    }

    const data: any = await response.json();
    const rawResults = Array.isArray(data?.results) ? data.results : [];

    return rawResults.map((item: any) => ({
      title: String(item.title || '').trim(),
      url: String(item.url || '').trim(),
      content: cleanExtractedMarkdown(String(item.content || '').trim()),
      score: typeof item.score === 'number' ? item.score : 0,
    }));
  } catch {
    // Network error, abort, or JSON parse error -> return safe empty array
    return [];
  } finally {
    clearTimeout(timer);
  }
}
