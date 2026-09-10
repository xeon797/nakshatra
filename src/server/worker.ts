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
  isStoryEligibleForRetry,
  getMaxRetriesFromEnv,
  FailureStage,
} from './lib/retry-policy';
import {
  acquirePipelineLock,
  releasePipelineLock,
  PIPELINE_GLOBAL_LOCK,
} from './lib/pipeline-lock';

export interface Phase2WorkerRunSummary {
  sourcesPolled: number;
  sourcesProcessed: number;
  rawArticlesIngested: number;
  clustersCreated: number;
  autoApprovedArticlesPublished: number;
  errors: string[];
}

export interface Phase2WorkerRunOptions {
  forceAllSources?: boolean;
  maxRetries?: number;
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
   * Step 1: Ingest due sources
   * Step 2: Run Clusterer.processUnclustered() with execution lock
   * Step 3: Trigger Writer/FactChecker on stories where editorial_status == 'auto_approved'
   */
  async runCycle(options?: Phase2WorkerRunOptions): Promise<Phase2WorkerRunSummary> {
    await ensureDatabaseInitialized();
    const db = await getDb();

    const summary: Phase2WorkerRunSummary = {
      sourcesPolled: 0,
      sourcesProcessed: 0,
      rawArticlesIngested: 0,
      clustersCreated: 0,
      autoApprovedArticlesPublished: 0,
      errors: [],
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Step 1: Ingest due sources
    // ─────────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    // Step 2: Run Clusterer.processUnclustered() with concurrency execution lock
    // ─────────────────────────────────────────────────────────────────────────
    let newClusters: ClusteredStoryResult[] = [];
    if (!isClusteringLocked) {
      isClusteringLocked = true;
      try {
        newClusters = await this.clusterer.processUnclustered(36);
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

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3: Trigger Writer & Fact-Checker on stories where editorial_status == 'auto_approved'
    // ─────────────────────────────────────────────────────────────────────────
    try {
      const maxRetries = options?.maxRetries ?? getMaxRetriesFromEnv();
      const autoApprovedStories = await db
        .select()
        .from(schema.stories)
        .where(eq(schema.stories.editorialStatus, 'auto_approved'));

      let rateLimitEncountered = false;

      for (const story of autoApprovedStories) {
        if (rateLimitEncountered) {
          summary.errors.push(
            `Rate limit active: deferred story "${story.title}" to protect API quota.`
          );
          break;
        }

        if (!isStoryEligibleForRetry(story, maxRetries)) {
          continue;
        }

        // Transition to 'processing'
        await db
          .update(schema.stories)
          .set({
            processingStatus: 'processing',
            lastAttemptedAt: new Date(),
            lastUpdatedAt: new Date(),
          })
          .where(eq(schema.stories.id, story.id));

        let currentStage: FailureStage = 'research';

        try {
          const evidencePacket = await this.researcher.buildEvidencePacket(story.id);
          currentStage = 'writing';

          // Pass publication intent explicitly based on upstream editorial decision
          const publicationIntent =
            story.editorialStatus === 'auto_approved' ? 'published' : 'review_pending';

          const savedArticle = await this.writer.synthesizeStoryArticle(evidencePacket, {
            publicationIntent,
          });

          if (savedArticle.status === 'published') {
            summary.autoApprovedArticlesPublished++;
          }
        } catch (err) {
          const classification = classifyError(err);
          const currentRetries = story.retryCount || 0;
          const nextRetryCount = currentRetries + 1;
          const isExhausted = nextRetryCount >= maxRetries;
          const isFinal = !classification.isRetryable || isExhausted;

          if (classification.isRateLimit) {
            rateLimitEncountered = true;
          }

          // If non-retryable or max retries exceeded:
          // Move editorial_status to 'needs_review' so automatic execution stops forever
          // and the story is queryable/visible by newsroom editors for manual intervention.
          // Otherwise keep 'auto_approved' but mark processing_status 'failed' with backoff.
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
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push(`Step 3 dispatch error: ${message}`);
    }

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
