import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { AutonomousPhase2Worker } from '../worker';
import {
  claimNextStoryBatch,
  recoverStaleProcessingJobs,
  countEligibleStoriesInQueue,
} from '../lib/story-queue';
import { GeminiBudgetExceededError } from '../../services/ai/gemini-provider';

describe('STEP 7: Autonomous Production Worker, Queue Hardening & Backlog Recovery', () => {
  beforeEach(async () => {
    resetDbForTesting();
    await initializeDatabase();
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
        cleanText: `Clean text for ${title}`,
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

  // ───────────────────────────────────────────────────────────────────────────
  // Test 1 — Batch Bound: Worker processes no more than configured maximum
  // ───────────────────────────────────────────────────────────────────────────
  it('strictly enforces batchSize limit so worker processes only bounded batches', async () => {
    const db = await getDb();

    // Create 5 auto_approved pending stories
    for (let i = 1; i <= 5; i++) {
      await createTestSourceAndStory(`Batch Test Story ${i}`, {
        importanceScore: 100 - i * 5,
      });
    }

    const mockResearcher = {
      buildEvidencePacket: vi.fn().mockImplementation(async (storyId: string) => ({
        storyId,
        primarySources: [{ title: 'Doc', url: 'https://test.com', text: 'Text' }],
        secondarySources: [],
        confirmedFacts: ['Fact 1'],
        differingPerspectives: [],
      })),
    };

    const mockWriter = {
      getAiProvider: vi.fn().mockReturnValue(null),
      synthesizeStoryArticle: vi.fn().mockImplementation(async (packet: any) => {
        const [saved] = await db
          .insert(schema.articles)
          .values({
            storyId: packet.storyId,
            title: `Article for ${packet.storyId}`,
            slug: `article-${packet.storyId}`,
            deck: 'Deck',
            contentMarkdown: 'Content',
            metaDescription: 'Meta',
            status: 'published',
            publishedAt: new Date(),
          })
          .returning();
        return saved;
      }),
    };

    const worker = new AutonomousPhase2Worker({
      ingestionService: { ingestSource: vi.fn().mockResolvedValue({ errors: [] }) } as any,
      clusterer: { processUnclustered: vi.fn().mockResolvedValue([]) } as any,
      researcher: mockResearcher as any,
      writer: mockWriter as any,
    });

    // Run cycle with batchSize = 2
    const summary = await worker.runCycle({
      batchSize: 2,
      skipIngestion: true,
      skipClustering: true,
    });

    expect(summary.storiesClaimed).toBe(2);
    expect(summary.autoApprovedArticlesPublished).toBe(2);
    expect(summary.stopReason).toBe('BATCH_LIMIT_REACHED');
    expect(mockWriter.synthesizeStoryArticle).toHaveBeenCalledTimes(2);

    // Verify exactly 2 articles exist in DB
    const published = await db.select().from(schema.articles);
    expect(published.length).toBe(2);

    // Verify 3 stories remain pending
    const remainingPending = await db
      .select()
      .from(schema.stories)
      .where(and(eq(schema.stories.editorialStatus, 'auto_approved'), eq(schema.stories.processingStatus, 'pending')));
    expect(remainingPending.length).toBe(3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 2 — Resume: Remaining stories stay pending and are processed on next cycle
  // ───────────────────────────────────────────────────────────────────────────
  it('resumes safely across cycles, processing the next batch without re-running completed stories', async () => {
    const db = await getDb();

    for (let i = 1; i <= 3; i++) {
      await createTestSourceAndStory(`Resume Story ${i}`, { importanceScore: 90 - i });
    }

    const mockResearcher = {
      buildEvidencePacket: vi.fn().mockImplementation(async (storyId: string) => ({
        storyId,
        primarySources: [{ title: 'Doc', url: 'https://test.com', text: 'Text' }],
        secondarySources: [],
        confirmedFacts: ['Fact 1'],
        differingPerspectives: [],
      })),
    };

    const mockWriter = {
      getAiProvider: vi.fn().mockReturnValue(null),
      synthesizeStoryArticle: vi.fn().mockImplementation(async (packet: any) => {
        const [saved] = await db
          .insert(schema.articles)
          .values({
            storyId: packet.storyId,
            title: `Article ${packet.storyId}`,
            slug: `slug-${packet.storyId}`,
            deck: 'Deck',
            contentMarkdown: 'Body',
            metaDescription: 'Meta',
            status: 'published',
            publishedAt: new Date(),
          })
          .returning();
        return saved;
      }),
    };

    const worker = new AutonomousPhase2Worker({
      ingestionService: { ingestSource: vi.fn().mockResolvedValue({ errors: [] }) } as any,
      clusterer: { processUnclustered: vi.fn().mockResolvedValue([]) } as any,
      researcher: mockResearcher as any,
      writer: mockWriter as any,
    });

    // Cycle 1: batchSize = 2 -> Processes stories 1 & 2
    const summary1 = await worker.runCycle({ batchSize: 2, skipIngestion: true, skipClustering: true });
    expect(summary1.autoApprovedArticlesPublished).toBe(2);

    // Cycle 2: batchSize = 2 -> Only story 3 is remaining
    const summary2 = await worker.runCycle({ batchSize: 2, skipIngestion: true, skipClustering: true });
    expect(summary2.storiesClaimed).toBe(1);
    expect(summary2.autoApprovedArticlesPublished).toBe(1);
    expect(summary2.stopReason).toBe('COMPLETED');

    // Total published is now 3
    const allArticles = await db.select().from(schema.articles);
    expect(allArticles.length).toBe(3);

    // 0 remaining pending stories
    const counts = await countEligibleStoriesInQueue(db);
    expect(counts.eligible).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 3 — Gemini Budget: Halts gracefully when request budget is reached
  // ───────────────────────────────────────────────────────────────────────────
  it('halts synthesis gracefully when Gemini call budget is reached and resets unstarted story to pending', async () => {
    const db = await getDb();

    for (let i = 1; i <= 3; i++) {
      await createTestSourceAndStory(`Budget Story ${i}`, { importanceScore: 90 - i });
    }

    let requestCount = 0;
    const mockAiProvider = {
      requestBudget: 1,
      requestsExecuted: 0,
      setRequestBudget(b: number | null) {
        this.requestBudget = b ?? 999;
      },
      getRequestsExecuted() {
        return requestCount;
      },
    };

    const mockResearcher = {
      buildEvidencePacket: vi.fn().mockImplementation(async (storyId: string) => ({
        storyId,
        primarySources: [{ title: 'Doc', url: 'https://test.com', text: 'Text' }],
        secondarySources: [],
        confirmedFacts: ['Fact 1'],
        differingPerspectives: [],
      })),
    };

    const mockWriter = {
      getAiProvider: vi.fn().mockReturnValue(mockAiProvider),
      synthesizeStoryArticle: vi.fn().mockImplementation(async (packet: any) => {
        if (requestCount >= 1) {
          throw new GeminiBudgetExceededError(1, requestCount);
        }
        requestCount++;
        const [saved] = await db
          .insert(schema.articles)
          .values({
            storyId: packet.storyId,
            title: `Article ${packet.storyId}`,
            slug: `slug-${packet.storyId}`,
            deck: 'Deck',
            contentMarkdown: 'Body',
            metaDescription: 'Meta',
            status: 'published',
            publishedAt: new Date(),
          })
          .returning();
        return saved;
      }),
    };

    const worker = new AutonomousPhase2Worker({
      ingestionService: { ingestSource: vi.fn().mockResolvedValue({ errors: [] }) } as any,
      clusterer: { processUnclustered: vi.fn().mockResolvedValue([]) } as any,
      researcher: mockResearcher as any,
      writer: mockWriter as any,
    });

    const summary = await worker.runCycle({
      batchSize: 3,
      geminiBudget: 1,
      skipIngestion: true,
      skipClustering: true,
    });

    expect(summary.autoApprovedArticlesPublished).toBe(1);
    expect(summary.stopReason).toBe('BUDGET_EXHAUSTED');

    // Remaining stories must stay pending with retryCount = 0 (no failure penalty)
    const pendingStories = await db
      .select()
      .from(schema.stories)
      .where(and(eq(schema.stories.editorialStatus, 'auto_approved'), eq(schema.stories.processingStatus, 'pending')));
    expect(pendingStories.length).toBe(2);
    for (const p of pendingStories) {
      expect(p.retryCount).toBe(0);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 4 — Idempotency: Re-running on existing article does not duplicate
  // ───────────────────────────────────────────────────────────────────────────
  it('prevents duplicate articles when a story already has a published article', async () => {
    const db = await getDb();
    const { story } = await createTestSourceAndStory('Idempotency Story 1');

    // Pre-insert published article for this story
    await db.insert(schema.articles).values({
      storyId: story.id,
      title: 'Existing Published Article',
      slug: 'existing-published-article',
      deck: 'Existing Deck',
      contentMarkdown: 'Existing Content',
      metaDescription: 'Existing Meta',
      status: 'published',
      publishedAt: new Date(),
    });

    const mockWriter = new (await import('../agents/writer')).MultiSourceWriterAgent({
      generateStructured: vi.fn().mockRejectedValue(new Error('Should never call AI for already published article!')),
    } as any);

    const packet = {
      storyId: story.id,
      primarySources: [{ title: 'Doc', url: 'https://test.com', text: 'Text' }],
      secondarySources: [],
      confirmedFacts: ['Fact'],
      differingPerspectives: [],
    };

    // Synthesize should return the existing article without calling AI
    const article = await mockWriter.synthesizeStoryArticle(packet as any, {
      publicationIntent: 'published',
      skipIfAlreadyPublished: true,
    });
    expect(article.slug).toBe('existing-published-article');

    // Story state is updated to completed
    const [updatedStory] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
    expect(updatedStory.editorialStatus).toBe('published');
    expect(updatedStory.processingStatus).toBe('completed');

    // Exactly 1 article exists in the database
    const totalArticles = await db.select().from(schema.articles);
    expect(totalArticles.length).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 5 — Lock Safety & Concurrency: Simultaneous workers cannot claim the same story
  // ───────────────────────────────────────────────────────────────────────────
  it('guarantees atomic queue claiming so concurrent workers never claim the same story', async () => {
    const db = await getDb();

    // Create 3 stories
    for (let i = 1; i <= 3; i++) {
      await createTestSourceAndStory(`Concurrency Story ${i}`, { importanceScore: 80 + i });
    }

    // Worker 1 claims 2 stories
    const claimedByWorker1 = await claimNextStoryBatch(db, { batchSize: 2 });
    expect(claimedByWorker1.length).toBe(2);

    // Worker 2 attempts to claim 2 stories concurrently
    const claimedByWorker2 = await claimNextStoryBatch(db, { batchSize: 2 });
    // Only 1 remaining story was unclaimed, so worker 2 gets exactly 1
    expect(claimedByWorker2.length).toBe(1);

    // Zero overlap in claimed IDs
    const ids1 = new Set(claimedByWorker1.map((s) => s.id));
    for (const s of claimedByWorker2) {
      expect(ids1.has(s.id)).toBe(false);
    }

    // A third worker gets 0 stories because all 3 are claimed
    const claimedByWorker3 = await claimNextStoryBatch(db, { batchSize: 2 });
    expect(claimedByWorker3.length).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 6 — Stale Recovery: Stranded processing stories are safely recovered
  // ───────────────────────────────────────────────────────────────────────────
  it('automatically recovers stale processing jobs whose heartbeat leases expired', async () => {
    const db = await getDb();

    // Story 1: Stale processing job (crashed 15 minutes ago)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const { story: staleStory } = await createTestSourceAndStory('Crashed Story 1', {
      processingStatus: 'processing',
      lastAttemptedAt: fifteenMinutesAgo,
      retryCount: 0,
    });

    // Story 2: Active processing job (started 1 minute ago)
    const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000);
    const { story: activeStory } = await createTestSourceAndStory('Active Story 2', {
      processingStatus: 'processing',
      lastAttemptedAt: oneMinuteAgo,
      retryCount: 0,
    });

    // Story 3: Stale story that has exhausted retries (attempt 2 of 3)
    const { story: exhaustedStory } = await createTestSourceAndStory('Exhausted Story 3', {
      processingStatus: 'processing',
      lastAttemptedAt: fifteenMinutesAgo,
      retryCount: 2,
    });

    // Run stale recovery with 10-minute threshold and maxRetries = 3
    const recoveryResult = await recoverStaleProcessingJobs(db, {
      staleThresholdMs: 10 * 60 * 1000,
      maxRetries: 3,
    });

    expect(recoveryResult.recoveredCount).toBe(2);
    expect(recoveryResult.recoveredStoryIds).toContain(staleStory.id);
    expect(recoveryResult.recoveredStoryIds).toContain(exhaustedStory.id);
    expect(recoveryResult.recoveredStoryIds).not.toContain(activeStory.id);

    // A crashed lease is infrastructure recovery, so it returns to pending
    // without consuming a synthesis retry.
    const [afterS1] = await db.select().from(schema.stories).where(eq(schema.stories.id, staleStory.id));
    expect(afterS1.processingStatus).toBe('pending');
    expect(afterS1.editorialStatus).toBe('auto_approved');
    expect(afterS1.retryCount).toBe(0);
    expect(afterS1.failureStage).toBe('timeout');

    // Story 2 remains actively processing
    const [afterS2] = await db.select().from(schema.stories).where(eq(schema.stories.id, activeStory.id));
    expect(afterS2.processingStatus).toBe('processing');

    // Existing retry history is preserved; lease recovery does not add a retry.
    const [afterS3] = await db.select().from(schema.stories).where(eq(schema.stories.id, exhaustedStory.id));
    expect(afterS3.editorialStatus).toBe('auto_approved');
    expect(afterS3.processingStatus).toBe('pending');
    expect(afterS3.retryCount).toBe(2);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 7 — Quota Handling: Rate limit (429) cleanly stops batch and preserves pending
  // ───────────────────────────────────────────────────────────────────────────
  it('halts current batch cleanly on HTTP 429 quota exhaustion without failing unattempted stories', async () => {
    const db = await getDb();

    const { story: s1 } = await createTestSourceAndStory('Quota Failure Story 1', { importanceScore: 95 });
    const { story: s2 } = await createTestSourceAndStory('Unattempted Story 2', { importanceScore: 90 });

    const mockResearcher = {
      buildEvidencePacket: vi.fn().mockImplementation(async (storyId: string) => ({
        storyId,
        primarySources: [{ title: 'Doc', url: 'https://test.com', text: 'Text' }],
        secondarySources: [],
        confirmedFacts: ['Fact 1'],
        differingPerspectives: [],
      })),
    };

    const mockWriter = {
      getAiProvider: vi.fn().mockReturnValue(null),
      synthesizeStoryArticle: vi.fn().mockImplementation(async (packet: any) => {
        if (packet.storyId === s1.id) {
          throw new Error('429 RESOURCE_EXHAUSTED: Daily free-tier request quota exceeded');
        }
        return { status: 'published' };
      }),
    };

    const worker = new AutonomousPhase2Worker({
      ingestionService: { ingestSource: vi.fn().mockResolvedValue({ errors: [] }) } as any,
      clusterer: { processUnclustered: vi.fn().mockResolvedValue([]) } as any,
      researcher: mockResearcher as any,
      writer: mockWriter as any,
    });

    const summary = await worker.runCycle({
      batchSize: 2,
      skipIngestion: true,
      skipClustering: true,
    });

    expect(summary.quotaEncountered).toBe(true);
    expect(summary.stopReason).toBe('QUOTA_EXHAUSTED');
    expect(summary.autoApprovedArticlesPublished).toBe(0);

    // Quota exhaustion does not consume a content retry. The attempted story
    // returns to pending with a cooldown.
    const [afterS1] = await db.select().from(schema.stories).where(eq(schema.stories.id, s1.id));
    expect(afterS1.processingStatus).toBe('pending');
    expect(afterS1.retryCount).toBe(0);
    expect(afterS1.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());

    // Story 2 was released back to pending with retryCount = 0!
    const [afterS2] = await db.select().from(schema.stories).where(eq(schema.stories.id, s2.id));
    expect(afterS2.processingStatus).toBe('pending');
    expect(afterS2.retryCount).toBe(0);
  });
});
