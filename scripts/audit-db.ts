import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getDb } from '../src/db';
import * as schema from '../src/db/schema';
import { eq, sql } from 'drizzle-orm';

async function runAudit() {
  const db = await getDb();
  
  // 1. Basic Counts
  const [rawCount] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.rawArticles);
  const [storyCount] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.stories);
  const [articleCount] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.articles);
  const [publishedCount] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.articles).where(eq(schema.articles.status, 'published'));
  const [reviewPendingCount] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.articles).where(eq(schema.articles.status, 'review_pending'));
  const [failedStories] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.stories).where(eq(schema.stories.processingStatus, 'failed'));
  
  console.log('=== BASIC COUNTS ===');
  console.log('Total raw articles:', rawCount.count);
  console.log('Total clustered stories:', storyCount.count);
  console.log('Total synthesized articles:', articleCount.count);
  console.log('Total published articles:', publishedCount.count);
  console.log('Total review_pending articles:', reviewPendingCount.count);
  console.log('Total failed stories:', failedStories.count);

  // 2. Breakdown of published articles by category
  console.log('\n=== PUBLISHED BY CATEGORY ===');
  const categories = ['llm_release', 'agentic', 'infra', 'research', 'policy'] as const;
  
  const allPubRows = await db
    .select({
      id: schema.articles.id,
      title: schema.articles.title,
      slug: schema.articles.slug,
      publishedAt: schema.articles.publishedAt,
      contentMarkdown: schema.articles.contentMarkdown,
      deck: schema.articles.deck,
      category: schema.stories.category
    })
    .from(schema.articles)
    .leftJoin(schema.stories, eq(schema.articles.storyId, schema.stories.id))
    .where(eq(schema.articles.status, 'published'));

  for (const cat of categories) {
    const catRows = allPubRows.filter(r => (r.category || 'llm_release') === cat);
    const count = catRows.length;
    if (count === 0) {
      console.log(`Category [${cat}]: COUNT = 0`);
      continue;
    }
    
    const dates = catRows.map(r => r.publishedAt ? new Date(r.publishedAt).getTime() : 0).filter(d => d > 0);
    const oldest = dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : 'N/A';
    const latest = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : 'N/A';
    const lengths = catRows.map(r => (r.contentMarkdown || '').length);
    const avgLen = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
    const minLen = Math.min(...lengths);
    const maxLen = Math.max(...lengths);
    
    console.log(`Category [${cat}]:`);
    console.log(`  published_count: ${count}`);
    console.log(`  oldest_published_at: ${oldest}`);
    console.log(`  latest_published_at: ${latest}`);
    console.log(`  average_article_length: ${avgLen} chars`);
    console.log(`  minimum_article_length: ${minLen} chars`);
    console.log(`  maximum_article_length: ${maxLen} chars`);
    for (const r of catRows) {
      console.log(`    - [${r.id}] "${r.title.slice(0, 60)}" (slug: ${r.slug}, chars: ${(r.contentMarkdown || '').length})`);
    }
  }

  // 3. Anomalies Detection
  console.log('\n=== ANOMALY DETECTION ===');
  
  // Orphaned stories without articles
  const allStories = await db.select().from(schema.stories);
  const allArticles = await db.select().from(schema.articles);
  const storyIdsWithArticles = new Set(allArticles.map(a => a.storyId).filter(Boolean));
  const orphanedStories = allStories.filter(s => !storyIdsWithArticles.has(s.id));
  console.log('Total orphaned stories (stories without articles):', orphanedStories.length);
  
  // Published stories linked to non-published articles
  const publishedStories = allStories.filter(s => s.editorialStatus === 'published');
  const pubStoryAnomalies = [];
  for (const ps of publishedStories) {
    const linkedArts = allArticles.filter(a => a.storyId === ps.id);
    const hasPub = linkedArts.some(a => a.status === 'published');
    if (!hasPub) {
      pubStoryAnomalies.push({ storyId: ps.id, title: ps.title, linkedCount: linkedArts.length });
    }
  }
  console.log('Published stories linked to non-published articles:', pubStoryAnomalies.length);
  
  // Duplicate article slugs
  const slugCounts = new Map<string, number>();
  for (const a of allArticles) {
    slugCounts.set(a.slug, (slugCounts.get(a.slug) || 0) + 1);
  }
  const dupSlugs = Array.from(slugCounts.entries()).filter(([_, count]) => count > 1);
  console.log('Duplicate article slugs:', dupSlugs.length, dupSlugs);
  
  // Duplicate articles for the same story
  const storyArticleCounts = new Map<string, number>();
  for (const a of allArticles) {
    if (a.storyId) {
      storyArticleCounts.set(a.storyId, (storyArticleCounts.get(a.storyId) || 0) + 1);
    }
  }
  const dupStoryArticles = Array.from(storyArticleCounts.entries()).filter(([_, count]) => count > 1);
  console.log('Duplicate articles for the same story:', dupStoryArticles.length, dupStoryArticles);
  
  // Articles missing citations
  const [citationsCount] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.articleCitations);
  console.log('Total citation rows in DB:', citationsCount.count);
  const articlesWithoutCitations = [];
  for (const a of allArticles) {
    const [c] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.articleCitations).where(eq(schema.articleCitations.articleId, a.id));
    if (c.count === 0) {
      articlesWithoutCitations.push({ id: a.id, title: a.title, status: a.status });
    }
  }
  console.log('Articles missing citations:', articlesWithoutCitations.length, articlesWithoutCitations);
  
  // Articles with null/empty body content
  const emptyBody = allArticles.filter(a => !a.contentMarkdown || a.contentMarkdown.trim().length === 0);
  console.log('Articles with null/empty body content:', emptyBody.length);
  
  // Stale auto_approved stories that never completed publication
  const staleAutoApproved = allStories.filter(s => s.editorialStatus === 'auto_approved' && !storyIdsWithArticles.has(s.id));
  console.log('Stale auto_approved stories without articles:', staleAutoApproved.length);
  console.log('Breakdown of stale auto_approved stories by category:');
  const staleByCat: Record<string, number> = {};
  for (const s of staleAutoApproved) {
    const c = s.category || 'unknown';
    staleByCat[c] = (staleByCat[c] || 0) + 1;
  }
  console.log(staleByCat);

  process.exit(0);
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
