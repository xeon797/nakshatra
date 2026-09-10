import { NextResponse } from 'next/server';
import { getDb } from '../../../../db';
import { ensureDatabaseInitialized } from '../../../../db/init';
import { AutonomousPhase2Worker } from '../../../../server/worker';
import {
  acquirePipelineLock,
  releasePipelineLock,
  PIPELINE_GLOBAL_LOCK,
} from '../../../../server/lib/pipeline-lock';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await ensureDatabaseInitialized();
    const db = await getDb();
    const ownerId = `manual-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const lockAcquired = await acquirePipelineLock(db, { lockName: PIPELINE_GLOBAL_LOCK, ownerId });
    if (!lockAcquired) {
      return NextResponse.json(
        {
          success: false,
          skipped: true,
          error: 'Pipeline is currently running in another process (cron or manual run in progress)',
        },
        { status: 409 }
      );
    }

    try {
      const worker = new AutonomousPhase2Worker();
      const summary = await worker.runCycle({ forceAllSources: true });

      return NextResponse.json({
        success: true,
        summary,
        message: `Autonomous cycle complete: polled ${summary.sourcesProcessed}/${summary.sourcesPolled} sources, ingested ${summary.rawArticlesIngested} raw items, created ${summary.clustersCreated} story clusters, published ${summary.autoApprovedArticlesPublished} stories.`,
      });
    } finally {
      await releasePipelineLock(db, { lockName: PIPELINE_GLOBAL_LOCK, ownerId });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pipeline execution failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

