import { describe, it, expect, beforeEach } from 'vitest';
import { handlePipelineCron } from '../cron/pipeline-cron';
import { getDb, resetDbForTesting } from '../../db';
import * as schema from '../../db/schema';
import { ensureDatabaseInitialized } from '../../db/init';
import { eq } from 'drizzle-orm';
import { AutonomousPhase2Worker } from '../worker';

describe('Production Cron Pipeline Route (/api/cron/pipeline)', () => {
  const CRON_SECRET = 'test-cron-secret-2026';

  beforeEach(async () => {
    process.env.CRON_SECRET = CRON_SECRET;
    resetDbForTesting();
    await ensureDatabaseInitialized();
  });

  it('rejects unauthenticated requests with 401 Unauthorized', async () => {
    const req = new Request('http://localhost:3000/api/cron/pipeline', {
      method: 'GET',
    });

    const res = await handlePipelineCron(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects requests with invalid token with 401 Unauthorized', async () => {
    const req = new Request('http://localhost:3000/api/cron/pipeline', {
      method: 'GET',
      headers: {
        authorization: 'Bearer invalid-token',
      },
    });

    const res = await handlePipelineCron(req);
    expect(res.status).toBe(401);
  });

  it('executes autonomous cycle successfully when authenticated via Bearer token', async () => {
    const req = new Request('http://localhost:3000/api/cron/pipeline', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
      },
    });

    const mockWorker = {
      runCycle: async () => ({
        sourcesPolled: 4,
        sourcesProcessed: 2,
        rawArticlesIngested: 3,
        clustersCreated: 1,
        autoApprovedArticlesPublished: 1,
        errors: [],
      }),
    } as unknown as AutonomousPhase2Worker;

    const res = await handlePipelineCron(req, mockWorker);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
    expect(body.metrics.sourcesPolled).toBe(4);
    expect(body.metrics.itemsIngested).toBe(3);
    expect(body.metrics.storiesClustered).toBe(1);
    expect(body.metrics.articlesPublished).toBe(1);

    // Verify agent_runs logged
    const db = await getDb();
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.agentName, 'pipeline_cron'));

    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0].modelName).toBe('orchestrator');
    expect(runs[0].status).toBe('success');
  });

  it('authenticates successfully via query parameter ?secret=', async () => {
    const req = new Request(`http://localhost:3000/api/cron/pipeline?secret=${CRON_SECRET}`, {
      method: 'GET',
    });

    const mockWorker = {
      runCycle: async () => ({
        sourcesPolled: 2,
        sourcesProcessed: 1,
        rawArticlesIngested: 1,
        clustersCreated: 0,
        autoApprovedArticlesPublished: 0,
        errors: [],
      }),
    } as unknown as AutonomousPhase2Worker;

    const res = await handlePipelineCron(req, mockWorker);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.metrics.sourcesPolled).toBe(2);
  });

  it('skips execution when in-database concurrency lock is currently active', async () => {
    const db = await getDb();

    // Acquire lock manually with active lease
    await db.insert(schema.systemLocks).values({
      lockName: 'pipeline_cron',
      lockedAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min in future
      ownerId: 'active-worker-instance',
    });

    const req = new Request('http://localhost:3000/api/cron/pipeline', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
      },
    });

    const res = await handlePipelineCron(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('skipped');
    expect(body.reason).toBe('job_already_running');
  });
});
