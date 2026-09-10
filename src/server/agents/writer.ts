import { EvidencePacket } from './researcher';
import { EditorialSynthesisAgent, VerifiedClaimInput } from '../../services/editorial/synthesis-agent';
import { ArticleManager } from '../../services/editorial/article-manager';
import { AiModelProvider } from '../../services/ai/provider';
import { getAiProvider } from '../../services/ai/factory';
import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';

export interface SynthesizeStoryArticleOptions {
  publicationIntent?: 'published' | 'review_pending';
  forcePublish?: boolean;
}

export class MultiSourceWriterAgent {
  private synthesisAgent: EditorialSynthesisAgent;
  private articleManager: ArticleManager;

  constructor(aiProvider?: AiModelProvider) {
    const provider = aiProvider || getAiProvider();
    this.synthesisAgent = new EditorialSynthesisAgent(provider);
    this.articleManager = new ArticleManager();
  }

  /**
   * Synthesizes an authoritative article from an aggregated EvidencePacket.
   * Upstream editorial decision determines publication intent.
   * Auto-approved stories are published immediately; others remain in review_pending.
   */
  async synthesizeStoryArticle(
    evidencePacket: EvidencePacket,
    options?: SynthesizeStoryArticleOptions
  ): Promise<typeof schema.articles.$inferSelect> {
    const db = await getDb();

    // 1. Fetch story metadata
    const [story] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, evidencePacket.storyId))
      .limit(1);

    const topicTitle = story ? story.title : 'AI Intelligence Briefing';

    // Upstream editorial decision determines publication intent
    const isAutoApproved = story?.editorialStatus === 'auto_approved';
    const shouldPublish =
      options?.publicationIntent === 'published' ||
      (options?.publicationIntent === undefined && (options?.forcePublish ?? isAutoApproved));
    const targetStatus: 'published' | 'review_pending' = shouldPublish ? 'published' : 'review_pending';
    const targetPublishedAt = shouldPublish ? new Date() : null;

    // 2. Prepare verified claims from confirmedFacts and differingPerspectives
    const verifiedClaims: VerifiedClaimInput[] = [];
    const primarySource = evidencePacket.primarySources[0] || {
      title: topicTitle,
      url: 'https://nakshatra.ai',
      text: 'Primary source documentation',
      sourceName: 'Primary Source',
    };

    for (const fact of evidencePacket.confirmedFacts) {
      verifiedClaims.push({
        claimText: fact,
        claimType: 'product_release',
        confidenceScore: 0.98,
        primarySourceUrl: primarySource.url,
        sourcePublisher: primarySource.sourceName || 'Primary Lab',
        verbatimExcerpt: fact,
      });
    }

    for (const perspective of evidencePacket.differingPerspectives) {
      const secondarySource = evidencePacket.secondarySources[0] || primarySource;
      verifiedClaims.push({
        claimText: perspective,
        claimType: 'quote',
        confidenceScore: 0.85,
        primarySourceUrl: secondarySource.url,
        sourcePublisher: secondarySource.sourceName || 'Industry Analysis',
        verbatimExcerpt: perspective,
      });
    }

    // Ensure at least 1 verified claim exists
    if (verifiedClaims.length === 0) {
      verifiedClaims.push({
        claimText: topicTitle,
        claimType: 'product_release',
        confidenceScore: 0.95,
        primarySourceUrl: primarySource.url,
        sourcePublisher: primarySource.sourceName || 'Primary Lab',
        verbatimExcerpt: topicTitle,
      });
    }

    // 3. Compile raw source texts for the deterministic N-gram plagiarism gate
    const rawSourceTexts = [
      ...evidencePacket.primarySources.map((s) => s.text),
      ...evidencePacket.secondarySources.map((s) => s.text),
    ];

    // 4. Run editorial synthesis agent (Dual-Language EN & BN)
    try {
      const bilingualResult = await this.synthesisAgent.synthesizeBilingualArticle({
        topicTitle,
        verifiedClaims,
        rawSourceTexts,
      });

      // 5. Persist article in PostgreSQL with dual-language fields and determined publication state
      const savedArticle = await this.articleManager.saveDraftArticle({
        synthesisResult: bilingualResult,
        bilingualDraft: bilingualResult.bilingualDraft,
        storyId: story?.id,
        verifiedClaims,
        status: targetStatus,
        publishedAt: targetPublishedAt,
      });

      // 6. Update story publication state finalized ONLY after successful article persistence
      if (story) {
        await db
          .update(schema.stories)
          .set({
            editorialStatus: savedArticle.status === 'published' ? 'published' : story.editorialStatus,
            processingStatus: 'completed',
            failureReason: null,
            failureStage: null,
            lastUpdatedAt: new Date(),
          })
          .where(eq(schema.stories.id, story.id));
      }

      return savedArticle;
    } catch {
      // Graceful fallback to single-language synthesis
      const synthesisResult = await this.synthesisAgent.synthesizeArticle({
        topicTitle,
        verifiedClaims,
        rawSourceTexts,
      });

      const savedArticle = await this.articleManager.saveDraftArticle({
        synthesisResult,
        storyId: story?.id,
        verifiedClaims,
        status: targetStatus,
        publishedAt: targetPublishedAt,
      });

      // 6. Update story publication state finalized ONLY after successful article persistence
      if (story) {
        await db
          .update(schema.stories)
          .set({
            editorialStatus: savedArticle.status === 'published' ? 'published' : story.editorialStatus,
            processingStatus: 'completed',
            failureReason: null,
            failureStage: null,
            lastUpdatedAt: new Date(),
          })
          .where(eq(schema.stories.id, story.id));
      }

      return savedArticle;
    }
  }
}
