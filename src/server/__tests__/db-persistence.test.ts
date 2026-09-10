import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { getDb, closeDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import { seedDemoArticlesIfEmpty } from '../db/seeds/demo-articles';
import { seedSources } from '../db/seeds/sources';

describe('Database Persistence & Multi-Process Sharing', () => {
  const originalDataDir = process.env.PGLITE_DATA_DIR;
  let activeTestDir: string | null = null;

  afterEach(async () => {
    await closeDb();
    if (activeTestDir && fs.existsSync(activeTestDir)) {
      try {
        fs.rmSync(activeTestDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[Cleanup] Failed to remove test dir ${activeTestDir}:`, err);
      }
      activeTestDir = null;
    }
    if (originalDataDir !== undefined) {
      process.env.PGLITE_DATA_DIR = originalDataDir;
    } else {
      delete process.env.PGLITE_DATA_DIR;
    }
  });

  it('preserves data across simulated database shutdown and restart', async () => {
    activeTestDir = path.resolve(process.cwd(), `data/test-persistence-restart-${Date.now()}`);
    process.env.PGLITE_DATA_DIR = activeTestDir;

    resetDbForTesting();
    await initializeDatabase();

    const db1 = await getDb();

    // 1. Create a cluster and persistent article
    const testSlug = `persistence-test-${Date.now()}`;
    const [cluster] = await db1
      .insert(schema.storyClusters)
      .values({
        title: 'Persistent Storage Launch',
        slug: `cluster-${testSlug}`,
        summary: 'Testing embedded database persistence across restarts.',
        status: 'published',
      })
      .returning();

    await db1.insert(schema.articles).values({
      storyClusterId: cluster.id,
      title: 'Persistent Architecture Verified',
      slug: testSlug,
      deck: 'A rigorous verification of disk persistence under embedded PostgreSQL.',
      contentMarkdown: 'This article should survive database shutdown and reopen from disk.',
      metaDescription: 'Verification test article for PGlite persistence.',
      status: 'published',
    });

    // 2. Simulate process shutdown / restart: close DB instance completely
    await closeDb();

    // 3. Re-open DB from the same persistent directory
    const db2 = await getDb();
    const retrieved = await db2
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.slug, testSlug));

    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].title).toBe('Persistent Architecture Verified');
    expect(retrieved[0].contentMarkdown).toBe(
      'This article should survive database shutdown and reopen from disk.'
    );
  }, 35000);

  it('shares database state consistently between Application and Worker workflows', async () => {
    activeTestDir = path.resolve(process.cwd(), `data/test-persistence-worker-${Date.now()}`);
    process.env.PGLITE_DATA_DIR = activeTestDir;

    resetDbForTesting();
    await initializeDatabase();

    // Workflow Step A: Next.js / Ingestion pipeline queues a cluster
    const dbApp = await getDb();
    const clusterSlug = `shared-cluster-${Date.now()}`;
    const [cluster] = await dbApp
      .insert(schema.storyClusters)
      .values({
        title: 'Autonomous Worker Task',
        slug: clusterSlug,
        summary: 'Story cluster queued for background agent processing.',
        status: 'discovering',
      })
      .returning();

    // Simulate worker process accessing the shared DB and progressing the story
    await closeDb(); // simulates independent process connection lifecycle
    const dbWorker = await getDb();

    const [fetchedCluster] = await dbWorker
      .select()
      .from(schema.storyClusters)
      .where(eq(schema.storyClusters.id, cluster.id));

    expect(fetchedCluster).toBeDefined();
    expect(fetchedCluster.status).toBe('discovering');

    // Worker marks cluster as researching and writes article draft
    await dbWorker
      .update(schema.storyClusters)
      .set({ status: 'researched' })
      .where(eq(schema.storyClusters.id, cluster.id));

    const articleSlug = `worker-article-${Date.now()}`;
    await dbWorker.insert(schema.articles).values({
      storyClusterId: cluster.id,
      title: 'Worker Generated Story',
      slug: articleSlug,
      deck: 'Background worker compiled this investigative reporting draft.',
      contentMarkdown: 'Detailed investigative report compiled by background worker.',
      metaDescription: 'Worker generated article draft.',
      status: 'review_pending',
    });

    // Workflow Step B: Application / UI queries updated state
    await closeDb();
    const dbAppCheck = await getDb();

    const [updatedCluster] = await dbAppCheck
      .select()
      .from(schema.storyClusters)
      .where(eq(schema.storyClusters.id, cluster.id));
    expect(updatedCluster.status).toBe('researched');

    const [writtenArticle] = await dbAppCheck
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.slug, articleSlug));
    expect(writtenArticle).toBeDefined();
    expect(writtenArticle.status).toBe('review_pending');
  }, 35000);

  it('guarantees demo seeds are idempotent and do not overwrite or duplicate existing articles', async () => {
    activeTestDir = path.resolve(process.cwd(), `data/test-persistence-seed-${Date.now()}`);
    process.env.PGLITE_DATA_DIR = activeTestDir;

    resetDbForTesting();
    await initializeDatabase();

    // First seed run
    await seedDemoArticlesIfEmpty();
    const db = await getDb();
    const initialArticles = await db.select().from(schema.articles);
    expect(initialArticles.length).toBeGreaterThan(0);
    const countAfterFirstSeed = initialArticles.length;

    // Second seed run should be a no-op
    await seedDemoArticlesIfEmpty();
    const articlesAfterSecondSeed = await db.select().from(schema.articles);
    expect(articlesAfterSecondSeed.length).toBe(countAfterFirstSeed);

    // Source seed idempotency check
    const firstSourceSeed = await seedSources();
    expect(firstSourceSeed.inserted + firstSourceSeed.skipped).toBeGreaterThan(0);

    const secondSourceSeed = await seedSources();
    expect(secondSourceSeed.inserted).toBe(0);
    expect(secondSourceSeed.skipped).toBeGreaterThan(0);
  }, 35000);
});
