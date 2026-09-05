import Parser from 'rss-parser';
import { canonicalizeUrl, cleanHtml } from './cleaner';
import { generateContentHash, computeSimHash } from './dedup';

export interface ParsedFeedItem {
  canonicalUrl: string;
  title: string;
  authors: string[];
  rawContent: string;
  cleanText: string;
  summaryExcerpt: string;
  publishedAt: Date;
  contentHash: string;
  simhashFingerprint: bigint;
  imageUrl?: string | null;
}

export class RssFeedAdapter {
  private parser: Parser;

  constructor(timeoutMs = 15000) {
    this.parser = new Parser({
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'NAKSHATRA-AI-News-Bot/1.0 (+https://nakshatra.ai/bot)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
    });
  }

  async parseUrl(feedUrl: string): Promise<ParsedFeedItem[]> {
    try {
      const feed = await this.parser.parseURL(feedUrl);
      return this.transformFeedItems(feed.items);
    } catch (err: any) {
      throw new Error(`Failed to parse RSS feed from ${feedUrl}: ${err?.message || err}`);
    }
  }

  async parseString(xmlContent: string): Promise<ParsedFeedItem[]> {
    try {
      const feed = await this.parser.parseString(xmlContent);
      return this.transformFeedItems(feed.items);
    } catch (err: any) {
      throw new Error(`Failed to parse RSS XML string: ${err?.message || err}`);
    }
  }

  private transformFeedItems(items: Parser.Item[]): ParsedFeedItem[] {
    const results: ParsedFeedItem[] = [];

    for (const item of items) {
      const link = item.link || item.guid;
      if (!link) continue;

      const canonicalUrl = canonicalizeUrl(link);
      const title = (item.title || 'Untitled Update').trim();
      const itemAny = item as Record<string, any>;
      const rawHtml = itemAny['content:encoded'] || item.content || item.summary || '';
      const { cleanText, excerpt } = cleanHtml(rawHtml);

      // Fallback clean text if raw content was minimal
      const finalCleanText = cleanText.length > 0 ? cleanText : title;
      const contentHash = generateContentHash(finalCleanText);
      const simhashFingerprint = computeSimHash(finalCleanText);

      const authors: string[] = [];
      if (item.creator) authors.push(item.creator);
      if (itemAny.author) authors.push(itemAny.author);

      let publishedAt = new Date();
      if (item.pubDate) {
        const parsed = new Date(item.pubDate);
        if (!isNaN(parsed.getTime())) {
          publishedAt = parsed;
        }
      }

      // Extract thumbnail from enclosure, media tags, or HTML content
      let imageUrl: string | null = null;
      if (item.enclosure?.url && typeof item.enclosure.url === 'string') {
        const u = item.enclosure.url.trim();
        if (u.startsWith('https://')) {
          imageUrl = u;
        }
      }

      if (!imageUrl && itemAny['media:content']) {
        const mc = itemAny['media:content'];
        const mUrl = mc?.$?.url || mc?.url || (Array.isArray(mc) ? mc[0]?.$?.url || mc[0]?.url : null);
        if (typeof mUrl === 'string' && mUrl.trim().startsWith('https://')) {
          imageUrl = mUrl.trim();
        }
      }

      if (!imageUrl && itemAny['media:thumbnail']) {
        const mt = itemAny['media:thumbnail'];
        const tUrl = mt?.$?.url || mt?.url || (Array.isArray(mt) ? mt[0]?.$?.url || mt[0]?.url : null);
        if (typeof tUrl === 'string' && tUrl.trim().startsWith('https://')) {
          imageUrl = tUrl.trim();
        }
      }

      if (!imageUrl && rawHtml) {
        const ogMatch =
          rawHtml.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["'](https:\/\/[^"']+)["']/i) ||
          rawHtml.match(/<meta[^>]+content=["'](https:\/\/[^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
        if (ogMatch && ogMatch[1]) {
          imageUrl = ogMatch[1].trim();
        } else {
          const imgMatch = rawHtml.match(/<img[^>]+src=["'](https:\/\/[^"']+)["']/i);
          if (imgMatch && imgMatch[1]) {
            const candidate = imgMatch[1].trim();
            if (
              !candidate.includes('pixel') &&
              !candidate.includes('tracking') &&
              !candidate.includes('spacer') &&
              candidate.startsWith('https://')
            ) {
              imageUrl = candidate;
            }
          }
        }
      }

      results.push({
        canonicalUrl,
        title,
        authors,
        rawContent: rawHtml,
        cleanText: finalCleanText,
        summaryExcerpt: excerpt,
        publishedAt,
        contentHash,
        simhashFingerprint,
        imageUrl,
      });
    }

    return results;
  }
}
