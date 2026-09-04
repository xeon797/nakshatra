import { getDb } from '../db';
import * as schema from '../db/schema';
import { ensureDatabaseInitialized } from '../db/init';
import { eq } from 'drizzle-orm';
import { IngestionService } from '../services/ingestion/ingest-service';
import { HybridStoryClusteringAgent, ClusteredStoryResult } from './agents/clusterer';
import { MultiSourceResearcherAgent } from './agents/researcher';
import { MultiSourceWriterAgent } from './agents/writer';

export interface Phase2WorkerRunSummary {
  sourcesPolled: number;
  sourcesProcessed: number;
  rawArticlesIngested: number;
  clustersCreated: number;
  autoApprovedArticlesPublished: number;
  errors: string[];
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
  async runCycle(): Promise<Phase2WorkerRunSummary> {
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

      if (lastPolled > 0 && now - lastPolled < pollingIntervalMs) {
        continue;
      }

      summary.sourcesProcessed++;
      try {
        const ingestResult = await this.ingestionService.ingestSource(source);
        summary.rawArticlesIngested += ingestResult.insertedCount;
        if (ingestResult.errors.length > 0) {
          summary.errors.push(...ingestResult.errors);
        }
      } catch (err: any) {
        summary.errors.push(`Failed ingestion for ${source.name}: ${err.message || String(err)}`);
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
      } catch (err: any) {
        summary.errors.push(`Clustering pipeline error: ${err.message || String(err)}`);
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
      const autoApprovedStories = await db
        .select()
        .from(schema.stories)
        .where(eq(schema.stories.editorialStatus, 'auto_approved'));

      for (const story of autoApprovedStories) {
        try {
          const evidencePacket = await this.researcher.buildEvidencePacket(story.id);
          await this.writer.synthesizeStoryArticle(evidencePacket);
          summary.autoApprovedArticlesPublished++;
        } catch (err: any) {
          summary.errors.push(
            `Failed autonomous article generation for story "${story.title}": ${err.message || String(err)}`
          );
        }
      }
    } catch (err: any) {
      summary.errors.push(`Step 3 dispatch error: ${err.message || String(err)}`);
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
      const summary = await worker.runCycle();
      console.log(
        `[NAKSHATRA Worker] Sources due: ${summary.sourcesProcessed}/${summary.sourcesPolled} | Ingested: ${summary.rawArticlesIngested} | Clusters: ${summary.clustersCreated} | Published: ${summary.autoApprovedArticlesPublished} | Errors: ${summary.errors.length}`
      );
    } catch (err: any) {
      console.error('[NAKSHATRA Worker Fatal]', err);
    }

    if (isOnce || !isRunning) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}
