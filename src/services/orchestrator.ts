import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { IngestionService } from './ingestion/ingest-service';
import { ClaimExtractionAgent } from './research/claim-extractor';
import { FactVerificationAgent, SourceDocument } from './research/fact-verifier';
import { EditorialSynthesisAgent, VerifiedClaimInput } from './editorial/synthesis-agent';
import { ArticleManager } from './editorial/article-manager';
import { getAiProvider } from './ai/factory';

export interface PipelineExecutionReport {
  sourceName: string;
  articlesIngested: number;
  draftsGenerated: number;
  failures: string[];
  articleIds: string[];
}

export class AutonomousNewsroomOrchestrator {
  private ingestionService: IngestionService;
  private claimExtractor: ClaimExtractionAgent;
  private factVerifier: FactVerificationAgent;
  private synthesisAgent: EditorialSynthesisAgent;
  private articleManager: ArticleManager;

  constructor(aiProvider = getAiProvider()) {
    this.ingestionService = new IngestionService();
    this.claimExtractor = new ClaimExtractionAgent(aiProvider);
    this.factVerifier = new FactVerificationAgent(aiProvider);
    this.synthesisAgent = new EditorialSynthesisAgent(aiProvider);
    this.articleManager = new ArticleManager();
  }

  /**
   * Runs the complete autonomous news cycle for a given source
   */
  async processSource(sourceId: string, xmlOverride?: string): Promise<PipelineExecutionReport> {
    const db = await getDb();
    const [source] = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, sourceId))
      .limit(1);

    if (!source) {
      throw new Error(`Source with id ${sourceId} not found.`);
    }

    const report: PipelineExecutionReport = {
      sourceName: source.name,
      articlesIngested: 0,
      draftsGenerated: 0,
      failures: [],
      articleIds: [],
    };

    // 1. Ingestion Step
    const ingestResult = await this.ingestionService.ingestSource(source, xmlOverride);
    report.articlesIngested = ingestResult.insertedCount;

    if (ingestResult.insertedCount === 0) {
      return report;
    }

    // 2. Fetch the newly ingested raw articles for this source
    const rawArticles = await db
      .select()
      .from(schema.rawArticles)
      .where(eq(schema.rawArticles.sourceId, source.id))
      .orderBy(schema.rawArticles.createdAt)
      .limit(ingestResult.insertedCount);

    for (const rawArticle of rawArticles) {
      try {
        // Create or find Story Cluster
        const slug = `story-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const [cluster] = await db
          .insert(schema.storyClusters)
          .values({
            title: rawArticle.title,
            slug,
            summary: rawArticle.summaryExcerpt || rawArticle.title,
            status: 'researching',
          })
          .returning();

        // 3. Claim Extraction Step
        const { claims } = await this.claimExtractor.extractClaims({
          articleTitle: rawArticle.title,
          articleText: rawArticle.cleanText,
          sourceName: source.name,
          storyClusterId: cluster.id,
        });

        if (claims.length === 0) {
          continue;
        }

        // 4. Fact Verification Step against source material
        const sourceDoc: SourceDocument = {
          id: source.id,
          url: rawArticle.canonicalUrl,
          sourceName: source.name,
          sourceTier: (source.tier as any) || 'tier_2_verified',
          text: rawArticle.cleanText,
        };

        const verifiedOutcomes = await this.factVerifier.verifyClaimsGraph({
          claims,
          sources: [sourceDoc],
          storyClusterId: cluster.id,
        });

        // Filter strictly verified claims
        const verifiedClaimsOnly = verifiedOutcomes.filter((o) =>
          o.verificationStatus.startsWith('verified')
        );

        if (verifiedClaimsOnly.length === 0) {
          report.failures.push(
            `Article "${rawArticle.title}" had no claims that passed primary verification.`
          );
          continue;
        }

        // Persist claims & evidences to database
        const verifiedInputs: VerifiedClaimInput[] = [];

        for (const voc of verifiedClaimsOnly) {
          const [claimRow] = await db
            .insert(schema.claims)
            .values({
              storyClusterId: cluster.id,
              claimText: voc.claimText,
              claimType: voc.claimType,
              extractedFromRawId: rawArticle.id,
              verificationStatus: voc.verificationStatus,
              confidenceScore: voc.confidenceScore.toString(),
            })
            .returning();

          const primaryEvidence = voc.evidences[0];
          if (primaryEvidence) {
            await db.insert(schema.evidences).values({
              claimId: claimRow.id,
              sourceUrl: primaryEvidence.sourceUrl,
              sourceName: primaryEvidence.sourceName,
              sourceTier: primaryEvidence.sourceTier,
              verbatimExcerpt: primaryEvidence.verbatimExcerpt,
              entailment: primaryEvidence.entailment,
              rationale: primaryEvidence.rationale,
            });

            verifiedInputs.push({
              id: claimRow.id,
              claimText: voc.claimText,
              claimType: voc.claimType,
              confidenceScore: voc.confidenceScore,
              primarySourceUrl: primaryEvidence.sourceUrl,
              sourcePublisher: primaryEvidence.sourceName,
              verbatimExcerpt: primaryEvidence.verbatimExcerpt,
            });
          }
        }

        // 5. Evidence-Bounded Editorial Synthesis Step
        const synthesisResult = await this.synthesisAgent.synthesizeArticle({
          topicTitle: rawArticle.title,
          verifiedClaims: verifiedInputs,
          rawSourceTexts: [rawArticle.cleanText],
          storyClusterId: cluster.id,
        });

        // 6. Persist Draft Article
        const savedDraft = await this.articleManager.saveDraftArticle({
          synthesisResult,
          storyClusterId: cluster.id,
          verifiedClaims: verifiedInputs,
        });

        report.draftsGenerated++;
        report.articleIds.push(savedDraft.id);
      } catch (err: any) {
        report.failures.push(`Failed processing "${rawArticle.title}": ${err.message}`);
      }
    }

    return report;
  }
}
