import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import { ArticleManager } from '../../services/editorial/article-manager';
import { AutonomousPhase2Worker } from '../worker';
import { verifyCronSecret, getValidCronSecrets } from '../../lib/auth';
import * as revalModule from '../../lib/revalidation';

describe('STEP 8: Live Website Population & Autonomous Pipeline Resilience', () => {
  beforeEach(async () => {
    resetDbForTesting();
    await initializeDatabase();
    vi.restoreAllMocks();
  });

  async function createTestSourceAndStory(
    title: string,
    overrides?: Partial<typeof schema.stories.$inferInsert>
  ) {
    const db = await getDb();
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: `Source for ${title}`,
        baseUrl: `https://test.com/rss-${Math.random().toString(36).substring(2, 6)}.xml`,
        sourceType: 'rss',
        tier: 'tier_1_primary',
        isActive: true,
      })
      .returning();

    const [story] = await db
      .insert(schema.stories)
      .values({
        title,
        summary: `Summary of ${title}`,
        category: 'llm_release',
        editorialStatus: 'auto_approved',
        riskLevel: 'low',
        importanceScore: overrides?.importanceScore ?? 80,
        firstSeenAt: overrides?.firstSeenAt ?? new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: source.id,
        processingStatus: overrides?.processingStatus ?? 'pending',
        retryCount: overrides?.retryCount ?? 0,
        lastAttemptedAt: overrides?.lastAttemptedAt ?? null,
        ...overrides,
      })
      .returning();

    const [rawArticle] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        canonicalUrl: `https://test.com/article-${story.id}`,
        title,
        cleanText: `Clean content for ${title}`,
        rawContent: `Raw content for ${title}`,
        contentHash: `hash-${story.id}`,
      })
      .returning();

    await db.insert(schema.storySources).values({
      storyId: story.id,
      rawArticleId: rawArticle.id,
      isPrimary: true,
    });

    return { source, story, rawArticle };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Published DB articles appear in public queries
  // ─────────────────────────────────────────────────────────────────────────
  it('1. Published DB articles appear in public queries with story and source metadata', async () => {
    const db = await getDb();
    const { story, source } = await createTestSourceAndStory('Frontier Reasoning LLM Dispatched');

    const [article] = await db
      .insert(schema.articles)
      .values({
        storyId: story.id,
        title: 'Frontier Reasoning LLM Dispatched',
        titleEn: 'Frontier Reasoning LLM Dispatched',
        titleBn: 'ফ্রন্টিয়ার রিজনিং এলএলএম প্রকাশিত',
        slug: 'frontier-reasoning-llm-dispatched',
        deck: 'Technical breakdown of new hybrid reasoning capabilities.',
        contentMarkdown: 'Article body markdown with verified claims.',
        metaDescription: 'Technical breakdown of new hybrid reasoning capabilities.',
        status: 'published',
        publishedAt: new Date(),
      })
      .returning();

    const articleManager = new ArticleManager();
    const published = await articleManager.getPublishedArticlesWithMetadata(10, 0);

    expect(published.length).toBe(1);
    expect(published[0].id).toBe(article.id);
    expect(published[0].slug).toBe('frontier-reasoning-llm-dispatched');
    expect(published[0].titleEn).toBe('Frontier Reasoning LLM Dispatched');
    expect(published[0].story?.category).toBe('llm_release');
    expect(published[0].sources.length).toBeGreaterThanOrEqual(1);
    expect(published[0].sources[0].name).toBe(source.name);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Frontend is not artificially limited to ~4 articles
  // ─────────────────────────────────────────────────────────────────────────
  it('2. Frontend is not artificially limited to ~4 articles; supports scalable pagination', async () => {
    const db = await getDb();
    const articleManager = new ArticleManager();

    // Create 16 published articles in database
    for (let i = 1; i <= 16; i++) {
      const { story } = await createTestSourceAndStory(`Research Dispatch ${i}`);
      await db.insert(schema.articles).values({
        storyId: story.id,
        title: `Research Dispatch ${i}`,
        slug: `research-dispatch-${i}`,
        deck: `Deck for research dispatch ${i}`,
        contentMarkdown: `Content body for research dispatch ${i}`,
        metaDescription: `Meta description for research dispatch ${i}`,
        status: 'published',
        publishedAt: new Date(Date.now() - i * 3600000),
      });
    }

    const totalCount = await articleManager.countPublishedArticles();
    expect(totalCount).toBe(16);

    // Initial batch load: 12 articles
    const initialBatch = await articleManager.getPublishedArticlesWithMetadata(12, 0);
    expect(initialBatch.length).toBe(12);

    // Second batch load: remaining 4 articles
    const secondBatch = await articleManager.getPublishedArticlesWithMetadata(12, 12);
    expect(secondBatch.length).toBe(4);

    // Verify all 16 distinct articles are accessible through pagination
    const allSlugs = new Set([...initialBatch.map((a) => a.slug), ...secondBatch.map((a) => a.slug)]);
    expect(allSlugs.size).toBe(16);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Publication triggers cache revalidation
  // ─────────────────────────────────────────────────────────────────────────
  it('3. Publication triggers targeted cache revalidation', async () => {
    const revalSpy = vi.spyOn(revalModule, 'revalidatePublishedContent');
    const articleManager = new ArticleManager();

    const { story } = await createTestSourceAndStory('Revalidation Verification Story');

    // Save published article
    await articleManager.saveDraftArticle({
      storyId: story.id,
      status: 'published',
      verifiedClaims: [
        {
          id: 'claim-1',
          claimText: 'Verified claim text',
          confidenceScore: 0.98,
        },
      ],
      synthesisResult: {
        draft: {
          title: 'Revalidation Target Article',
          slug: 'revalidation-target-article',
          deck: 'Summary deck',
          contentMarkdown: 'Article content[^1]',
          metaDescription: 'Meta desc',
          citations: [
            {
              citationIndex: 1,
              claimIndex: 0,
              anchorText: 'Verified claim text',
              primarySourceUrl: 'https://test.com/source',
              sourcePublisher: 'Test Lab',
            },
          ],
        },
        plagiarismAudit: {
          maxSimilarity: 0.02,
          isAcceptable: true,
          longestCommonPhraseLength: 0,
          offendingPhrases: [],
        },
        readingTimeMinutes: 3,
      },
    });

    expect(revalSpy).toHaveBeenCalledWith('revalidation-target-article');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Worker scheduling configuration is valid
  // ─────────────────────────────────────────────────────────────────────────
  it('4. Worker scheduling configuration and multi-tier authentication are valid', () => {
    const validSecrets = getValidCronSecrets();
    expect(validSecrets).toContain('nakshatra-cron-secret-2026');
    expect(validSecrets).toContain('dev-cron-secret-nakshatra');

    // 1. Authorized via Bearer token
    const bearerReq = new Request('http://localhost:3000/api/cron/pipeline', {
      headers: { Authorization: 'Bearer nakshatra-cron-secret-2026' },
    });
    expect(verifyCronSecret(bearerReq)).toBe(true);

    // 2. Authorized via query param
    const queryReq = new Request('http://localhost:3000/api/cron/pipeline?secret=nakshatra-cron-secret-2026');
    expect(verifyCronSecret(queryReq)).toBe(true);

    // 3. Authorized via Vercel platform cron header
    const vercelCronReq = new Request('http://localhost:3000/api/cron/pipeline', {
      headers: { 'x-vercel-cron': '1' },
    });
    expect(verifyCronSecret(vercelCronReq)).toBe(true);

    // 4. Rejected when unauthorized
    const unauthReq = new Request('http://localhost:3000/api/cron/pipeline');
    expect(verifyCronSecret(unauthReq)).toBe(false);

    const forgedReq = new Request('http://localhost:3000/api/cron/pipeline', {
      headers: { Authorization: 'Bearer invalid-secret' },
    });
    expect(verifyCronSecret(forgedReq)).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Queue progresses across bounded cycles
  // ─────────────────────────────────────────────────────────────────────────
  it('5. Queue progresses sequentially across bounded cycles', async () => {
    const db = await getDb();

    // Create 5 pending stories in queue
    for (let i = 1; i <= 5; i++) {
      await createTestSourceAndStory(`Queued Story ${i}`, {
        importanceScore: 50 + i * 5,
        processingStatus: 'pending',
      });
    }

    // Mock researcher and writer dependencies to avoid network calls in queue test
    const mockResearcher = {
      buildEvidencePacket: vi.fn().mockResolvedValue({
        storyId: 'mock-story-id',
        claims: [{ id: 'mock-claim-id', claimText: 'Claim', confidenceScore: 0.95 }],
      }),
    } as any;

    const mockWriter = {
      synthesizeStoryArticle: vi.fn().mockResolvedValue({
        id: 'mock-article-id',
        status: 'published',
        slug: 'mock-slug',
      }),
      getAiProvider: vi.fn().mockReturnValue({
        setRequestBudget: vi.fn(),
        getRequestsExecuted: vi.fn().mockReturnValue(0),
      }),
    } as any;

    const worker = new AutonomousPhase2Worker({
      researcher: mockResearcher,
      writer: mockWriter,
    });

    // Cycle 1: batchSize = 2 -> claims 2, 3 remaining
    const summary1 = await worker.runCycle({ batchSize: 2, skipIngestion: true, skipClustering: true });
    expect(summary1.storiesClaimed).toBe(2);
    expect(summary1.autoApprovedArticlesPublished).toBe(2);

    const [remainingAfterCycle1] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.processingStatus, 'pending'));
    expect(remainingAfterCycle1).toBeDefined();

    // Cycle 2: batchSize = 2 -> claims 2, 1 remaining
    const summary2 = await worker.runCycle({ batchSize: 2, skipIngestion: true, skipClustering: true });
    expect(summary2.storiesClaimed).toBe(2);
    expect(summary2.autoApprovedArticlesPublished).toBe(2);

    // Cycle 3: batchSize = 2 -> claims final 1
    const summary3 = await worker.runCycle({ batchSize: 2, skipIngestion: true, skipClustering: true });
    expect(summary3.storiesClaimed).toBe(1);
    expect(summary3.autoApprovedArticlesPublished).toBe(1);

    // Verify all 5 stories are completed in DB
    const pendingRemaining = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.processingStatus, 'pending'));
    expect(pendingRemaining.length).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Quota exhaustion does not strand pending stories
  // ─────────────────────────────────────────────────────────────────────────
  it('6. Quota exhaustion stops immediately and safely releases unclaimed stories to pending', async () => {
    const db = await getDb();

    const { story: s1 } = await createTestSourceAndStory('Quota Test Story 1', {
      importanceScore: 95,
      processingStatus: 'pending',
    });
    const { story: s2 } = await createTestSourceAndStory('Quota Test Story 2', {
      importanceScore: 40,
      processingStatus: 'pending',
    });

    const mockResearcher = {
      buildEvidencePacket: vi.fn().mockResolvedValue({
        storyId: s1.id,
        claims: [{ id: 'mock-claim', claimText: 'Claim', confidenceScore: 0.95 }],
      }),
    } as any;

    const mockWriter = {
      synthesizeStoryArticle: vi.fn().mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: quota exceeded')),
      getAiProvider: vi.fn().mockReturnValue({
        setRequestBudget: vi.fn(),
        getRequestsExecuted: vi.fn().mockReturnValue(0),
      }),
    } as any;

    const worker = new AutonomousPhase2Worker({
      researcher: mockResearcher,
      writer: mockWriter,
    });

    const summary = await worker.runCycle({ batchSize: 2, skipIngestion: true, skipClustering: true });

    expect(summary.quotaEncountered).toBe(true);
    expect(summary.stopReason).toBe('QUOTA_EXHAUSTED');
    expect(summary.storiesSkipped).toBeGreaterThanOrEqual(1);

    // Story 2 must be safely released back to 'pending' without penalty
    const [story2Db] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, s2.id));
    expect(story2Db.processingStatus).toBe('pending');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Published articles become visible through the deployed public layer
  // ─────────────────────────────────────────────────────────────────────────
  it('7. Published articles become immediately visible through the public access layer', async () => {
    const db = await getDb();
    const articleManager = new ArticleManager();

    const { story } = await createTestSourceAndStory('Verified Quantum Computing Dispatch');

    const [publishedArticle] = await db
      .insert(schema.articles)
      .values({
        storyId: story.id,
        title: 'Verified Quantum Computing Dispatch',
        titleEn: 'Verified Quantum Computing Dispatch',
        titleBn: 'যাচাইকৃত কোয়ান্টাম কম্পিউটিং প্রতিবেদন',
        slug: 'verified-quantum-computing-dispatch',
        deck: 'Technical overview of superconducting qubits.',
        summaryEn: 'Technical overview of superconducting qubits.',
        summaryBn: 'সুপারকন্ডাক্টিং কিউবিটের কারিগরি বিবরণ।',
        contentMarkdown: 'Full article text regarding quantum error correction.',
        metaDescription: 'Technical overview of superconducting qubits and quantum error correction.',
        status: 'published',
        confidenceScore: '0.97',
        publishedAt: new Date(),
      })
      .returning();

    // Query single article by slug (reader view)
    const readerArticle = await articleManager.getArticleBySlug('verified-quantum-computing-dispatch');
    expect(readerArticle).not.toBeNull();
    expect(readerArticle?.titleEn).toBe('Verified Quantum Computing Dispatch');
    expect(readerArticle?.titleBn).toBe('যাচাইকৃত কোয়ান্টাম কম্পিউটিং প্রতিবেদন');
    expect(readerArticle?.status).toBe('published');

    // Query list with metadata (feed view)
    const feed = await articleManager.getPublishedArticlesWithMetadata(10, 0);
    const inFeed = feed.find((a) => a.slug === publishedArticle.slug);
    expect(inFeed).toBeDefined();
    expect(inFeed?.story?.category).toBe('llm_release');
  });
});
