import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { SynthesisResult, VerifiedClaimInput } from './synthesis-agent';

export interface BilingualDraftInput {
  en?: {
    title?: string;
    summary?: string;
    content?: string;
    keyTakeaways?: string[];
  };
  bn?: {
    title?: string;
    summary?: string;
    content?: string;
    keyTakeaways?: string[];
  };
}

export interface SaveArticleParams {
  synthesisResult: SynthesisResult;
  storyClusterId?: string;
  storyId?: string;
  verifiedClaims: VerifiedClaimInput[];
  editorUserId?: string;
  bilingualDraft?: BilingualDraftInput;
  status?: 'draft' | 'review_pending' | 'published' | 'rejected';
  publishedAt?: Date | null;
}

export class ArticleManager {
  /**
   * Persists a synthesized draft or published article into PostgreSQL with citations and revision record.
   * Ensures idempotency when retrying for the same storyId.
   */
  async saveDraftArticle(params: SaveArticleParams): Promise<typeof schema.articles.$inferSelect> {
    const db = await getDb();
    const { draft, plagiarismAudit, readingTimeMinutes } = params.synthesisResult;

    // Calculate mean confidence score across verified claims
    const totalConfidence = params.verifiedClaims.reduce((sum, c) => sum + c.confidenceScore, 0);
    const avgConfidence =
      params.verifiedClaims.length > 0
        ? (totalConfidence / params.verifiedClaims.length).toFixed(2)
        : '0.90';

    // Validate citation grounding invariant: every citation must reference a valid verified claim
    for (const cit of draft.citations) {
      if (
        cit.claimIndex === undefined ||
        cit.claimIndex === null ||
        cit.claimIndex < 0 ||
        cit.claimIndex >= params.verifiedClaims.length ||
        !params.verifiedClaims[cit.claimIndex]
      ) {
        throw new Error(
          `Grounding Invariant Violation: Citation index [${cit.citationIndex}] references an invalid or non-existent claim index (${cit.claimIndex}). Draft rejected.`
        );
      }
    }

    // Check if an article already exists for this storyId (idempotency on retry)
    let existingArticle: typeof schema.articles.$inferSelect | null = null;
    if (params.storyId) {
      const [found] = await db
        .select()
        .from(schema.articles)
        .where(eq(schema.articles.storyId, params.storyId))
        .limit(1);
      existingArticle = found || null;
    }

    // Slug collision handling: check if slug exists, and if so, append random unique suffix
    let uniqueSlug = existingArticle ? existingArticle.slug : draft.slug;
    if (!existingArticle) {
      let collisionAttempts = 0;
      while (true) {
        const existing = await db
          .select({ id: schema.articles.id })
          .from(schema.articles)
          .where(eq(schema.articles.slug, uniqueSlug))
          .limit(1);

        if (existing.length === 0) break;

        collisionAttempts++;
        const suffix = Math.random().toString(36).substring(2, 7);
        uniqueSlug = `${draft.slug}-${suffix}`;
        if (collisionAttempts >= 5) break;
      }
    }

    // Bilingual fields resolution
    const bDraft = params.bilingualDraft;
    const titleEn = bDraft?.en?.title || draft.title;
    const titleBn = bDraft?.bn?.title || draft.title;
    const summaryEn = bDraft?.en?.summary || draft.deck;
    const summaryBn = bDraft?.bn?.summary || draft.deck;
    const contentEn = bDraft?.en?.content || draft.contentMarkdown;
    const contentBn = bDraft?.bn?.content || draft.contentMarkdown;
    const keyTakeawaysEn = bDraft?.en?.keyTakeaways || [];
    const keyTakeawaysBn = bDraft?.bn?.keyTakeaways || [];

    // Inherit image_url from primary source linked to story or storyCluster
    let imageUrl: string | null = null;
    if (params.storyId) {
      const primarySource = await db
        .select({ imageUrl: schema.rawArticles.imageUrl })
        .from(schema.storySources)
        .innerJoin(schema.rawArticles, eq(schema.storySources.rawArticleId, schema.rawArticles.id))
        .where(and(eq(schema.storySources.storyId, params.storyId), eq(schema.storySources.isPrimary, true)))
        .limit(1);

      imageUrl = primarySource[0]?.imageUrl || null;

      if (!imageUrl) {
        const anySource = await db
          .select({ imageUrl: schema.rawArticles.imageUrl })
          .from(schema.storySources)
          .innerJoin(schema.rawArticles, eq(schema.storySources.rawArticleId, schema.rawArticles.id))
          .where(eq(schema.storySources.storyId, params.storyId))
          .limit(1);
        imageUrl = anySource[0]?.imageUrl || null;
      }
    } else if (params.storyClusterId) {
      const clusterSource = await db
        .select({ imageUrl: schema.rawArticles.imageUrl })
        .from(schema.storyClusterSources)
        .innerJoin(schema.rawArticles, eq(schema.storyClusterSources.rawArticleId, schema.rawArticles.id))
        .where(eq(schema.storyClusterSources.storyClusterId, params.storyClusterId))
        .limit(1);
      imageUrl = clusterSource[0]?.imageUrl || null;
    }

    const targetStatus = params.status ?? (existingArticle ? existingArticle.status : 'review_pending');
    const targetPublishedAt =
      params.publishedAt !== undefined
        ? params.publishedAt
        : targetStatus === 'published'
        ? (existingArticle?.publishedAt || new Date())
        : null;

    let savedArticle: typeof schema.articles.$inferSelect;

    if (existingArticle) {
      // Update existing article record (idempotent retry)
      const [updated] = await db
        .update(schema.articles)
        .set({
          storyClusterId: params.storyClusterId || existingArticle.storyClusterId,
          title: titleEn,
          deck: summaryEn,
          contentMarkdown: contentEn,
          titleEn,
          titleBn,
          summaryEn,
          summaryBn,
          contentEn,
          contentBn,
          keyTakeawaysEn,
          keyTakeawaysBn,
          metaDescription: draft.metaDescription,
          status: targetStatus,
          confidenceScore: avgConfidence,
          nGramMaxSimilarity: plagiarismAudit.maxSimilarity.toString(),
          readingTimeMinutes,
          imageUrl: imageUrl || existingArticle.imageUrl,
          heroImageUrl: imageUrl || existingArticle.heroImageUrl,
          publishedAt: targetPublishedAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.articles.id, existingArticle.id))
        .returning();

      savedArticle = updated;

      // Delete existing citations so they can be freshly updated
      await db
        .delete(schema.articleCitations)
        .where(eq(schema.articleCitations.articleId, savedArticle.id));

      await db.insert(schema.articleRevisions).values({
        articleId: savedArticle.id,
        editorUserId: params.editorUserId || 'agent:editorial_synthesis',
        diffSummary:
          targetStatus === 'published'
            ? 'Article updated and published from autonomous pipeline.'
            : 'Article draft updated from retry or latest synthesis.',
        previousContent: existingArticle.contentMarkdown,
      });
    } else {
      // 1. Insert New Article
      const [inserted] = await db
        .insert(schema.articles)
        .values({
          storyClusterId: params.storyClusterId,
          storyId: params.storyId,
          title: titleEn,
          slug: uniqueSlug,
          deck: summaryEn,
          contentMarkdown: contentEn,
          titleEn,
          titleBn,
          summaryEn,
          summaryBn,
          contentEn,
          contentBn,
          keyTakeawaysEn,
          keyTakeawaysBn,
          metaDescription: draft.metaDescription,
          status: targetStatus,
          confidenceScore: avgConfidence,
          nGramMaxSimilarity: plagiarismAudit.maxSimilarity.toString(),
          readingTimeMinutes,
          imageUrl: imageUrl || null,
          heroImageUrl: imageUrl || null,
          publishedAt: targetPublishedAt,
        })
        .returning();

      savedArticle = inserted;

      // Insert Initial Revision
      await db.insert(schema.articleRevisions).values({
        articleId: savedArticle.id,
        editorUserId: params.editorUserId || 'agent:editorial_synthesis',
        diffSummary:
          targetStatus === 'published'
            ? 'Initial autonomous evidence-grounded publication.'
            : 'Initial autonomous evidence-grounded draft generation.',
        previousContent: draft.contentMarkdown,
      });
    }

    // 2. Insert Citations
    for (const cit of draft.citations) {
      const referencedClaim = params.verifiedClaims[cit.claimIndex];
      await db.insert(schema.articleCitations).values({
        articleId: savedArticle.id,
        claimId: referencedClaim?.id || null,
        citationIndex: cit.citationIndex,
        anchorText: cit.anchorText,
        primarySourceUrl: cit.primarySourceUrl,
        sourcePublisher: cit.sourcePublisher,
      });
    }

    return savedArticle;
  }

  /**
   * Human approval transition to 'published'
   */
  async approveArticle(articleId: string, editorUserId: string): Promise<void> {
    const db = await getDb();
    const now = new Date();
    const [article] = await db
      .update(schema.articles)
      .set({
        status: 'published',
        publishedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.articles.id, articleId))
      .returning();

    if (article?.storyId) {
      await db
        .update(schema.stories)
        .set({
          editorialStatus: 'published',
          processingStatus: 'completed',
          lastUpdatedAt: now,
        })
        .where(eq(schema.stories.id, article.storyId));
    }

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
    const now = new Date();
    const [article] = await db
      .update(schema.articles)
      .set({
        status: 'rejected',
        updatedAt: now,
      })
      .where(eq(schema.articles.id, articleId))
      .returning();

    if (article?.storyId) {
      await db
        .update(schema.stories)
        .set({
          editorialStatus: 'rejected',
          lastUpdatedAt: now,
        })
        .where(eq(schema.stories.id, article.storyId));
    }

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
   * Retrieves published articles enriched with story metadata and source pills
   */
  async getPublishedArticlesWithMetadata(limit = 30, offset = 0) {
    const db = await getDb();
    const rows = await db
      .select({
        article: schema.articles,
        story: schema.stories,
      })
      .from(schema.articles)
      .leftJoin(schema.stories, eq(schema.articles.storyId, schema.stories.id))
      .where(eq(schema.articles.status, 'published'))
      .orderBy(desc(schema.articles.publishedAt))
      .limit(limit)
      .offset(offset);

    const enriched = await Promise.all(
      rows.map(async ({ article, story }) => {
        let sourcesList: Array<{ name: string; tier?: string; isPrimary?: boolean }> = [];
        if (story) {
          const storySourcesList = await db
            .select({
              name: schema.sources.name,
              tier: schema.sources.tier,
              isPrimary: schema.storySources.isPrimary,
            })
            .from(schema.storySources)
            .innerJoin(schema.rawArticles, eq(schema.storySources.rawArticleId, schema.rawArticles.id))
            .innerJoin(schema.sources, eq(schema.rawArticles.sourceId, schema.sources.id))
            .where(eq(schema.storySources.storyId, story.id));

          sourcesList = storySourcesList;
        }

        if (sourcesList.length === 0) {
          const citations = await db
            .select({
              name: schema.articleCitations.sourcePublisher,
            })
            .from(schema.articleCitations)
            .where(eq(schema.articleCitations.articleId, article.id));
          sourcesList = Array.from(new Set(citations.map((c) => c.name))).map((n) => ({
            name: n,
            tier: 'tier_1_primary',
            isPrimary: true,
          }));
        }

        return {
          ...article,
          story: story || null,
          sources: sourcesList,
        };
      })
    );

    return enriched;
  }

  /**
   * Retrieves article with citations and story metadata by slug
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

    let story = null;
    let storySourcesList: Array<{
      name: string;
      baseUrl: string;
      tier: string;
      isPrimary: boolean;
      title: string;
      url: string;
    }> = [];

    if (article.storyId) {
      const [storyRow] = await db
        .select()
        .from(schema.stories)
        .where(eq(schema.stories.id, article.storyId))
        .limit(1);
      story = storyRow || null;

      if (story) {
        storySourcesList = await db
          .select({
            name: schema.sources.name,
            baseUrl: schema.sources.baseUrl,
            tier: schema.sources.tier,
            isPrimary: schema.storySources.isPrimary,
            title: schema.rawArticles.title,
            url: schema.rawArticles.canonicalUrl,
          })
          .from(schema.storySources)
          .innerJoin(schema.rawArticles, eq(schema.storySources.rawArticleId, schema.rawArticles.id))
          .innerJoin(schema.sources, eq(schema.rawArticles.sourceId, schema.sources.id))
          .where(eq(schema.storySources.storyId, story.id));
      }
    }

    return { ...article, citations, story, storySources: storySourcesList };
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
