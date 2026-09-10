import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getDb, resetDbForTesting, closeDb } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import { IngestionService } from '../../services/ingestion/ingest-service';
import { RssFeedAdapter } from '../../services/ingestion/rss-adapter';
import {
  seedSources,
  HIGH_SIGNAL_AI_SOURCES,
  INVALID_OR_DEPRECATED_SOURCE_URLS,
} from '../db/seeds/sources';
import { HybridStoryClusteringAgent } from '../agents/clusterer';
import { AutonomousPhase2Worker } from '../worker';
import { classifyHeadlineCategory } from '../diagnostics/source-diagnostic';
import { MockAiProvider } from '../../services/ai/mock-provider';

describe('STEP 4: Source Catalog & Ingestion Pipeline Hardening', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  beforeEach(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  afterAll(async () => {
    await closeDb();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Broken Feeds Fail Visibly
  // ─────────────────────────────────────────────────────────────────────────
  it('broken feeds fail visibly and record failure status in database without crashing', async () => {
    const db = await getDb();
    const [brokenSource] = await db
      .insert(schema.sources)
      .values({
        name: 'Broken Mock Feed',
        baseUrl: 'https://broken.invalid/feed.xml',
        sourceType: 'rss',
        tier: 'tier_2_verified',
        reputationScore: '0.80',
        isActive: true,
        pollingFrequencyMinutes: 15,
        scrapeRulesJson: { consecutiveFailures: 0 },
      })
      .returning();

    // Mock adapter that throws on parse
    const mockAdapter = {
      parseUrl: async () => {
        throw new Error('HTTP 404 Not Found');
      },
      parseString: async () => {
        throw new Error('HTTP 404 Not Found');
      },
    } as unknown as RssFeedAdapter;

    const ingestionService = new IngestionService(mockAdapter);
    const result = await ingestionService.ingestSource(brokenSource);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('HTTP 404 Not Found');
    expect(result.insertedCount).toBe(0);

    // Verify source record in database has updated failure status and lastPolledAt
    const [updatedSource] = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, brokenSource.id));

    expect(updatedSource.lastPolledAt).not.toBeNull();
    const rules = updatedSource.scrapeRulesJson as Record<string, unknown>;
    expect(rules.healthStatus).toBe('failing');
    expect(rules.lastError).toContain('HTTP 404');
    expect(rules.consecutiveFailures).toBe(1);
    expect(rules.lastErrorAt).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Valid Feeds Update lastPolledAt and Health Status
  // ─────────────────────────────────────────────────────────────────────────
  it('valid feeds update lastPolledAt and mark healthStatus as healthy', async () => {
    const db = await getDb();
    const [validSource] = await db
      .insert(schema.sources)
      .values({
        name: 'Valid Mock Feed',
        baseUrl: 'https://valid.mock/feed.xml',
        sourceType: 'rss',
        tier: 'tier_1_primary',
        reputationScore: '1.00',
        isActive: true,
        pollingFrequencyMinutes: 15,
        scrapeRulesJson: { consecutiveFailures: 2, healthStatus: 'failing' },
      })
      .returning();

    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>Valid Mock News</title>
        <link>https://valid.mock</link>
        <item>
          <title>Frontier LLM Released with Native Tool Use</title>
          <link>https://valid.mock/news/frontier-release-2026</link>
          <description>Autonomous reasoning model with function calling and multi-step verification.</description>
          <pubDate>${new Date().toUTCString()}</pubDate>
        </item>
      </channel>
    </rss>`;

    const ingestionService = new IngestionService();
    const result = await ingestionService.ingestSource(validSource, { xmlOverride: sampleXml });

    expect(result.errors.length).toBe(0);
    expect(result.insertedCount).toBe(1);

    const [updatedSource] = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, validSource.id));

    expect(updatedSource.lastPolledAt).not.toBeNull();
    const rules = updatedSource.scrapeRulesJson as Record<string, unknown>;
    expect(rules.healthStatus).toBe('healthy');
    expect(rules.consecutiveFailures).toBe(0);
    expect(rules.lastSuccessAt).toBeDefined();
    expect(rules.lastError).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Successful Feeds Persist Raw Articles
  // ─────────────────────────────────────────────────────────────────────────
  it('successful feeds persist novel raw articles into database with full metadata', async () => {
    const db = await getDb();
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'OpenAI Test Source',
        baseUrl: 'https://openai.test/feed.xml',
        sourceType: 'rss',
        tier: 'tier_1_primary',
        reputationScore: '1.00',
        isActive: true,
      })
      .returning();

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>OpenAI Updates</title>
        <link>https://openai.test</link>
        <item>
          <title>OpenAI Announces Unified Multimodal System</title>
          <link>https://openai.test/index/unified-multimodal-2026</link>
          <description>Details of the architecture and benchmark results.</description>
          <pubDate>${new Date().toUTCString()}</pubDate>
        </item>
      </channel>
    </rss>`;

    const service = new IngestionService();
    const result = await service.ingestSource(source, { xmlOverride: xml });

    expect(result.insertedCount).toBe(1);

    const persisted = await db
      .select()
      .from(schema.rawArticles)
      .where(eq(schema.rawArticles.canonicalUrl, 'https://openai.test/index/unified-multimodal-2026'));

    expect(persisted.length).toBe(1);
    expect(persisted[0].title).toBe('OpenAI Announces Unified Multimodal System');
    expect(persisted[0].sourceId).toBe(source.id);
    expect(persisted[0].contentHash).toBeDefined();
    expect(persisted[0].simhashFingerprint).toBeDefined();
    expect(persisted[0].processingStatus).toBe('ingested');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Exact and Near Duplicates Are Not Repeatedly Inserted
  // ─────────────────────────────────────────────────────────────────────────
  it('deduplicates exact URLs and near-identical syndicated articles on subsequent polls', async () => {
    const db = await getDb();
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'Syndication Test Source',
        baseUrl: 'https://syndication.test/feed.xml',
        sourceType: 'rss',
        tier: 'tier_3_aggregator',
      })
      .returning();

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>Syndicated News</title>
        <link>https://syndication.test</link>
        <item>
          <title>NVIDIA Ships Blackwell GPUs for Gigawatt Clusters</title>
          <link>https://syndication.test/articles/nvidia-blackwell-gigawatt</link>
          <description>NVIDIA has begun shipping its Blackwell Ultra compute systems for massive hyperscaler datacenters.</description>
          <pubDate>${new Date().toUTCString()}</pubDate>
        </item>
      </channel>
    </rss>`;

    const service = new IngestionService();
    // First poll inserts
    const firstRun = await service.ingestSource(source, { xmlOverride: xml });
    expect(firstRun.insertedCount).toBe(1);

    // Second poll with identical feed skips duplicate
    const secondRun = await service.ingestSource(source, { xmlOverride: xml });
    expect(secondRun.insertedCount).toBe(0);
    expect(secondRun.exactDuplicatesSkipped).toBe(1);

    // Verify raw articles count in DB remains 1
    const allRaw = await db.select().from(schema.rawArticles);
    expect(allRaw.length).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Category Routing Works Across All 5 Public Categories
  // ─────────────────────────────────────────────────────────────────────────
  it('accurately classifies headlines and articles across all 5 public categories', () => {
    const testCases: {
      title: string;
      summary: string;
      sourceCat?: string;
      expected: 'llm_release' | 'agentic' | 'infra' | 'research' | 'policy';
    }[] = [
      {
        title: 'OpenAI Launches GPT-5 Frontier Architecture with Reasoning Chains',
        summary: 'Official launch and developer API availability for the flagship LLM.',
        sourceCat: 'llm_release',
        expected: 'llm_release',
      },
      {
        title: 'Autonomous Multi-Agent Workflow Framework Released for Developer Automation',
        summary: 'New agentic framework coordinates parallel subagents with MCP tool calling.',
        sourceCat: 'agentic',
        expected: 'agentic',
      },
      {
        title: 'NVIDIA Expands Blackwell NVL72 Datacenter Supercomputer Deployments',
        summary: 'Liquid-cooled AI clusters and semiconductor interconnect improvements.',
        sourceCat: 'infra',
        expected: 'infra',
      },
      {
        title: 'Evaluating Formal Proof Search and Mathematical Reasoning in Large Models',
        summary: 'arXiv preprint benchmarking theorem proving across Olympiad problem sets.',
        sourceCat: 'research',
        expected: 'research',
      },
      {
        title: 'European Commission Issues Binding Implementation Guidelines for the EU AI Act',
        summary: 'Regulatory obligations and safety audits mandated for frontier model developers.',
        sourceCat: 'policy',
        expected: 'policy',
      },
    ];

    for (const tc of testCases) {
      const category = classifyHeadlineCategory(tc.title, tc.summary, tc.sourceCat);
      expect(category).toBe(tc.expected);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Ingestion Windows Do Not Incorrectly Discard Valid Recent Stories
  // ─────────────────────────────────────────────────────────────────────────
  it('accepts stories published within 72 hours while skipping deep historical entries', async () => {
    const db = await getDb();
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'Window Test Source',
        baseUrl: 'https://window.test/feed.xml',
        sourceType: 'rss',
        tier: 'tier_2_verified',
      })
      .returning();

    const now = Date.now();
    const date48hAgo = new Date(now - 48 * 60 * 60 * 1000).toUTCString();
    const date30dAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toUTCString();

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>Window Test</title>
        <link>https://window.test</link>
        <item>
          <title>Weekend Breakthrough (48h ago)</title>
          <link>https://window.test/item-recent-weekend</link>
          <description>Valid recent story published over the weekend.</description>
          <pubDate>${date48hAgo}</pubDate>
        </item>
        <item>
          <title>Ancient Archive Item (30 days ago)</title>
          <link>https://window.test/item-historical-archive</link>
          <description>Old story from last month.</description>
          <pubDate>${date30dAgo}</pubDate>
        </item>
      </channel>
    </rss>`;

    const service = new IngestionService();
    // Test with recentWindowLimit = 1 to verify that item 2 (index 1) is evaluated by overlap cutoff
    const result = await service.ingestSource(source, {
      xmlOverride: xml,
      recentWindowLimit: 1,
      overlapHours: 72,
    });

    // Item 1 (48h ago) is accepted because it's within top window or within 72h
    expect(result.insertedCount).toBe(1);
    expect(result.historicalSkipped).toBe(1);

    // Verify clusterer fetchUnclusteredArticles(72) retrieves the recent raw article
    const clusterer = new HybridStoryClusteringAgent();
    const unclustered = await clusterer.fetchUnclusteredArticles(72);
    expect(unclustered.some((u) => u.title.includes('Weekend Breakthrough'))).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Seed Sources Catalog Cleans Up Invalid Feeds & Syncs High-Signal Catalog
  // ─────────────────────────────────────────────────────────────────────────
  it('syncs all 21 high-signal feeds and deactivates known broken/duplicate endpoints', async () => {
    const db = await getDb();

    // Insert known invalid entries first
    for (const badUrl of INVALID_OR_DEPRECATED_SOURCE_URLS) {
      await db.insert(schema.sources).values({
        name: 'Legacy Invalid Source',
        baseUrl: badUrl,
        sourceType: 'rss',
        isActive: true,
      });
    }

    const syncResult = await seedSources();

    expect(syncResult.deactivated).toBeGreaterThanOrEqual(INVALID_OR_DEPRECATED_SOURCE_URLS.length);
    expect(syncResult.totalActive).toBe(HIGH_SIGNAL_AI_SOURCES.length);

    // Verify that DeepSeek GitHub repo and Anthropic 404 feeds are deactivated
    for (const badUrl of INVALID_OR_DEPRECATED_SOURCE_URLS) {
      const [record] = await db
        .select()
        .from(schema.sources)
        .where(eq(schema.sources.baseUrl, badUrl));
      expect(record.isActive).toBe(false);
    }

    // Verify active sources include all 5 category tags in scrapeRulesJson
    const activeSources = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.isActive, true));

    const categoriesFound = new Set(
      activeSources.map((s) => (s.scrapeRulesJson as Record<string, string>)?.primaryCategory)
    );

    expect(categoriesFound.has('llm_release')).toBe(true);
    expect(categoriesFound.has('agentic')).toBe(true);
    expect(categoriesFound.has('infra')).toBe(true);
    expect(categoriesFound.has('research')).toBe(true);
    expect(categoriesFound.has('policy')).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Worker and Database State Remain Connected
  // ─────────────────────────────────────────────────────────────────────────
  it('AutonomousPhase2Worker connects to database and respects polling schedule', async () => {
    const db = await getDb();
    await seedSources();

    const mockAdapter = {
      parseUrl: async (url: string) => {
        return [
          {
            canonicalUrl: `${url}/worker-test-item-1`,
            title: 'Worker Verification Item',
            authors: ['Author'],
            rawContent: '<p>Worker test item content</p>',
            cleanText: 'Worker test item content',
            summaryExcerpt: 'Worker test item excerpt',
            publishedAt: new Date(),
            contentHash: `hash-${url}`,
            simhashFingerprint: BigInt(123456789),
          },
        ];
      },
      parseString: async () => [],
    } as unknown as RssFeedAdapter;

    const mockIngestionService = new IngestionService(mockAdapter);
    const mockAiProvider = new MockAiProvider();
    const clusterer = new HybridStoryClusteringAgent(mockAiProvider);
    const worker = new AutonomousPhase2Worker({
      ingestionService: mockIngestionService,
      clusterer,
    });
    const summary = await worker.runCycle({ forceAllSources: false });

    // Since sources were just seeded/updated, lastPolledAt was null or old, so they are processed
    expect(summary.sourcesPolled).toBe(HIGH_SIGNAL_AI_SOURCES.length);
    expect(summary.sourcesProcessed).toBeGreaterThan(0);
    expect(summary.rawArticlesIngested).toBeGreaterThan(0);

    // Verify that polled sources now have non-null lastPolledAt in DB
    const polledSources = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.isActive, true));

    const polledWithTimestamp = polledSources.filter((s) => s.lastPolledAt !== null);
    expect(polledWithTimestamp.length).toBeGreaterThan(0);
  });
});
