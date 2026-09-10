import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import { AutonomousPhase2Worker } from '../worker';
import { IngestionService } from '../../services/ingestion/ingest-service';
import {
  acquirePipelineLock,
  releasePipelineLock,
  isPipelineLocked,
  withPipelineLock,
  PIPELINE_GLOBAL_LOCK,
} from '../lib/pipeline-lock';
import {
  classifyError,
} from '../lib/retry-policy';

describe('Production Pipeline Safety & Hardening (Forensic Fix Verification)', () => {
  beforeEach(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Retry Exhaustion & Automatic Processing Stop
  // ───────────────────────────────────────────────────────────────────────────
  it('stops automatic processing and marks story needs_review when max retries are exhausted', async () => {
    const db = await getDb();

    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'OpenAI Test Lab',
        baseUrl: 'https://openai.com/test-safety-rss.xml',
        sourceType: 'rss',
        tier: 'tier_1_primary',
      })
      .returning();

    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'GPT-5 Frontier Architecture Release',
        summary: 'Frontier AI model release announcement.',
        category: 'llm_release',
        editorialStatus: 'auto_approved',
        riskLevel: 'low',
        importanceScore: 90,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: source.id,
      })
      .returning();

    // Link a raw article
    const [rawArticle] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        canonicalUrl: 'https://openai.com/gpt-5-safety-test',
        title: 'Introducing GPT-5',
        cleanText: 'Frontier reasoning benchmark announcement.',
        rawContent: 'Announcing GPT-5.',
        contentHash: 'hash_test_retry_1',
      })
      .returning();

    await db.insert(schema.storySources).values({
      storyId: story.id,
      rawArticleId: rawArticle.id,
      isPrimary: true,
    });

    const mockIngestionService = {
      ingestSource: vi.fn().mockResolvedValue({
        sourceId: source.id,
        sourceName: source.name,
        totalFetched: 0,
        insertedCount: 0,
        exactDuplicatesSkipped: 0,
        nearDuplicatesSkipped: 0,
        errors: [],
      }),
    };

    const mockClusterer = {
      processUnclustered: vi.fn().mockResolvedValue([]),
    };

    const mockResearcher = {
      buildEvidencePacket: vi.fn().mockResolvedValue({
        storyId: story.id,
        primarySources: [{ title: 'GPT-5', url: rawArticle.canonicalUrl, text: rawArticle.cleanText }],
        secondarySources: [],
        confirmedFacts: ['Fact 1'],
        differingPerspectives: [],
      }),
    };

    // Simulate transient 503 service outage from external Gemini API
    const mockWriter = {
      synthesizeStoryArticle: vi.fn().mockRejectedValue(
        new Error('Gemini API 503 Service Unavailable: Model overloaded')
      ),
    };

    const worker = new AutonomousPhase2Worker({
      ingestionService: mockIngestionService as any,
      clusterer: mockClusterer as any,
      researcher: mockResearcher as any,
      writer: mockWriter as any,
    });

    // Cycle 1: Attempt 1 fails (retryable, retryCount becomes 1, status remains auto_approved)
    const summary1 = await worker.runCycle({ maxRetries: 3 });
    expect(summary1.autoApprovedArticlesPublished).toBe(0);
    expect(summary1.errors.length).toBe(1);

    const [afterCycle1] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
    expect(afterCycle1.editorialStatus).toBe('auto_approved');
    expect(afterCycle1.processingStatus).toBe('failed');
    expect(afterCycle1.retryCount).toBe(1);
    expect(afterCycle1.failureStage).toBe('writing');
    expect(afterCycle1.failureReason).toContain('Gemini API 503');

    // Simulate time passing to satisfy backoff for attempt 2
    await db
      .update(schema.stories)
      .set({ lastAttemptedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(schema.stories.id, story.id));

    // Cycle 2: Attempt 2 fails (retryCount becomes 2)
    await worker.runCycle({ maxRetries: 3 });
    const [afterCycle2] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
    expect(afterCycle2.retryCount).toBe(2);
    expect(afterCycle2.editorialStatus).toBe('auto_approved');

    // Simulate time passing to satisfy backoff for attempt 3
    await db
      .update(schema.stories)
      .set({ lastAttemptedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(schema.stories.id, story.id));

    // Cycle 3: Attempt 3 fails -> Max retries reached (3/3)
    // Editorial status transitions to 'needs_review', stopping all further automatic attempts!
    await worker.runCycle({ maxRetries: 3 });
    const [afterCycle3] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
    expect(afterCycle3.retryCount).toBe(3);
    expect(afterCycle3.editorialStatus).toBe('needs_review');
    expect(afterCycle3.processingStatus).toBe('failed');

    // Cycle 4: Subsequent automatic runs must NOT touch the story again
    mockWriter.synthesizeStoryArticle.mockClear();
    await worker.runCycle({ maxRetries: 3 });
    expect(mockWriter.synthesizeStoryArticle).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Retryable vs Non-Retryable Failure Handling
  // ───────────────────────────────────────────────────────────────────────────
  it('immediately transitions non-retryable errors to needs_review without endless retries', async () => {
    const db = await getDb();

    // Verify classification logic directly
    const transientNet = classifyError(new Error('ECONNRESET connection reset by peer'));
    expect(transientNet.isRetryable).toBe(true);
    expect(transientNet.isRateLimit).toBe(false);

    const rateLimit = classifyError(new Error('429 Resource has been exhausted (check quota)'));
    expect(rateLimit.isRetryable).toBe(true);
    expect(rateLimit.isRateLimit).toBe(true);

    const nonRetryable = classifyError(
      new Error('Grounding Invariant Violation: Citation index references an invalid claim index')
    );
    expect(nonRetryable.isRetryable).toBe(false);

    // Verify pipeline behavior on non-retryable error
    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'Story with Corrupt Citations',
        summary: 'Corrupt citations test story.',
        category: 'research',
        editorialStatus: 'auto_approved',
        riskLevel: 'medium',
        importanceScore: 80,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
      })
      .returning();

    const mockResearcher = {
      buildEvidencePacket: vi.fn().mockResolvedValue({
        storyId: story.id,
        primarySources: [{ title: 'A', url: 'https://example.com', text: 'Text' }],
        secondarySources: [],
        confirmedFacts: ['Fact'],
        differingPerspectives: [],
      }),
    };

    const mockWriter = {
      synthesizeStoryArticle: vi.fn().mockRejectedValue(
        new Error('Grounding Invariant Violation: Citation index references an invalid claim')
      ),
    };

    const worker = new AutonomousPhase2Worker({
      ingestionService: { ingestSource: vi.fn().mockResolvedValue({ errors: [] }) } as any,
      clusterer: { processUnclustered: vi.fn().mockResolvedValue([]) } as any,
      researcher: mockResearcher as any,
      writer: mockWriter as any,
    });

    // Run cycle: on attempt 1, it immediately aborts further retries and flags needs_review
    await worker.runCycle({ maxRetries: 3 });

    const [updatedStory] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
    expect(updatedStory.retryCount).toBe(1);
    expect(updatedStory.editorialStatus).toBe('needs_review');
    expect(updatedStory.processingStatus).toBe('failed');
    expect(updatedStory.failureReason).toContain('Grounding Invariant Violation');

    // Next cycle skips it completely
    mockWriter.synthesizeStoryArticle.mockClear();
    await worker.runCycle({ maxRetries: 3 });
    expect(mockWriter.synthesizeStoryArticle).not.toHaveBeenCalled();
  });

  it('halts further story processing in the cycle when rate limit / quota error occurs', async () => {
    const db = await getDb();

    const [_story1] = await db
      .insert(schema.stories)
      .values({
        title: 'Story 1 - Hits Quota',
        summary: 'Quota test story 1',
        category: 'infra',
        editorialStatus: 'auto_approved',
        riskLevel: 'low',
        importanceScore: 90,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
      })
      .returning();

    const [story2] = await db
      .insert(schema.stories)
      .values({
        title: 'Story 2 - Should Be Deferred',
        summary: 'Quota test story 2',
        category: 'infra',
        editorialStatus: 'auto_approved',
        riskLevel: 'low',
        importanceScore: 85,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
      })
      .returning();

    const mockResearcher = {
      buildEvidencePacket: vi.fn().mockResolvedValue({
        primarySources: [{ title: 'T', url: 'https://test.com', text: 'Txt' }],
        secondarySources: [],
        confirmedFacts: ['Fact'],
        differingPerspectives: [],
      }),
    };

    // Story 1 encounters a 429 rate limit
    const mockWriter = {
      synthesizeStoryArticle: vi.fn().mockRejectedValue(
        new Error('429 RESOURCE_EXHAUSTED: Daily external API quota exceeded')
      ),
    };

    const worker = new AutonomousPhase2Worker({
      ingestionService: { ingestSource: vi.fn().mockResolvedValue({ errors: [] }) } as any,
      clusterer: { processUnclustered: vi.fn().mockResolvedValue([]) } as any,
      researcher: mockResearcher as any,
      writer: mockWriter as any,
    });

    const summary = await worker.runCycle();

    // Story 1 attempted once and failed
    expect(mockWriter.synthesizeStoryArticle).toHaveBeenCalledTimes(1);

    // Story 2 was deferred to preserve quota, not called
    const [s2] = await db.select().from(schema.stories).where(eq(schema.stories.id, story2.id));
    expect(s2.retryCount).toBe(0);
    expect(s2.processingStatus).toBe('pending');
    expect(summary.errors.some((e) => e.includes('Rate limit active: deferred story'))).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Concurrent Pipeline Execution Guard
  // ───────────────────────────────────────────────────────────────────────────
  it('prevents simultaneous pipeline runs and safely rejects concurrent triggers', async () => {
    const db = await getDb();

    // Process A acquires the lock
    const acquiredA = await acquirePipelineLock(db, {
      lockName: PIPELINE_GLOBAL_LOCK,
      ownerId: 'cron-job-process-A',
    });
    expect(acquiredA).toBe(true);

    // Process B attempts to acquire the same lock simultaneously
    const acquiredB = await acquirePipelineLock(db, {
      lockName: PIPELINE_GLOBAL_LOCK,
      ownerId: 'manual-trigger-process-B',
    });
    expect(acquiredB).toBe(false);

    // Process B cannot execute while A is running
    const lockState = await isPipelineLocked(db);
    expect(lockState.isLocked).toBe(true);
    expect(lockState.ownerId).toBe('cron-job-process-A');

    // Release A
    await releasePipelineLock(db, {
      lockName: PIPELINE_GLOBAL_LOCK,
      ownerId: 'cron-job-process-A',
    });

    // Process B can now acquire the lock
    const acquiredBAfterRelease = await acquirePipelineLock(db, {
      lockName: PIPELINE_GLOBAL_LOCK,
      ownerId: 'manual-trigger-process-B',
    });
    expect(acquiredBAfterRelease).toBe(true);

    await releasePipelineLock(db, {
      lockName: PIPELINE_GLOBAL_LOCK,
      ownerId: 'manual-trigger-process-B',
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Lock Release After Failure & Crash Recovery (Stale Lock TTL)
  // ───────────────────────────────────────────────────────────────────────────
  it('guarantees lock release when pipeline throws an unhandled error', async () => {
    const db = await getDb();

    await expect(
      withPipelineLock(
        db,
        { lockName: PIPELINE_GLOBAL_LOCK, ownerId: 'crashing-worker' },
        async () => {
          throw new Error('Fatal unhandled pipeline crash');
        }
      )
    ).rejects.toThrow('Fatal unhandled pipeline crash');

    // Verify lock is released despite exception
    const lockState = await isPipelineLocked(db);
    expect(lockState.isLocked).toBe(false);
  });

  it('automatically recovers from stale locks if previous worker process crashed without releasing', async () => {
    const db = await getDb();

    // Manually insert an expired lock (owner crashed 15 minutes ago)
    await db.insert(schema.systemLocks).values({
      lockName: PIPELINE_GLOBAL_LOCK,
      lockedAt: new Date(Date.now() - 20 * 60 * 1000),
      expiresAt: new Date(Date.now() - 5 * 60 * 1000), // Expired 5 min ago
      ownerId: 'dead-pid-process',
    });

    // New worker instance arrives
    const acquired = await acquirePipelineLock(db, {
      lockName: PIPELINE_GLOBAL_LOCK,
      ownerId: 'new-active-worker',
      leaseMs: 10 * 60 * 1000,
    });

    expect(acquired).toBe(true);

    const lockState = await isPipelineLocked(db);
    expect(lockState.isLocked).toBe(true);
    expect(lockState.ownerId).toBe('new-active-worker');

    await releasePipelineLock(db, { lockName: PIPELINE_GLOBAL_LOCK, ownerId: 'new-active-worker' });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Safe Incremental RSS Processing & Deduplication
  // ───────────────────────────────────────────────────────────────────────────
  it('processes recent candidate window, skips historical items, and handles overlap safely without duplicates', async () => {
    const db = await getDb();

    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'ArXiv cs.AI High Volume Feed',
        baseUrl: 'http://export.arxiv.org/rss/cs.AI',
        sourceType: 'arxiv',
        tier: 'tier_2_verified',
      })
      .returning();

    // Generate simulated feed with 70 items:
    // Items 0..9: Recent new items (within window Limit 10)
    // Items 10..19: Items published recently (within 48h overlap window)
    // Items 20..69: Deep historical items (older than 48h and outside window limit)
    const now = new Date();
    const generateFeedXml = () => {
      let itemsXml = '';
      for (let i = 0; i < 70; i++) {
        let pubDate: Date;
        if (i < 20) {
          // Within last 6 hours
          pubDate = new Date(now.getTime() - i * 15 * 60 * 1000);
        } else {
          // 30 days ago
          pubDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000 - i * 1000);
        }

        const uniqueTopics = [
          'Quantum annealing optimization for constrained NP-hard graph coloring problems',
          'Reinforcement learning from human feedback using pairwise preference rankings',
          'Mixture of experts sparse gating stability under variable latency constraints',
          'Vision transformer attention mechanisms for automated medical image segmentation',
          'Formal verification of smart contracts using interactive theorem provers',
          'Cross-lingual zero-shot transfer in low-resource polysynthetic languages',
          'Neural radiance fields for dynamic real-time volumetric scene synthesis',
          'Graph convolutional networks for molecular fingerprint property prediction',
          'Autonomous micro-aerial vehicle navigation without satellite positioning signals',
          'Differential privacy guarantees for distributed edge device federated learning',
          'Multi-agent cooperative game theory for decentralized swarm robotics',
          'Low-rank parameter efficient fine-tuning of trillion parameter transformers',
          'Neuromorphic event-based optical flow estimation with spiking silicon arrays',
          'Bayesian epistemic uncertainty quantification in safety-critical autonomous driving',
          'Audio source separation in reverberant acoustic environments with deep priors',
          'Symbolic program synthesis guided by learned neural representation spaces',
          'Causal structure discovery from observational time-series with hidden variables',
          'Adversarial perturbation defenses for deep convolutional vision classifiers',
          'Self-supervised genomic representation learning for variant pathogenicity prediction',
          'Energy-efficient heterogeneous compute hardware architectures for transformer inference',
        ];
        const topic = uniqueTopics[i % uniqueTopics.length] + ` (Identifier: ${i})`;
        const desc = `Detailed technical treatise detailing methodology and empirical benchmarks for ${topic}. Unique dataset ${i} verified.`;

        itemsXml += `
          <item>
            <title>${topic}</title>
            <link>https://arxiv.org/abs/2609.${1000 + i}</link>
            <description>${desc}</description>
            <pubDate>${pubDate.toUTCString()}</pubDate>
          </item>
        `;
      }

      return `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>arXiv cs.AI</title>
            <link>http://export.arxiv.org/rss/cs.AI</link>
            ${itemsXml}
          </channel>
        </rss>`;
    };

    const feedXml = generateFeedXml();
    const ingestionService = new IngestionService();

    // Ingest with window limit = 10, overlap hours = 48
    // Items 0..9 are in the window (10 items)
    // Items 10..19 are in the 48h overlap window (10 items)
    // Items 20..69 are historical and safely skipped without DB queries (50 items)
    const result1 = await ingestionService.ingestSource(source, {
      xmlOverride: feedXml,
      recentWindowLimit: 10,
      overlapHours: 48,
    });

    expect(result1.totalFetched).toBe(70);
    expect(result1.candidatesInspected).toBe(20);
    expect(result1.insertedCount).toBe(20);
    expect(result1.historicalSkipped).toBe(50);
    expect(result1.exactDuplicatesSkipped).toBe(0);

    // Second run with the same feed (Idempotency and Overlap verification)
    const result2 = await ingestionService.ingestSource(source, {
      xmlOverride: feedXml,
      recentWindowLimit: 10,
      overlapHours: 48,
    });

    expect(result2.totalFetched).toBe(70);
    expect(result2.candidatesInspected).toBe(20);
    expect(result2.insertedCount).toBe(0);
    expect(result2.exactDuplicatesSkipped).toBe(20);
    expect(result2.historicalSkipped).toBe(50);

    // Verify DB count remains exactly 20
    const rawArticles = await db
      .select()
      .from(schema.rawArticles)
      .where(eq(schema.rawArticles.sourceId, source.id));
    expect(rawArticles.length).toBe(20);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Interrupted Run Recovery
  // ───────────────────────────────────────────────────────────────────────────
  it('safely recovers from an interrupted or partially completed ingestion run without duplicates', async () => {
    const db = await getDb();

    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'Interrupted Feed Recovery Test',
        baseUrl: 'https://test-interrupted.com/feed.xml',
        sourceType: 'rss',
        tier: 'tier_2_verified',
      })
      .returning();

    // Pre-insert 2 articles that were processed right before an unexpected process termination
    await db.insert(schema.rawArticles).values([
      {
        sourceId: source.id,
        canonicalUrl: 'https://test-interrupted.com/article-1',
        title: 'Article 1 Before Crash',
        cleanText: 'Article 1 clean text content.',
        rawContent: 'Raw article 1',
        contentHash: 'hash_interrupted_1',
      },
      {
        sourceId: source.id,
        canonicalUrl: 'https://test-interrupted.com/article-2',
        title: 'Article 2 Before Crash',
        cleanText: 'Article 2 clean text content.',
        rawContent: 'Raw article 2',
        contentHash: 'hash_interrupted_2',
      },
    ]);

    const partialFeedXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Interrupted Feed</title>
          <link>https://test-interrupted.com</link>
          <item>
            <title>Article 1 Before Crash</title>
            <link>https://test-interrupted.com/article-1</link>
            <description>Article 1 clean text content.</description>
            <pubDate>${new Date().toUTCString()}</pubDate>
          </item>
          <item>
            <title>Article 2 Before Crash</title>
            <link>https://test-interrupted.com/article-2</link>
            <description>Article 2 clean text content.</description>
            <pubDate>${new Date().toUTCString()}</pubDate>
          </item>
          <item>
            <title>Article 3 After Recovery</title>
            <link>https://test-interrupted.com/article-3</link>
            <description>Article 3 clean text content newly ingested.</description>
            <pubDate>${new Date().toUTCString()}</pubDate>
          </item>
        </channel>
      </rss>`;

    const ingestionService = new IngestionService();
    const result = await ingestionService.ingestSource(source, {
      xmlOverride: partialFeedXml,
    });

    // The two pre-existing articles are skipped cleanly via batch dedup
    // Article 3 is ingested normally
    expect(result.insertedCount).toBe(1);
    expect(result.exactDuplicatesSkipped).toBe(2);

    const allArticles = await db
      .select()
      .from(schema.rawArticles)
      .where(eq(schema.rawArticles.sourceId, source.id));

    expect(allArticles.length).toBe(3);
  });
});
