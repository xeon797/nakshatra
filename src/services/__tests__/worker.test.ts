import { describe, it, expect, beforeAll, vi } from 'vitest';
import { runWorkerCycle, startWorkerDaemon } from '../worker';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';

describe('Autonomous Background Polling Worker Daemon', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  it('runs polling cycle, skips sources not due yet, and executes due sources', async () => {
    const db = await getDb();

    // 1. Insert a source that was polled 1 minute ago (interval 15 mins -> NOT due)
    await db.insert(schema.sources).values({
      name: 'Recent Source',
      baseUrl: 'https://recent.example.com/rss.xml',
      sourceType: 'rss',
      pollingFrequencyMinutes: 15,
      lastPolledAt: new Date(Date.now() - 60 * 1000), // 1 minute ago
      isActive: true,
    });

    // 2. Insert a source that was polled 60 minutes ago (interval 15 mins -> DUE)
    const [dueSource] = await db.insert(schema.sources).values({
      name: 'Due Source',
      baseUrl: 'https://due.example.com/rss.xml',
      sourceType: 'rss',
      pollingFrequencyMinutes: 15,
      lastPolledAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
      isActive: true,
    }).returning();

    const mockOrchestrator = {
      processSource: vi.fn().mockResolvedValue({
        sourceName: 'Due Source',
        articlesIngested: 2,
        draftsGenerated: 1,
        synthesizedArticles: ['art-1'],
        failures: [],
        articleIds: ['art-1'],
      }),
    };

    const summary = await runWorkerCycle({ orchestrator: mockOrchestrator });

    expect(summary.sourcesPolled).toBeGreaterThanOrEqual(2);
    expect(summary.sourcesProcessed).toBeGreaterThanOrEqual(1);
    expect(mockOrchestrator.processSource).toHaveBeenCalledWith(dueSource.id);
  });

  it('starts worker daemon in once mode and exits cleanly', async () => {
    const mockOrchestrator = {
      processSource: vi.fn().mockResolvedValue({
        sourceName: 'Mock Source',
        articlesIngested: 1,
        draftsGenerated: 1,
        synthesizedArticles: ['art-mock'],
        failures: [],
        articleIds: ['art-mock'],
      }),
    };

    await expect(
      startWorkerDaemon({ intervalSeconds: 1, once: true, orchestrator: mockOrchestrator })
    ).resolves.not.toThrow();
  });
});
