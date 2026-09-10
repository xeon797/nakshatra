import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { RssFeedAdapter, ParsedFeedItem } from './rss-adapter';
import { isNearDuplicate } from './dedup';
import { eq, desc, or, inArray } from 'drizzle-orm';

export const DEFAULT_RECENT_FEED_WINDOW = 50;
export const DEFAULT_OVERLAP_WINDOW_HOURS = 72;

export interface IngestSourceOptions {
  xmlOverride?: string;
  recentWindowLimit?: number;
  overlapHours?: number;
}

export interface IngestionResult {
  sourceId: string;
  sourceName: string;
  totalFetched: number;
  candidatesInspected: number;
  insertedCount: number;
  exactDuplicatesSkipped: number;
  nearDuplicatesSkipped: number;
  historicalSkipped: number;
  errors: string[];
}

export class IngestionService {
  private rssAdapter: RssFeedAdapter;

  constructor(rssAdapter?: RssFeedAdapter) {
    this.rssAdapter = rssAdapter || new RssFeedAdapter();
  }

  /**
   * Ingests news items for a single source definition using safe incremental windowing
   * and batch deduplication checks.
   */
  async ingestSource(
    source: typeof schema.sources.$inferSelect,
    optionsOrXml?: string | IngestSourceOptions
  ): Promise<IngestionResult> {
    const db = await getDb();
    const xmlOverride = typeof optionsOrXml === 'string' ? optionsOrXml : optionsOrXml?.xmlOverride;
    const windowLimit = typeof optionsOrXml === 'object' ? (optionsOrXml.recentWindowLimit ?? DEFAULT_RECENT_FEED_WINDOW) : DEFAULT_RECENT_FEED_WINDOW;
    const overlapHours = typeof optionsOrXml === 'object' ? (optionsOrXml.overlapHours ?? DEFAULT_OVERLAP_WINDOW_HOURS) : DEFAULT_OVERLAP_WINDOW_HOURS;

    const result: IngestionResult = {
      sourceId: source.id,
      sourceName: source.name,
      totalFetched: 0,
      candidatesInspected: 0,
      insertedCount: 0,
      exactDuplicatesSkipped: 0,
      nearDuplicatesSkipped: 0,
      historicalSkipped: 0,
      errors: [],
    };

    let items: ParsedFeedItem[] = [];
    try {
      if (xmlOverride) {
        items = await this.rssAdapter.parseString(xmlOverride);
      } else {
        items = await this.rssAdapter.parseUrl(source.baseUrl);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push(errMsg);
      console.warn(`[Ingestion] Failed polling source "${source.name}" (${source.baseUrl}): ${errMsg}`);

      // Record visible failure status on source record so broken feeds never silently appear healthy
      try {
        const rules = (source.scrapeRulesJson as Record<string, unknown>) || {};
        const consecutiveFailures = (typeof rules.consecutiveFailures === 'number' ? rules.consecutiveFailures : 0) + 1;
        await db
          .update(schema.sources)
          .set({
            lastPolledAt: new Date(),
            updatedAt: new Date(),
            scrapeRulesJson: {
              ...rules,
              healthStatus: 'failing',
              lastError: errMsg,
              lastErrorAt: new Date().toISOString(),
              consecutiveFailures,
            },
          })
          .where(eq(schema.sources.id, source.id));
      } catch (dbErr) {
        console.error(`[Ingestion] Failed to update failure status for source ${source.id}:`, dbErr);
      }

      return result;
    }

    result.totalFetched = items.length;

    // ─────────────────────────────────────────────────────────────────────────
    // Safe Incremental Partitioning:
    // 1. In RSS/Atom feeds, newest updates are placed at the beginning of the feed.
    // 2. We inspect a generous recent window (default 50 items) to guarantee that even high-volume
    //    or delayed feeds (e.g. arXiv cs.AI with 1,180 historical items) do not exhaust DB queries.
    // 3. To avoid naive timestamp-only filtering (which can miss delayed, out-of-order, or timezone-skewed entries),
    //    we ALWAYS include:
    //    a) All items within the top windowLimit (first 50 items) regardless of timestamp.
    //    b) Any items beyond the window whose publishedAt falls within the generous overlap window (last 72h).
    // 4. Deep historical items beyond the window from weeks or years ago are safely skipped.
    // ─────────────────────────────────────────────────────────────────────────
    const now = Date.now();
    const overlapCutoffMs = now - overlapHours * 60 * 60 * 1000;

    const candidateItems: ParsedFeedItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (i < windowLimit) {
        candidateItems.push(item);
      } else if (item.publishedAt && item.publishedAt.getTime() >= overlapCutoffMs) {
        // Include recent overlap items even if ordered further down in feed
        candidateItems.push(item);
      } else {
        result.historicalSkipped++;
      }
    }

    result.candidatesInspected = candidateItems.length;

    if (candidateItems.length === 0) {
      const rules = (source.scrapeRulesJson as Record<string, unknown>) || {};
      await db
        .update(schema.sources)
        .set({
          lastPolledAt: new Date(),
          updatedAt: new Date(),
          scrapeRulesJson: {
            ...rules,
            healthStatus: 'healthy',
            lastSuccessAt: new Date().toISOString(),
            lastError: null,
            consecutiveFailures: 0,
            lastItemsDiscovered: items.length,
            lastItemsInserted: 0,
          },
        })
        .where(eq(schema.sources.id, source.id));
      return result;
    }

    // Fetch recent raw articles to check near-duplicate SimHash (O(100) items)
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

    // ─────────────────────────────────────────────────────────────────────────
    // High-Efficiency Batch Deduplication:
    // Query existing canonical URLs and content hashes for the candidate set in ONE roundtrip
    // instead of N sequential SQL queries.
    // ─────────────────────────────────────────────────────────────────────────
    const candidateUrls = candidateItems.map((c) => c.canonicalUrl).filter(Boolean);
    const candidateHashes = candidateItems.map((c) => c.contentHash).filter(Boolean);

    const existingInDb =
      candidateUrls.length > 0 || candidateHashes.length > 0
        ? await db
            .select({
              canonicalUrl: schema.rawArticles.canonicalUrl,
              contentHash: schema.rawArticles.contentHash,
            })
            .from(schema.rawArticles)
            .where(
              or(
                inArray(schema.rawArticles.canonicalUrl, candidateUrls),
                inArray(schema.rawArticles.contentHash, candidateHashes)
              )
            )
        : [];

    const knownUrls = new Set<string>(existingInDb.map((e) => e.canonicalUrl));
    const knownHashes = new Set<string>(existingInDb.map((e) => e.contentHash));

    for (const item of candidateItems) {
      // 1. Exact Deduplication Check (URL or SHA-256 Hash across batch set)
      if (knownUrls.has(item.canonicalUrl) || knownHashes.has(item.contentHash)) {
        result.exactDuplicatesSkipped++;
        continue;
      }

      // Check within recentArticles in-memory cache as well
      const exactInBatch = recentArticles.find(
        (r) => r.canonicalUrl === item.canonicalUrl || r.contentHash === item.contentHash
      );
      if (exactInBatch) {
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
            imageUrl: item.imageUrl || null,
          })
          .returning();

        result.insertedCount++;
        // Track inserted item for subsequent checks in this batch
        knownUrls.add(inserted.canonicalUrl);
        knownHashes.add(inserted.contentHash);
        recentArticles.unshift({
          id: inserted.id,
          contentHash: inserted.contentHash,
          canonicalUrl: inserted.canonicalUrl,
          simhashFingerprint: inserted.simhashFingerprint,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string })?.code;
        // Handle race conditions or unique constraint violations gracefully
        if (message.includes('unique') || code === '23505') {
          result.exactDuplicatesSkipped++;
        } else {
          result.errors.push(`Failed to insert article ${item.canonicalUrl}: ${message}`);
        }
      }
    }

    // Update source's last_polled_at timestamp and record health status
    const rules = (source.scrapeRulesJson as Record<string, unknown>) || {};
    await db
      .update(schema.sources)
      .set({
        lastPolledAt: new Date(),
        updatedAt: new Date(),
        scrapeRulesJson: {
          ...rules,
          healthStatus: 'healthy',
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          consecutiveFailures: 0,
          lastItemsDiscovered: items.length,
          lastItemsInserted: result.insertedCount,
        },
      })
      .where(eq(schema.sources.id, source.id));

    return result;
  }
}
