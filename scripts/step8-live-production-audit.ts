import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getDb, closeDb, schema } from '../src/db';
import { eq, sql, desc, or, and, lt } from 'drizzle-orm';
import { getMaxRetriesFromEnv } from '../src/server/lib/retry-policy';

async function auditProductionDatabase() {
  console.log('====================================================');
  console.log('📊 STEP 8: PRODUCTION DATABASE AUDIT');
  console.log(`Auditing at: ${new Date().toISOString()}`);
  console.log('====================================================\n');

  const db = await getDb();
  const maxRetries = getMaxRetriesFromEnv();

  try {
    // 1. Stories metrics
    const [totalStoriesRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stories);
    const totalStories = totalStoriesRow?.count ?? 0;

    // Processing status counts
    const [pendingRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stories)
      .where(eq(schema.stories.processingStatus, 'pending'));
    const pendingCount = pendingRow?.count ?? 0;

    const [processingRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stories)
      .where(eq(schema.stories.processingStatus, 'processing'));
    const processingCount = processingRow?.count ?? 0;

    const [failedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stories)
      .where(eq(schema.stories.processingStatus, 'failed'));
    const failedCount = failedRow?.count ?? 0;

    const [completedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stories)
      .where(eq(schema.stories.processingStatus, 'completed'));
    const completedCount = completedRow?.count ?? 0;

    // Editorial status counts
    const [autoApprovedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stories)
      .where(eq(schema.stories.editorialStatus, 'auto_approved'));
    const autoApprovedCount = autoApprovedRow?.count ?? 0;

    const [editorialPublishedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stories)
      .where(eq(schema.stories.editorialStatus, 'published'));
    const editorialPublishedCount = editorialPublishedRow?.count ?? 0;

    const [needsReviewRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stories)
      .where(eq(schema.stories.editorialStatus, 'needs_review'));
    const needsReviewCount = needsReviewRow?.count ?? 0;

    const [rejectedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stories)
      .where(eq(schema.stories.editorialStatus, 'rejected'));
    const rejectedCount = rejectedRow?.count ?? 0;

    // 2. Articles metrics
    const [totalArticlesRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.articles);
    const totalArticles = totalArticlesRow?.count ?? 0;

    const [publishedArticlesRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.articles)
      .where(eq(schema.articles.status, 'published'));
    const publishedArticlesCount = publishedArticlesRow?.count ?? 0;

    const [draftArticlesRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.articles)
      .where(eq(schema.articles.status, 'draft'));
    const draftArticlesCount = draftArticlesRow?.count ?? 0;

    const [reviewPendingArticlesRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.articles)
      .where(eq(schema.articles.status, 'review_pending'));
    const reviewPendingArticlesCount = reviewPendingArticlesRow?.count ?? 0;

    // 3. Eligible stories for processing right now
    // An eligible story: editorialStatus = 'auto_approved', processingStatus in ('pending', 'failed'), retryCount < maxRetries
    const [eligibleRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stories)
      .where(
        and(
          eq(schema.stories.editorialStatus, 'auto_approved'),
          or(
            eq(schema.stories.processingStatus, 'pending'),
            and(
              eq(schema.stories.processingStatus, 'failed'),
              lt(schema.stories.retryCount, maxRetries)
            )
          )
        )
      );
    const eligibleCount = eligibleRow?.count ?? 0;

    // 4. Print Summary Report
    console.log('--- STORIES BREAKDOWN ---');
    console.log(`Total Stories:       ${totalStories}`);
    console.log(`  Pending:           ${pendingCount}`);
    console.log(`  Processing:        ${processingCount}`);
    console.log(`  Failed:            ${failedCount}`);
    console.log(`  Completed:         ${completedCount}`);
    console.log(`  Auto-Approved:     ${autoApprovedCount}`);
    console.log(`  Editorial Pub:     ${editorialPublishedCount}`);
    console.log(`  Needs Review:      ${needsReviewCount}`);
    console.log(`  Rejected:          ${rejectedCount}`);
    console.log(`  Eligible Right Now:${eligibleCount} (with retryCount < ${maxRetries})`);

    console.log('\n--- ARTICLES BREAKDOWN ---');
    console.log(`Total Articles:      ${totalArticles}`);
    console.log(`  Published:         ${publishedArticlesCount}`);
    console.log(`  Draft:             ${draftArticlesCount}`);
    console.log(`  Review Pending:    ${reviewPendingArticlesCount}`);

    // 5. Latest 20 published articles
    const latestPublished = await db
      .select({
        id: schema.articles.id,
        title: schema.articles.title,
        slug: schema.articles.slug,
        status: schema.articles.status,
        publishedAt: schema.articles.publishedAt,
        storyId: schema.articles.storyId,
      })
      .from(schema.articles)
      .where(eq(schema.articles.status, 'published'))
      .orderBy(desc(schema.articles.publishedAt))
      .limit(20);

    console.log(`\n--- LATEST PUBLISHED ARTICLES (${latestPublished.length}) ---`);
    latestPublished.forEach((art, idx) => {
      console.log(
        `${idx + 1}. [${art.status}] "${art.title}"\n   slug: ${art.slug}\n   publishedAt: ${art.publishedAt ? new Date(art.publishedAt).toISOString() : 'NULL'}\n   storyId: ${art.storyId}`
      );
    });

    console.log('\n====================================================');
    console.log('AUDIT COMPLETE');
    console.log('====================================================');
  } finally {
    await closeDb();
  }
}

auditProductionDatabase().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
