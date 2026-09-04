import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq, desc } from 'drizzle-orm';
import { SynthesisResult, VerifiedClaimInput } from './synthesis-agent';

export class ArticleManager {
  /**
   * Persists a synthesized draft article into PostgreSQL with citations and initial revision record
   */
  async saveDraftArticle(params: {
    synthesisResult: SynthesisResult;
    storyClusterId?: string;
    verifiedClaims: VerifiedClaimInput[];
    editorUserId?: string;
  }): Promise<typeof schema.articles.$inferSelect> {
    const db = await getDb();
    const { draft, plagiarismAudit, readingTimeMinutes } = params.synthesisResult;

    // Calculate mean confidence score across verified claims
    const totalConfidence = params.verifiedClaims.reduce((sum, c) => sum + c.confidenceScore, 0);
    const avgConfidence =
      params.verifiedClaims.length > 0
        ? (totalConfidence / params.verifiedClaims.length).toFixed(2)
        : '0.90';

    // 1. Insert Article
    const [insertedArticle] = await db
      .insert(schema.articles)
      .values({
        storyClusterId: params.storyClusterId,
        title: draft.title,
        slug: draft.slug,
        deck: draft.deck,
        contentMarkdown: draft.contentMarkdown,
        metaDescription: draft.metaDescription,
        status: 'review_pending',
        confidenceScore: avgConfidence,
        nGramMaxSimilarity: plagiarismAudit.maxSimilarity.toString(),
        readingTimeMinutes,
      })
      .returning();

    // 2. Insert Citations
    for (const cit of draft.citations) {
      const referencedClaim = params.verifiedClaims[cit.claimIndex];
      await db.insert(schema.articleCitations).values({
        articleId: insertedArticle.id,
        claimId: referencedClaim?.id || null,
        citationIndex: cit.citationIndex,
        anchorText: cit.anchorText,
        primarySourceUrl: cit.primarySourceUrl,
        sourcePublisher: cit.sourcePublisher,
      });
    }

    // 3. Insert Initial Revision
    await db.insert(schema.articleRevisions).values({
      articleId: insertedArticle.id,
      editorUserId: params.editorUserId || 'agent:editorial_synthesis',
      diffSummary: 'Initial autonomous evidence-grounded draft generation.',
      previousContent: draft.contentMarkdown,
    });

    return insertedArticle;
  }

  /**
   * Human approval transition to 'published'
   */
  async approveArticle(articleId: string, editorUserId: string): Promise<void> {
    const db = await getDb();
    await db
      .update(schema.articles)
      .set({
        status: 'published',
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.articles.id, articleId));

    await db.insert(schema.articleRevisions).values({
      articleId,
      editorUserId,
      diffSummary: 'Approved and published to public feed.',
      previousContent: '',
    });
  }

  /**
   * Human rejection transition
   */
  async rejectArticle(articleId: string, editorUserId: string, reason: string): Promise<void> {
    const db = await getDb();
    await db
      .update(schema.articles)
      .set({
        status: 'rejected',
        updatedAt: new Date(),
      })
      .where(eq(schema.articles.id, articleId));

    await db.insert(schema.articleRevisions).values({
      articleId,
      editorUserId,
      diffSummary: `Rejected from publication. Reason: ${reason}`,
      previousContent: '',
    });
  }

  /**
   * Retrieves published articles with full citation relations for the public website
   */
  async getPublishedArticles(limit = 20, offset = 0) {
    const db = await getDb();
    return db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.status, 'published'))
      .orderBy(desc(schema.articles.publishedAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Retrieves article with citations by slug
   */
  async getArticleBySlug(slug: string) {
    const db = await getDb();
    const [article] = await db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.slug, slug))
      .limit(1);

    if (!article) return null;

    const citations = await db
      .select()
      .from(schema.articleCitations)
      .where(eq(schema.articleCitations.articleId, article.id))
      .orderBy(schema.articleCitations.citationIndex);

    return { ...article, citations };
  }

  /**
   * Retrieves pending review articles for the Newsroom dashboard
   */
  async getPendingReviewQueue() {
    const db = await getDb();
    return db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.status, 'review_pending'))
      .orderBy(desc(schema.articles.createdAt));
  }
}
