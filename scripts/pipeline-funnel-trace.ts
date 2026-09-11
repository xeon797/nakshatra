import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getDb, closeDb, schema } from '../src/db';
import { eq, sql, desc } from 'drizzle-orm';
import { ArticleManager } from '../src/services/editorial/article-manager';

const STAGE_TIMEOUT_MS = 6000;

async function runStageWithTimeout<T>(
  stageName: string,
  fn: () => Promise<T>
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[STAGE TIMEOUT] ${stageName} exceeded ${STAGE_TIMEOUT_MS}ms`));
    }, STAGE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runFunnelTrace() {
  console.log('========================================================================');
  console.log('🔍 NAKSHATRA PRODUCTION PIPELINE CONVERSION FUNNEL TRACE');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('========================================================================\n');

  const watchdog = setTimeout(() => {
    console.error('\n🚨 [WATCHDOG] Funnel trace exceeded 30s hard limit. Force exiting.');
    process.exit(1);
  }, 30000);
  watchdog.unref();

  try {
    const db = await getDb();

    // ─────────────────────────────────────────────────────────────────────────
    // 1. ACTIVE SOURCES
    // ─────────────────────────────────────────────────────────────────────────
    console.log('==================================================');
    console.log('STAGE 1: SOURCES');
    console.log('==================================================');
    await runStageWithTimeout('Stage 1: Sources', async () => {
      const [totalSources] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.sources);
      const [activeSources] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.sources).where(eq(schema.sources.isActive, true));
      const [inactiveSources] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.sources).where(eq(schema.sources.isActive, false));

      const tierBreakdown = await db
        .select({
          tier: schema.sources.tier,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.sources)
        .groupBy(schema.sources.tier);

      const [latestPolled] = await db
        .select({ maxPolled: sql<string>`max(last_polled_at)::text` })
        .from(schema.sources);

      console.log(`Total Sources:          ${totalSources.count}`);
      console.log(`Active Sources:         ${activeSources.count}`);
      console.log(`Inactive Sources:       ${inactiveSources.count}`);
      console.log(`Tier Breakdown:        `, tierBreakdown);
      console.log(`Most Recent Polled At:  ${latestPolled.maxPolled || 'NEVER'}\n`);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2. RAW ARTICLES & DEDUPLICATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log('==================================================');
    console.log('STAGE 2: RAW ARTICLES & DEDUPLICATION');
    console.log('==================================================');
    await runStageWithTimeout('Stage 2: Raw Articles', async () => {
      const [totalRaw] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.rawArticles);
      const [distinctUrls] = await db.select({ count: sql<number>`count(distinct canonical_url)::int` }).from(schema.rawArticles);
      const [distinctHashes] = await db.select({ count: sql<number>`count(distinct content_hash)::int` }).from(schema.rawArticles);

      const statusBreakdown = await db
        .select({
          status: schema.rawArticles.processingStatus,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.rawArticles)
        .groupBy(schema.rawArticles.processingStatus);

      const [dateRange] = await db.select({
        oldest: sql<string>`min(created_at)::text`,
        newest: sql<string>`max(created_at)::text`,
        oldestPub: sql<string>`min(published_at)::text`,
        newestPub: sql<string>`max(published_at)::text`,
      }).from(schema.rawArticles);

      console.log(`Total Raw Articles:      ${totalRaw.count}`);
      console.log(`Distinct Canonical URLs: ${distinctUrls.count}`);
      console.log(`Distinct Content Hashes: ${distinctHashes.count}`);
      console.log(`Processing Status:      `, statusBreakdown);
      console.log(`Created Date Range:      ${dateRange.oldest} -> ${dateRange.newest}`);
      console.log(`Published Date Range:    ${dateRange.oldestPub} -> ${dateRange.newestPub}\n`);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 3. STORY CLUSTERS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('==================================================');
    console.log('STAGE 3: STORY CLUSTERS (Phase 1)');
    console.log('==================================================');
    await runStageWithTimeout('Stage 3: Story Clusters', async () => {
      const [totalClusters] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.storyClusters);
      const clusterStatus = await db
        .select({
          status: schema.storyClusters.status,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.storyClusters)
        .groupBy(schema.storyClusters.status);

      console.log(`Total Story Clusters:    ${totalClusters.count}`);
      console.log(`Cluster Statuses:       `, clusterStatus);
      console.log('');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 4. STORIES & TRIAGE DECISIONS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('==================================================');
    console.log('STAGE 4: STORIES & EDITORIAL TRIAGE (Phase 2)');
    console.log('==================================================');
    await runStageWithTimeout('Stage 4: Stories & Triage', async () => {
      const [totalStories] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.stories);

      const editorialBreakdown = await db
        .select({
          editorialStatus: schema.stories.editorialStatus,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.stories)
        .groupBy(schema.stories.editorialStatus);

      const processingBreakdown = await db
        .select({
          processingStatus: schema.stories.processingStatus,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.stories)
        .groupBy(schema.stories.processingStatus);

      const categoryBreakdown = await db
        .select({
          category: schema.stories.category,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.stories)
        .groupBy(schema.stories.category);

      const [storyDates] = await db.select({
        oldest: sql<string>`min(first_seen_at)::text`,
        newest: sql<string>`max(first_seen_at)::text`,
      }).from(schema.stories);

      console.log(`Total Stories:           ${totalStories.count}`);
      console.log(`Editorial Statuses:     `, editorialBreakdown);
      console.log(`Processing Statuses:    `, processingBreakdown);
      console.log(`Categories:             `, categoryBreakdown);
      console.log(`First Seen Range:        ${storyDates.oldest} -> ${storyDates.newest}\n`);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 5. AUTO_APPROVED BOTTLENECK ANALYSIS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('==================================================');
    console.log('STAGE 5: AUTO_APPROVED STORY CONVERSION ANALYSIS');
    console.log('==================================================');
    await runStageWithTimeout('Stage 5: Auto-approved Stories', async () => {
      // Stories marked auto_approved
      const autoApproved = await db
        .select()
        .from(schema.stories)
        .where(eq(schema.stories.editorialStatus, 'auto_approved'));

      // Check which auto_approved stories have articles
      const allArticles = await db.select({ id: schema.articles.id, storyId: schema.articles.storyId }).from(schema.articles);
      const articleStoryIds = new Set(allArticles.map((a) => a.storyId).filter(Boolean));

      const withArticle = autoApproved.filter((s) => articleStoryIds.has(s.id));
      const withoutArticle = autoApproved.filter((s) => !articleStoryIds.has(s.id));

      console.log(`Auto-Approved Stories Total:          ${autoApproved.length}`);
      console.log(`  - Converted to Articles:            ${withArticle.length}`);
      console.log(`  - UNCONVERTED (Without Article):    ${withoutArticle.length}`);

      // Inspect unconverted stories breakdown by processing_status
      const unconvertedProcessingMap: Record<string, number> = {};
      const failureReasonMap: Record<string, number> = {};
      let maxRetriesEncountered = 0;

      for (const s of withoutArticle) {
        const ps = s.processingStatus || 'none';
        unconvertedProcessingMap[ps] = (unconvertedProcessingMap[ps] || 0) + 1;
        if (s.retryCount > maxRetriesEncountered) maxRetriesEncountered = s.retryCount;
        if (s.failureReason) {
          const key = `[${s.failureStage || 'unknown'}] ${s.failureReason.slice(0, 60)}`;
          failureReasonMap[key] = (failureReasonMap[key] || 0) + 1;
        }
      }

      console.log(`Unconverted processing_status breakdown:`, unconvertedProcessingMap);
      console.log(`Max Retry Count encountered:          ${maxRetriesEncountered}`);
      if (Object.keys(failureReasonMap).length > 0) {
        console.log(`Recorded Failure Reasons:`, failureReasonMap);
      }

      // Check lastAttemptedAt timestamps
      const attempted = withoutArticle.filter((s) => s.lastAttemptedAt);
      console.log(`Unconverted stories ever attempted:   ${attempted.length} / ${withoutArticle.length}`);
      if (attempted.length > 0) {
        const lastAttempt = attempted.sort((a, b) => new Date(b.lastAttemptedAt!).getTime() - new Date(a.lastAttemptedAt!).getTime())[0];
        console.log(`Most recent attempt timestamp:        ${new Date(lastAttempt.lastAttemptedAt!).toISOString()} for "${lastAttempt.title}"`);
      }

      // Sample unconverted eligible stories
      console.log('\nTop 3 Sample Unconverted Eligible Stories:');
      for (const s of withoutArticle.slice(0, 3)) {
        console.log(`  - [ID: ${s.id}] "${s.title}" | Cat: ${s.category} | ProcStatus: ${s.processingStatus} | Retries: ${s.retryCount} | LastAttempt: ${s.lastAttemptedAt ? new Date(s.lastAttemptedAt).toISOString() : 'NEVER'}`);
      }
      console.log('');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 6. AGENT RUNS & TELEMETRY (GEMINI SUCCESS / FAILURE)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('==================================================');
    console.log('STAGE 6: AGENT RUNS & GEMINI TELEMETRY');
    console.log('==================================================');
    await runStageWithTimeout('Stage 6: Agent Runs', async () => {
      const [totalRuns] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.agentRuns);

      const agentBreakdown = await db
        .select({
          agentName: schema.agentRuns.agentName,
          status: schema.agentRuns.status,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.agentRuns)
        .groupBy(schema.agentRuns.agentName, schema.agentRuns.status);

      const recentRuns = await db
        .select()
        .from(schema.agentRuns)
        .orderBy(desc(schema.agentRuns.createdAt))
        .limit(5);

      console.log(`Total Agent Runs Logged: ${totalRuns.count}`);
      console.log(`Agent & Status Breakdown:`, agentBreakdown);
      console.log('\nMost Recent 5 Agent Runs:');
      for (const r of recentRuns) {
        console.log(`  - [${new Date(r.createdAt).toISOString()}] Agent: ${r.agentName} | Model: ${r.modelName} | Status: ${r.status} | Latency: ${r.latencyMs}ms | Error: ${r.errorMessage || 'none'}`);
      }
      console.log('');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 7. ARTICLES & PERSISTENCE
    // ─────────────────────────────────────────────────────────────────────────
    console.log('==================================================');
    console.log('STAGE 7: ARTICLES & PERSISTENCE');
    console.log('==================================================');
    await runStageWithTimeout('Stage 7: Articles', async () => {
      const [totalArticles] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.articles);

      const statusBreakdown = await db
        .select({
          status: schema.articles.status,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.articles)
        .groupBy(schema.articles.status);

      const allArticles = await db.select().from(schema.articles);

      console.log(`Total Articles:          ${totalArticles.count}`);
      console.log(`Status Breakdown:       `, statusBreakdown);

      console.log('\nAll Articles in Database:');
      for (const a of allArticles) {
        console.log(`  - [ID: ${a.id}] "${a.title}"`);
        console.log(`    Slug: ${a.slug} | Status: ${a.status} | PubAt: ${a.publishedAt ? new Date(a.publishedAt).toISOString() : 'NULL'} | StoryId: ${a.storyId}`);
        console.log(`    Bilingual: EN title len=${a.titleEn?.length || 0}, BN title len=${a.titleBn?.length || 0}`);
      }
      console.log('');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 8. PUBLIC QUERY VISIBILITY
    // ─────────────────────────────────────────────────────────────────────────
    console.log('==================================================');
    console.log('STAGE 8: PUBLIC QUERY VISIBILITY');
    console.log('==================================================');
    await runStageWithTimeout('Stage 8: Public Queries', async () => {
      const manager = new ArticleManager();
      const visible = await manager.getPublishedArticlesWithMetadata(10, 0);

      console.log(`Public Query Visible Published Articles: ${visible.length}`);
      for (const v of visible) {
        console.log(`  - [${v.id}] "${v.title}" (slug: ${v.slug})`);
      }
      console.log('');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 9. SYSTEM LOCKS / CONCURRENCY STATUS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('==================================================');
    console.log('STAGE 9: SYSTEM LOCKS');
    console.log('==================================================');
    await runStageWithTimeout('Stage 9: System Locks', async () => {
      const locks = await db.select().from(schema.systemLocks);
      console.log(`Active Lock Rows in DB: ${locks.length}`);
      for (const l of locks) {
        console.log(`  - Lock: "${l.lockName}" | Owner: ${l.ownerId} | LockedAt: ${new Date(l.lockedAt).toISOString()} | ExpiresAt: ${new Date(l.expiresAt).toISOString()}`);
      }
      console.log('');
    });

  } finally {
    console.log('==================================================');
    console.log(`[${new Date().toISOString()}] Teardown: Closing database connections...`);
    await closeDb();
    console.log(`[${new Date().toISOString()}] Database connections closed cleanly.`);
  }
}

const isDirectExecution = process.argv[1]?.includes('pipeline-funnel-trace');
if (isDirectExecution) {
  runFunnelTrace()
    .then(() => {
      console.log('\n✓ Funnel trace completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal error during funnel trace:', err);
      process.exit(1);
    });
}
