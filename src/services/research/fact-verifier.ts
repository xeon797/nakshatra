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

export const BatchClaimVerificationSchema = z.object({
  verdicts: z.array(
    z.object({
      claimIndex: z.number().describe('0-indexed pointer matching the input claims list.'),
      entailment: z.enum(['supports', 'refutes', 'inconclusive']).describe('Whether the source text supports, refutes, or is inconclusive.'),
      verbatimExcerpt: z.string().default('').describe('Verbatim quote from the source supporting or refuting the claim.'),
      rationale: z.string().default('').describe('Explanation for entailment decision.'),
      confidenceScore: z.number().min(0).max(1).default(0.95),
    })
  ),
});

export type BatchClaimVerification = z.infer<typeof BatchClaimVerificationSchema>;

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

  /**
   * Batch verifies multiple claims against a single source document in ONE structured LLM call,
   * avoiding N * M sequential Gemini requests and prompt token re-transmission.
   */
  async verifyClaimsBatchAgainstSource(params: {
    claims: Array<{ claimText: string; claimType: string }>;
    source: SourceDocument;
  }): Promise<{
    verdicts: Map<number, VerificationVerdict>;
    promptTokens: number;
    completionTokens: number;
  }> {
    if (params.claims.length === 0) {
      return { verdicts: new Map(), promptTokens: 0, completionTokens: 0 };
    }

    if (params.claims.length === 1) {
      const single = await this.verifyClaimAgainstSource({
        claimText: params.claims[0].claimText,
        source: params.source,
      });
      const map = new Map<number, VerificationVerdict>();
      map.set(0, single);
      return {
        verdicts: map,
        promptTokens: single.promptTokens ?? 0,
        completionTokens: single.completionTokens ?? 0,
      };
    }

    const systemPrompt = `You are an elite, uncompromising Fact-Checking Agent for NAKSHATRA.
Your job is to perform strict Natural Language Inference (NLI) on a list of candidate claims against a single source document in ONE batch.

RULES:
1. "supports": The source document explicitly and unambiguously states or entails the claim.
2. "refutes": The source document contradicts or disproves the claim.
3. "inconclusive": The source document does NOT mention this claim, or only vaguely touches on it without proving it.
4. "verbatimExcerpt" MUST be an exact quote taken from the source document.
5. "claimIndex" MUST be the 0-indexed integer corresponding to each claim in the numbered claims list.`;

    const claimsListPrompt = params.claims
      .map((c, idx) => `[Claim ${idx}] (${c.claimType}): "${c.claimText}"`)
      .join('\n');

    const userPrompt = `Source Document (${params.source.sourceName} - Tier: ${params.source.sourceTier}):
"""
${params.source.text}
"""

Evaluate each of the following ${params.claims.length} claims against the source document above:
${claimsListPrompt}

Return a verdicts array with an entry for each claim index in strict JSON.`;

    try {
      const response = await this.aiProvider.generateStructured(
        userPrompt,
        BatchClaimVerificationSchema,
        {
          systemPrompt,
          temperature: 0.05,
        }
      );

      const map = new Map<number, VerificationVerdict>();
      for (const item of response.data.verdicts) {
        map.set(item.claimIndex, {
          entailment: item.entailment,
          verbatimExcerpt: item.verbatimExcerpt || '',
          rationale: item.rationale || '',
          confidenceScore: item.confidenceScore ?? 0.95,
          promptTokens: 0,
          completionTokens: 0,
        });
      }

      return {
        verdicts: map,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
      };
    } catch {
      // Graceful fallback to sequential verification if batch parsing fails
      const map = new Map<number, VerificationVerdict>();
      let pTokens = 0;
      let cTokens = 0;
      for (let i = 0; i < params.claims.length; i++) {
        const single = await this.verifyClaimAgainstSource({
          claimText: params.claims[i].claimText,
          source: params.source,
        });
        map.set(i, single);
        pTokens += single.promptTokens ?? 0;
        cTokens += single.completionTokens ?? 0;
      }
      return { verdicts: map, promptTokens: pTokens, completionTokens: cTokens };
    }
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
      // 1. Batch verify all claims across each source document
      // This reduces N * M Gemini calls down to M calls (e.g. 10 calls -> 1-2 calls)
      const sourceVerdicts = new Map<string, Map<number, VerificationVerdict>>();

      for (const source of params.sources) {
        const batchRes = await this.verifyClaimsBatchAgainstSource({
          claims: params.claims,
          source,
        });
        totalPromptTokens += batchRes.promptTokens;
        totalCompletionTokens += batchRes.completionTokens;
        sourceVerdicts.set(source.id, batchRes.verdicts);
      }

      // Check whether authoritative primary lab evidence is already present for this story
      const hasAuthoritativePrimary = params.sources.some(
        (s) => s.sourceTier === 'tier_1_primary' && s.text.trim().length > 300
      );

      // 2. Aggregate evidence per claim
      for (let i = 0; i < params.claims.length; i++) {
        const claim = params.claims[i];
        const evidences: VerifiedClaimOutcome['evidences'] = [];
        let supportsCount = 0;
        let hasPrimarySupport = false;
        let refutesCount = 0;
        let maxConfidence = 0;

        for (const source of params.sources) {
          const verdictsForSource = sourceVerdicts.get(source.id);
          let verdict = verdictsForSource?.get(i);
          if (!verdict) {
            verdict = await this.verifyClaimAgainstSource({
              claimText: claim.claimText,
              source,
            });
          }

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

        // 3. Conditional Tavily Search:
        // Principle: Only call Tavily if:
        // - The claim is disputed (contradicted between sources), OR
        // - The claim is unverified AND we do NOT already have authoritative primary lab documentation
        const isContradicted = refutesCount > 0;
        const needsTavilyCorroboration =
          isContradicted || (verificationStatus === 'unverified' && !hasAuthoritativePrimary);

        if (needsTavilyCorroboration) {
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
    } catch (err) {
      if (runId) {
        await this.logger.finishRun(runId, {
          status: 'failed',
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          latencyMs: Date.now() - startTime,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  }
}
