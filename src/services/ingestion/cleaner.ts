import * as cheerio from 'cheerio';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
  'source',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
]);

/**
 * Normalizes and strips marketing/tracking query parameters from URLs
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const keysToDelete: string[] = [];
    parsed.searchParams.forEach((_, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        keysToDelete.push(key);
      }
    });
    for (const key of keysToDelete) {
      parsed.searchParams.delete(key);
    }
    parsed.hash = '';
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Extracts clean, readable text from raw HTML content and strips clutter
 */
export function cleanHtml(rawHtml: string): { cleanText: string; excerpt: string } {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return { cleanText: '', excerpt: '' };
  }

  const $ = cheerio.load(rawHtml);

  // Strip boilerplate and non-content elements
  $('script, style, noscript, iframe, nav, footer, header, form, svg, aside, .ads, .social-share').remove();

  // Extract text with preserved paragraph breaks
  const textBlocks: string[] = [];
  $('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, article, section').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length > 0) {
      textBlocks.push(text);
    }
  });

  const cleanText = textBlocks.length > 0 
    ? textBlocks.join('\n\n') 
    : $.text().replace(/\s+/g, ' ').trim();

  const excerpt = cleanText.length > 300 
    ? cleanText.slice(0, 300).trim() + '...' 
    : cleanText;

  return { cleanText, excerpt };
}
