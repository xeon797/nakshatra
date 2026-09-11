import { NextResponse } from 'next/server';
import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { ensureDatabaseInitialized } from '../../db/init';
import { verifyCronSecret } from '../../lib/auth';
import { AutonomousPhase2Worker } from '../worker';
import {
  acquirePipelineLock,
  releasePipelineLock,
  PIPELINE_GLOBAL_LOCK,
} from '../lib/pipeline-lock';

export async function handlePipelineCron(req: Request, workerInstance?: AutonomousPhase2Worker) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureDatabaseInitialized();
  const db = await getDb();
  const ownerId = `cron-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  // Safe 90s lease prevents stalled locks if a serverless container terminates abruptly
  const lockAcquired = await acquirePipelineLock(db, {
    lockName: PIPELINE_GLOBAL_LOCK,
    ownerId,
    leaseMs: 90000,
  });
  if (!lockAcquired) {
    return NextResponse.json(
      { status: 'skipped', reason: 'job_already_running' },
      { status: 200 }
    );
  }

  const startTime = Date.now();
  let workerSummary;
  let runStatus = 'success';
  let errorMessage: string | null = null;

  try {
    let url: URL | null = null;
    try {
      url = new URL(req.url);
    } catch {
      // ignore
    }

    const paramBatch = url?.searchParams.get('batchSize');
    const paramBudget = url?.searchParams.get('geminiBudget');
    const skipIngest = url?.searchParams.get('skipIngestion') === 'true';
    const forceAll = url?.searchParams.get('forceAllSources') === 'true';

    const worker = workerInstance || new AutonomousPhase2Worker();
    const batchSize = paramBatch
      ? parseInt(paramBatch, 10)
      : process.env.CRON_BATCH_SIZE
      ? parseInt(process.env.CRON_BATCH_SIZE, 10)
      : 2;
    const geminiBudget = paramBudget
      ? parseInt(paramBudget, 10)
      : process.env.CRON_GEMINI_BUDGET
      ? parseInt(process.env.CRON_GEMINI_BUDGET, 10)
      : 2;
    const maxRuntimeMs = 25000; // 25s safe for serverless invocation limits

    workerSummary = await worker.runCycle({
      batchSize,
      geminiBudget,
      maxRuntimeMs,
      maxSourcesToIngest: forceAll ? undefined : 2,
      skipIngestion: skipIngest,
      forceAllSources: forceAll,
    });

    if (workerSummary.errors.length > 0) {
      errorMessage = workerSummary.errors.slice(0, 5).join('; ');
      if (
        workerSummary.rawArticlesIngested === 0 &&
        workerSummary.clustersCreated === 0 &&
        workerSummary.autoApprovedArticlesPublished === 0
      ) {
        runStatus = 'partial_error';
      }
    }
  } catch (err) {
    runStatus = 'error';
    errorMessage = err instanceof Error ? err.message : String(err);
    workerSummary = {
      runId: ownerId,
      startedAt: new Date(startTime).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
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
      geminiBudget: 0,
      quotaEncountered: false,
      stopReason: 'FATAL_ERROR' as const,
      errors: [errorMessage],
    };
  } finally {
    await releasePipelineLock(db, { lockName: PIPELINE_GLOBAL_LOCK, ownerId });
  }

  const durationMs = Date.now() - startTime;

  try {
    await db.insert(schema.agentRuns).values({
      agentName: 'pipeline_cron',
      agentVersion: '1.0.0',
      modelProvider: 'system',
      modelName: 'orchestrator',
      promptTokens: 0,
      completionTokens: 0,
      totalCostUsd: '0.000000',
      latencyMs: durationMs,
      status: runStatus,
      errorMessage,
    });
  } catch (logErr) {
    console.warn('[Pipeline Cron] Failed to log agent run:', logErr);
  }

  if (runStatus === 'error') {
    return NextResponse.json(
      {
        success: false,
        durationMs,
        error: errorMessage,
        metrics: {
          sourcesPolled: workerSummary.sourcesPolled,
          itemsIngested: workerSummary.rawArticlesIngested,
          storiesClustered: workerSummary.clustersCreated,
          articlesPublished: workerSummary.autoApprovedArticlesPublished,
          storiesClaimed: workerSummary.storiesClaimed,
          staleJobsRecovered: workerSummary.staleJobsRecovered,
          geminiRequestsUsed: workerSummary.geminiRequestsUsed,
          stopReason: workerSummary.stopReason,
        },
        errors: workerSummary.errors,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    durationMs,
    metrics: {
      sourcesPolled: workerSummary.sourcesPolled,
      itemsIngested: workerSummary.rawArticlesIngested,
      storiesClustered: workerSummary.clustersCreated,
      articlesPublished: workerSummary.autoApprovedArticlesPublished,
      storiesClaimed: workerSummary.storiesClaimed,
      staleJobsRecovered: workerSummary.staleJobsRecovered,
      geminiRequestsUsed: workerSummary.geminiRequestsUsed,
      stopReason: workerSummary.stopReason,
    },
    errors: workerSummary.errors,
  });
}
