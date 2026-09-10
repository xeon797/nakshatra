import { z } from 'zod';
import { AiModelProvider } from '../ai/provider';
import { AgentAuditLogger } from './audit-logger';

export const ExtractedClaimSchema = z.object({
  claimText: z.string().describe('An atomic, self-contained factual assertion.'),
  claimType: z.enum([
    'benchmark_result',
    'product_release',
    'quote',
    'architecture',
    'policy_or_safety',
  ]),
  sourceExcerpt: z.string().describe('The exact or near-exact sentence from the source supporting this claim.'),
  confidenceScore: z.number().min(0).max(1).default(0.95),
});

export const ClaimExtractionResultSchema = z.object({
  claims: z.array(ExtractedClaimSchema),
});

export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;

export class ClaimExtractionAgent {
  private aiProvider: AiModelProvider;
  private logger: AgentAuditLogger;

  constructor(aiProvider: AiModelProvider, logger?: AgentAuditLogger) {
    this.aiProvider = aiProvider;
    this.logger = logger || new AgentAuditLogger();
  }

  async extractClaims(params: {
    articleTitle: string;
    articleText: string;
    sourceName: string;
    storyClusterId?: string;
  }): Promise<{ claims: ExtractedClaim[]; runId?: string }> {
    const startTime = Date.now();
    let runId: string | undefined;

    try {
      runId = await this.logger.startRun({
        agentName: 'ClaimExtractionAgent',
        agentVersion: '1.0.0',
        modelProvider: this.aiProvider.providerName,
        modelName: this.aiProvider.defaultModel,
        storyClusterId: params.storyClusterId,
      });
    } catch {
      // In standalone tests or when logger fails, proceed gracefully
    }

    const systemPrompt = `You are NAKSHATRA's Lead Research Agent.
Your job is to deconstruct source articles into atomic, verifiable factual claims.
CRITICAL RULES:
1. Extract concrete facts across all technical dimensions: core announcements/releases, technical architecture & mechanics, benchmark metrics & performance, direct quotes, and limitations/safety.
2. NEVER include subjective speculation, marketing hype, or unverified claims as facts.
3. Every claim MUST be paired with its exact supporting excerpt from the text.
4. If a claim cannot be verified directly in the text, DO NOT include it.
5. Aim to extract 6 to 15 key atomic claims covering all technical dimensions of the article when source material is rich.`;

    const userPrompt = `Source Name: ${params.sourceName}
Article Title: ${params.articleTitle}

Article Text:
"""
${params.articleText}
"""

Extract all atomic factual claims in strict JSON format.`;

    try {
      const response = await this.aiProvider.generateStructured(
        userPrompt,
        ClaimExtractionResultSchema,
        {
          systemPrompt,
          temperature: 0.1,
        }
      );

      const durationMs = Date.now() - startTime;

      if (runId) {
        await this.logger.logStep({
          agentRunId: runId,
          stepNumber: 1,
          actionName: 'extract_claims',
          inputPayload: { title: params.articleTitle, source: params.sourceName },
          outputPayload: { extractedCount: response.data.claims.length },
          rationale: `Extracted ${response.data.claims.length} atomic claims with source excerpts.`,
        });

        await this.logger.finishRun(runId, {
          status: 'success',
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens,
          latencyMs: durationMs,
        });
      }

      const mappedClaims = response.data.claims.map((c) => ({
        claimText: c.claimText,
        claimType: c.claimType,
        sourceExcerpt: c.sourceExcerpt,
        confidenceScore: c.confidenceScore ?? 0.95,
      }));

      return { claims: mappedClaims, runId };
    } catch (err) {
      if (runId) {
        await this.logger.finishRun(runId, {
          status: 'failed',
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: Date.now() - startTime,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  }
}
