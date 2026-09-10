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

function extractMediaUrl(media: unknown): string | null {
  if (!media) return null;
  if (Array.isArray(media) && media.length > 0) {
    return extractMediaUrl(media[0]);
  }
  if (typeof media === 'object' && media !== null) {
    const obj = media as Record<string, unknown>;
    if (typeof obj.url === 'string' && obj.url.trim().startsWith('https://')) {
      return obj.url.trim();
    }
    if (obj.$ && typeof obj.$ === 'object' && obj.$ !== null) {
      const dollar = obj.$ as Record<string, unknown>;
      if (typeof dollar.url === 'string' && dollar.url.trim().startsWith('https://')) {
        return dollar.url.trim();
      }
    }
  }
  return null;
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse RSS feed from ${feedUrl}: ${message}`);
    }
  }

  async parseString(xmlContent: string): Promise<ParsedFeedItem[]> {
    try {
      const feed = await this.parser.parseString(xmlContent);
      return this.transformFeedItems(feed.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse RSS XML string: ${message}`);
    }
  }

  private transformFeedItems(items: Parser.Item[]): ParsedFeedItem[] {
    const results: ParsedFeedItem[] = [];

    for (const item of items) {
      const link = item.link || item.guid;
      if (!link) continue;

      const canonicalUrl = canonicalizeUrl(link);
      const title = (item.title || 'Untitled Update').trim();
      const itemRecord = item as Record<string, unknown>;
      const encodedContent = typeof itemRecord['content:encoded'] === 'string' ? itemRecord['content:encoded'] : '';
      const rawHtml = encodedContent || item.content || item.summary || '';
      const { cleanText, excerpt } = cleanHtml(rawHtml);

      // Fallback clean text if raw content was minimal
      const finalCleanText = cleanText.length > 0 ? cleanText : title;
      const contentHash = generateContentHash(finalCleanText);
      const simhashFingerprint = computeSimHash(finalCleanText);

      const authors: string[] = [];
      if (item.creator) authors.push(item.creator);
      if (typeof itemRecord.author === 'string') authors.push(itemRecord.author);

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

      if (!imageUrl && itemRecord['media:content']) {
        imageUrl = extractMediaUrl(itemRecord['media:content']);
      }

      if (!imageUrl && itemRecord['media:thumbnail']) {
        imageUrl = extractMediaUrl(itemRecord['media:thumbnail']);
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
