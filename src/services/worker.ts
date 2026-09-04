import { AutonomousNewsroomOrchestrator } from './orchestrator';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { ensureDatabaseInitialized } from '../db/init';
import { eq } from 'drizzle-orm';
export { AutonomousPhase2Worker, startPhase2Daemon } from '../server/worker';

export interface WorkerRunSummary {
  sourcesPolled: number;
  sourcesProcessed: number;
  articlesSynthesized: number;
  errors: string[];
}

export interface OrchestratorLike {
  processSource(sourceId: string, xmlOverride?: string): Promise<any>;
}

/**
 * Executes a single polling cycle across all active sources due for ingestion
 */
export async function runWorkerCycle(options?: {
  orchestrator?: OrchestratorLike;
}): Promise<WorkerRunSummary> {
  await ensureDatabaseInitialized();
  const db = await getDb();

  const activeSources = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.isActive, true));

  const orchestrator = options?.orchestrator || new AutonomousNewsroomOrchestrator();
  const summary: WorkerRunSummary = {
    sourcesPolled: activeSources.length,
    sourcesProcessed: 0,
    articlesSynthesized: 0,
    errors: [],
  };

  const now = Date.now();

  for (const source of activeSources) {
    const lastPolled = source.lastPolledAt ? new Date(source.lastPolledAt).getTime() : 0;
    const pollingIntervalMs = (source.pollingFrequencyMinutes || 15) * 60 * 1000;

    // Check if source is due for polling (or never polled before)
    if (lastPolled > 0 && now - lastPolled < pollingIntervalMs) {
      continue;
    }

    summary.sourcesProcessed++;
    try {
      const report = await orchestrator.processSource(source.id);
      summary.articlesSynthesized += report.synthesizedArticles.length;
      if (report.failures.length > 0) {
        summary.errors.push(...report.failures);
      }
    } catch (err: any) {
      const msg = `Failed to process source ${source.name}: ${err.message || String(err)}`;
      summary.errors.push(msg);
    }
  }

  return summary;
}

/**
 * Starts the continuous background daemon polling on a fixed interval
 */
export async function startWorkerDaemon(options?: {
  intervalSeconds?: number;
  once?: boolean;
  orchestrator?: OrchestratorLike;
}): Promise<void> {
  await ensureDatabaseInitialized();
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
      const summary = await runWorkerCycle({ orchestrator: options?.orchestrator });
      console.log(
        `[NAKSHATRA Worker] Processed ${summary.sourcesProcessed}/${summary.sourcesPolled} sources | Synthesized: ${summary.articlesSynthesized} | Errors: ${summary.errors.length}`
      );
    } catch (err: any) {
      console.error('[NAKSHATRA Worker Error]', err);
    }

    if (isOnce || !isRunning) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}
