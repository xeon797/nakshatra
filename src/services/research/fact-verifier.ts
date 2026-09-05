import { z } from 'zod';
import { AiModelProvider } from '../ai/provider';
import { AgentAuditLogger } from './audit-logger';
import { searchSecondarySources } from '../../server/services/external-research';

export const VerificationVerdictSchema = z.object({
  entailment: z.enum(['supports', 'refutes', 'inconclusive']).describe('Whether the source text supports, refutes, or is inconclusive about the claim.'),
  verbatimExcerpt: z.string().describe('The verbatim excerpt from the source text that proves or disproves the claim.'),
  rationale: z.string().describe('Precise explanation for why this entailment decision was made.'),
  confidenceScore: z.number().min(0).max(1).default(0.95),
});

export type VerificationVerdict = z.infer<typeof VerificationVerdictSchema> & {
  promptTokens?: number;
  completionTokens?: number;
};

export interface SourceDocument {
  id: string;
  url: string;
  sourceName: string;
  sourceTier: 'tier_1_primary' | 'tier_2_verified' | 'tier_3_aggregator';
  text: string;
}

export interface VerifiedClaimOutcome {
  claimText: string;
  claimType: string;
  verificationStatus: 'verified_primary' | 'verified_corroborated' | 'disputed' | 'debunked' | 'unverified';
  confidenceScore: number;
  evidences: Array<{
    sourceUrl: string;
    sourceName: string;
    sourceTier: string;
    verbatimExcerpt: string;
    entailment: 'supports' | 'refutes' | 'inconclusive';
    rationale: string;
  }>;
}

export class FactVerificationAgent {
  private aiProvider: AiModelProvider;
  private logger: AgentAuditLogger;

  constructor(aiProvider: AiModelProvider, logger?: AgentAuditLogger) {
    this.aiProvider = aiProvider;
    this.logger = logger || new AgentAuditLogger();
  }

  async verifyClaimAgainstSource(params: {
    claimText: string;
    source: SourceDocument;
  }): Promise<VerificationVerdict> {
    const systemPrompt = `You are an elite, uncompromising Fact-Checking Agent for NAKSHATRA.
Your job is to perform strict Natural Language Inference (NLI) on an atomic factual claim against a source document.

RULES:
1. "supports": The source document explicitly and unambiguously states or directly entails the claim.
2. "refutes": The source document contradicts or disproves the claim.
3. "inconclusive": The source document does NOT mention this claim, or only vaguely touches on it without proving it.
4. "verbatimExcerpt" MUST be an exact quote taken from the source document. If inconclusive, provide the closest relevant sentence or empty string.
5. Never assume or extrapolate beyond what is literally written in the source text.`;

    const userPrompt = `Claim to Verify:
"""
${params.claimText}
"""

Source (${params.source.sourceName} - Tier: ${params.source.sourceTier}):
"""
${params.source.text}
"""

Determine whether the source SUPPORTS, REFUTES, or is INCONCLUSIVE regarding the claim in JSON.`;

    const response = await this.aiProvider.generateStructured(
      userPrompt,
      VerificationVerdictSchema,
      {
        systemPrompt,
        temperature: 0.05,
      }
    );

    return {
      ...response.data,
      confidenceScore: response.data.confidenceScore ?? 0.95,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
    };
  }

  async verifyClaimsGraph(params: {
    claims: Array<{ claimText: string; claimType: string }>;
    sources: SourceDocument[];
    storyClusterId?: string;
  }): Promise<VerifiedClaimOutcome[]> {
    const startTime = Date.now();
    let runId: string | undefined;

    try {
      runId = await this.logger.startRun({
        agentName: 'FactVerificationAgent',
        agentVersion: '1.0.0',
        modelProvider: this.aiProvider.providerName,
        modelName: this.aiProvider.defaultModel,
        storyClusterId: params.storyClusterId,
      });
    } catch {
      // Graceful logger fallback
    }

    const outcomes: VerifiedClaimOutcome[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    try {
      for (let i = 0; i < params.claims.length; i++) {
        const claim = params.claims[i];
        const evidences: VerifiedClaimOutcome['evidences'] = [];
        let supportsCount = 0;
        let hasPrimarySupport = false;
        let refutesCount = 0;
        let maxConfidence = 0;

        for (const source of params.sources) {
          const verdict = await this.verifyClaimAgainstSource({
            claimText: claim.claimText,
            source,
          });

          totalPromptTokens += verdict.promptTokens ?? 0;
          totalCompletionTokens += verdict.completionTokens ?? 0;

          evidences.push({
            sourceUrl: source.url,
            sourceName: source.sourceName,
            sourceTier: source.sourceTier,
            verbatimExcerpt: verdict.verbatimExcerpt,
            entailment: verdict.entailment,
            rationale: verdict.rationale,
          });

          if (verdict.entailment === 'supports') {
            supportsCount++;
            if (source.sourceTier === 'tier_1_primary') {
              hasPrimarySupport = true;
            }
            if (verdict.confidenceScore > maxConfidence) {
              maxConfidence = verdict.confidenceScore;
            }
          } else if (verdict.entailment === 'refutes') {
            refutesCount++;
          }
        }

        let verificationStatus: VerifiedClaimOutcome['verificationStatus'] = 'unverified';

        if (refutesCount > 0 && supportsCount === 0) {
          verificationStatus = 'debunked';
        } else if (refutesCount > 0 && supportsCount > 0) {
          verificationStatus = 'disputed';
        } else if (hasPrimarySupport) {
          verificationStatus = 'verified_primary';
        } else if (supportsCount >= 2) {
          verificationStatus = 'verified_corroborated';
        } else if (supportsCount === 1) {
          verificationStatus = 'verified_primary'; // Single verified source in MVP
        }

        // Corroborate controversial/unverified claims using Tavily secondary source discovery
        if (verificationStatus === 'disputed' || verificationStatus === 'unverified') {
          try {
            const secondaryResults = await searchSecondarySources(claim.claimText);
            for (let sIdx = 0; sIdx < secondaryResults.length; sIdx++) {
              const secRes = secondaryResults[sIdx];
              if (!secRes.content || secRes.content.length < 30) continue;
              const secDoc: SourceDocument = {
                id: `tavily-sec-${sIdx}`,
                url: secRes.url,
                sourceName: secRes.title || 'Secondary Verification Source',
                sourceTier: 'tier_2_verified',
                text: secRes.content,
              };

              const secVerdict = await this.verifyClaimAgainstSource({
                claimText: claim.claimText,
                source: secDoc,
              });

              totalPromptTokens += secVerdict.promptTokens ?? 0;
              totalCompletionTokens += secVerdict.completionTokens ?? 0;

              evidences.push({
                sourceUrl: secDoc.url,
                sourceName: secDoc.sourceName,
                sourceTier: secDoc.sourceTier,
                verbatimExcerpt: secVerdict.verbatimExcerpt,
                entailment: secVerdict.entailment,
                rationale: secVerdict.rationale,
              });

              if (secVerdict.entailment === 'supports') {
                supportsCount++;
                if (secVerdict.confidenceScore > maxConfidence) {
                  maxConfidence = secVerdict.confidenceScore;
                }
              } else if (secVerdict.entailment === 'refutes') {
                refutesCount++;
              }
            }

            if (refutesCount > 0 && supportsCount === 0) {
              verificationStatus = 'debunked';
            } else if (refutesCount > 0 && supportsCount > 0) {
              verificationStatus = 'disputed';
            } else if (hasPrimarySupport) {
              verificationStatus = 'verified_primary';
            } else if (supportsCount >= 2) {
              verificationStatus = 'verified_corroborated';
            } else if (supportsCount === 1) {
              verificationStatus = 'verified_primary';
            }
          } catch {
            // Secondary corroboration fallback
          }
        }

        outcomes.push({
          claimText: claim.claimText,
          claimType: claim.claimType,
          verificationStatus,
          confidenceScore: maxConfidence || 0.5,
          evidences,
        });
      }

      if (runId) {
        await this.logger.logStep({
          agentRunId: runId,
          stepNumber: 1,
          actionName: 'verify_claims_graph',
          inputPayload: { claimCount: params.claims.length, sourceCount: params.sources.length },
          outputPayload: {
            verifiedCount: outcomes.filter((o) => o.verificationStatus.startsWith('verified')).length,
          },
          rationale: `Verified ${outcomes.length} claims across ${params.sources.length} sources.`,
        });

        await this.logger.finishRun(runId, {
          status: 'success',
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          latencyMs: Date.now() - startTime,
        });
      }

      return outcomes;
    } catch (err: any) {
      if (runId) {
        await this.logger.finishRun(runId, {
          status: 'failed',
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          latencyMs: Date.now() - startTime,
          errorMessage: err.message || String(err),
        });
      }
      throw err;
    }
  }
}
