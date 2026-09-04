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
      const rawHtml = item['content:encoded'] || item.content || item.summary || '';
      const { cleanText, excerpt } = cleanHtml(rawHtml);

      // Fallback clean text if raw content was minimal
      const finalCleanText = cleanText.length > 0 ? cleanText : title;
      const contentHash = generateContentHash(finalCleanText);
      const simhashFingerprint = computeSimHash(finalCleanText);

      const authors: string[] = [];
      if (item.creator) authors.push(item.creator);
      if (item.author) authors.push(item.author);

      let publishedAt = new Date();
      if (item.pubDate) {
        const parsed = new Date(item.pubDate);
        if (!isNaN(parsed.getTime())) {
          publishedAt = parsed;
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
      });
    }

    return results;
  }
}
