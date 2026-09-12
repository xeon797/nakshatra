import { EvidencePacket } from './researcher';
import {
  EditorialSynthesisAgent,
  StrictVerifiedClaim,
  normalizeVerifiedClaim,
  PlagiarismGateError,
  GroundingValidationError,
} from '../../services/editorial/synthesis-agent';
import { ArticleManager } from '../../services/editorial/article-manager';
import { AiModelProvider } from '../../services/ai/provider';
import { getAiProvider } from '../../services/ai/factory';
import { isGeminiControlFlowError } from '../../services/ai/gemini-provider';
import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq, and } from 'drizzle-orm';

export interface SynthesizeStoryArticleOptions {
  publicationIntent?: 'published' | 'review_pending';
  forcePublish?: boolean;
  skipIfAlreadyPublished?: boolean;
}

export class MultiSourceWriterAgent {
  private synthesisAgent: EditorialSynthesisAgent;
  private articleManager: ArticleManager;

  constructor(aiProvider?: AiModelProvider) {
    const provider = aiProvider || getAiProvider();
    this.synthesisAgent = new EditorialSynthesisAgent(provider);
    this.articleManager = new ArticleManager();
  }

  public getAiProvider(): AiModelProvider {
    return this.synthesisAgent.getAiProvider();
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

    // Idempotency check: if skipIfAlreadyPublished is enabled and article already published, return immediately
    if (options?.skipIfAlreadyPublished && story?.id) {
      const [existingPublished] = await db
        .select()
        .from(schema.articles)
        .where(
          and(
            eq(schema.articles.storyId, story.id),
            eq(schema.articles.status, 'published')
          )
        )
        .limit(1);

      if (existingPublished) {
        await db
          .update(schema.stories)
          .set({
            editorialStatus: 'published',
            processingStatus: 'completed',
            failureReason: null,
            failureStage: null,
            nextAttemptAt: null,
            lastUpdatedAt: new Date(),
          })
          .where(eq(schema.stories.id, story.id));

        return existingPublished;
      }
    }

    const topicTitle = story ? story.title : 'AI Intelligence Briefing';

    // Upstream editorial decision determines publication intent
    const isAutoApproved = story?.editorialStatus === 'auto_approved';
    const shouldPublish =
      options?.publicationIntent === 'published' ||
      (options?.publicationIntent === undefined && (options?.forcePublish ?? isAutoApproved));
    const targetStatus: 'published' | 'review_pending' = shouldPublish ? 'published' : 'review_pending';
    const targetPublishedAt = shouldPublish ? new Date() : null;

    // 2. Prepare verified claims from evidencePacket
    const category = story?.category || evidencePacket.category || 'llm_release';
    const verifiedClaims: StrictVerifiedClaim[] = [];
    const primarySource = evidencePacket.primarySources[0] || {
      title: topicTitle,
      url: 'https://nakshatra.ai',
      text: 'Primary source documentation',
      sourceName: 'Primary Source',
    };

    if (evidencePacket.verifiedClaimsList && evidencePacket.verifiedClaimsList.length > 0) {
      for (const vc of evidencePacket.verifiedClaimsList) {
        verifiedClaims.push(normalizeVerifiedClaim(vc));
      }
    } else {
      const inferClaimType = (fact: string): 'benchmark_result' | 'product_release' | 'quote' | 'architecture' | 'policy_or_safety' => {
        if (/(?:benchmark|mmlu|gsm8k|humaneval|swe-bench|score|accuracy|percent|%|sota|outperform)/i.test(fact)) {
          return 'benchmark_result';
        }
        if (/(?:architecture|parameter|context window|weights|transformer|token|latency|inference|training|reasoning)/i.test(fact)) {
          return 'architecture';
        }
        if (/(?:limitat|risk|safety|guardrail|pricing|cost|preview|compute)/i.test(fact)) {
          return 'policy_or_safety';
        }
        if (/^["'].*["']$/.test(fact.trim()) || /(?:said|stated|commented|explained)/i.test(fact)) {
          return 'quote';
        }
        return 'product_release';
      };

      for (let i = 0; i < evidencePacket.confirmedFacts.length; i++) {
        const fact = evidencePacket.confirmedFacts[i];
        verifiedClaims.push(
          normalizeVerifiedClaim({
            claimId: `claim-fact-${i + 1}`,
            claimText: fact,
            sourceUrl: primarySource.url,
            sourceTitle: primarySource.sourceName || 'Primary Lab',
            sourceType: inferClaimType(fact),
            evidenceExcerpt: fact,
            epistemicClass: 'FACT',
            confidenceScore: 0.98,
          })
        );
      }

      for (let i = 0; i < evidencePacket.differingPerspectives.length; i++) {
        const perspective = evidencePacket.differingPerspectives[i];
        const secondarySource = evidencePacket.secondarySources[0] || primarySource;
        const claimType = inferClaimType(perspective) === 'product_release' ? 'quote' : inferClaimType(perspective);
        verifiedClaims.push(
          normalizeVerifiedClaim({
            claimId: `claim-persp-${i + 1}`,
            claimText: perspective,
            sourceUrl: secondarySource.url,
            sourceTitle: secondarySource.sourceName || 'Industry Analysis',
            sourceType: claimType,
            evidenceExcerpt: perspective,
            epistemicClass: 'ANALYSIS',
            confidenceScore: 0.85,
          })
        );
      }
    }

    // Ensure at least 1 verified claim exists
    if (verifiedClaims.length === 0) {
      verifiedClaims.push(
        normalizeVerifiedClaim({
          claimId: 'claim-topic-1',
          claimText: topicTitle,
          sourceUrl: primarySource.url,
          sourceTitle: primarySource.sourceName || 'Primary Lab',
          sourceType: 'product_release',
          evidenceExcerpt: topicTitle,
          epistemicClass: 'FACT',
          confidenceScore: 0.95,
        })
      );
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
        structuredEvidence: evidencePacket.structuredDetails,
        storyClusterId: story?.id,
        primarySourceUrl: primarySource.url,
        primaryPublisher: primarySource.sourceName || 'Primary Lab',
        category,
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
            nextAttemptAt: null,
            lastUpdatedAt: new Date(),
          })
          .where(eq(schema.stories.id, story.id));
      }

      return savedArticle;
    } catch (err) {
      console.warn('[Writer] Bilingual synthesis attempt failed:', err);
      // Runtime, quota, and budget control signals must return to the worker.
      // A second single-language generation here would violate the shared
      // outbound attempt budget and could outlive the function deadline.
      if (isGeminiControlFlowError(err)) {
        throw err;
      }
      // Re-throw critical safety and grounding validation errors
      if (err instanceof PlagiarismGateError || err instanceof GroundingValidationError) {
        throw err;
      }

      // Graceful fallback to single-language synthesis for other errors
      const synthesisResult = await this.synthesisAgent.synthesizeArticle({
        topicTitle,
        verifiedClaims,
        rawSourceTexts,
        structuredEvidence: evidencePacket.structuredDetails,
        storyClusterId: story?.id,
        primarySourceUrl: primarySource.url,
        primaryPublisher: primarySource.sourceName || 'Primary Lab',
        category,
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
            nextAttemptAt: null,
            lastUpdatedAt: new Date(),
          })
          .where(eq(schema.stories.id, story.id));
      }

      return savedArticle;
    }
  }
}
