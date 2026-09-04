import { ArticleManager } from '../../../services/editorial/article-manager';
import { ensureDatabaseInitialized } from '../../../db/init';
import { getDb } from '../../../db';
import * as schema from '../../../db/schema';
import { eq } from 'drizzle-orm';
import NewsroomClient from './NewsroomClient';

export const dynamic = 'force-dynamic';

export default async function NewsroomPage() {
  await ensureDatabaseInitialized();
  const manager = new ArticleManager();
  const db = await getDb();

  const rawDrafts = await manager.getPendingReviewQueue();

  // Load citations for each draft
  const draftsWithCitations = await Promise.all(
    rawDrafts.map(async (d) => {
      const citations = await db
        .select()
        .from(schema.articleCitations)
        .where(eq(schema.articleCitations.articleId, d.id));

      return {
        id: d.id,
        title: d.title,
        deck: d.deck,
        slug: d.slug,
        contentMarkdown: d.contentMarkdown,
        status: d.status,
        confidenceScore: d.confidenceScore,
        nGramMaxSimilarity: d.nGramMaxSimilarity,
        readingTimeMinutes: d.readingTimeMinutes,
        createdAt: d.createdAt.toISOString(),
        citations: citations.map((c) => ({
          id: c.id,
          citationIndex: c.citationIndex,
          anchorText: c.anchorText,
          primarySourceUrl: c.primarySourceUrl,
          sourcePublisher: c.sourcePublisher,
        })),
      };
    })
  );

  return <NewsroomClient initialDrafts={draftsWithCitations} />;
}
