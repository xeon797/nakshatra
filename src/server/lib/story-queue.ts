import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq, and, or, desc, ne, lte } from 'drizzle-orm';
import { isStoryEligibleForRetry, getMaxRetriesFromEnv } from './retry-policy';

export const DEFAULT_STALE_JOB_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
export const DEFAULT_WORKER_BATCH_SIZE = 3;

export interface StaleRecoveryOptions {
  staleThresholdMs?: number;
  maxRetries?: number;
}

export interface StaleRecoveryResult {
  recoveredCount: number;
  recoveredStoryIds: string[];
}

/**
 * Recovers stranded / zombie stories that were left in 'processing' status
 * due to worker crashes, serverless function timeouts, or uncaught aborts.
 *
 * Transitions stale stories to 'failed' (with retry increment and backoff)
 * or to 'needs_review' if maxRetries are exceeded.
 */
export async function recoverStaleProcessingJobs(
  db: Awaited<ReturnType<typeof getDb>>,
  options?: StaleRecoveryOptions
): Promise<StaleRecoveryResult> {
  const staleThresholdMs = options?.staleThresholdMs ?? DEFAULT_STALE_JOB_THRESHOLD_MS;
  const maxRetries = options?.maxRetries ?? getMaxRetriesFromEnv();
  const staleCutoff = new Date(Date.now() - staleThresholdMs);

  const staleStories = await db
    .select()
    .from(schema.stories)
    .where(
      and(
        eq(schema.stories.editorialStatus, 'auto_approved'),
        eq(schema.stories.processingStatus, 'processing'),
        lte(schema.stories.lastAttemptedAt, staleCutoff)
      )
    );

  const recoveredStoryIds: string[] = [];

  for (const story of staleStories) {
    const nextRetryCount = (story.retryCount || 0) + 1;
    const isExhausted = nextRetryCount >= maxRetries;

    await db
      .update(schema.stories)
      .set({
        editorialStatus: isExhausted ? 'needs_review' : 'auto_approved',
        processingStatus: 'failed',
        retryCount: nextRetryCount,
        failureReason: `Heartbeat lease expired: processing exceeded ${Math.round(staleThresholdMs / 1000)}s without completion (worker timeout/crash).`,
        failureStage: 'timeout',
        lastAttemptedAt: new Date(),
        lastUpdatedAt: new Date(),
      })
      .where(eq(schema.stories.id, story.id));

    recoveredStoryIds.push(story.id);
  }

  return {
    recoveredCount: recoveredStoryIds.length,
    recoveredStoryIds,
  };
}

export interface ClaimBatchOptions {
  batchSize?: number;
  maxRetries?: number;
}

/**
 * Atomically claims up to `batchSize` eligible auto_approved stories from the queue.
 *
 * Guarantees single-worker ownership via atomic update predicates:
 * Only transitions stories that are NOT currently 'processing' or 'completed'.
 * Prioritizes high-importance and recent stories.
 */
export async function claimNextStoryBatch(
  db: Awaited<ReturnType<typeof getDb>>,
  options?: ClaimBatchOptions
): Promise<Array<typeof schema.stories.$inferSelect>> {
  const batchSize = options?.batchSize ?? DEFAULT_WORKER_BATCH_SIZE;
  const maxRetries = options?.maxRetries ?? getMaxRetriesFromEnv();

  // Fetch candidates from queue that could be eligible
  const candidates = await db
    .select()
    .from(schema.stories)
    .where(
      and(
        eq(schema.stories.editorialStatus, 'auto_approved'),
        or(
          eq(schema.stories.processingStatus, 'pending'),
          eq(schema.stories.processingStatus, 'failed')
        )
      )
    )
    .orderBy(desc(schema.stories.importanceScore), desc(schema.stories.firstSeenAt))
    .limit(batchSize * 4); // scan headroom for backoff filtering

  const claimed: Array<typeof schema.stories.$inferSelect> = [];

  for (const candidate of candidates) {
    if (claimed.length >= batchSize) break;

    if (!isStoryEligibleForRetry(candidate, maxRetries)) {
      continue;
    }

    // Atomic claim: verify status has not changed concurrently
    const [claimedStory] = await db
      .update(schema.stories)
      .set({
        processingStatus: 'processing',
        lastAttemptedAt: new Date(),
        lastUpdatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.stories.id, candidate.id),
          eq(schema.stories.editorialStatus, 'auto_approved'),
          ne(schema.stories.processingStatus, 'processing'),
          ne(schema.stories.processingStatus, 'completed')
        )
      )
      .returning();

    if (claimedStory) {
      claimed.push(claimedStory);
    }
  }

  return claimed;
}

/**
 * Releases a claimed story back to 'pending' without incrementing retry count or penalty.
 * Used when a batch terminates early due to budget exhaustion or watchdog deadline.
 */
export async function releaseStoryToPending(
  db: Awaited<ReturnType<typeof getDb>>,
  storyId: string
): Promise<void> {
  await db
    .update(schema.stories)
    .set({
      processingStatus: 'pending',
      lastUpdatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.stories.id, storyId),
        eq(schema.stories.processingStatus, 'processing')
      )
    );
}

/**
 * Marks a story completed and published in PostgreSQL.
 */
export async function markStoryCompleted(
  db: Awaited<ReturnType<typeof getDb>>,
  storyId: string
): Promise<void> {
  await db
    .update(schema.stories)
    .set({
      editorialStatus: 'published',
      processingStatus: 'completed',
      failureReason: null,
      failureStage: null,
      lastUpdatedAt: new Date(),
    })
    .where(eq(schema.stories.id, storyId));
}

/**
 * Counts currently pending/failed eligible stories in the queue.
 */
export async function countEligibleStoriesInQueue(
  db: Awaited<ReturnType<typeof getDb>>,
  maxRetries: number = getMaxRetriesFromEnv()
): Promise<{ eligible: number; pending: number; failed: number }> {
  const rows = await db
    .select({
      id: schema.stories.id,
      editorialStatus: schema.stories.editorialStatus,
      processingStatus: schema.stories.processingStatus,
      retryCount: schema.stories.retryCount,
      lastAttemptedAt: schema.stories.lastAttemptedAt,
    })
    .from(schema.stories)
    .where(eq(schema.stories.editorialStatus, 'auto_approved'));

  let pending = 0;
  let failed = 0;
  let eligible = 0;

  for (const row of rows) {
    if (row.processingStatus === 'pending') {
      pending++;
      eligible++;
    } else if (row.processingStatus === 'failed') {
      failed++;
      if (isStoryEligibleForRetry(row, maxRetries)) {
        eligible++;
      }
    }
  }

  return { eligible, pending, failed };
}
