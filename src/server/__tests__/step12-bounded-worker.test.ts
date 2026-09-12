import { beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { AutonomousPhase2Worker } from '../worker';
import { recoverStaleProcessingJobs } from '../lib/story-queue';
import {
  GeminiQuotaExhaustedError,
  GeminiServiceUnavailableError,
} from '../../services/ai/gemini-provider';
import {
  PIPELINE_FUNCTION_MAX_DURATION_SECONDS,
  PIPELINE_GEMINI_TIMEOUT_MS,
  PIPELINE_HTTP_TIMEOUT_MS,
  PIPELINE_SHUTDOWN_HEADROOM_MS,
  PIPELINE_WORKER_DEADLINE_MS,
  assertRuntimePolicy,
} from '../lib/runtime-policy';
import { maxDuration } from '../../app/api/cron/pipeline/route';

describe('STEP 12: bounded queue-only worker runtime and recovery', () => {
  beforeEach(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  async function createStory(
    title: string,
    overrides?: Partial<typeof schema.stories.$inferInsert>
  ) {
    const db = await getDb();
    const [source] = await db.insert(schema.sources).values({
      name: `Source ${title}`,
      baseUrl: `https://example.com/${Math.random().toString(36).slice(2)}.xml`,
      sourceType: 'rss',
      tier: 'tier_1_primary',
    }).returning();
    const [story] = await db.insert(schema.stories).values({
      title,
      summary: `${title} summary`,
      category: 'llm_release',
      editorialStatus: 'auto_approved',
      riskLevel: 'low',
      importanceScore: 90,
      firstSeenAt: new Date(),
      lastUpdatedAt: new Date(),
      primarySourceId: source.id,
      processingStatus: 'pending',
      retryCount: 0,
      ...overrides,
    }).returning();
    const [raw] = await db.insert(schema.rawArticles).values({
      sourceId: source.id,
      canonicalUrl: `https://example.com/article/${story.id}`,
      title,
      rawContent: `${title} source material`,
      cleanText: `${title} source material`,
      contentHash: `hash-${story.id}`,
    }).returning();
    await db.insert(schema.storySources).values({
      storyId: story.id,
      rawArticleId: raw.id,
      isPrimary: true,
    });
    return story;
  }

  function createWorker(writerError: Error, researcherDelayMs = 0) {
    const ingestion = { ingestSource: vi.fn() };
    const clusterer = { processUnclustered: vi.fn() };
    const researcher = {
      buildEvidencePacket: vi.fn(async (storyId: string) => {
        if (researcherDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, researcherDelayMs));
        }
        return {
          storyId,
          primarySources: [{ title: 'Source', url: 'https://example.com', text: 'Evidence' }],
          secondarySources: [],
          confirmedFacts: ['Verified fact'],
          differingPerspectives: [],
        };
      }),
    };
    const provider = {
      attempts: 0,
      configureExecutionPolicy: vi.fn(),
      getAttemptsExecuted() { return this.attempts; },
    };
    const writer = {
      getAiProvider: () => provider,
      synthesizeStoryArticle: vi.fn(async () => {
        provider.attempts++;
        throw writerError;
      }),
    };
    return {
      worker: new AutonomousPhase2Worker({
        ingestionService: ingestion as never,
        clusterer: clusterer as never,
        researcher: researcher as never,
        writer: writer as never,
      }),
      ingestion,
      clusterer,
      researcher,
      writer,
    };
  }

  it('queue-only mode skips ingestion and clustering and creates no new story', async () => {
    const db = await getDb();
    await createStory('Queue-only isolation');
    const before = await db.select().from(schema.stories);
    const { worker, ingestion, clusterer } = createWorker(
      new GeminiServiceUnavailableError('503 Service Unavailable')
    );

    await worker.runCycle({
      processQueueOnly: true,
      batchSize: 1,
      geminiBudget: 1,
      transientCooldownMs: 1000,
    });

    expect(ingestion.ingestSource).not.toHaveBeenCalled();
    expect(clusterer.processUnclustered).not.toHaveBeenCalled();
    expect(await db.select().from(schema.stories)).toHaveLength(before.length);
  });

  it('requeues a story after one 503 attempt without incrementing retries', async () => {
    const db = await getDb();
    const story = await createStory('503 recovery');
    const { worker, writer } = createWorker(new GeminiServiceUnavailableError('503 unavailable'));
    const summary = await worker.runCycle({
      processQueueOnly: true,
      batchSize: 1,
      geminiBudget: 1,
      transientCooldownMs: 1000,
    });

    const [after] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
    expect(writer.synthesizeStoryArticle).toHaveBeenCalledTimes(1);
    expect(summary.geminiRequestsUsed).toBe(1);
    expect(summary.stopReason).toBe('PROVIDER_UNAVAILABLE');
    expect(after.processingStatus).toBe('pending');
    expect(after.retryCount).toBe(0);
    expect(after.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it('applies a cooldown and exits cleanly after one 429 attempt', async () => {
    const db = await getDb();
    const story = await createStory('429 recovery');
    const { worker } = createWorker(new GeminiQuotaExhaustedError('429 RESOURCE_EXHAUSTED', 20));
    const summary = await worker.runCycle({
      processQueueOnly: true,
      batchSize: 1,
      geminiBudget: 1,
      quotaCooldownMs: 60_000,
    });

    const [after] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
    expect(summary.stopReason).toBe('QUOTA_EXHAUSTED');
    expect(summary.quotaEncountered).toBe(true);
    expect(summary.geminiRequestsUsed).toBe(1);
    expect(after.processingStatus).toBe('pending');
    expect(after.retryCount).toBe(0);
    expect(after.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it('releases a claimed story when research consumes the synthesis deadline', async () => {
    const db = await getDb();
    const story = await createStory('Watchdog recovery');
    const { worker, writer } = createWorker(new Error('must not run'), 1100);
    const summary = await worker.runCycle({
      processQueueOnly: true,
      batchSize: 1,
      geminiBudget: 1,
      deadlineAt: Date.now() + 1000,
      geminiTimeoutMs: 1,
      shutdownHeadroomMs: 0,
      researchFetchTimeoutMs: 1,
    });

    const [after] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
    expect(summary.storiesClaimed).toBe(1);
    expect(summary.stopReason).toBe('WATCHDOG_DEADLINE');
    expect(writer.synthesizeStoryArticle).not.toHaveBeenCalled();
    expect(after.processingStatus).toBe('pending');
  });

  it('makes an expired processing lease immediately eligible without a retry penalty', async () => {
    const db = await getDb();
    const story = await createStory('Expired lease', {
      processingStatus: 'processing',
      retryCount: 2,
      lastAttemptedAt: new Date(Date.now() - 10_000),
    });

    const recovered = await recoverStaleProcessingJobs(db, { staleThresholdMs: 1000 });
    const [after] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
    expect(recovered.recoveredStoryIds).toContain(story.id);
    expect(after.processingStatus).toBe('pending');
    expect(after.retryCount).toBe(2);
    expect(after.nextAttemptAt).toBeNull();
  });

  it('keeps the configured deadlines ordered with shutdown headroom', () => {
    expect(assertRuntimePolicy()).toBeUndefined();
    expect(maxDuration).toBe(PIPELINE_FUNCTION_MAX_DURATION_SECONDS);
    expect(PIPELINE_GEMINI_TIMEOUT_MS + PIPELINE_SHUTDOWN_HEADROOM_MS)
      .toBeLessThan(PIPELINE_WORKER_DEADLINE_MS);
    expect(PIPELINE_WORKER_DEADLINE_MS).toBeLessThan(PIPELINE_HTTP_TIMEOUT_MS);
    expect(PIPELINE_HTTP_TIMEOUT_MS).toBeLessThan(PIPELINE_FUNCTION_MAX_DURATION_SECONDS * 1000);
  });

  it('leaves no processing story after any queue-only controlled failure', async () => {
    const db = await getDb();
    await createStory('No orphaned processing lease');
    const { worker } = createWorker(new GeminiServiceUnavailableError('503 unavailable'));
    await worker.runCycle({ processQueueOnly: true, batchSize: 1, geminiBudget: 1 });
    const processing = await db.select().from(schema.stories).where(
      and(eq(schema.stories.editorialStatus, 'auto_approved'), eq(schema.stories.processingStatus, 'processing'))
    );
    expect(processing).toHaveLength(0);
  });
});
