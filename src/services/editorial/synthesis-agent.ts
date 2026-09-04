import { z } from 'zod';
import { AiModelProvider } from '../ai/provider';
import { AgentAuditLogger } from '../research/audit-logger';
import { PlagiarismDetector, PlagiarismCheckResult } from './plagiarism-detector';

export const ArticleCitationSchema = z.object({
  citationIndex: z.number().int().positive().describe('Numbered index in the article body [^1], [^2].'),
  claimIndex: z.number().int().nonnegative().describe('0-indexed pointer to the verified claim in the input list.'),
  anchorText: z.string().describe('Key phrase or term in the text to associate with this citation.'),
  primarySourceUrl: z.string().url().describe('The verified primary URL of the source.'),
  sourcePublisher: z.string().describe('Name of the publishing organization (e.g. OpenAI, arXiv, DeepMind).'),
});

export const SynthesizedArticleDraftSchema = z.object({
  title: z.string().max(120).describe('Journalistic headline, active voice, non-sensational.'),
  deck: z.string().max(250).describe('Summary deck / subhead explaining the core development.'),
  slug: z.string().describe('URL-friendly kebab-case slug.'),
  contentMarkdown: z.string().describe('Body of the article in markdown with inline footnote tags [^1], [^2].'),
  metaDescription: z.string().max(160).describe('SEO description under 160 characters.'),
  citations: z.array(ArticleCitationSchema).describe('Complete list of mapped citations.'),
});

export type SynthesizedArticleDraft = z.infer<typeof SynthesizedArticleDraftSchema>;

export interface VerifiedClaimInput {
  id?: string;
  claimText: string;
  claimType: string;
  confidenceScore: number;
  primarySourceUrl: string;
  sourcePublisher: string;
  verbatimExcerpt: string;
}

export interface SynthesisResult {
  draft: SynthesizedArticleDraft;
  plagiarismAudit: PlagiarismCheckResult;
  runId?: string;
  readingTimeMinutes: number;
}

export class PlagiarismGateError extends Error {
  constructor(public audit: PlagiarismCheckResult) {
    super(
      `Article draft exceeded verbatim similarity limit (${(audit.maxSimilarity * 100).toFixed(1)}% > 12%). Offending phrases: ${audit.offendingPhrases.join(', ')}`
    );
    this.name = 'PlagiarismGateError';
  }
}

export class EditorialSynthesisAgent {
  private aiProvider: AiModelProvider;
  private logger: AgentAuditLogger;
  private plagiarismDetector: PlagiarismDetector;

  constructor(
    aiProvider: AiModelProvider,
    logger?: AgentAuditLogger,
    plagiarismDetector?: PlagiarismDetector
  ) {
    this.aiProvider = aiProvider;
    this.logger = logger || new AgentAuditLogger();
    this.plagiarismDetector = plagiarismDetector || new PlagiarismDetector();
  }

  async synthesizeArticle(params: {
    topicTitle: string;
    verifiedClaims: VerifiedClaimInput[];
    rawSourceTexts: string[];
    storyClusterId?: string;
  }): Promise<SynthesisResult> {
    if (params.verifiedClaims.length === 0) {
      throw new Error('Cannot synthesize article: No verified claims provided.');
    }

    const startTime = Date.now();
    let runId: string | undefined;

    try {
      runId = await this.logger.startRun({
        agentName: 'EditorialSynthesisAgent',
        agentVersion: '1.0.0',
        modelProvider: this.aiProvider.providerName,
        modelName: this.aiProvider.defaultModel,
        storyClusterId: params.storyClusterId,
      });
    } catch {
      // Graceful logger fallback
    }

    const claimsContext = params.verifiedClaims
      .map(
        (c, idx) =>
          `[Claim ${idx}] (${c.claimType})
Claim: ${c.claimText}
Confidence: ${c.confidenceScore}
Source: ${c.sourcePublisher} (${c.primarySourceUrl})
Verified Excerpt: "${c.verbatimExcerpt}"`
      )
      .join('\n\n');

    const systemPrompt = `You are NAKSHATRA's Lead Editorial Journalist.
Your mandate is to craft an original, concise, evidence-backed news article based ONLY on the provided VERIFIED CLAIMS.

INVIOLABLE RULES:
1. Grounding: You may ONLY state facts directly derived from the verified claims. Zero speculation.
2. Inline Footnotes: For every factual statement, append an inline citation token like [^1], [^2] referencing the citation list.
3. Originality: Write in clear, active journalistic prose. DO NOT copy more than 4 consecutive words verbatim from source text.
4. Completeness: Ensure all citations mapped in the citations array match the [^N] numbers in the body.`;

    const userPrompt = `Story Topic: ${params.topicTitle}

VERIFIED CLAIMS LIST:
${claimsContext}

Generate the full synthesized article draft in JSON conforming to the schema.`;

    try {
      const response = await this.aiProvider.generateStructured(
        userPrompt,
        SynthesizedArticleDraftSchema,
        {
          systemPrompt,
          temperature: 0.2,
        }
      );

      const draft = response.data;

      // Deterministic N-Gram Anti-Plagiarism Gate Check
      const plagiarismAudit = this.plagiarismDetector.check(
        draft.contentMarkdown,
        params.rawSourceTexts
      );

      if (!plagiarismAudit.isAcceptable) {
        throw new PlagiarismGateError(plagiarismAudit);
      }

      // Calculate reading time (avg 200 words per minute)
      const wordCount = draft.contentMarkdown.split(/\s+/).length;
      const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

      if (runId) {
        await this.logger.logStep({
          agentRunId: runId,
          stepNumber: 1,
          actionName: 'synthesize_article',
          inputPayload: {
            topic: params.topicTitle,
            claimsCount: params.verifiedClaims.length,
          },
          outputPayload: {
            title: draft.title,
            citationsCount: draft.citations.length,
            similarityScore: plagiarismAudit.maxSimilarity,
          },
          rationale: `Synthesized original draft with ${draft.citations.length} inline citations and ${(plagiarismAudit.maxSimilarity * 100).toFixed(1)}% verbatim similarity.`,
        });

        await this.logger.finishRun(runId, {
          status: 'success',
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens,
          latencyMs: Date.now() - startTime,
        });
      }

      return {
        draft,
        plagiarismAudit,
        runId,
        readingTimeMinutes,
      };
    } catch (err: any) {
      if (runId) {
        await this.logger.finishRun(runId, {
          status: 'failed',
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: Date.now() - startTime,
          errorMessage: err.message || String(err),
        });
      }
      throw err;
    }
  }
}
