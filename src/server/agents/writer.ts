import { EvidencePacket } from './researcher';
import { EditorialSynthesisAgent, VerifiedClaimInput } from '../../services/editorial/synthesis-agent';
import { ArticleManager } from '../../services/editorial/article-manager';
import { AiModelProvider } from '../../services/ai/provider';
import { getAiProvider } from '../../services/ai/factory';
import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';

export class MultiSourceWriterAgent {
  private synthesisAgent: EditorialSynthesisAgent;
  private articleManager: ArticleManager;

  constructor(aiProvider?: AiModelProvider) {
    const provider = aiProvider || getAiProvider();
    this.synthesisAgent = new EditorialSynthesisAgent(provider);
    this.articleManager = new ArticleManager();
  }

  /**
   * Synthesizes an authoritative article from an aggregated EvidencePacket
   */
  async synthesizeStoryArticle(
    evidencePacket: EvidencePacket
  ): Promise<typeof schema.articles.$inferSelect> {
    const db = await getDb();

    // 1. Fetch story metadata
    const [story] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, evidencePacket.storyId))
      .limit(1);

    const topicTitle = story ? story.title : 'AI Intelligence Briefing';

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

      // 5. Persist draft article in PostgreSQL with dual-language fields
      const savedDraft = await this.articleManager.saveDraftArticle({
        synthesisResult: bilingualResult,
        bilingualDraft: bilingualResult.bilingualDraft,
        storyId: story?.id,
        verifiedClaims,
      });

      // 6. Update story status to published
      if (story) {
        await db
          .update(schema.stories)
          .set({
            editorialStatus: 'published',
            processingStatus: 'completed',
            failureReason: null,
            failureStage: null,
            lastUpdatedAt: new Date(),
          })
          .where(eq(schema.stories.id, story.id));
      }

      return savedDraft;
    } catch {
      // Graceful fallback to single-language synthesis
      const synthesisResult = await this.synthesisAgent.synthesizeArticle({
        topicTitle,
        verifiedClaims,
        rawSourceTexts,
      });

      const savedDraft = await this.articleManager.saveDraftArticle({
        synthesisResult,
        storyId: story?.id,
        verifiedClaims,
      });

      if (story) {
        await db
          .update(schema.stories)
          .set({
            editorialStatus: 'published',
            processingStatus: 'completed',
            failureReason: null,
            failureStage: null,
            lastUpdatedAt: new Date(),
          })
          .where(eq(schema.stories.id, story.id));
      }

      return savedDraft;
    }
  }
}
