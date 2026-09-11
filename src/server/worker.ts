import { getDb } from '../db';
import * as schema from '../db/schema';
import { ensureDatabaseInitialized } from '../db/init';
import { eq } from 'drizzle-orm';
import { IngestionService } from '../services/ingestion/ingest-service';
import { HybridStoryClusteringAgent, ClusteredStoryResult } from './agents/clusterer';
import { MultiSourceResearcherAgent } from './agents/researcher';
import { MultiSourceWriterAgent } from './agents/writer';
import {
  classifyError,
  getMaxRetriesFromEnv,
  FailureStage,
} from './lib/retry-policy';
import {
  acquirePipelineLock,
  releasePipelineLock,
  PIPELINE_GLOBAL_LOCK,
} from './lib/pipeline-lock';
import {
  claimNextStoryBatch,
  recoverStaleProcessingJobs,
  releaseStoryToPending,
  countEligibleStoriesInQueue,
  DEFAULT_WORKER_BATCH_SIZE,
  DEFAULT_STALE_JOB_THRESHOLD_MS,
} from './lib/story-queue';

export interface Phase2WorkerRunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sourcesPolled: number;
  sourcesProcessed: number;
  rawArticlesIngested: number;
  clustersCreated: number;
  storiesScanned: number;
  storiesEligible: number;
  storiesClaimed: number;
  autoApprovedArticlesPublished: number;
  storiesRetried: number;
  storiesFailed: number;
  storiesSkipped: number;
  staleJobsRecovered: number;
  geminiRequestsUsed: number;
  geminiBudget: number;
  quotaEncountered: boolean;
  stopReason:
    | 'COMPLETED'
    | 'BATCH_LIMIT_REACHED'
    | 'BUDGET_EXHAUSTED'
    | 'QUOTA_EXHAUSTED'
    | 'WATCHDOG_DEADLINE'
    | 'FATAL_ERROR';
  errors: string[];
}

export interface Phase2WorkerRunOptions {
  forceAllSources?: boolean;
  maxRetries?: number;
  clusteringWindowHours?: number;
  batchSize?: number;
  geminiBudget?: number;
  maxRuntimeMs?: number;
  staleJobThresholdMs?: number;
  skipIngestion?: boolean;
  skipClustering?: boolean;
  deterministicEvidence?: boolean;
}

interface BudgetableAiProvider {
  setRequestBudget?: (budget: number | null) => void;
  getRequestsExecuted?: () => number;
}

// Global in-process execution lock to prevent concurrent clusterer runs
let isClusteringLocked = false;

export class AutonomousPhase2Worker {
  private ingestionService: IngestionService;
  private clusterer: HybridStoryClusteringAgent;
  private researcher: MultiSourceResearcherAgent;
  private writer: MultiSourceWriterAgent;

  constructor(dependencies?: {
    ingestionService?: IngestionService;
    clusterer?: HybridStoryClusteringAgent;
    researcher?: MultiSourceResearcherAgent;
    writer?: MultiSourceWriterAgent;
  }) {
    this.ingestionService = dependencies?.ingestionService || new IngestionService();
    this.clusterer = dependencies?.clusterer || new HybridStoryClusteringAgent();
    this.researcher = dependencies?.researcher || new MultiSourceResearcherAgent();
    this.writer = dependencies?.writer || new MultiSourceWriterAgent();
  }

  /**
   * Executes a complete autonomous newsroom cycle:
   * Step 1: Ingest due sources (bounded polling)
   * Step 2: Run Clusterer.processUnclustered() with execution lock
   * Step 3: Trigger Writer/FactChecker on bounded batch of auto_approved stories with strict queue claiming
   */
  async runCycle(options?: Phase2WorkerRunOptions): Promise<Phase2WorkerRunSummary> {
    await ensureDatabaseInitialized();
    const db = await getDb();

    const startTime = Date.now();
    const runId = `worker-${startTime}-${Math.random().toString(36).substring(2, 8)}`;
    const batchSize = options?.batchSize ?? (process.env.WORKER_BATCH_SIZE ? parseInt(process.env.WORKER_BATCH_SIZE, 10) : DEFAULT_WORKER_BATCH_SIZE);
    const geminiBudget = options?.geminiBudget ?? (process.env.WORKER_GEMINI_BUDGET ? parseInt(process.env.WORKER_GEMINI_BUDGET, 10) : 5);
    const maxRuntimeMs = options?.maxRuntimeMs ?? (process.env.WORKER_MAX_RUNTIME_MS ? parseInt(process.env.WORKER_MAX_RUNTIME_MS, 10) : 50000);
    const staleThresholdMs = options?.staleJobThresholdMs ?? DEFAULT_STALE_JOB_THRESHOLD_MS;
    const maxRetries = options?.maxRetries ?? getMaxRetriesFromEnv();

    const summary: Phase2WorkerRunSummary = {
      runId,
      startedAt: new Date(startTime).toISOString(),
      finishedAt: '',
      durationMs: 0,
      sourcesPolled: 0,
      sourcesProcessed: 0,
      rawArticlesIngested: 0,
      clustersCreated: 0,
      storiesScanned: 0,
      storiesEligible: 0,
      storiesClaimed: 0,
      autoApprovedArticlesPublished: 0,
      storiesRetried: 0,
      storiesFailed: 0,
      storiesSkipped: 0,
      staleJobsRecovered: 0,
      geminiRequestsUsed: 0,
      geminiBudget,
      quotaEncountered: false,
      stopReason: 'COMPLETED',
      errors: [],
    };

    // Configure Gemini request budget if provider supports it
    const aiProvider = this.writer.getAiProvider?.();
    const budgetable = aiProvider as unknown as BudgetableAiProvider | undefined;
    if (typeof budgetable?.setRequestBudget === 'function') {
      budgetable.setRequestBudget(geminiBudget);
    }
    const initialGeminiRequests =
      typeof budgetable?.getRequestsExecuted === 'function'
        ? budgetable.getRequestsExecuted()
        : 0;

    // ─────────────────────────────────────────────────────────────────────────
    // Step 1: Ingest due sources
    // ─────────────────────────────────────────────────────────────────────────
    if (!options?.skipIngestion) {
      const activeSources = await db
        .select()
        .from(schema.sources)
        .where(eq(schema.sources.isActive, true));

      summary.sourcesPolled = activeSources.length;
      const now = Date.now();

      for (const source of activeSources) {
        const lastPolled = source.lastPolledAt ? new Date(source.lastPolledAt).getTime() : 0;
        const pollingIntervalMs = (source.pollingFrequencyMinutes || 15) * 60 * 1000;

        if (!options?.forceAllSources && lastPolled > 0 && now - lastPolled < pollingIntervalMs) {
          continue;
        }

        summary.sourcesProcessed++;
        try {
          const ingestResult = await this.ingestionService.ingestSource(source);
          summary.rawArticlesIngested += ingestResult.insertedCount;
          if (ingestResult.errors.length > 0) {
            summary.errors.push(...ingestResult.errors);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          summary.errors.push(`Failed ingestion for ${source.name}: ${message}`);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 2: Run Clusterer.processUnclustered() with concurrency execution lock
    // ─────────────────────────────────────────────────────────────────────────
    if (!options?.skipClustering) {
      let newClusters: ClusteredStoryResult[] = [];
      if (!isClusteringLocked) {
        isClusteringLocked = true;
        try {
          const windowHours = options?.clusteringWindowHours ?? 72;
          newClusters = await this.clusterer.processUnclustered(windowHours);
          summary.clustersCreated = newClusters.length;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          summary.errors.push(`Clustering pipeline error: ${message}`);
        } finally {
          isClusteringLocked = false;
        }
      } else {
        console.log('[Worker] Clustering already locked in another execution; skipping clustering step.');
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3: Hardened Queue Worker (Stale Recovery, Bounded Claiming, Watchdog)
    // ─────────────────────────────────────────────────────────────────────────
    try {
      // 1. Recover stale processing jobs (zombies from previous timeouts or crashes)
      const staleRecovery = await recoverStaleProcessingJobs(db, {
        staleThresholdMs,
        maxRetries,
      });
      summary.staleJobsRecovered = staleRecovery.recoveredCount;

      // 2. Telemetry: Count currently eligible stories in queue
      const queueCounts = await countEligibleStoriesInQueue(db, maxRetries);
      summary.storiesEligible = queueCounts.eligible;
      summary.storiesScanned = queueCounts.pending + queueCounts.failed;

      // 3. Atomically claim bounded batch of eligible stories
      const claimedStories = await claimNextStoryBatch(db, {
        batchSize,
        maxRetries,
      });
      summary.storiesClaimed = claimedStories.length;

      let rateLimitEncountered = false;

      for (let i = 0; i < claimedStories.length; i++) {
        const story = claimedStories[i];

        // A. Execution Time Watchdog: ensure sufficient headroom remains for synthesis
        const elapsed = Date.now() - startTime;
        const remainingTimeMs = maxRuntimeMs - elapsed;
        if (remainingTimeMs < 30000 && i > 0) {
          summary.stopReason = 'WATCHDOG_DEADLINE';
          // Release remaining unstarted stories back to 'pending' without penalty
          for (let j = i; j < claimedStories.length; j++) {
            await releaseStoryToPending(db, claimedStories[j].id);
            summary.storiesSkipped++;
          }
          break;
        }

        // B. Gemini Request Budget Check
        const currentGeminiRequests =
          typeof budgetable?.getRequestsExecuted === 'function'
            ? budgetable.getRequestsExecuted()
            : 0;
        const requestsUsedSoFar = currentGeminiRequests - initialGeminiRequests;

        if (requestsUsedSoFar >= geminiBudget) {
          summary.stopReason = 'BUDGET_EXHAUSTED';
          for (let j = i; j < claimedStories.length; j++) {
            await releaseStoryToPending(db, claimedStories[j].id);
            summary.storiesSkipped++;
          }
          break;
        }

        // C. Rate limit guard
        if (rateLimitEncountered) {
          summary.errors.push(
            `Rate limit active: deferred story "${story.title}" to protect API quota.`
          );
          await releaseStoryToPending(db, story.id);
          summary.storiesSkipped++;
          continue;
        }

        let currentStage: FailureStage = 'research';

        try {
          const evidencePacket = await this.researcher.buildEvidencePacket(story.id, {
            deterministicOnly: options?.deterministicEvidence !== false,
          });
          currentStage = 'writing';

          // Pass publication intent explicitly based on upstream editorial decision
          const publicationIntent =
            story.editorialStatus === 'auto_approved' ? 'published' : 'review_pending';

          const savedArticle = await this.writer.synthesizeStoryArticle(evidencePacket, {
            publicationIntent,
            skipIfAlreadyPublished: true,
          });

          if (savedArticle.status === 'published') {
            summary.autoApprovedArticlesPublished++;
          }
        } catch (err) {
          const classification = classifyError(err);

          // Handle Gemini budget exceeded stop (Not a failure on the story)
          if (classification.isBudgetExceeded) {
            summary.stopReason = 'BUDGET_EXHAUSTED';
            await releaseStoryToPending(db, story.id);
            summary.storiesSkipped++;
            // Release remaining claimed stories
            for (let j = i + 1; j < claimedStories.length; j++) {
              await releaseStoryToPending(db, claimedStories[j].id);
              summary.storiesSkipped++;
            }
            break;
          }

          if (classification.isRateLimit) {
            rateLimitEncountered = true;
            summary.quotaEncountered = true;
            summary.stopReason = 'QUOTA_EXHAUSTED';
          }

          const currentRetries = story.retryCount || 0;
          const nextRetryCount = currentRetries + 1;
          const isExhausted = nextRetryCount >= maxRetries;
          const isFinal = !classification.isRetryable || isExhausted;

          if (isFinal) {
            summary.storiesFailed++;
          } else {
            summary.storiesRetried++;
          }

          // Move editorial_status to 'needs_review' if non-retryable or max retries exceeded
          await db
            .update(schema.stories)
            .set({
              editorialStatus: isFinal ? 'needs_review' : 'auto_approved',
              processingStatus: 'failed',
              retryCount: nextRetryCount,
              failureReason: classification.reason,
              failureStage: currentStage,
              lastAttemptedAt: new Date(),
              lastUpdatedAt: new Date(),
            })
            .where(eq(schema.stories.id, story.id));

          const message = err instanceof Error ? err.message : String(err);
          summary.errors.push(
            `Story "${story.title}" failed at stage [${currentStage}] (attempt ${nextRetryCount}/${maxRetries}, retryable: ${classification.isRetryable}): ${message}`
          );

          if (classification.isRateLimit) {
            // Immediately release any remaining claimed stories to pending
            for (let j = i + 1; j < claimedStories.length; j++) {
              await releaseStoryToPending(db, claimedStories[j].id);
              summary.errors.push(
                `Rate limit active: deferred story "${claimedStories[j].title}" to protect API quota.`
              );
              summary.storiesSkipped++;
            }
            break;
          }
        }
      }

      // Determine final stopReason if all claimed items finished
      if (summary.stopReason === 'COMPLETED' && summary.storiesClaimed >= batchSize) {
        summary.stopReason = 'BATCH_LIMIT_REACHED';
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push(`Step 3 dispatch error: ${message}`);
      summary.stopReason = 'FATAL_ERROR';
    }

    // Calculate final Gemini requests used
    const finalGeminiRequests =
      typeof budgetable?.getRequestsExecuted === 'function'
        ? budgetable.getRequestsExecuted()
        : 0;
    summary.geminiRequestsUsed = finalGeminiRequests - initialGeminiRequests;

    const finishedAtMs = Date.now();
    summary.finishedAt = new Date(finishedAtMs).toISOString();
    summary.durationMs = finishedAtMs - startTime;

    // Structured Observability Logging (Phase 10 standard)
    console.log('\n====================================================');
    console.log('NAKSHATRA PRODUCTION WORKER');
    console.log('====================================================');
    console.log(`Run ID: ${summary.runId}`);
    console.log('\nQueue:');
    console.log(`  Eligible: ${summary.storiesEligible}`);
    console.log(`  Claimed:  ${summary.storiesClaimed}`);
    console.log(`  Stale Recovered: ${summary.staleJobsRecovered}`);
    console.log('\nProcessing:');
    console.log(`  Completed (Published): ${summary.autoApprovedArticlesPublished}`);
    console.log(`  Retryable failures:    ${summary.storiesRetried}`);
    console.log(`  Permanent failures:    ${summary.storiesFailed}`);
    console.log(`  Skipped / Deferred:    ${summary.storiesSkipped}`);
    console.log('\nGemini:');
    console.log(`  Requests used:    ${summary.geminiRequestsUsed} / ${summary.geminiBudget}`);
    console.log(`  Quota encountered: ${summary.quotaEncountered}`);
    console.log('\nRuntime:');
    console.log(`  ${(summary.durationMs / 1000).toFixed(1)} seconds`);
    console.log('\nStop reason:');
    console.log(`  ${summary.stopReason}`);
    console.log('====================================================\n');

    return summary;
  }
}

/**
 * Starts continuous background daemon
 */
export async function startPhase2Daemon(options?: {
  intervalSeconds?: number;
  once?: boolean;
  worker?: AutonomousPhase2Worker;
}): Promise<void> {
  const worker = options?.worker || new AutonomousPhase2Worker();
  const interval = options?.intervalSeconds ?? parseInt(process.env.WORKER_INTERVAL_SEC || '60', 10);
  const isOnce = options?.once ?? process.argv.includes('--once');

  let isRunning = true;
  const stop = () => {
    isRunning = false;
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (isRunning) {
    try {
      const db = await getDb();
      const ownerId = `daemon-${process.pid || 'worker'}-${Date.now()}`;
      const lockAcquired = await acquirePipelineLock(db, { lockName: PIPELINE_GLOBAL_LOCK, ownerId });

      if (!lockAcquired) {
        console.log('[Worker] Pipeline locked by another process; skipping this interval.');
      } else {
        try {
          const summary = await worker.runCycle();
          console.log(
            `[NAKSHATRA Worker] Sources due: ${summary.sourcesProcessed}/${summary.sourcesPolled} | Ingested: ${summary.rawArticlesIngested} | Clusters: ${summary.clustersCreated} | Published: ${summary.autoApprovedArticlesPublished} | Errors: ${summary.errors.length}`
          );
        } finally {
          await releasePipelineLock(db, { lockName: PIPELINE_GLOBAL_LOCK, ownerId });
        }
      }
    } catch (err) {
      console.error('[NAKSHATRA Worker Fatal]', err);
    }

    if (isOnce || !isRunning) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}
