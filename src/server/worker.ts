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
import { revalidatePublishedContent } from '../lib/revalidation';
import { AiExecutionPolicy, AiModelProvider } from '../services/ai/provider';
import { getAiProvider } from '../services/ai/factory';
import {
  GeminiDeadlineExceededError,
  GeminiQuotaExhaustedError,
} from '../services/ai/gemini-provider';
import {
  PIPELINE_GEMINI_TIMEOUT_MS,
  PIPELINE_QUOTA_COOLDOWN_MS,
  PIPELINE_RESEARCH_FETCH_TIMEOUT_MS,
  PIPELINE_SHUTDOWN_HEADROOM_MS,
  PIPELINE_STORY_LEASE_MS,
  PIPELINE_TRANSIENT_COOLDOWN_MS,
  PIPELINE_WORKER_DEADLINE_MS,
} from './lib/runtime-policy';

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
    | 'PROVIDER_UNAVAILABLE'
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
  maxSourcesToIngest?: number;
  skipClustering?: boolean;
  deterministicEvidence?: boolean;
  processQueueOnly?: boolean;
  deadlineAt?: number;
  shutdownHeadroomMs?: number;
  geminiTimeoutMs?: number;
  geminiMaxRetries?: number;
  allowGeminiFallback?: boolean;
  maxSourceEnrichments?: number;
  researchFetchTimeoutMs?: number;
  transientCooldownMs?: number;
  quotaCooldownMs?: number;
}

interface BudgetableAiProvider {
  setRequestBudget?: (budget: number | null) => void;
  getRequestsExecuted?: () => number;
  configureExecutionPolicy?: (policy: AiExecutionPolicy) => void;
  getAttemptsExecuted?: () => number;
}

// Global in-process execution lock to prevent concurrent clusterer runs
let isClusteringLocked = false;

export class AutonomousPhase2Worker {
  private ingestionService: IngestionService;
  private clusterer: HybridStoryClusteringAgent;
  private researcher: MultiSourceResearcherAgent;
  private writer: MultiSourceWriterAgent;
  private aiProvider?: AiModelProvider;

  constructor(dependencies?: {
    ingestionService?: IngestionService;
    clusterer?: HybridStoryClusteringAgent;
    researcher?: MultiSourceResearcherAgent;
    writer?: MultiSourceWriterAgent;
    aiProvider?: AiModelProvider;
  }) {
    const needsSharedProvider =
      !dependencies?.clusterer || !dependencies?.researcher || !dependencies?.writer;
    const sharedProvider = dependencies?.aiProvider || (needsSharedProvider ? getAiProvider() : undefined);
    this.ingestionService = dependencies?.ingestionService || new IngestionService();
    this.clusterer = dependencies?.clusterer || new HybridStoryClusteringAgent(sharedProvider);
    this.researcher = dependencies?.researcher || new MultiSourceResearcherAgent(sharedProvider);
    this.writer = dependencies?.writer || new MultiSourceWriterAgent(sharedProvider);
    this.aiProvider = sharedProvider || this.writer.getAiProvider?.();
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
    const processQueueOnly = options?.processQueueOnly === true;
    const batchSize = options?.batchSize ?? (process.env.WORKER_BATCH_SIZE ? parseInt(process.env.WORKER_BATCH_SIZE, 10) : DEFAULT_WORKER_BATCH_SIZE);
    const geminiBudget = options?.geminiBudget ?? (process.env.WORKER_GEMINI_BUDGET ? parseInt(process.env.WORKER_GEMINI_BUDGET, 10) : 5);
    const maxRuntimeMs = options?.maxRuntimeMs ?? (process.env.WORKER_MAX_RUNTIME_MS ? parseInt(process.env.WORKER_MAX_RUNTIME_MS, 10) : PIPELINE_WORKER_DEADLINE_MS);
    const deadlineAt = options?.deadlineAt ?? startTime + maxRuntimeMs;
    const shutdownHeadroomMs = options?.shutdownHeadroomMs ?? PIPELINE_SHUTDOWN_HEADROOM_MS;
    const geminiTimeoutMs = options?.geminiTimeoutMs ?? PIPELINE_GEMINI_TIMEOUT_MS;
    const staleThresholdMs = options?.staleJobThresholdMs ?? (processQueueOnly ? PIPELINE_STORY_LEASE_MS : DEFAULT_STALE_JOB_THRESHOLD_MS);
    const maxRetries = options?.maxRetries ?? getMaxRetriesFromEnv();
    const transientCooldownMs = options?.transientCooldownMs ?? PIPELINE_TRANSIENT_COOLDOWN_MS;
    const quotaCooldownMs = options?.quotaCooldownMs ?? PIPELINE_QUOTA_COOLDOWN_MS;

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

    // One shared provider is used by clustering, research, synthesis, retries,
    // verification, and model fallback. Attempts are counted before outbound I/O.
    const budgetable = this.aiProvider as unknown as BudgetableAiProvider | undefined;
    if (typeof budgetable?.configureExecutionPolicy === 'function') {
      budgetable.configureExecutionPolicy({
        attemptBudget: geminiBudget,
        maxRetries: options?.geminiMaxRetries ?? (processQueueOnly ? 0 : 1),
        requestTimeoutMs: geminiTimeoutMs,
        deadlineAt,
        shutdownHeadroomMs,
        allowModelFallback: options?.allowGeminiFallback ?? !processQueueOnly,
      });
    } else if (typeof budgetable?.setRequestBudget === 'function') {
      budgetable.setRequestBudget(geminiBudget);
    }
    const initialGeminiRequests =
      typeof budgetable?.getAttemptsExecuted === 'function'
        ? budgetable.getAttemptsExecuted()
        : typeof budgetable?.getRequestsExecuted === 'function'
        ? budgetable.getRequestsExecuted()
        : 0;

    // ─────────────────────────────────────────────────────────────────────────
    // Step 1: Ingest due sources
    // ─────────────────────────────────────────────────────────────────────────
    if (!processQueueOnly && !options?.skipIngestion) {
      const activeSources = await db
        .select()
        .from(schema.sources)
        .where(eq(schema.sources.isActive, true));

      summary.sourcesPolled = activeSources.length;
      const now = Date.now();

      for (const source of activeSources) {
        if (
          options?.maxSourcesToIngest !== undefined &&
          summary.sourcesProcessed >= options.maxSourcesToIngest
        ) {
          break;
        }

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
    let haltBeforeQueue = false;
    if (!processQueueOnly && !options?.skipClustering) {
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
          const classification = classifyError(err);
          if (classification.isBudgetExceeded) {
            summary.stopReason = 'BUDGET_EXHAUSTED';
            haltBeforeQueue = true;
          } else if (classification.isRateLimit) {
            summary.stopReason = 'QUOTA_EXHAUSTED';
            summary.quotaEncountered = true;
            haltBeforeQueue = true;
          } else if (classification.isServiceUnavailable) {
            summary.stopReason = 'PROVIDER_UNAVAILABLE';
            haltBeforeQueue = true;
          }
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
    const activeClaimIds = new Set<string>();
    const getAttemptsUsed = () => {
      const total =
        typeof budgetable?.getAttemptsExecuted === 'function'
          ? budgetable.getAttemptsExecuted()
          : typeof budgetable?.getRequestsExecuted === 'function'
          ? budgetable.getRequestsExecuted()
          : initialGeminiRequests;
      return total - initialGeminiRequests;
    };

    try {
      if (!haltBeforeQueue) {
        // 1. Recover expired processing leases before selecting new work.
        const staleRecovery = await recoverStaleProcessingJobs(db, {
          staleThresholdMs,
          maxRetries,
        });
        summary.staleJobsRecovered = staleRecovery.recoveredCount;

        // 2. Telemetry: Count currently eligible stories in queue.
        const queueCounts = await countEligibleStoriesInQueue(db, maxRetries);
        summary.storiesEligible = queueCounts.eligible;
        summary.storiesScanned = queueCounts.pending + queueCounts.failed;

        // Do not claim work unless research, one Gemini attempt, and cleanup fit.
        if (Date.now() + geminiTimeoutMs + shutdownHeadroomMs >= deadlineAt) {
          summary.stopReason = 'WATCHDOG_DEADLINE';
        } else {
          // 3. Atomically claim a bounded batch of eligible stories.
          const claimedStories = await claimNextStoryBatch(db, {
            batchSize,
            maxRetries,
          });
          summary.storiesClaimed = claimedStories.length;
          for (const story of claimedStories) activeClaimIds.add(story.id);

          const releaseFrom = async (
            startIndex: number,
            releaseOptions?: Parameters<typeof releaseStoryToPending>[2]
          ) => {
            for (let j = startIndex; j < claimedStories.length; j++) {
              const claimed = claimedStories[j];
              if (!activeClaimIds.has(claimed.id)) continue;
              await releaseStoryToPending(db, claimed.id, releaseOptions);
              activeClaimIds.delete(claimed.id);
              summary.storiesSkipped++;
            }
          };

          for (let i = 0; i < claimedStories.length; i++) {
            const story = claimedStories[i];

            if (Date.now() + geminiTimeoutMs + shutdownHeadroomMs >= deadlineAt) {
              summary.stopReason = 'WATCHDOG_DEADLINE';
              await releaseFrom(i, {
                failureReason: 'Worker deadline approached before synthesis began.',
                failureStage: 'timeout',
              });
              break;
            }

            if (getAttemptsUsed() >= geminiBudget) {
              summary.stopReason = 'BUDGET_EXHAUSTED';
              await releaseFrom(i, {
                failureReason: 'Shared Gemini attempt budget exhausted before synthesis.',
                failureStage: 'writing',
              });
              break;
            }

            let currentStage: FailureStage = 'research';

            try {
              const evidencePacket = await this.researcher.buildEvidencePacket(story.id, {
                deterministicOnly: options?.deterministicEvidence !== false,
                maxSourceEnrichments: options?.maxSourceEnrichments ?? (processQueueOnly ? 2 : undefined),
                externalFetchTimeoutMs: options?.researchFetchTimeoutMs ?? PIPELINE_RESEARCH_FETCH_TIMEOUT_MS,
                deadlineAt,
                shutdownHeadroomMs: shutdownHeadroomMs + geminiTimeoutMs,
              });
              currentStage = 'writing';

              if (Date.now() + geminiTimeoutMs + shutdownHeadroomMs >= deadlineAt) {
                summary.stopReason = 'WATCHDOG_DEADLINE';
                await releaseFrom(i, {
                  failureReason: 'Worker deadline approached after research; synthesis was not attempted.',
                  failureStage: 'timeout',
                });
                break;
              }

              const publicationIntent =
                story.editorialStatus === 'auto_approved' ? 'published' : 'review_pending';
              const savedArticle = await this.writer.synthesizeStoryArticle(evidencePacket, {
                publicationIntent,
                skipIfAlreadyPublished: true,
              });

              activeClaimIds.delete(story.id);
              if (savedArticle.status === 'published') {
                summary.autoApprovedArticlesPublished++;
                try {
                  await revalidatePublishedContent(savedArticle.slug);
                } catch (revalidationError) {
                  const revalidationMessage =
                    revalidationError instanceof Error
                      ? revalidationError.message
                      : String(revalidationError);
                  summary.errors.push(
                    `Article "${savedArticle.slug}" persisted, but cache revalidation failed: ${revalidationMessage}`
                  );
                }
              }
            } catch (err) {
              const classification = classifyError(err);
              const message = err instanceof Error ? err.message : String(err);

              if (err instanceof GeminiDeadlineExceededError) {
                summary.stopReason = 'WATCHDOG_DEADLINE';
                await releaseFrom(i, {
                  failureReason: err.message,
                  failureStage: 'timeout',
                });
                break;
              }

              if (classification.isBudgetExceeded) {
                summary.stopReason = 'BUDGET_EXHAUSTED';
                await releaseFrom(i, {
                  failureReason: classification.reason,
                  failureStage: currentStage,
                });
                break;
              }

              if (classification.isRateLimit) {
                summary.quotaEncountered = true;
                summary.stopReason = 'QUOTA_EXHAUSTED';
                const providerDelayMs =
                  err instanceof GeminiQuotaExhaustedError && err.retryDelaySeconds
                    ? err.retryDelaySeconds * 1000
                    : 0;
                const nextAttemptAt = new Date(Date.now() + Math.max(quotaCooldownMs, providerDelayMs));
                summary.errors.push(`Story "${story.title}" deferred after Gemini quota exhaustion: ${message}`);
                await releaseFrom(i, {
                  failureReason: classification.reason,
                  failureStage: currentStage,
                  nextAttemptAt,
                });
                break;
              }

              if (classification.isServiceUnavailable && processQueueOnly) {
                summary.stopReason = 'PROVIDER_UNAVAILABLE';
                summary.errors.push(`Story "${story.title}" deferred after Gemini 503/unavailable: ${message}`);
                await releaseFrom(i, {
                  failureReason: classification.reason,
                  failureStage: currentStage,
                  nextAttemptAt: new Date(Date.now() + transientCooldownMs),
                });
                break;
              }

              const currentRetries = story.retryCount || 0;
              const nextRetryCount = currentRetries + 1;
              const isExhausted = nextRetryCount >= maxRetries;
              const isFinal = !classification.isRetryable || isExhausted;

              if (isFinal) summary.storiesFailed++;
              else summary.storiesRetried++;

              await db
                .update(schema.stories)
                .set({
                  editorialStatus: isFinal ? 'needs_review' : 'auto_approved',
                  processingStatus: 'failed',
                  retryCount: nextRetryCount,
                  failureReason: classification.reason,
                  failureStage: currentStage,
                  lastAttemptedAt: new Date(),
                  nextAttemptAt: isFinal ? null : new Date(Date.now() + transientCooldownMs),
                  lastUpdatedAt: new Date(),
                })
                .where(eq(schema.stories.id, story.id));
              activeClaimIds.delete(story.id);

              summary.errors.push(
                `Story "${story.title}" failed at stage [${currentStage}] (attempt ${nextRetryCount}/${maxRetries}, retryable: ${classification.isRetryable}): ${message}`
              );
            }
          }

          if (summary.stopReason === 'COMPLETED' && summary.storiesClaimed >= batchSize) {
            summary.stopReason = 'BATCH_LIMIT_REACHED';
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push(`Step 3 dispatch error: ${message}`);
      summary.stopReason = 'FATAL_ERROR';
    } finally {
      for (const storyId of activeClaimIds) {
        await releaseStoryToPending(db, storyId, {
          failureReason: 'Worker exited before the claimed story completed.',
          failureStage: 'timeout',
          nextAttemptAt: new Date(Date.now() + transientCooldownMs),
        });
      }
      activeClaimIds.clear();
    }

    // Calculate final Gemini requests used
    const finalGeminiRequests =
      typeof budgetable?.getAttemptsExecuted === 'function'
        ? budgetable.getAttemptsExecuted()
        : typeof budgetable?.getRequestsExecuted === 'function'
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
