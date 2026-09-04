import { describe, it, expect, beforeAll } from 'vitest';
import { canonicalizeUrl, cleanHtml } from '../cleaner';
import { generateContentHash, computeSimHash, hammingDistance, isNearDuplicate } from '../dedup';
import { RssFeedAdapter } from '../rss-adapter';
import { IngestionService } from '../ingest-service';
import { getDb, resetDbForTesting } from '../../../db';
import { initializeDatabase } from '../../../db/init';
import * as schema from '../../../db/schema';
import { eq } from 'drizzle-orm';

describe('Feature 2: Ingestion & Deduplication Pipeline', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  describe('URL Canonicalizer', () => {
    it('strips tracking UTM parameters and anchor fragments', () => {
      const raw = 'https://news.google.com/article?utm_source=twitter&utm_medium=social&utm_campaign=launch#comments';
      const clean = canonicalizeUrl(raw);
      expect(clean).toBe('https://news.google.com/article');
    });

    it('preserves valid query parameters while removing trackers', () => {
      const raw = 'https://arxiv.org/abs/2403.12345?query=transformer&ref=ai-digest';
      const clean = canonicalizeUrl(raw);
      expect(clean).toBe('https://arxiv.org/abs/2403.12345?query=transformer');
    });
  });

  describe('HTML Cleaner & Normalizer', () => {
    it('removes scripts, ads, and preserves paragraph breaks', () => {
      const dirtyHtml = `
        <article>
          <h1>DeepSeek Releases V3</h1>
          <script>console.log('tracker');</script>
          <p>DeepSeek has announced the open weights release of DeepSeek-V3.</p>
          <div class="ads">Buy sponsor goods</div>
          <p>The model contains 671B total parameters with 37B activated per token.</p>
        </article>
      `;
      const { cleanText, excerpt } = cleanHtml(dirtyHtml);
      expect(cleanText).toContain('DeepSeek Releases V3');
      expect(cleanText).toContain('DeepSeek has announced the open weights release');
      expect(cleanText).not.toContain('console.log');
      expect(cleanText).not.toContain('Buy sponsor goods');
      expect(excerpt.length).toBeGreaterThan(20);
    });
  });

  describe('Deduplication & SimHash Algorithms', () => {
    it('generates identical SHA-256 hash for identical normalized texts', () => {
      const text1 = 'Google DeepMind announced Gemini 2.5 Pro with breakthrough coding capabilities.';
      const text2 = '   Google DeepMind   announced Gemini 2.5 Pro with breakthrough coding capabilities.  \n';
      expect(generateContentHash(text1)).toBe(generateContentHash(text2));
    });

    it('detects near-duplicates with low Hamming distance on syndication edits', () => {
      const original = `
        OpenAI has officially launched its newest flagship reasoning model, designated GPT-4.5.
        The model brings substantial improvements in mathematical reasoning, creative writing, and autonomous code generation.
        Starting today, developers can access the model via the standard chat completions API with tier-based rate limits.
      `;
      const syndicatedCopy = `
        OpenAI has officially launched its newest flagship reasoning model, named GPT-4.5.
        The model brings substantial improvements in mathematical reasoning, creative writing, and autonomous code generation.
        Starting today, developers can access the model via the standard API endpoints with tier-based rate limits.
      `;

      const hash1 = computeSimHash(original);
      const hash2 = computeSimHash(syndicatedCopy);
      const distance = hammingDistance(hash1, hash2);

      expect(distance).toBeLessThanOrEqual(8);
      expect(isNearDuplicate(hash1, hash2, 8)).toBe(true);
    });

    it('distinguishes completely different stories with high Hamming distance', () => {
      const storyA = 'Anthropic published research on constitutional AI alignment, RLHF evaluation, and model safety steering.';
      const storyB = 'Nvidia reported quarterly earnings exceeding Wall Street revenue forecasts driven by record H100 GPU shipments.';

      const hashA = computeSimHash(storyA);
      const hashB = computeSimHash(storyB);
      const distance = hammingDistance(hashA, hashB);

      expect(distance).toBeGreaterThan(15);
      expect(isNearDuplicate(hashA, hashB, 8)).toBe(false);
    });
  });

  describe('RSS Ingestion Service End-to-End', () => {
    const mockRssXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <title>Google DeepMind Research</title>
          <link>https://deepmind.google/discover/blog/</link>
          <description>Artificial Intelligence Research</description>
          <item>
            <title>Gemini 2.5: Our Next Generation Multimodal Model</title>
            <link>https://deepmind.google/discover/blog/gemini-2-5/?utm_source=feed</link>
            <pubDate>Fri, 04 Sep 2026 12:00:00 GMT</pubDate>
            <content:encoded><![CDATA[<p>Today we introduce Gemini 2.5, delivering state-of-the-art multimodal reasoning.</p>]]></content:encoded>
          </item>
          <item>
            <title>AlphaFold 3 in Molecular Biology</title>
            <link>https://deepmind.google/discover/blog/alphafold-3/</link>
            <pubDate>Thu, 03 Sep 2026 10:00:00 GMT</pubDate>
            <content:encoded><![CDATA[<p>AlphaFold 3 predicts the structure and interactions of all life molecules.</p>]]></content:encoded>
          </item>
        </channel>
      </rss>`;

    it('ingests feed items, populates raw_articles, and updates source metadata', async () => {
      const db = await getDb();
      const [source] = await db
        .insert(schema.sources)
        .values({
          name: 'Google DeepMind Feed',
          baseUrl: 'https://deepmind.google/feed-test.xml',
          sourceType: 'rss',
          tier: 'tier_1_primary',
        })
        .returning();

      const ingestionService = new IngestionService();
      const result = await ingestionService.ingestSource(source, mockRssXml);

      expect(result.totalFetched).toBe(2);
      expect(result.insertedCount).toBe(2);
      expect(result.exactDuplicatesSkipped).toBe(0);

      // Verify records in DB
      const inserted = await db
        .select()
        .from(schema.rawArticles)
        .where(eq(schema.rawArticles.sourceId, source.id));

      expect(inserted.length).toBe(2);
      expect(inserted[0].canonicalUrl).not.toContain('utm_source');
      expect(inserted[0].contentHash).toBeDefined();

      // Second ingestion pass: should recognize all as exact duplicates
      const secondPass = await ingestionService.ingestSource(source, mockRssXml);
      expect(secondPass.insertedCount).toBe(0);
      expect(secondPass.exactDuplicatesSkipped).toBe(2);
    });
  });
});
