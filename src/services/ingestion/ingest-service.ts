import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { RssFeedAdapter, ParsedFeedItem } from './rss-adapter';
import { isNearDuplicate } from './dedup';
import { eq, desc, or } from 'drizzle-orm';

export interface IngestionResult {
  sourceId: string;
  sourceName: string;
  totalFetched: number;
  insertedCount: number;
  exactDuplicatesSkipped: number;
  nearDuplicatesSkipped: number;
  errors: string[];
}

export class IngestionService {
  private rssAdapter: RssFeedAdapter;

  constructor(rssAdapter?: RssFeedAdapter) {
    this.rssAdapter = rssAdapter || new RssFeedAdapter();
  }

  /**
   * Ingests news items for a single source definition
   */
  async ingestSource(source: typeof schema.sources.$inferSelect, xmlOverride?: string): Promise<IngestionResult> {
    const db = await getDb();
    const result: IngestionResult = {
      sourceId: source.id,
      sourceName: source.name,
      totalFetched: 0,
      insertedCount: 0,
      exactDuplicatesSkipped: 0,
      nearDuplicatesSkipped: 0,
      errors: [],
    };

    let items: ParsedFeedItem[] = [];
    try {
      if (xmlOverride) {
        items = await this.rssAdapter.parseString(xmlOverride);
      } else {
        items = await this.rssAdapter.parseUrl(source.baseUrl);
      }
    } catch (err: any) {
      result.errors.push(err.message || String(err));
      return result;
    }

    result.totalFetched = items.length;

    // Fetch recent raw articles to check near-duplicate SimHash
    const recentArticles = await db
      .select({
        id: schema.rawArticles.id,
        contentHash: schema.rawArticles.contentHash,
        canonicalUrl: schema.rawArticles.canonicalUrl,
        simhashFingerprint: schema.rawArticles.simhashFingerprint,
      })
      .from(schema.rawArticles)
      .orderBy(desc(schema.rawArticles.createdAt))
      .limit(100);

    for (const item of items) {
      // 1. Exact Deduplication Check (URL or SHA-256 Hash across entire database)
      const exactInBatch = recentArticles.find(
        (r) => r.canonicalUrl === item.canonicalUrl || r.contentHash === item.contentHash
      );
      if (exactInBatch) {
        result.exactDuplicatesSkipped++;
        continue;
      }

      const [exactMatchInDb] = await db
        .select({ id: schema.rawArticles.id })
        .from(schema.rawArticles)
        .where(
          or(
            eq(schema.rawArticles.canonicalUrl, item.canonicalUrl),
            eq(schema.rawArticles.contentHash, item.contentHash)
          )
        )
        .limit(1);

      if (exactMatchInDb) {
        result.exactDuplicatesSkipped++;
        continue;
      }

      // 2. Near-Duplicate SimHash Check
      let isNearDup = false;
      for (const recent of recentArticles) {
        if (recent.simhashFingerprint && item.simhashFingerprint) {
          const recentSimhash = BigInt(recent.simhashFingerprint);
          if (isNearDuplicate(recentSimhash, item.simhashFingerprint, 8)) {
            isNearDup = true;
            break;
          }
        }
      }

      if (isNearDup) {
        result.nearDuplicatesSkipped++;
        continue;
      }

      // 3. Persist novel raw article
      try {
        const [inserted] = await db
          .insert(schema.rawArticles)
          .values({
            sourceId: source.id,
            canonicalUrl: item.canonicalUrl,
            title: item.title,
            authors: item.authors,
            rawContent: item.rawContent,
            cleanText: item.cleanText,
            summaryExcerpt: item.summaryExcerpt,
            publishedAt: item.publishedAt,
            contentHash: item.contentHash,
            simhashFingerprint: item.simhashFingerprint.toString(),
            processingStatus: 'ingested',
          })
          .returning();

        result.insertedCount++;
        // Track inserted item for subsequent checks in this batch
        recentArticles.unshift({
          id: inserted.id,
          contentHash: inserted.contentHash,
          canonicalUrl: inserted.canonicalUrl,
          simhashFingerprint: inserted.simhashFingerprint,
        });
      } catch (err: any) {
        // Handle race conditions or unique constraint violations gracefully
        if (err.message?.includes('unique') || err.code === '23505') {
          result.exactDuplicatesSkipped++;
        } else {
          result.errors.push(`Failed to insert article ${item.canonicalUrl}: ${err.message}`);
        }
      }
    }

    // Update source's last_polled_at timestamp
    await db
      .update(schema.sources)
      .set({ lastPolledAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.sources.id, source.id));

    return result;
  }
}
