import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getDb, closeDb, schema } from '../src/db';
import { validateProductionEnv } from '../src/lib/env';
import { eq, sql, desc, and } from 'drizzle-orm';
import { AutonomousPhase2Worker } from '../src/server/worker';
import { ArticleManager } from '../src/services/editorial/article-manager';

const SCRIPT_TIMEOUT_MS = 90000; // 90 second hard watchdog

async function main() {
  const scriptStart = Date.now();
  console.log('========================================================================');
  console.log('🚀 STEP 7: AUTONOMOUS PRODUCTION WORKER & BACKLOG RECOVERY VERIFICATION');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('Constraints: Max 1 Story | Gemini Budget = 2 | Real Neon Database');
  console.log('========================================================================\n');

  const watchdog = setTimeout(() => {
    console.error('\n🚨 [WATCHDOG] Step 7 production recovery script exceeded 90s. Forcing exit.');
    process.exit(1);
  }, SCRIPT_TIMEOUT_MS);
  watchdog.unref();

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Environment Validation
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[Phase 1] Validating Production Environment...');
    validateProductionEnv();
    console.log('  ✔ Environment variables validated successfully.\n');

    const db = await getDb();

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: Baseline Neon Metrics
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[Phase 2] Gathering Neon Production Baseline...');
    const [initialArticlesRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.articles)
      .where(eq(schema.articles.status, 'published'));
    const initialPublishedCount = initialArticlesRow.count;

    const [initialStoriesRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stories);
    const initialStoriesCount = initialStoriesRow.count;

    const [initialEligibleRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stories)
      .where(
        and(
          eq(schema.stories.editorialStatus, 'auto_approved'),
          sql`${schema.stories.processingStatus} != 'completed'`
        )
      );
    const initialEligibleCount = initialEligibleRow.count;

    const [activeLocksRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.systemLocks);
    const initialLocksCount = activeLocksRow.count;

    console.log(`  - Published Articles Baseline: ${initialPublishedCount}`);
    console.log(`  - Total Stories:               ${initialStoriesCount}`);
    console.log(`  - Eligible In Queue:           ${initialEligibleCount}`);
    console.log(`  - Active System Locks:         ${initialLocksCount}\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Run Bounded Autonomous Worker Cycle
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[Phase 3] Instantiating AutonomousPhase2Worker and running bounded cycle...');
    console.log('  - Options: batchSize: 1, geminiBudget: 2, skipIngestion: true, skipClustering: true, maxRuntimeMs: 65000');

    const worker = new AutonomousPhase2Worker();
    const cycleStartMs = Date.now();
    const summary = await worker.runCycle({
      batchSize: 1,
      geminiBudget: 2,
      skipIngestion: true,
      skipClustering: true,
      maxRuntimeMs: 65000,
    });
    const cycleDurationMs = Date.now() - cycleStartMs;

    console.log('\n[Phase 3 Complete] Worker Cycle Execution Summary:');
    console.log(`  - Run ID:                 ${summary.runId}`);
    console.log(`  - Duration:               ${(cycleDurationMs / 1000).toFixed(1)}s`);
    console.log(`  - Stop Reason:            ${summary.stopReason}`);
    console.log(`  - Stories Claimed:        ${summary.storiesClaimed}`);
    console.log(`  - Articles Published:     ${summary.autoApprovedArticlesPublished}`);
    console.log(`  - Gemini Requests Used:   ${summary.geminiRequestsUsed} / ${summary.geminiBudget}`);
    console.log(`  - Stale Jobs Recovered:   ${summary.staleJobsRecovered}`);
    console.log(`  - Quota Encountered:      ${summary.quotaEncountered}`);
    console.log(`  - Errors:                 ${summary.errors.length > 0 ? summary.errors.join('; ') : 'None'}\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: Neon Post-Run Verification
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[Phase 4] Verifying Neon Database Post-Run Invariants...');

    const [postArticlesRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.articles)
      .where(eq(schema.articles.status, 'published'));
    const postPublishedCount = postArticlesRow.count;

    console.log(`  - Published Articles: Initial = ${initialPublishedCount} -> Post = ${postPublishedCount}`);
    if (summary.autoApprovedArticlesPublished > 0) {
      if (postPublishedCount !== initialPublishedCount + summary.autoApprovedArticlesPublished) {
        throw new Error(
          `Published count mismatch: expected ${initialPublishedCount + summary.autoApprovedArticlesPublished}, got ${postPublishedCount}`
        );
      }
      console.log('  ✔ Published count increment invariant verified.');
    }

    // Inspect the most recently published article
    const [latestArticle] = await db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.status, 'published'))
      .orderBy(desc(schema.articles.publishedAt))
      .limit(1);

    if (latestArticle) {
      console.log('\n  [Latest Published Article Details]');
      console.log(`    - ID:            ${latestArticle.id}`);
      console.log(`    - Story ID:      ${latestArticle.storyId}`);
      console.log(`    - Slug:          ${latestArticle.slug}`);
      console.log(`    - Title (EN):    ${latestArticle.titleEn}`);
      console.log(`    - Title (BN):    ${latestArticle.titleBn || 'N/A'}`);
      console.log(`    - Summary (BN):  ${latestArticle.summaryBn ? latestArticle.summaryBn.slice(0, 100) + '...' : 'N/A'}`);
      console.log(`    - Status:        ${latestArticle.status}`);
      console.log(`    - Published At:  ${latestArticle.publishedAt?.toISOString()}`);
      console.log(`    - Confidence:    ${latestArticle.confidenceScore}`);
      console.log(`    - Reading Time:  ${latestArticle.readingTimeMinutes} min`);

      const citations = await db
        .select()
        .from(schema.articleCitations)
        .where(eq(schema.articleCitations.articleId, latestArticle.id));
      console.log(`    - Citations:     ${citations.length} persisted citations`);

      // Verify associated story state
      if (latestArticle.storyId) {
        const [linkedStory] = await db
          .select()
          .from(schema.stories)
          .where(eq(schema.stories.id, latestArticle.storyId));

        if (linkedStory) {
          console.log('\n  [Associated Story Verification]');
          console.log(`    - ID:                ${linkedStory.id}`);
          console.log(`    - Title:             "${linkedStory.title}"`);
          console.log(`    - Editorial Status:  ${linkedStory.editorialStatus}`);
          console.log(`    - Processing Status: ${linkedStory.processingStatus}`);
          console.log(`    - Retry Count:       ${linkedStory.retryCount}`);

          if (linkedStory.editorialStatus !== 'published') {
            throw new Error(`Story editorialStatus should be 'published', found '${linkedStory.editorialStatus}'`);
          }
          if (linkedStory.processingStatus !== 'completed') {
            throw new Error(`Story processingStatus should be 'completed', found '${linkedStory.processingStatus}'`);
          }
          console.log('  ✔ Linked story state machine transition verified (editorial: published, processing: completed).');
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 5: Public Query Visibility
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n[Phase 5] Verifying Public Feed Query Visibility...');
    const articleManager = new ArticleManager();
    const publicArticles = await articleManager.getPublishedArticlesWithMetadata(10, 0);
    console.log(`  - Publicly visible articles count: ${publicArticles.length}`);
    const foundInFeed = publicArticles.some((a) => a.id === latestArticle?.id);
    console.log(`  - Newly published article visible in public feed: ${foundInFeed ? 'YES ✔' : 'NO ❌'}`);
    if (!foundInFeed && latestArticle) {
      throw new Error(`Newly published article ${latestArticle.id} not visible in public feed query.`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 6: System Locks Invariant
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n[Phase 6] Verifying System Locks Release...');
    const [finalLocksRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.systemLocks);
    console.log(`  - Active locks in system_locks: ${finalLocksRow.count}`);
    if (finalLocksRow.count > 0) {
      throw new Error(`Lingering system locks detected: ${finalLocksRow.count}`);
    }
    console.log('  ✔ Zero lingering locks verified.');

    const totalElapsedSec = ((Date.now() - scriptStart) / 1000).toFixed(1);
    console.log('\n========================================================================');
    console.log(`✅ STEP 7 PRODUCTION VERIFICATION COMPLETE (${totalElapsedSec}s)`);
    console.log('========================================================================');
  } finally {
    clearTimeout(watchdog);
    await closeDb();
  }
}

main().catch((err) => {
  console.error('\n❌ [STEP 7 VERIFICATION FAILED]', err);
  process.exit(1);
});
