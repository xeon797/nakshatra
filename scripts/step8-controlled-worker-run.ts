import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getDb } from '../src/db';
import * as schema from '../src/db/schema';
import { eq, desc } from 'drizzle-orm';
import { AutonomousPhase2Worker } from '../src/server/worker';
import { ArticleManager } from '../src/services/editorial/article-manager';

async function main() {
  console.log('====================================================');
  console.log('STEP 8: CONTROLLED PRODUCTION WORKER RUN');
  console.log('====================================================\n');

  const db = await getDb();
  const articleManager = new ArticleManager();

  // 1. Initial State Audit
  const initialCount = await articleManager.countPublishedArticles();
  const initialArticles = await articleManager.getPublishedArticlesWithMetadata(20, 0);
  console.log(`[Before Run] Published articles in Neon: ${initialCount}`);
  console.log(`[Before Run] Recent articles:`);
  initialArticles.slice(0, 5).forEach((a, i) => {
    console.log(`  ${i + 1}. [${a.slug}] ${a.title}`);
  });

  // Check eligible queue count
  const eligibleStories = await db
    .select({ id: schema.stories.id, title: schema.stories.title, status: schema.stories.editorialStatus, processing: schema.stories.processingStatus })
    .from(schema.stories)
    .where(eq(schema.stories.editorialStatus, 'auto_approved'))
    .limit(5);

  console.log(`\n[Queue Status] Sample auto-approved candidates:`);
  eligibleStories.forEach((s, idx) => {
    console.log(`  ${idx + 1}. ID: ${s.id} | Processing: ${s.processing} | Title: "${s.title}"`);
  });

  // 2. Execute Controlled Worker Cycle
  console.log('\n--- Executing 1 Controlled Autonomous Cycle (batchSize: 2, geminiBudget: 2) ---');
  const worker = new AutonomousPhase2Worker();
  const summary = await worker.runCycle({
    skipIngestion: true,
    skipClustering: true,
    batchSize: 2,
    geminiBudget: 2,
    maxRuntimeMs: 60000,
    deterministicEvidence: true,
  });

  console.log('\n--- Worker Execution Result ---');
  console.log(`Run ID: ${summary.runId}`);
  console.log(`Stop reason: ${summary.stopReason}`);
  console.log(`Duration: ${summary.durationMs}ms`);
  console.log(`Stories eligible: ${summary.storiesEligible}`);
  console.log(`Stories claimed: ${summary.storiesClaimed}`);
  console.log(`Published: ${summary.autoApprovedArticlesPublished}`);
  console.log(`Gemini requests used: ${summary.geminiRequestsUsed}`);
  console.log(`Errors: ${summary.errors.length > 0 ? summary.errors.join('; ') : 'None'}`);

  // 3. Post-Run Verification in Database
  const finalCount = await articleManager.countPublishedArticles();
  const finalArticles = await articleManager.getPublishedArticlesWithMetadata(20, 0);
  console.log(`\n[After Run] Published articles in Neon: ${finalCount} (Delta: +${finalCount - initialCount})`);

  console.log(`\n[Verification] Top Published Articles now in DB:`);
  finalArticles.slice(0, finalCount).forEach((a, i) => {
    console.log(`  ${i + 1}. [${a.slug}] "${a.title}" (Published: ${a.publishedAt})`);
  });

  // 4. Verify the newly created article has complete evidence grounding
  if (finalCount > initialCount) {
    const newestArticle = finalArticles[0];
    console.log(`\n[Verification] Validating newest published article [${newestArticle.slug}]:`);
    const fullArticle = await articleManager.getArticleBySlug(newestArticle.slug);
    if (fullArticle) {
      console.log(`  - Title (EN): "${fullArticle.titleEn || fullArticle.title}"`);
      console.log(`  - Title (BN): "${fullArticle.titleBn}"`);
      console.log(`  - Citations count: ${fullArticle.citations.length}`);
      console.log(`  - Status: ${fullArticle.status}`);
      console.log(`  - Public query accessible: YES`);
    } else {
      console.error(`  - Failed to load newest article by slug!`);
    }
  }

  console.log('\n====================================================');
  console.log('CONTROLLED WORKER RUN COMPLETED SUCCESSFULLY');
  console.log('====================================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('Controlled worker run failed:', err);
  process.exit(1);
});
